from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Condition, Event
from typing import final, override

import pytest

from scripts.e2e_scheduler.locks import locks_are_compatible
from scripts.e2e_scheduler.model import JobId, JobSpec, WorkerId
from scripts.e2e_scheduler.queue import (
    AssignmentOwnerError,
    DuplicateJobIdError,
    DuplicateTerminalJobError,
    EligibleJobQueue,
    LostAssignmentError,
    WorkerAlreadyAssignedError,
)


@final
class _WaitingCondition(Condition):
    """Signal immediately before releasing the condition lock to wait."""

    def __init__(self, wait_entered: Event) -> None:
        super().__init__()
        self._wait_entered = wait_entered

    @override
    def wait(self, timeout: float | None = None) -> bool:
        self._wait_entered.set()
        return super().wait(timeout)


def job(
    job_id: str,
    estimated_seconds: float,
    locks: set[str] | None = None,
) -> JobSpec:
    return JobSpec(
        job_id=JobId(job_id),
        project="chromium",
        spec_path=Path(f"e2e/specs/{job_id}.spec.js"),
        logical_group=job_id,
        tests=(),
        locks=frozenset(locks or ()),
        estimated_seconds=estimated_seconds,
    )


def test_idle_worker_takes_longest_eligible_job() -> None:
    # Given
    queue = EligibleJobQueue(
        (
            job("mail", 90, {"mail-server"}),
            job("fast", 20),
            job("slow", 80),
        )
    )

    # When
    first = queue.acquire(WorkerId("worker-1"))
    second = queue.acquire(WorkerId("worker-2"))

    # Then
    assert first is not None
    assert second is not None
    assert first.job_id == JobId("mail")
    assert second.job_id == JobId("slow")


def test_equal_duration_jobs_are_ordered_by_job_id() -> None:
    # Given
    queue = EligibleJobQueue((job("z-last", 30), job("a-first", 30)))

    # When
    acquired = queue.acquire(WorkerId("worker-1"))

    # Then
    assert acquired is not None
    assert acquired.job_id == JobId("a-first")


def test_worker_project_affinity_preserves_lpt_within_each_lane() -> None:
    chromium = job("chromium", 30)
    firefox = JobSpec(
        job_id=JobId("firefox"),
        project="matrix-firefox",
        spec_path=Path("e2e/specs/firefox.spec.js"),
        logical_group="firefox",
        tests=(),
        locks=frozenset(),
        estimated_seconds=90,
    )
    queue = EligibleJobQueue(
        (firefox, chromium),
        worker_projects={
            WorkerId("worker-1"): frozenset({"chromium"}),
            WorkerId("worker-2"): frozenset({"matrix-firefox"}),
        },
    )

    chromium_job = queue.acquire(WorkerId("worker-1"))
    firefox_job = queue.acquire(WorkerId("worker-2"))

    assert chromium_job == chromium
    assert firefox_job == firefox


def test_cross_browser_worker_steals_chromium_after_every_primary_job_is_terminal() -> None:
    chromium = job("chromium", 100)
    firefox = JobSpec(
        job_id=JobId("firefox"),
        project="matrix-firefox",
        spec_path=Path("e2e/specs/firefox.spec.js"),
        logical_group="firefox",
        tests=(),
        locks=frozenset(),
        estimated_seconds=10,
    )
    worker = WorkerId("worker-cross")
    queue = EligibleJobQueue(
        (chromium, firefox),
        worker_projects={worker: frozenset({"matrix-firefox"})},
        worker_fallback_projects={worker: frozenset({"chromium"})},
    )
    first = queue.acquire(worker)
    assert first == firefox and first is not None
    queue.complete(worker, first.job_id)
    assert queue.acquire(worker) == chromium


def test_duplicate_compatible_job_ids_are_rejected_before_assignment() -> None:
    # Given
    jobs = (job("duplicate", 30), job("duplicate", 20))

    # When / Then
    with pytest.raises(DuplicateJobIdError) as error:
        _ = EligibleJobQueue(jobs)

    assert error.value.job_id == JobId("duplicate")


def test_duplicate_conflicting_job_ids_are_rejected_before_assignment() -> None:
    # Given
    jobs = (
        job("duplicate", 30, {"mail-server"}),
        job("duplicate", 20, {"mail-server"}),
    )

    # When / Then
    with pytest.raises(DuplicateJobIdError) as error:
        _ = EligibleJobQueue(jobs)

    assert error.value.job_id == JobId("duplicate")


def test_locked_job_waits_while_unlocked_work_is_stolen() -> None:
    # Given
    queue = EligibleJobQueue(
        (
            job("mail-a", 90, {"mail-server"}),
            job("mail-b", 80, {"mail-server"}),
            job("free", 10),
        )
    )

    # When
    first = queue.acquire(WorkerId("worker-1"))
    second = queue.acquire(WorkerId("worker-2"))

    # Then
    assert first is not None
    assert second is not None
    assert first.job_id == JobId("mail-a")
    assert second.job_id == JobId("free")


