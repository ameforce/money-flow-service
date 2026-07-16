from __future__ import annotations

from threading import Barrier
from typing import final

from scripts.e2e_scheduler.model import WorkerId
from scripts.e2e_scheduler.runner_worker import close_capsules


@final
class _BarrierCapsule:
    def __init__(
        self,
        worker_id: WorkerId,
        barrier: Barrier,
        *,
        fail: bool = False,
    ) -> None:
        self.worker_id = worker_id
        self._barrier = barrier
        self._fail = fail
        self.close_calls = 0

    def close(self) -> None:
        self.close_calls += 1
        _ = self._barrier.wait(timeout=1.0)
        if self._fail:
            raise OSError(f"cleanup failed for {self.worker_id}")


def test_close_capsules_runs_bounded_cleanup_concurrently_and_preserves_order() -> None:
    # Given
    barrier = Barrier(3)
    capsules = (
        _BarrierCapsule(WorkerId("worker-3"), barrier),
        _BarrierCapsule(WorkerId("worker-1"), barrier, fail=True),
        _BarrierCapsule(WorkerId("worker-2"), barrier),
    )

    # When
    outcomes = close_capsules(capsules)

    # Then
    assert tuple((item.worker_id, item.succeeded) for item in outcomes) == (
        (WorkerId("worker-3"), True),
        (WorkerId("worker-1"), False),
        (WorkerId("worker-2"), True),
    )
    assert tuple(capsule.close_calls for capsule in capsules) == (1, 1, 1)
