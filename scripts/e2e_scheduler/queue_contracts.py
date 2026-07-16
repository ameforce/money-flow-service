"""Typed contracts and errors exposed by the eligible job queue."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, override

from scripts.e2e_scheduler.metrics import QueueMetrics
from scripts.e2e_scheduler.model import JobId, JobSpec, WorkerId


@dataclass(slots=True)
class DuplicateJobIdError(ValueError):
    """Raised when queue input contains the same job ID more than once."""

    job_id: JobId

    @override
    def __str__(self) -> str:
        return f"duplicate scheduler job ID: {self.job_id}"


@dataclass(slots=True)
class DuplicateTerminalJobError(Exception):
    """Raised when a terminal result is recorded more than once."""

    job_id: JobId

    @override
    def __str__(self) -> str:
        return f"job {self.job_id} already has a terminal result"


@dataclass(slots=True)
class AssignmentOwnerError(Exception):
    """Raised when a worker finishes another worker's assignment."""

    job_id: JobId
    assigned_worker_id: WorkerId
    attempted_worker_id: WorkerId

    @override
    def __str__(self) -> str:
        return (
            f"job {self.job_id} belongs to {self.assigned_worker_id}, "
            f"not {self.attempted_worker_id}"
        )


@dataclass(slots=True)
class LostAssignmentError(Exception):
    """Raised when a worker reports a job without an active assignment."""

    worker_id: WorkerId
    job_id: JobId

    @override
    def __str__(self) -> str:
        return f"worker {self.worker_id} has no assignment for job {self.job_id}"


@dataclass(slots=True)
class WorkerAlreadyAssignedError(Exception):
    """Raised when a busy worker asks for another job."""

    worker_id: WorkerId
    job_id: JobId

    @override
    def __str__(self) -> str:
        return f"worker {self.worker_id} is already assigned job {self.job_id}"


@dataclass(frozen=True, slots=True)
class QueueAssignment:
    job: JobSpec
    metrics: QueueMetrics


class AssignmentCapacityController(Protocol):
    def assignment_capacity(self) -> int: ...

    def worker_is_enabled(self, worker_id: WorkerId, capacity: int) -> bool: ...

    def wait_timeout_seconds(self) -> float: ...

    def record_worker_crash(self) -> None: ...

    def record_unexpected_failure(self) -> None: ...
