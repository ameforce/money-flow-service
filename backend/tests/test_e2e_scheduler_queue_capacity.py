from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from typing import final

from scripts.e2e_scheduler.model import JobId, JobSpec, WorkerId
from scripts.e2e_scheduler.queue import EligibleJobQueue


@final
class _CapacityGate:
    def __init__(
        self,
        capacity: int,
        enabled_workers: frozenset[WorkerId] | None = None,
    ) -> None:
        self.capacity = capacity
        self.enabled_workers = enabled_workers
        self.checked = Event()

    def assignment_capacity(self) -> int:
        self.checked.set()
        return self.capacity

    def worker_is_enabled(self, worker_id: WorkerId, capacity: int) -> bool:
        _ = capacity
        return self.enabled_workers is None or worker_id in self.enabled_workers

    def wait_timeout_seconds(self) -> float:
        return 60.0

    def record_worker_crash(self) -> None:
        return None

    def record_unexpected_failure(self) -> None:
        return None


def _job(job_id: str, estimated_seconds: float) -> JobSpec:
    return JobSpec(
        job_id=JobId(job_id),
        project="chromium",
        spec_path=Path(f"e2e/specs/{job_id}.spec.js"),
        logical_group=job_id,
        tests=(),
        locks=frozenset(),
        estimated_seconds=estimated_seconds,
    )


def test_reduced_capacity_blocks_only_future_assignment_until_slot_opens() -> None:
    # Given
    gate = _CapacityGate(5)
    queue = EligibleJobQueue(
        tuple(_job(f"job-{index}", 10 - index) for index in range(7)),
        capacity_controller=gate,
    )
    active = tuple(
        queue.acquire(WorkerId(f"worker-{index}")) for index in range(1, 6)
    )
    assert all(item is not None for item in active)
    gate.capacity = 4
    gate.checked.clear()
    first, second = active[:2]
    assert first is not None and second is not None
    queue.complete(WorkerId("worker-1"), first.job_id)

    # When
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(queue.acquire, WorkerId("worker-1"))
    try:
        assert gate.checked.wait(timeout=1)
        assert not future.done()
        queue.complete(WorkerId("worker-2"), second.job_id)
        reassigned = future.result(timeout=1)

        # Then
        assert reassigned is not None
    finally:
        queue.stop()
        _ = future.result(timeout=1)
        executor.shutdown(wait=False, cancel_futures=True)


def test_scaled_down_reserve_finishes_current_job_without_reacquiring() -> None:
    # Given
    worker_1 = WorkerId("worker-1")
    reserve = WorkerId("worker-9")
    gate = _CapacityGate(9, frozenset({worker_1, reserve}))
    queue = EligibleJobQueue(
        tuple(_job(f"job-{index}", 10 - index) for index in range(3)),
        capacity_controller=gate,
    )
    current = queue.acquire(reserve)
    assert current is not None

    # When
    gate.capacity = 8
    gate.enabled_workers = frozenset({worker_1})
    queue.complete(reserve, current.job_id)
    gate.checked.clear()
    executor = ThreadPoolExecutor(max_workers=1)
    reserve_future = executor.submit(queue.acquire, reserve)
    try:
        assert gate.checked.wait(timeout=1)
        assert not reserve_future.done()
        while (next_job := queue.acquire(worker_1)) is not None:
            queue.complete(worker_1, next_job.job_id)

        # Then
        assert reserve_future.result(timeout=1) is None
    finally:
        queue.stop()
        executor.shutdown(wait=False, cancel_futures=True)
