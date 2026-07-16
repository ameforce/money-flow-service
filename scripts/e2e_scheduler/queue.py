"""Condition-protected LPT queue for eligible E2E scheduler jobs."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from threading import Condition
import time
from typing import final

from scripts.e2e_scheduler.locks import locks_are_compatible
from scripts.e2e_scheduler.model import JobId, JobSpec, WorkerId
from scripts.e2e_scheduler.queue_contracts import (
    AssignmentCapacityController as AssignmentCapacityController,
    AssignmentOwnerError as AssignmentOwnerError,
    DuplicateJobIdError as DuplicateJobIdError,
    DuplicateTerminalJobError as DuplicateTerminalJobError,
    LostAssignmentError as LostAssignmentError,
    QueueAssignment as QueueAssignment,
    WorkerAlreadyAssignedError as WorkerAlreadyAssignedError,
)
from scripts.e2e_scheduler.queue_timing import QueueTiming, QueueWaitReason


@dataclass(frozen=True, slots=True)
class _Assignment:
    worker_id: WorkerId
    job: JobSpec


@final
class EligibleJobQueue:
    """Own pending jobs, locks, assignments, and terminal job IDs."""

    def __init__(
        self,
        jobs: tuple[JobSpec, ...],
        capacity_controller: AssignmentCapacityController | None = None,
        worker_projects: Mapping[WorkerId, frozenset[str]] | None = None,
        worker_fallback_projects: Mapping[WorkerId, frozenset[str]] | None = None,
    ) -> None:
        seen_job_ids: set[JobId] = set()
        for job in jobs:
            if job.job_id in seen_job_ids:
                raise DuplicateJobIdError(job_id=job.job_id)
            seen_job_ids.add(job.job_id)
        self._pending = list(jobs)
        self._active_locks: set[str] = set()
        self._assignments: dict[JobId, _Assignment] = {}
        self._worker_jobs: dict[WorkerId, JobId] = {}
        self._terminal_job_ids: set[JobId] = set()
        self._total_jobs = len(jobs)
        self._accepting_assignments = True
        self._condition = Condition()
        self._capacity_controller = capacity_controller
        self._worker_projects = worker_projects
        self._worker_fallback_projects = worker_fallback_projects
        self._worker_primary_job_ids = (
            {
                worker_id: frozenset(
                    job.job_id for job in jobs if job.project in projects
                )
                for worker_id, projects in worker_projects.items()
            }
            if worker_projects is not None
            else None
        )

    def acquire(self, worker_id: WorkerId) -> JobSpec | None:
        """Wait for and assign the longest currently eligible job."""
        assignment = self.acquire_assignment(worker_id)
        return assignment.job if assignment is not None else None

    def acquire_assignment(self, worker_id: WorkerId) -> QueueAssignment | None:
        """Wait for one job and preserve the reason-specific idle timing."""
        timing = QueueTiming(time.perf_counter())
        with self._condition:
            assigned_job_id = self._worker_jobs.get(worker_id)
            if assigned_job_id is not None:
                raise WorkerAlreadyAssignedError(
                    worker_id=worker_id,
                    job_id=assigned_job_id,
                )
        while True:
            with self._condition:
                if not self._accepting_assignments:
                    return None
                if len(self._terminal_job_ids) == self._total_jobs:
                    return None
            capacity_started = time.perf_counter()
            capacity = (
                self._capacity_controller.assignment_capacity()
                if self._capacity_controller is not None
                else self._total_jobs
            )
            if self._capacity_controller is not None:
                timing.record_wait(
                    QueueWaitReason.CAPACITY,
                    time.perf_counter() - capacity_started,
                )
            with self._condition:
                assignment = self._try_assign(worker_id, capacity, timing)
                if assignment is not None:
                    return assignment
                if not self._accepting_assignments:
                    return None
                if len(self._terminal_job_ids) == self._total_jobs:
                    return None
                reason = self._wait_reason(worker_id, capacity)
                timeout = (
                    self._capacity_controller.wait_timeout_seconds()
                    if self._capacity_controller is not None
                    else None
                )
                wait_started = time.perf_counter()
                _ = self._condition.wait(timeout)
                timing.record_wait(reason, time.perf_counter() - wait_started)

    def _try_assign(
        self,
        worker_id: WorkerId,
        capacity: int,
        timing: QueueTiming,
    ) -> QueueAssignment | None:
        assignment_started = time.perf_counter()
        if not self._accepting_assignments:
            timing.record_assignment(time.perf_counter() - assignment_started)
            return None
        worker_is_enabled = (
            self._capacity_controller.worker_is_enabled(worker_id, capacity)
            if self._capacity_controller is not None
            else True
        )
        job = None
        if len(self._assignments) < capacity and worker_is_enabled:
            job = next(
                (
                    pending
                    for pending in sorted(
                        self._pending,
                        key=lambda item: (-item.estimated_seconds, str(item.job_id)),
                    )
                    if locks_are_compatible(self._active_locks, pending.locks)
                    and self._worker_can_run(worker_id, pending)
                ),
                None,
            )
        if job is not None:
            self._pending.remove(job)
            self._active_locks.update(job.locks)
            self._assignments[job.job_id] = _Assignment(worker_id, job)
            self._worker_jobs[worker_id] = job.job_id
        timing.record_assignment(time.perf_counter() - assignment_started)
        return (
            QueueAssignment(job, timing.finish(time.perf_counter()))
            if job is not None
            else None
        )

    def _wait_reason(
        self,
        worker_id: WorkerId,
        capacity: int,
    ) -> QueueWaitReason:
        worker_is_enabled = (
            self._capacity_controller.worker_is_enabled(worker_id, capacity)
            if self._capacity_controller is not None
            else True
        )
        if len(self._assignments) >= capacity or not worker_is_enabled:
            return QueueWaitReason.CAPACITY
        compatible_projects = tuple(
            pending for pending in self._pending if self._worker_can_run(worker_id, pending)
        )
        if not compatible_projects:
            return (
                QueueWaitReason.AFFINITY
                if self._pending
                else QueueWaitReason.NO_PENDING
            )
        if any(
            locks_are_compatible(self._active_locks, pending.locks)
            for pending in compatible_projects
        ):
            return QueueWaitReason.ELIGIBLE
        return QueueWaitReason.LOCK

    def _worker_can_run(self, worker_id: WorkerId, job: JobSpec) -> bool:
        if self._worker_projects is None:
            return True
        primary_projects = self._worker_projects.get(worker_id, frozenset())
        if job.project in primary_projects:
            return True
        fallback_projects: frozenset[str] = (
            self._worker_fallback_projects.get(worker_id, frozenset())
            if self._worker_fallback_projects is not None
            else frozenset()
        )
        primary_job_ids: frozenset[JobId] = (
            self._worker_primary_job_ids.get(worker_id, frozenset())
            if self._worker_primary_job_ids is not None
            else frozenset()
        )
        return (
            job.project in fallback_projects
            and primary_job_ids.issubset(self._terminal_job_ids)
        )

    def record_worker_crash(self) -> None:
        if self._capacity_controller is not None:
            self._capacity_controller.record_worker_crash()

    def record_unexpected_failure(self) -> None:
        if self._capacity_controller is not None:
            self._capacity_controller.record_unexpected_failure()

    def stop(self) -> None:
        """Wake waiters and prevent every future job assignment."""
        with self._condition:
            self._accepting_assignments = False
            self._condition.notify_all()

    def complete(self, worker_id: WorkerId, job_id: JobId) -> None:
        """Record successful terminal completion and release its locks."""
        self._finish(worker_id, job_id)

    def abort(self, worker_id: WorkerId, job_id: JobId) -> None:
        """Record aborted terminal completion and release its locks."""
        self._finish(worker_id, job_id)

    def _finish(self, worker_id: WorkerId, job_id: JobId) -> None:
        with self._condition:
            if job_id in self._terminal_job_ids:
                raise DuplicateTerminalJobError(job_id=job_id)
            assignment = self._assignments.get(job_id)
            if assignment is None:
                raise LostAssignmentError(worker_id=worker_id, job_id=job_id)
            if assignment.worker_id != worker_id:
                raise AssignmentOwnerError(
                    job_id=job_id,
                    assigned_worker_id=assignment.worker_id,
                    attempted_worker_id=worker_id,
                )
            del self._assignments[job_id]
            del self._worker_jobs[worker_id]
            self._active_locks.difference_update(assignment.job.locks)
            self._terminal_job_ids.add(job_id)
            self._condition.notify_all()
