# pyright: reportUnnecessaryComparison=false
"""Typed timing accumulator for one scheduler queue assignment."""

from __future__ import annotations

from enum import StrEnum
from typing import Final, assert_never, final

from scripts.e2e_scheduler.metrics import QueueMetrics


AVOIDABLE_IDLE_THRESHOLD_SECONDS: Final = 0.250


class QueueWaitReason(StrEnum):
    ELIGIBLE = "eligible"
    AFFINITY = "affinity"
    LOCK = "lock"
    CAPACITY = "capacity"
    NO_PENDING = "no-pending"


@final
class QueueTiming:
    """Mutable accumulator scoped to one acquire attempt."""

    __slots__ = (
        "_affinity_blocked_seconds",
        "_assignment_seconds",
        "_avoidable_idle_count",
        "_capacity_blocked_seconds",
        "_eligible_idle_seconds",
        "_lock_blocked_seconds",
        "_started_at",
    )

    def __init__(self, started_at: float) -> None:
        self._started_at = started_at
        self._assignment_seconds = 0.0
        self._eligible_idle_seconds = 0.0
        self._affinity_blocked_seconds = 0.0
        self._lock_blocked_seconds = 0.0
        self._capacity_blocked_seconds = 0.0
        self._avoidable_idle_count = 0

    def record_assignment(self, seconds: float) -> None:
        self._assignment_seconds += max(seconds, 0.0)

    def record_wait(self, reason: QueueWaitReason, seconds: float) -> None:
        elapsed = max(seconds, 0.0)
        match reason:
            case QueueWaitReason.ELIGIBLE:
                self._eligible_idle_seconds += elapsed
                if elapsed >= AVOIDABLE_IDLE_THRESHOLD_SECONDS:
                    self._avoidable_idle_count += 1
            case QueueWaitReason.AFFINITY:
                self._affinity_blocked_seconds += elapsed
            case QueueWaitReason.LOCK:
                self._lock_blocked_seconds += elapsed
            case QueueWaitReason.CAPACITY:
                self._capacity_blocked_seconds += elapsed
            case QueueWaitReason.NO_PENDING:
                return
            case unreachable:
                assert_never(unreachable)

    def finish(self, finished_at: float) -> QueueMetrics:
        return QueueMetrics(
            queue_wait_seconds=max(finished_at - self._started_at, 0.0),
            assignment_seconds=self._assignment_seconds,
            eligible_idle_seconds=self._eligible_idle_seconds,
            affinity_blocked_seconds=self._affinity_blocked_seconds,
            lock_blocked_seconds=self._lock_blocked_seconds,
            capacity_blocked_seconds=self._capacity_blocked_seconds,
            avoidable_idle_count=self._avoidable_idle_count,
        )
