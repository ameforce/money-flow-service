"""Cold-reserve activation and worker-slot gating for adaptive E2E runs."""

from __future__ import annotations

from threading import Condition
from typing import Protocol, final

from scripts.e2e_scheduler.model import RunId, WorkerId
from scripts.e2e_scheduler.runner_worker import (
    CapsuleWorker,
    WorkerCrash,
    WorkerLoopError,
)


class CapacitySignalController(Protocol):
    def assignment_capacity(self) -> int: ...

    def wait_timeout_seconds(self) -> float: ...

    def record_worker_crash(self) -> None: ...

    def record_unexpected_failure(self) -> None: ...


@final
class AdaptiveWorkerPool:
    """Activate cold capsules before exposing their assignment capacity."""

    def __init__(
        self,
        run_id: RunId,
        controller: CapacitySignalController,
        *,
        warm_worker_ids: tuple[WorkerId, ...],
        reserve_capsules: tuple[CapsuleWorker, ...],
        capacity_order: tuple[WorkerId, ...],
    ) -> None:
        self._run_id = run_id
        self._controller = controller
        self._reserve_capsules = {
            capsule.worker_id: capsule for capsule in reserve_capsules
        }
        self._capacity_order = capacity_order
        self._active_worker_ids = set(warm_worker_ids)
        self._stopped = False
        self._condition = Condition()

    def assignment_capacity(self) -> int:
        desired = self._controller.assignment_capacity()
        with self._condition:
            while len(self._active_worker_ids) < desired:
                worker_id = next(
                    (
                        candidate
                        for candidate in self._capacity_order
                        if candidate not in self._active_worker_ids
                        and candidate in self._reserve_capsules
                    ),
                    None,
                )
                if worker_id is None:
                    break
                capsule = self._reserve_capsules[worker_id]
                try:
                    capsule.start()
                except Exception as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
                    raise WorkerLoopError(
                        WorkerCrash(
                            run_id=self._run_id,
                            worker_id=worker_id,
                            job_id=None,
                            error_type=type(error).__name__,
                            detail=str(error),
                        )
                    ) from error
                self._active_worker_ids.add(worker_id)
                self._condition.notify_all()
            return min(desired, len(self._active_worker_ids))

    def worker_is_enabled(self, worker_id: WorkerId, capacity: int) -> bool:
        with self._condition:
            enabled = frozenset(self._capacity_order[:capacity])
            return worker_id in self._active_worker_ids and worker_id in enabled

    def wait_timeout_seconds(self) -> float:
        return self._controller.wait_timeout_seconds()

    def record_worker_crash(self) -> None:
        self._controller.record_worker_crash()

    def record_unexpected_failure(self) -> None:
        self._controller.record_unexpected_failure()

    def wait_until_active(self, worker_id: WorkerId) -> bool:
        with self._condition:
            while worker_id not in self._active_worker_ids and not self._stopped:
                _ = self._condition.wait()
            return worker_id in self._active_worker_ids

    def stop_waiters(self) -> None:
        with self._condition:
            self._stopped = True
            self._condition.notify_all()