def test_completion_releases_locks_for_waiting_job() -> None:
    # Given
    queue = EligibleJobQueue(
        (
            job("mail-a", 90, {"mail-server"}),
            job("mail-b", 80, {"mail-server"}),
        )
    )
    worker = WorkerId("worker-1")
    first = queue.acquire(worker)
    assert first is not None

    # When
    queue.complete(worker, first.job_id)
    second = queue.acquire(worker)

    # Then
    assert second is not None
    assert second.job_id == JobId("mail-b")


def test_acquire_returns_none_after_every_job_is_terminal() -> None:
    # Given
    queue = EligibleJobQueue((job("only", 10),))
    worker = WorkerId("worker-1")
    acquired = queue.acquire(worker)
    assert acquired is not None
    queue.complete(worker, acquired.job_id)

    # When
    next_job = queue.acquire(worker)

    # Then
    assert next_job is None


def test_duplicate_completion_raises_typed_error() -> None:
    # Given
    queue = EligibleJobQueue((job("only", 10),))
    worker = WorkerId("worker-1")
    acquired = queue.acquire(worker)
    assert acquired is not None
    queue.complete(worker, acquired.job_id)

    # When / Then
    with pytest.raises(DuplicateTerminalJobError):
        queue.complete(worker, acquired.job_id)


def test_completion_by_wrong_worker_raises_typed_error() -> None:
    # Given
    queue = EligibleJobQueue((job("only", 10),))
    acquired = queue.acquire(WorkerId("owner"))
    assert acquired is not None

    # When / Then
    with pytest.raises(AssignmentOwnerError):
        queue.complete(WorkerId("intruder"), acquired.job_id)


def test_completion_without_assignment_raises_typed_error() -> None:
    # Given
    queue = EligibleJobQueue((job("pending", 10),))

    # When / Then
    with pytest.raises(LostAssignmentError):
        queue.complete(WorkerId("worker-1"), JobId("missing"))


def test_busy_worker_cannot_acquire_second_assignment() -> None:
    # Given
    queue = EligibleJobQueue((job("first", 20), job("second", 10)))
    worker = WorkerId("worker-1")
    first = queue.acquire(worker)
    assert first is not None

    # When / Then
    with pytest.raises(WorkerAlreadyAssignedError) as error:
        _ = queue.acquire(worker)

    assert error.value.job_id == first.job_id


def test_abort_releases_locks_and_makes_job_terminal() -> None:
    # Given
    queue = EligibleJobQueue(
        (
            job("mail-a", 90, {"mail-server"}),
            job("mail-b", 80, {"mail-server"}),
        )
    )
    worker = WorkerId("worker-1")
    first = queue.acquire(worker)
    assert first is not None

    # When
    queue.abort(worker, first.job_id)
    second = queue.acquire(worker)

    # Then
    assert second is not None
    assert second.job_id == JobId("mail-b")


def test_stop_prevents_pending_job_assignment() -> None:
    # Given
    queue = EligibleJobQueue(
        (
            job("mail-a", 90, {"mail-server"}),
            job("mail-b", 80, {"mail-server"}),
        )
    )
    first = queue.acquire(WorkerId("worker-1"))
    assert first is not None

    # When
    queue.stop()

    with ThreadPoolExecutor(max_workers=1) as executor:
        waiting = executor.submit(queue.acquire, WorkerId("worker-2"))
        # Then
        assert waiting.result(timeout=1) is None

    queue.abort(WorkerId("worker-1"), first.job_id)


def test_stop_wakes_worker_already_waiting_on_active_lock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    queue = EligibleJobQueue(
        (
            job("mail-a", 90, {"mail-server"}),
            job("mail-b", 80, {"mail-server"}),
        )
    )
    owner = WorkerId("worker-1")
    first = queue.acquire(owner)
    assert first is not None
    wait_entered = Event()
    monkeypatch.setattr(queue, "_condition", _WaitingCondition(wait_entered))
    executor = ThreadPoolExecutor(max_workers=1)
    waiting = executor.submit(queue.acquire, WorkerId("worker-2"))

    try:
        # When
        assert wait_entered.wait(timeout=1)
        queue.stop()

        # Then
        assert waiting.result(timeout=1) is None
    finally:
        try:
            try:
                queue.stop()
            finally:
                queue.abort(owner, first.job_id)
            _ = waiting.result(timeout=1)
        finally:
            executor.shutdown(wait=False, cancel_futures=True)


def test_lock_compatibility_requires_disjoint_names() -> None:
    # Given
    active = frozenset({"mail-server", "migration-package"})

    # When
    compatible = locks_are_compatible(active, frozenset({"evidence-root"}))
    conflicting = locks_are_compatible(active, frozenset({"mail-server"}))

    # Then
    assert compatible
    assert not conflicting
