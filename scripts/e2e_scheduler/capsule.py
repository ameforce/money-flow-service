"""One isolated warm process and filesystem capsule for scheduler jobs."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
from threading import Event
import time
from types import TracebackType
from typing import Self, final, override

from scripts.e2e_scheduler.active_job import ActiveJobController
from scripts.e2e_scheduler.browser import BrowserServerHandle, BrowserServerStartError
from scripts.e2e_scheduler.browser_pool import BrowserServerPool
from scripts.e2e_scheduler.capsule_cleanup import (
    remove_file_with_retry,
    sqlite_database_files,
)
from scripts.e2e_scheduler.capsule_job_execution import (
    JobMetricsRecord,
    PlaywrightProcessRequest,
    acquire_browser,
    prepare_job_paths,
    record_job_metrics,
    run_playwright_process,
)
from scripts.e2e_scheduler.capsule_job_launch import JobLaunchRequest, build_job_launch
from scripts.e2e_scheduler.capsule_paths import JobPaths, build_job_paths
from scripts.e2e_scheduler.capsule_reset import reset_capsule_state
from scripts.e2e_scheduler.capsule_settings import CapsuleSettings
from scripts.e2e_scheduler.capsule_services import (
    CapsuleServiceStartError,
    CapsuleServices,
)
from scripts.e2e_scheduler.model import JobId, JobSpec, RunId, WorkerId
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.project_profiles import project_profile
from scripts.e2e_scheduler.runtime_support import (
    ROOT as REPOSITORY_ROOT,
    is_up,
)

__all__ = (
    "BrowserServerHandle",
    "BrowserServerStartError",
    "CapsuleError",
    "WorkerCapsule",
)


@dataclass(slots=True)
class CapsuleError(Exception):
    run_id: RunId
    worker_id: WorkerId
    reason: str

    @override
    def __str__(self) -> str:
        return f"capsule {self.run_id}/{self.worker_id}: {self.reason}"


@final
class WorkerCapsule:
    """Mutable lifecycle owner for one warm browser and orchestrator pair."""

    __slots__ = (
        "_active_jobs",
        "_last_reset_metrics",
        "_metrics_recorder",
        "_services",
        "_stop_requested",
        "repository_root",
        "root",
        "run_id",
        "settings",
        "worker_id",
    )

    def __init__(
        self,
        root: Path,
        run_id: RunId,
        worker_id: WorkerId,
        repository_root: Path = REPOSITORY_ROOT,
        settings: CapsuleSettings | None = None,
        metrics_recorder: ProcessMetricsRecorder | None = None,
    ) -> None:
        self.root = root
        self.run_id = run_id
        self.worker_id = worker_id
        self.repository_root = repository_root
        self.settings = settings or CapsuleSettings()
        self._services: CapsuleServices | None = None
        self._active_jobs = ActiveJobController(run_id, worker_id)
        self._last_reset_metrics = (0.0, 0, 0.0, 0.0)
        self._metrics_recorder = metrics_recorder
        self._stop_requested = Event()

    @property
    def worker_root(self) -> Path:
        return self.root / "runs" / str(self.run_id) / "workers" / str(self.worker_id)

    @property
    def is_started(self) -> bool:
        return self._services is not None

    @property
    def database_path(self) -> Path:
        return self.worker_root / "database.sqlite3"

    @property
    def temporary_root(self) -> Path:
        return self.worker_root / "temporary"

    @property
    def uploads_root(self) -> Path:
        return self.worker_root / "uploads"

    @property
    def backend_upload_root(self) -> Path:
        return self.worker_root / "tmp_import_uploads"

    @property
    def browser_profile_root(self) -> Path:
        return self.worker_root / "browser"

    @property
    def logs_root(self) -> Path:
        return self.worker_root / "logs"

    def job_paths(self, job_id: JobId) -> JobPaths:
        return build_job_paths(self.worker_root, job_id)

    def start(self) -> None:
        if self._services is not None:
            raise CapsuleError(self.run_id, self.worker_id, "already started")
        self.worker_root.mkdir(parents=True, exist_ok=True)
        self.temporary_root.mkdir(parents=True, exist_ok=True)
        self.uploads_root.mkdir(parents=True, exist_ok=True)
        self.logs_root.mkdir(parents=True, exist_ok=True)
        try:
            self._services = CapsuleServices.start(
                repository_root=self.repository_root,
                worker_root=self.worker_root,
                database_path=self.database_path,
                logs_root=self.logs_root,
                initial_browser_engine=self.settings.browser_engines[0],
                stop_requested=self._stop_requested.is_set,
                metrics_recorder=self._metrics_recorder,
            )
        except CapsuleServiceStartError as error:
            raise CapsuleError(self.run_id, self.worker_id, str(error)) from error

    def run_job(self, job: JobSpec) -> int:
        backend_port, browser, frontend_origin = self._running_services()
        browser_engine = project_profile(job.project).browser
        if browser_engine not in self.settings.browser_engines:
            raise CapsuleError(
                self.run_id,
                self.worker_id,
                f"project {job.project} requires unassigned browser {browser_engine}",
            )
        acquisition = acquire_browser(
            browser,
            browser_engine,
            self.settings.browser_engines[0],
        )
        paths = self.job_paths(job.job_id)
        prepare_job_paths(job, paths)
        launch = build_job_launch(
            JobLaunchRequest(
                repository_root=self.repository_root,
                run_id=self.run_id,
                worker_id=self.worker_id,
                settings=self.settings,
                job=job,
                paths=paths,
                backend_port=backend_port,
                frontend_origin=frontend_origin,
                browser_endpoint=acquisition.endpoint,
            )
        )
        process_started = time.monotonic()
        try:
            return run_playwright_process(
                PlaywrightProcessRequest(
                    launch=launch,
                    paths=paths,
                    repository_root=self.repository_root,
                    active_jobs=self._active_jobs,
                    metrics_recorder=self._metrics_recorder,
                )
            )
        finally:
            process_seconds = max(time.monotonic() - process_started, 0.0)
            try:
                self.reset()
            finally:
                record_job_metrics(
                    JobMetricsRecord(
                        job=job,
                        paths=paths,
                        repository_root=self.repository_root,
                        browser=acquisition.metrics,
                        process_seconds=process_seconds,
                        reset_seconds=self._last_reset_metrics,
                    )
                )

    def request_stop(self) -> None:
        self._stop_requested.set()
        self._active_jobs.request_stop()

    def reset(self) -> None:
        _ = self._running_services()
        self._last_reset_metrics = reset_capsule_state(
            self.database_path,
            self.temporary_root,
            self.uploads_root,
            self.backend_upload_root,
        )

    def backend_health_latency_ms(self) -> float:
        backend_port, _browser, _frontend = self._running_services()
        started = time.monotonic()
        if not is_up(f"http://127.0.0.1:{backend_port}/healthz"):
            raise OSError(f"worker {self.worker_id} backend health probe failed")
        return max((time.monotonic() - started) * 1000.0, 0.001)

    def close(self) -> None:
        failures: list[str] = []
        if self._services is not None:
            failures.extend(self._services.close())
            self._services = None
        for path in (
            self.temporary_root,
            self.uploads_root,
            self.backend_upload_root,
            self.browser_profile_root,
        ):
            try:
                if path.exists():
                    shutil.rmtree(path)
            except OSError as error:
                failures.append(f"remove {path}: {error}")
        for path in sqlite_database_files(self.database_path):
            try:
                remove_file_with_retry(path)
            except OSError as error:
                failures.append(f"remove {path}: {error}")
        if failures:
            raise CapsuleError(self.run_id, self.worker_id, "; ".join(failures))

    def __enter__(self) -> Self:
        self.start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        self.close()
        return False

    def _running_services(self) -> tuple[int, BrowserServerPool, str]:
        if self._services is None:
            raise CapsuleError(self.run_id, self.worker_id, "not started")
        return (
            self._services.backend_port,
            self._services.browser,
            self._services.origin,
        )
