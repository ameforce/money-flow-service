"""Composite system and warm-backend resource sampling."""

from __future__ import annotations

from math import ceil
from typing import Protocol, final

from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.resources import ResourceSample, SystemResourceSample


class SystemResourceSampler(Protocol):
    def sample(self) -> SystemResourceSample: ...


class BackendLatencyProbe(Protocol):
    @property
    def is_started(self) -> bool: ...

    def backend_health_latency_ms(self) -> float: ...


@final
class CapsuleResourceSampler:
    def __init__(
        self,
        system: SystemResourceSampler,
        capsules: tuple[BackendLatencyProbe, ...],
        process_metrics: ProcessMetricsRecorder | None = None,
    ) -> None:
        self._system = system
        self._capsules = capsules
        self._process_metrics = process_metrics

    def sample(self) -> ResourceSample:
        system = self._system.sample()
        if self._process_metrics is not None:
            self._process_metrics.sample_active_resources()
        active_capsules = tuple(
            capsule for capsule in self._capsules if capsule.is_started
        )
        if not active_capsules:
            raise OSError("resource sampler has no started backend capsules")
        latencies = tuple(
            sorted(
                capsule.backend_health_latency_ms() for capsule in active_capsules
            )
        )
        index = max(0, ceil(len(latencies) * 0.95) - 1)
        return ResourceSample(
            cpu_percent=system.cpu_percent,
            available_memory_percent=system.available_memory_percent,
            backend_p95_ms=latencies[index],
            recent_worker_crashes=0,
            recent_unexpected_failures=0,
        )
