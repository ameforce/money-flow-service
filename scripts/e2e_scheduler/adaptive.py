"""Thread-safe adaptive capacity controller for future job assignments."""

from __future__ import annotations

from dataclasses import dataclass, replace
from threading import Lock
import time
from typing import Protocol, final

from scripts.e2e_scheduler.model import WorkerId
from scripts.e2e_scheduler.resources import AdaptivePolicy, ResourceSample


class ResourceSampler(Protocol):
    def sample(self) -> ResourceSample: ...


@dataclass(frozen=True, slots=True)
class CapacityDecision:
    elapsed_seconds: float
    previous: int
    capacity: int
    reason: str
    detail: str
    sample: ResourceSample | None


@final
class AdaptiveCapacityController:
    """Synchronize sampling and change only the next-assignment capacity."""

    def __init__(
        self,
        initial: int,
        started_capsules: int,
        sampler: ResourceSampler,
        policy: AdaptivePolicy | None = None,
        sample_interval_seconds: float = 5.0,
    ) -> None:
        requested = policy or AdaptivePolicy()
        self._policy = AdaptivePolicy(
            minimum=requested.minimum,
            maximum=min(requested.maximum, started_capsules),
            cooldown_seconds=requested.cooldown_seconds,
        )
        if not self._policy.minimum <= initial <= self._policy.maximum:
            from scripts.e2e_scheduler.resources import CapacityOutOfBoundsError

            raise CapacityOutOfBoundsError(
                current=initial,
                minimum=self._policy.minimum,
                maximum=self._policy.maximum,
            )
        self._capacity = initial
        self._sampler = sampler
        self._started = time.monotonic()
        self._sample_interval_seconds = max(0.0, sample_interval_seconds)
        self._last_sampled = self._started - self._sample_interval_seconds
        self._last_capacity_change = self._started
        self._decisions: list[CapacityDecision] = [
            CapacityDecision(0.0, initial, initial, "initial", "", None)
        ]
        self._recent_crashes = 0
        self._recent_failures = 0
        self._pressure_streak = 0
        self._healthy_streak = 0
        self._expansion_blocked = False
        self._lock = Lock()

    @property
    def decisions(self) -> tuple[CapacityDecision, ...]:
        with self._lock:
            return tuple(self._decisions)

    def assignment_capacity(self) -> int:
        """Return current capacity, sampling at most once per cooldown."""
        with self._lock:
            now = time.monotonic()
            elapsed = now - self._last_sampled
            if elapsed < self._sample_interval_seconds:
                return self._capacity
            previous = self._capacity
            try:
                sampled = self._sampler.sample()
            except OSError as error:
                self._pressure_streak = 0
                self._healthy_streak = 0
                self._record(now, previous, "sampler-error", str(error), None)
                return self._capacity
            sample = replace(
                sampled,
                recent_worker_crashes=(
                    sampled.recent_worker_crashes + self._recent_crashes
                ),
                recent_unexpected_failures=(
                    sampled.recent_unexpected_failures + self._recent_failures
                ),
            )
            if sample.recent_worker_crashes or sample.recent_unexpected_failures:
                self._expansion_blocked = True
            if _is_sustained_pressure(sample):
                self._pressure_streak += 1
            else:
                self._pressure_streak = 0
            if _is_healthy(sample):
                self._healthy_streak += 1
            else:
                self._healthy_streak = 0
            self._capacity = self._policy.next_capacity(
                previous,
                sample,
                max(0.0, now - self._last_capacity_change),
                pressure_streak=self._pressure_streak,
                healthy_streak=self._healthy_streak,
                expansion_allowed=not self._expansion_blocked,
            )
            reason = "stable"
            if self._capacity < previous:
                reason = "overloaded"
            elif self._capacity > previous:
                reason = "healthy"
            if self._capacity != previous:
                self._last_capacity_change = now
                self._pressure_streak = 0
                self._healthy_streak = 0
            self._record(now, previous, reason, "", sample)
            self._recent_crashes = 0
            self._recent_failures = 0
            return self._capacity

    def worker_is_enabled(self, worker_id: WorkerId, capacity: int) -> bool:
        """Keep standalone capacity behavior unrestricted by worker identity."""
        _ = (worker_id, capacity)
        return True

    def wait_timeout_seconds(self) -> float:
        with self._lock:
            remaining = self._policy.cooldown_seconds - (
                time.monotonic() - self._last_sampled
            )
        return max(
            0.05,
            min(self._sample_interval_seconds, max(0.0, remaining)),
        )

    def record_worker_crash(self) -> None:
        with self._lock:
            self._recent_crashes += 1
            self._expansion_blocked = True

    def record_unexpected_failure(self) -> None:
        with self._lock:
            self._recent_failures += 1
            self._expansion_blocked = True

    def _record(
        self,
        now: float,
        previous: int,
        reason: str,
        detail: str,
        sample: ResourceSample | None,
    ) -> None:
        self._last_sampled = now
        self._decisions.append(
            CapacityDecision(
                elapsed_seconds=max(0.0, now - self._started),
                previous=previous,
                capacity=self._capacity,
                reason=reason,
                detail=detail,
                sample=sample,
            )
        )


def _is_sustained_pressure(sample: ResourceSample) -> bool:
    return (
        sample.cpu_percent >= 92.0
        and sample.available_memory_percent < 20.0
        and sample.backend_p95_ms > 500.0
    )


def _is_healthy(sample: ResourceSample) -> bool:
    return (
        sample.cpu_percent <= 75.0
        and sample.available_memory_percent >= 25.0
        and sample.backend_p95_ms <= 350.0
        and sample.recent_worker_crashes == 0
        and sample.recent_unexpected_failures == 0
    )
