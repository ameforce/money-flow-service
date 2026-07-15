from __future__ import annotations

from pathlib import Path
from threading import Event, Lock
from typing import final

from backend.tests import e2e_scheduler_runner_errors as runner_errors
from backend.tests.e2e_scheduler_runner_capsule_fake import FakeCapsule
from scripts.e2e_scheduler.aggregate import AggregationError, JobResult
from scripts.e2e_scheduler.discovery import canonical_test_id
from scripts.e2e_scheduler.history import DurationHistory, DurationRecord
from scripts.e2e_scheduler.model import (
    DiscoveredTest,
    JobSpec,
    RunId,
    RunManifest,
    WorkerId,
)
from scripts.e2e_scheduler.runner import WorkerCrash
from scripts.e2e_scheduler.runner_options import RunnerMode, RunnerOptions
from scripts.e2e_scheduler.runner_worker import CapsuleWorker
from scripts.e2e_scheduler.resources import ResourceSample
from scripts.e2e_scheduler.project_profiles import BrowserEngine
from scripts.e2e_scheduler.adaptive import CapacityDecision
from scripts.e2e_scheduler.runner_worker import (
    RunMetricsSnapshot,
    RunMetricsStatus,
    TimedJobResult,
)
from scripts.e2e_scheduler.metrics import RunTelemetry


class _FakeResourceSampler:
    def sample(self) -> ResourceSample:
        return ResourceSample(50.0, 50.0, 100.0, 0, 0)


