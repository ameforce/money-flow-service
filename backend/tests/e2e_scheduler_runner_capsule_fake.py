from __future__ import annotations

from pathlib import Path
from threading import Event

from backend.tests import e2e_scheduler_runner_errors as runner_errors
from backend.tests.e2e_scheduler_runner_paths import FakeJobPaths
from scripts.e2e_scheduler.model import JobId, JobSpec, WorkerId


class FakeCapsule:
    """Observable in-memory worker lifecycle for coordinator integration tests."""

    worker_id: WorkerId
    events: list[str]
    repository_root: Path
    close_calls: int
    stop_requests: int
    stop_event: Event
    fail_close: bool
    fail_start: bool

    def __init__(
        self,
        worker_id: WorkerId,
        events: list[str],
        repository_root: Path,
        fail_close: bool = False,
        fail_start: bool = False,
    ) -> None:
        self.worker_id = worker_id
        self.events = events
        self.repository_root = repository_root
        self.close_calls = 0
        self.stop_requests = 0
        self.stop_event = Event()
        self.fail_close = fail_close
        self.fail_start = fail_start
        self._started = False

    @property
    def is_started(self) -> bool:
        return self._started

    def start(self) -> None:
        self.events.append(f"start:{self.worker_id}")
        if self.fail_start:
            raise runner_errors.FakeWorkerCrashError(str(self.worker_id))
        self._started = True

    def close(self) -> None:
        self.close_calls += 1
        self.events.append(f"close:{self.worker_id}")
        self._started = False
        if self.fail_close:
            raise runner_errors.FakeCleanupError(self.worker_id)

    def request_stop(self) -> None:
        self.stop_requests += 1
        self.stop_event.set()
        self.events.append(f"stop:{self.worker_id}")

    def run_job(self, job: JobSpec) -> int:
        _ = job
        return 0

    def job_paths(self, job_id: JobId) -> FakeJobPaths:
        root = self.repository_root / str(self.worker_id) / str(job_id)
        return FakeJobPaths(
            json_report=root / "result.json",
            runtime_profile=root / "runtime-profile.json",
            evidence_expectations=root / "evidence-expectations.jsonl",
            screenshots=root / "screenshots",
            evidence=root / "evidence",
            uiux_evidence=root / "uiux-evidence",
        )

    def backend_health_latency_ms(self) -> float:
        return 100.0
