from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Condition, Event
from typing import final, override

import pytest

from scripts.e2e_scheduler.model import JobId, JobSpec, WorkerId
from scripts.e2e_scheduler.queue import EligibleJobQueue


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


def _job(job_id: str, project: str, seconds: float) -> JobSpec:
    return JobSpec(
        job_id=JobId(job_id),
        project=project,
        spec_path=Path(f"e2e/specs/{job_id}.spec.js"),
        logical_group=job_id,
        tests=(),
        locks=frozenset(),
        estimated_seconds=seconds,
    )


def test_only_tail_assistant_steals_after_all_chromium_jobs_are_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    chromium_long = _job("chromium-long", "chromium", 100)
    chromium_short = _job("chromium-short", "chromium", 90)
    firefox_tail = _job("firefox-tail", "matrix-firefox", 80)
    webkit_tail = _job("webkit-tail", "matrix-webkit", 70)
    worker_one = WorkerId("worker-1")
    other_chromium_worker = WorkerId("worker-6")
    assistant = WorkerId("worker-7")
    queue = EligibleJobQueue(
        (chromium_long, chromium_short, firefox_tail, webkit_tail),
        worker_projects={
            worker_one: frozenset({"chromium"}),
            other_chromium_worker: frozenset({"chromium"}),
            assistant: frozenset({"chromium"}),
        },
        worker_fallback_projects={
            worker_one: frozenset(),
            other_chromium_worker: frozenset(),
            assistant: frozenset({"matrix-firefox", "matrix-webkit"}),
        },
    )
    first = queue.acquire(worker_one)
    second = queue.acquire(assistant)
    assert first == chromium_long and first is not None
    assert second == chromium_short and second is not None
    queue.complete(assistant, second.job_id)

    early_wait = Event()
    monkeypatch.setattr(queue, "_condition", _WaitingCondition(early_wait))
    executor = ThreadPoolExecutor(max_workers=2)
    assistant_future = executor.submit(queue.acquire, assistant)
    other_future = None
    try:
        # When / Then: the assistant cannot steal while any Chromium job runs.
        assert early_wait.wait(timeout=1)
        assert not assistant_future.done()

        # When / Then: the final Chromium completion opens only the assistant.
        queue.complete(worker_one, first.job_id)
        assert assistant_future.result(timeout=1) == firefox_tail
        other_wait = Event()
        monkeypatch.setattr(queue, "_condition", _WaitingCondition(other_wait))
        other_future = executor.submit(queue.acquire, other_chromium_worker)
        assert other_wait.wait(timeout=1)
        assert not other_future.done()
    finally:
        queue.stop()
        if other_future is not None:
            assert other_future.result(timeout=1) is None
        executor.shutdown(wait=False, cancel_futures=True)