@final
class FakeRuntime:
    """Boundary fake that keeps real manifest, queue, and history behavior."""

    def __init__(
        self,
        tmp_path: Path,
        tests: tuple[DiscoveredTest, ...],
        *,
        crashing_specs: frozenset[str] | None = None,
        aggregate_failure: bool = False,
        build_code: int = 0,
        cleanup_failing_workers: frozenset[WorkerId] | None = None,
        startup_failing_workers: frozenset[WorkerId] | None = None,
        capacity_decision_failure: bool = False,
        history_failure: bool = False,
        metrics_publication_failure: bool = False,
    ) -> None:
        self.tmp_path = tmp_path
        self.tests = tests
        self.crashing_specs = crashing_specs or frozenset()
        self.aggregate_failure = aggregate_failure
        self.build_code = build_code
        self.cleanup_failing_workers = cleanup_failing_workers or frozenset()
        self.startup_failing_workers = startup_failing_workers or frozenset()
        self.capacity_decision_failure = capacity_decision_failure
        self.history_failure = history_failure
        self.metrics_publication_failure = metrics_publication_failure
        self.events: list[str] = []
        self.capsules: list[FakeCapsule] = []
        self.executed_specs: list[str] = []
        self.worker_crashes: list[WorkerCrash] = []
        self.aggregate_calls = 0
        self.history_saved = False
        self.resource_sampler_calls = 0
        self.saved_capacity_decisions: tuple[CapacityDecision, ...] | None = None
        self.saved_run_metrics = False
        self.saved_run_metrics_status: RunMetricsStatus | None = None
        self.saved_run_metrics_expected_jobs: int | None = None
        self.saved_run_metrics_completed_jobs: int | None = None
        self._lock = Lock()
        self._crash_recorded = Event()
        self._history = DurationHistory(
            records=tuple(
                DurationRecord(
                    test_id=test.test_id,
                    spec_path=test.spec_path,
                    seconds=float(100 - index),
                )
                for index, test in enumerate(tests)
            )
        )

    def new_run_id(self) -> RunId:
        return RunId("run-test")

    def build_frontend(self) -> int:
        self.events.append("build")
        return self.build_code

    def discover(self, playwright_args: tuple[str, ...]) -> tuple[DiscoveredTest, ...]:
        _ = playwright_args
        self.events.append("discover")
        return self.tests

    def load_history(self) -> DurationHistory:
        return self._history

    def manifest_path(self, run_id: RunId) -> Path:
        return self.tmp_path / "runs" / str(run_id) / "manifest.json"

    def create_capsule(
        self,
        run_id: RunId,
        worker_id: WorkerId,
        playwright_args: tuple[str, ...],
        browser_engines: tuple[BrowserEngine, ...],
    ) -> CapsuleWorker:
        _ = (playwright_args, browser_engines)
        assert self.manifest_path(run_id).is_file()
        self.events.append(f"create:{worker_id}")
        capsule = FakeCapsule(
            worker_id,
            self.events,
            self.tmp_path,
            worker_id in self.cleanup_failing_workers,
            worker_id in self.startup_failing_workers,
        )
        self.capsules.append(capsule)
        return capsule

    def execute_job(
        self,
        capsule: CapsuleWorker,
        job: JobSpec,
    ) -> TimedJobResult:
        spec_name = job.spec_path.name
        with self._lock:
            self.executed_specs.append(spec_name)
        if spec_name in self.crashing_specs:
            raise runner_errors.FakeWorkerCrashError(spec_name)
        if self.crashing_specs and not self._crash_recorded.wait(timeout=2):
            raise AssertionError("worker crash was not recorded")
        test = job.tests[0]
        artifact_root = self.tmp_path / str(capsule.worker_id) / str(job.job_id)
        return TimedJobResult(
            result=JobResult(
                job_id=job.job_id,
                worker_id=capsule.worker_id,
                project=job.project,
                browser=test.browser,
                viewport=test.viewport,
                repository_root=self.tmp_path,
                report_path=artifact_root / "result.json",
                screenshot_dir=artifact_root / "screenshots",
                evidence_dir=artifact_root / "evidence",
                uiux_evidence_root=artifact_root / "uiux-evidence",
                return_code=0,
                expected_evidence_names=(),
                cleanup_succeeded=False,
            ),
            seconds=1.0,
        )

    def aggregate(
        self,
        manifest: RunManifest,
        results: tuple[JobResult, ...],
    ) -> None:
        self.aggregate_calls += 1
        self.events.append("aggregate")
        if self.aggregate_failure or len(results) != len(manifest.jobs):
            raise AggregationError("fake incomplete run")

    def publish_complete(
        self,
        manifest: RunManifest,
        results: tuple[JobResult, ...],
        snapshot: RunMetricsSnapshot,
    ) -> None:
        self.aggregate_calls += 1
        self.events.append("aggregate")
        _ = self.process_telemetry()
        if self.aggregate_failure or len(results) != len(manifest.jobs):
            raise AggregationError("fake incomplete run")
        if self.metrics_publication_failure:
            raise AggregationError("fake metrics publication failed")
        self.saved_run_metrics = True
        self.saved_run_metrics_status = snapshot.status
        self.saved_run_metrics_expected_jobs = snapshot.expected_jobs
        self.saved_run_metrics_completed_jobs = len(snapshot.results)
        self.events.append(f"metrics:{snapshot.status}")

    def save_history(self, history: DurationHistory) -> None:
        _ = history
        if self.history_failure:
            raise OSError("history cache unavailable")
        self.events.append("history")
        self.history_saved = True

    def record_worker_crash(self, crash: WorkerCrash) -> None:
        self.worker_crashes.append(crash)
        self.events.append("worker-crash")
        self._crash_recorded.set()

    def create_resource_sampler(
        self,
        capsules: tuple[CapsuleWorker, ...],
    ) -> _FakeResourceSampler:
        _ = capsules
        self.resource_sampler_calls += 1
        return _FakeResourceSampler()

    def save_capacity_decisions(
        self,
        run_id: RunId,
        decisions: tuple[CapacityDecision, ...],
    ) -> None:
        _ = run_id
        if self.capacity_decision_failure:
            raise OSError("capacity evidence unavailable")
        self.saved_capacity_decisions = decisions

    def save_run_metrics(
        self,
        run_id: RunId,
        snapshot: RunMetricsSnapshot,
    ) -> None:
        _ = run_id
        self.saved_run_metrics = True
        self.saved_run_metrics_status = snapshot.status
        self.saved_run_metrics_expected_jobs = snapshot.expected_jobs
        self.saved_run_metrics_completed_jobs = len(snapshot.results)
        self.events.append(f"metrics:{snapshot.status}")

    def process_telemetry(self) -> RunTelemetry:
        return RunTelemetry()


def make_test(index: int) -> DiscoveredTest:
    spec_path = Path(f"e2e/specs/flow-{index}.spec.js")
    title_path = ("flow", f"case {index}")
    return DiscoveredTest(
        test_id=canonical_test_id(
            "desktop-chromium",
            spec_path,
            10,
            title_path,
        ),
        project="desktop-chromium",
        spec_path=spec_path,
        line=10,
        title_path=title_path,
        browser="chromium",
        viewport=(1280, 720),
        estimated_seconds=30.0,
    )


def make_options(workers: int = 4) -> RunnerOptions:
    return RunnerOptions(
        mode=RunnerMode.DYNAMIC,
        scheduler_workers=workers,
        adaptive_workers=False,
        benchmark_label=None,
        html_report=False,
        project_matrix=True,
        include_slow=False,
        playwright_args=(),
    )
