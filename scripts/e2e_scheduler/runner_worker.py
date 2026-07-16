"""Worker-loop lifecycle and synchronized dynamic result collection."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, replace
from pathlib import Path
from threading import Lock
from typing import Protocol, final, override

from scripts.e2e_scheduler.aggregate import JobResult
from scripts.e2e_scheduler.history import DurationHistory
from scripts.e2e_scheduler.history_results import duration_results as duration_results
from scripts.e2e_scheduler.model import (
    DiscoveredTest,
    JobId,
    JobSpec,
    RunId,
    RunManifest,
    WorkerId,
)
from scripts.e2e_scheduler.metrics import RunTelemetry
from scripts.e2e_scheduler.queue import EligibleJobQueue
from scripts.e2e_scheduler.adaptive import CapacityDecision, ResourceSampler
from scripts.e2e_scheduler.project_profiles import BrowserEngine
from scripts.e2e_scheduler.runner_cleanup import (
    CleanupOutcome as CleanupOutcome,
    close_capsules as close_capsules,
)
from scripts.e2e_scheduler.runner_result import (
    RunMetricsSnapshot as RunMetricsSnapshot,
    RunMetricsStatus as RunMetricsStatus,
    TimedJobResult as TimedJobResult,
)


class CapsuleWorker(Protocol):
    worker_id: WorkerId
    repository_root: Path

    @property
    def is_started(self) -> bool: ...

    def start(self) -> None: ...

    def close(self) -> None: ...

    def request_stop(self) -> None: ...

    def run_job(self, job: JobSpec) -> int: ...

    def job_paths(self, job_id: JobId) -> JobArtifactPaths: ...

    def backend_health_latency_ms(self) -> float: ...


class JobArtifactPaths(Protocol):
    @property
    def json_report(self) -> Path: ...

    @property
    def runtime_profile(self) -> Path: ...

    @property
    def evidence_expectations(self) -> Path: ...

    @property
    def screenshots(self) -> Path: ...

    @property
    def evidence(self) -> Path: ...

    @property
    def uiux_evidence(self) -> Path: ...


@dataclass(frozen=True, slots=True)
class WorkerCrash:
    run_id: RunId
    worker_id: WorkerId
    job_id: JobId | None
    error_type: str
    detail: str


@dataclass(slots=True)
class WorkerLoopError(Exception):
    crash: WorkerCrash

    @override
    def __str__(self) -> str:
        return (
            f"worker {self.crash.worker_id} crashed on {self.crash.job_id}: "
            f"{self.crash.error_type}: {self.crash.detail}"
        )


class WorkerActivation(Protocol):
    def wait_until_active(self, worker_id: WorkerId) -> bool: ...

    def stop_waiters(self) -> None: ...


class SchedulerRuntime(Protocol):
    def new_run_id(self) -> RunId: ...

    def build_frontend(self) -> int: ...

    def discover(
        self,
        playwright_args: tuple[str, ...],
    ) -> tuple[DiscoveredTest, ...]: ...

    def load_history(self) -> DurationHistory: ...

    def manifest_path(self, run_id: RunId) -> Path: ...

    def create_capsule(
        self,
        run_id: RunId,
        worker_id: WorkerId,
        playwright_args: tuple[str, ...],
        browser_engines: tuple[BrowserEngine, ...],
    ) -> CapsuleWorker: ...

    def execute_job(
        self,
        capsule: CapsuleWorker,
        job: JobSpec,
    ) -> TimedJobResult: ...

    def publish_complete(
        self,
        manifest: RunManifest,
        results: tuple[JobResult, ...],
        snapshot: RunMetricsSnapshot,
    ) -> None: ...

    def save_history(self, history: DurationHistory) -> None: ...

    def record_worker_crash(self, crash: WorkerCrash) -> None: ...

    def create_resource_sampler(
        self,
        capsules: tuple[CapsuleWorker, ...],
    ) -> ResourceSampler: ...

    def save_capacity_decisions(
        self,
        run_id: RunId,
        decisions: tuple[CapacityDecision, ...],
    ) -> None: ...

    def save_run_metrics(
        self,
        run_id: RunId,
        snapshot: RunMetricsSnapshot,
    ) -> None: ...

    def process_telemetry(self) -> RunTelemetry: ...


@final
class ResultLedger:
    """Thread-safe mutable collection for one coordinator run."""

    def __init__(self) -> None:
        self._items: list[TimedJobResult] = []
        self._lock = Lock()

    def add(self, result: TimedJobResult) -> None:
        with self._lock:
            self._items.append(result)

    def finalized(
        self,
        cleanup: tuple[CleanupOutcome, ...],
    ) -> tuple[TimedJobResult, ...]:
        cleanup_by_worker = {item.worker_id: item.succeeded for item in cleanup}
        with self._lock:
            return tuple(
                replace(
                    item,
                    result=replace(
                        item.result,
                        cleanup_succeeded=cleanup_by_worker[item.result.worker_id],
                    ),
                )
                for item in self._items
            )


def run_worker_pool(
    run_id: RunId,
    capsules: tuple[CapsuleWorker, ...],
    queue: EligibleJobQueue,
    ledger: ResultLedger,
    runtime: SchedulerRuntime,
    activation: WorkerActivation | None = None,
) -> WorkerCrash | None:
    first_crash: WorkerCrash | None = None
    executor = ThreadPoolExecutor(max_workers=len(capsules))
    try:
        futures = tuple(
            executor.submit(
                _worker_loop,
                run_id,
                capsule,
                queue,
                ledger,
                runtime,
                activation,
            )
            for capsule in capsules
        )
        for future in as_completed(futures):
            try:
                future.result()
            except WorkerLoopError as error:
                if first_crash is None:
                    first_crash = error.crash
                    runtime.record_worker_crash(first_crash)
    except (KeyboardInterrupt, SystemExit):
        queue.stop()
        if activation is not None:
            activation.stop_waiters()
        for capsule in capsules:
            try:
                capsule.request_stop()
            except Exception as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
                print(
                    f"[e2e-runner] capsule interrupt failed: {error}",
                    flush=True,
                )
        raise
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
    return first_crash


def _worker_loop(
    run_id: RunId,
    capsule: CapsuleWorker,
    queue: EligibleJobQueue,
    ledger: ResultLedger,
    runtime: SchedulerRuntime,
    activation: WorkerActivation | None,
) -> None:
    job: JobSpec | None = None
    terminal = False
    try:
        if activation is not None and not activation.wait_until_active(
            capsule.worker_id
        ):
            return
        while True:
            assignment = queue.acquire_assignment(capsule.worker_id)
            if assignment is None:
                if activation is not None:
                    activation.stop_waiters()
                return
            job = assignment.job
            terminal = False
            result = runtime.execute_job(capsule, job)
            result = replace(
                result,
                metrics=replace(result.metrics, queue=assignment.metrics),
            )
            if result.result.return_code != 0:
                queue.record_unexpected_failure()
            queue.complete(capsule.worker_id, job.job_id)
            terminal = True
            ledger.add(result)
    except WorkerLoopError:
        queue.record_worker_crash()
        queue.stop()
        if activation is not None:
            activation.stop_waiters()
        raise
    except Exception as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
        queue.record_worker_crash()
        queue.stop()
        if activation is not None:
            activation.stop_waiters()
        if job is not None and not terminal:
            queue.abort(capsule.worker_id, job.job_id)
        raise WorkerLoopError(
            WorkerCrash(
                run_id=run_id,
                worker_id=capsule.worker_id,
                job_id=job.job_id if job is not None else None,
                error_type=type(error).__name__,
                detail=str(error),
            )
        ) from error
