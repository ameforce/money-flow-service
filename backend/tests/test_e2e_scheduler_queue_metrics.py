from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
import time
from typing import final

from scripts.e2e_scheduler.model import JobId, JobSpec, WorkerId
from scripts.e2e_scheduler.queue import EligibleJobQueue


@final
class _CapacityGate:
    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self.checked = Event()

    def assignment_capacity(self) -> int:
        self.checked.set()
        return self.capacity

    def worker_is_enabled(self, worker_id: WorkerId, capacity: int) -> bool:
        _ = (worker_id, capacity)
        return True

    def wait_timeout_seconds(self) -> float:
        return 60.0

    def record_worker_crash(self) -> None:
        return None

    def record_unexpected_failure(self) -> None:
        return None


def _job(
    job_id: str,
    *,
    project: str = "chromium",
    locks: frozenset[str] | None = None,
) -> JobSpec:
    return JobSpec(
        job_id=JobId(job_id),
        project=project,
        spec_path=Path(f"e2e/specs/{job_id}.spec.js"),
        logical_group=job_id,
        tests=(),
        locks=frozenset() if locks is None else locks,
        estimated_seconds=1.0,
    )


def test_immediate_assignment_records_nonnegative_queue_cost_without_idle() -> None:
    queue = EligibleJobQueue((_job("ready"),))

    assignment = queue.acquire_assignment(WorkerId("worker-1"))

    assert assignment is not None
    assert assignment.metrics.queue_wait_seconds >= 0.0
    assert assignment.metrics.assignment_seconds >= 0.0
    assert assignment.metrics.eligible_idle_seconds == 0.0
    assert assignment.metrics.avoidable_idle_count == 0


def test_capacity_wait_is_attributed_to_next_assignment() -> None:
    gate = _CapacityGate(1)
    queue = EligibleJobQueue(
        (_job("first"), _job("second")),
        capacity_controller=gate,
    )
    first = queue.acquire_assignment(WorkerId("worker-1"))
    assert first is not None
    gate.checked.clear()

    with ThreadPoolExecutor(max_workers=1) as executor:
        waiting = executor.submit(queue.acquire_assignment, WorkerId("worker-2"))
        assert gate.checked.wait(timeout=1)
        time.sleep(0.02)
        queue.complete(WorkerId("worker-1"), first.job.job_id)
        second = waiting.result(timeout=1)

    assert second is not None
    assert second.metrics.capacity_blocked_seconds >= 0.01
    assert second.metrics.avoidable_idle_count == 0


def test_lock_wait_is_attributed_without_false_avoidable_idle() -> None:
    queue = EligibleJobQueue(
        (
            _job("mail-a", locks=frozenset({"mail-server"})),
            _job("mail-b", locks=frozenset({"mail-server"})),
        )
    )
    first = queue.acquire_assignment(WorkerId("worker-1"))
    assert first is not None

    with ThreadPoolExecutor(max_workers=1) as executor:
        waiting = executor.submit(queue.acquire_assignment, WorkerId("worker-2"))
        time.sleep(0.02)
        queue.complete(WorkerId("worker-1"), first.job.job_id)
        second = waiting.result(timeout=1)

    assert second is not None
    assert second.metrics.lock_blocked_seconds >= 0.01
    assert second.metrics.eligible_idle_seconds == 0.0
    assert second.metrics.avoidable_idle_count == 0


def test_affinity_wait_is_attributed_until_primary_lane_is_terminal() -> None:
    firefox = _job("firefox", project="matrix-firefox")
    chromium = _job("chromium")
    owner = WorkerId("worker-owner")
    tail = WorkerId("worker-tail")
    queue = EligibleJobQueue(
        (firefox, chromium),
        worker_projects={
            owner: frozenset({"matrix-firefox"}),
            tail: frozenset({"matrix-firefox"}),
        },
        worker_fallback_projects={tail: frozenset({"chromium"})},
    )
    primary = queue.acquire_assignment(owner)
    assert primary is not None

    with ThreadPoolExecutor(max_workers=1) as executor:
        waiting = executor.submit(queue.acquire_assignment, tail)
        time.sleep(0.02)
        queue.complete(owner, primary.job.job_id)
        stolen = waiting.result(timeout=1)

    assert stolen is not None
    assert stolen.metrics.affinity_blocked_seconds >= 0.01
    assert stolen.metrics.avoidable_idle_count == 0
