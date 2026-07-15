"""Local subprocess and filesystem adapter for the dynamic coordinator."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import time
from uuid import uuid4

from scripts.e2e_scheduler.aggregate import JobResult, aggregate_run
from scripts.e2e_scheduler.capsule import WorkerCapsule
from scripts.e2e_scheduler.capsule_settings import CapsuleSettings
from scripts.e2e_scheduler.history import DurationHistory
from scripts.e2e_scheduler.evidence_expectations import parse_evidence_expectations
from scripts.e2e_scheduler.model import (
    DiscoveredTest,
    JobSpec,
    RunId,
    RunManifest,
    WorkerId,
)
from scripts.e2e_scheduler.runner_options import RunnerOptions
from scripts.e2e_scheduler.runtime_profile import parse_runtime_profile
from scripts.e2e_scheduler.runner_worker import (
    CapsuleWorker,
    TimedJobResult,
    WorkerCrash,
)
from scripts.e2e_scheduler.adaptive import CapacityDecision, ResourceSampler
from scripts.e2e_scheduler.resource_sampling import CapsuleResourceSampler
from scripts.e2e_scheduler.resources import WindowsSystemSampler
from scripts.e2e_scheduler.adaptive_artifacts import save_capacity_decisions
from scripts.e2e_scheduler.run_metrics import (
    RunMetricsConfiguration,
    save_run_metrics,
)
from scripts.e2e_scheduler.runner_worker import RunMetricsSnapshot
from scripts.e2e_scheduler.legacy_runtime import build_frontend_for_static
from scripts.e2e_scheduler.runtime_support import (
    ROOT,
    SCREENSHOT_DIR,
    with_local_playwright_runtime,
)
from scripts.e2e_scheduler.job_metrics import load_job_metrics
from scripts.e2e_scheduler.process_launch import resolve_dynamic_windows_spawn_mode
from scripts.e2e_scheduler.project_profiles import BrowserEngine
from scripts.e2e_scheduler.metrics import RunTelemetry
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.runner_process_telemetry import snapshot_run_telemetry
from scripts.e2e_scheduler.runner_discovery import (
    DiscoveryProcessError as DiscoveryProcessError,
    discover_local_tests,
)


def _process_metrics_recorder() -> ProcessMetricsRecorder:
    if os.name != "nt":
        return ProcessMetricsRecorder()
    from scripts.e2e_scheduler.windows_process_resources import (
        current_process_resource_usage,
    )

    return ProcessMetricsRecorder(current_process_resource_usage)


@dataclass(frozen=True, slots=True)
class LocalSchedulerRuntime:
    options: RunnerOptions
    repository_root: Path = ROOT
    scheduler_root: Path = ROOT / "output" / "playwright" / "e2e-scheduler"
    publication_root: Path = SCREENSHOT_DIR
    history_path: Path = ROOT / "output" / "playwright" / "e2e-duration-history.json"
    _process_metrics: ProcessMetricsRecorder = field(
        default_factory=_process_metrics_recorder,
        init=False,
        compare=False,
        repr=False,
    )

    def new_run_id(self) -> RunId:
        return RunId(f"{datetime.now(UTC).strftime('%Y%m%dT%H%M%S')}-{uuid4().hex[:8]}")

    def build_frontend(self) -> int:
        return build_frontend_for_static(
            None,
            metrics_recorder=self._process_metrics,
            windows_spawn_mode=resolve_dynamic_windows_spawn_mode(),
        )

    def discover(
        self,
        playwright_args: tuple[str, ...],
    ) -> tuple[DiscoveredTest, ...]:
        env = with_local_playwright_runtime()
        env.update(_runner_environment(self.options))
        return discover_local_tests(
            playwright_args,
            self.repository_root,
            self.options.project_matrix,
            env,
            self._process_metrics,
        )

    def load_history(self) -> DurationHistory:
        return DurationHistory.load(self.history_path)

    def manifest_path(self, run_id: RunId) -> Path:
        return self.scheduler_root / "runs" / str(run_id) / "manifest.json"

    def create_capsule(
        self,
        run_id: RunId,
        worker_id: WorkerId,
        playwright_args: tuple[str, ...],
        browser_engines: tuple[BrowserEngine, ...],
    ) -> CapsuleWorker:
        settings = CapsuleSettings(
            playwright_args=playwright_args,
            html_report=self.options.html_report,
            project_matrix=self.options.project_matrix,
            include_slow=self.options.include_slow,
            browser_engines=browser_engines,
        )
        return WorkerCapsule(
            self.scheduler_root,
            run_id,
            worker_id,
            self.repository_root,
            settings,
            self._process_metrics,
        )

    def execute_job(
        self,
        capsule: CapsuleWorker,
        job: JobSpec,
    ) -> TimedJobResult:
        started = time.monotonic()
        return_code = capsule.run_job(job)
        seconds = max(time.monotonic() - started, 0.001)
        paths = capsule.job_paths(job.job_id)
        profile = parse_runtime_profile(paths.runtime_profile)
        expected_evidence = parse_evidence_expectations(paths.evidence_expectations)
        return TimedJobResult(
            JobResult(
                job_id=job.job_id,
                worker_id=capsule.worker_id,
                project=profile.project,
                browser=profile.browser,
                viewport=profile.viewport,
                repository_root=capsule.repository_root,
                report_path=paths.json_report,
                screenshot_dir=paths.screenshots,
                evidence_dir=paths.evidence,
                return_code=return_code,
                expected_evidence_names=expected_evidence,
                cleanup_succeeded=False,
                uiux_evidence_root=paths.uiux_evidence,
            ),
            seconds,
            load_job_metrics(paths.json_report.parent / "scheduler-metrics.json"),
        )

    def aggregate(
        self,
        manifest: RunManifest,
        results: tuple[JobResult, ...],
    ) -> None:
        _ = aggregate_run(manifest, results, self.publication_root)

    def save_history(self, history: DurationHistory) -> None:
        history.save(self.history_path)

    def record_worker_crash(self, crash: WorkerCrash) -> None:
        path = self.manifest_path(crash.run_id).with_name("worker-crash.json")
        temporary = path.with_suffix(".json.tmp")
        _ = temporary.write_text(
            json.dumps(
                {
                    "worker_id": str(crash.worker_id),
                    "job_id": str(crash.job_id) if crash.job_id is not None else None,
                    "error_type": crash.error_type,
                    "detail": crash.detail,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        _ = temporary.replace(path)

    def create_resource_sampler(
        self,
        capsules: tuple[CapsuleWorker, ...],
    ) -> ResourceSampler:
        return CapsuleResourceSampler(
            WindowsSystemSampler(),
            capsules,
            self._process_metrics,
        )

    def save_capacity_decisions(
        self,
        run_id: RunId,
        decisions: tuple[CapacityDecision, ...],
    ) -> None:
        save_capacity_decisions(
            self.manifest_path(run_id).with_name("capacity-decisions.json"),
            decisions,
        )

    def save_run_metrics(
        self,
        run_id: RunId,
        snapshot: RunMetricsSnapshot,
    ) -> None:
        save_run_metrics(
            self.manifest_path(run_id).with_name("run-metrics.json"),
            snapshot,
            RunMetricsConfiguration(
                benchmark_invocation_id=str(
                    os.environ.get("E2E_BENCHMARK_INVOCATION_ID") or ""
                ),
                adaptive=self.options.adaptive_workers,
                initial_workers=self.options.scheduler_workers,
                started_workers=snapshot.started_workers,
            ),
        )

    def process_telemetry(self) -> RunTelemetry:
        return snapshot_run_telemetry(self._process_metrics)


def _runner_environment(options: RunnerOptions) -> Mapping[str, str]:
    env: dict[str, str] = {}
    if options.html_report:
        env["E2E_HTML_REPORT"] = "1"
    if options.project_matrix:
        env["E2E_PROJECT_MATRIX"] = "1"
    if options.include_slow:
        env["E2E_INCLUDE_SLOW"] = "1"
    return env
