"""Immutable job and run result values shared by scheduler boundaries."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from scripts.e2e_scheduler.aggregate import JobResult
from scripts.e2e_scheduler.metrics import JobMetrics, RunTelemetry
from scripts.e2e_scheduler.resources import ResourceSample
from scripts.e2e_scheduler.runner_cleanup import CleanupOutcome


@dataclass(frozen=True, slots=True)
class TimedJobResult:
    result: JobResult
    seconds: float
    metrics: JobMetrics = field(default_factory=JobMetrics)


class RunMetricsStatus(StrEnum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    INTERRUPTED = "interrupted"


@dataclass(frozen=True, slots=True)
class RunMetricsSnapshot:
    results: tuple[TimedJobResult, ...]
    cleanup: tuple[CleanupOutcome, ...]
    final_sample: ResourceSample | None
    status: RunMetricsStatus
    expected_jobs: int
    started_workers: int = 0
    telemetry: RunTelemetry = field(default_factory=RunTelemetry)
