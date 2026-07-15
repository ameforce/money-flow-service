"""Typed boundaries and values for benchmark evidence collection."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import ClassVar, Final, Literal, override

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from scripts.e2e_scheduler.benchmark import (
    CapacityDecisionRecord,
    ConcurrencyMetadata,
    RunInventory,
)


class InputModel(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)


class Totals(InputModel):
    expected_tests: int
    actual_tests: int
    expected_scenarios: int
    actual_scenarios: int
    expected_evidence_count: int
    actual_evidence_count: int
    passed: int = 0
    skipped: int = 0
    failed: int = 0
    interrupted: int = 0
    missing: int = 0


class ScenarioIds(InputModel):
    expected: tuple[str, ...]
    actual: tuple[str, ...]
    skipped: tuple[str, ...] = ()


class Project(InputModel):
    name: str
    browser: str
    viewport: tuple[int, int] | None


class DynamicJob(InputModel):
    job_id: str
    worker_id: str
    expected_evidence_files: tuple[str, ...]
    actual_evidence_files: tuple[str, ...]


class DynamicLatest(InputModel):
    generated_at: datetime
    run_id: str
    benchmark_invocation_id: str
    cleanup_status: Literal["complete"]
    totals: Totals
    scenario_ids: ScenarioIds
    projects: tuple[Project, ...]
    count: int
    files: tuple[str, ...]
    jobs: tuple[DynamicJob, ...]


class LegacyLatest(InputModel):
    count: int
    files: tuple[str, ...]


class Profile(InputModel):
    name: str
    browser: str
    viewport: tuple[int, int] | None


class Profiles(InputModel):
    version: Literal[1]
    profiles: tuple[Profile, ...]


class ConcurrencyInput(InputModel):
    adaptive: bool
    initial: int | None
    minimum: int | None
    maximum: int | None
    started_workers: int | None


class LegacyCleanup(InputModel):
    version: Literal[1]
    process_exited: bool
    backend_port_closed: bool
    frontend_port_closed: bool
    database_removed: bool
    backend_latency_ms_samples: tuple[float, ...]
    failures: tuple[str, ...]
    concurrency: ConcurrencyInput


class MetricJobV1(InputModel):
    wall_seconds: float


class MetricCleanup(InputModel):
    succeeded: bool


@dataclass(slots=True)
class BenchmarkCollectionError(Exception):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


class RunMetricsBase(InputModel):
    worker_minutes: float
    backend_latency_ms_samples: tuple[float, ...]
    cleanup: tuple[MetricCleanup, ...]
    benchmark_invocation_id: str
    concurrency: ConcurrencyInput


class RunMetricsV1(RunMetricsBase):
    version: Literal[1]
    jobs: tuple[MetricJobV1, ...]

    def validate_complete(self, _latest: DynamicLatest) -> None:
        pass


class QueueMetricsInput(InputModel):
    queue_wait_seconds: float = Field(ge=0)
    assignment_seconds: float = Field(ge=0)
    eligible_idle_seconds: float = Field(ge=0)
    affinity_blocked_seconds: float = Field(ge=0)
    lock_blocked_seconds: float = Field(ge=0)
    capacity_blocked_seconds: float = Field(ge=0)
    avoidable_idle_count: int = Field(ge=0)


class BrowserMetricsInput(InputModel):
    acquire_seconds: float = Field(ge=0)
    switch_seconds: float = Field(ge=0)


class ExecutionMetricsInput(InputModel):
    playwright_cli_startup_seconds: float = Field(ge=0)
    actual_test_seconds: float = Field(ge=0)
    duration_inventory_complete: bool


class SetupMetricsInput(InputModel):
    auth_mode: Literal["none", "ui", "api", "mixed"]
    auth_count: int = Field(ge=0)
    auth_seconds: float = Field(ge=0)
    auth_failures: int = Field(ge=0)
    auth_ui_count: int = Field(ge=0)
    auth_ui_seconds: float = Field(ge=0)
    auth_api_count: int = Field(ge=0)
    auth_api_seconds: float = Field(ge=0)
    db_reset_seconds: float = Field(ge=0)
    db_reset_retry_count: int = Field(default=0, ge=0)
    db_reset_locked_seconds: float = Field(default=0.0, ge=0)
    filesystem_cleanup_seconds: float = Field(ge=0)
    artifact_aggregation_seconds: float = Field(ge=0)


class JobMetricsInput(InputModel):
    queue: QueueMetricsInput
    browser: BrowserMetricsInput
    execution: ExecutionMetricsInput
    setup: SetupMetricsInput


class MetricJobV2(InputModel):
    job_id: str = Field(min_length=1)
    worker_id: str = Field(min_length=1)
    wall_seconds: float = Field(ge=0)
    metrics: JobMetricsInput


class ProcessSpawnInput(InputModel):
    role: str = Field(min_length=1)
    count: int = Field(ge=0)


class RunnerResourceInput(InputModel):
    cpu_seconds: float = Field(ge=0)
    read_bytes: int = Field(ge=0)
    write_bytes: int = Field(ge=0)
    peak_working_set_bytes: int = Field(ge=0)
    peak_process_count: int = Field(ge=0)
    total_process_count: int = Field(ge=0)
    active_process_count: int = Field(ge=0)
    peak_launch_count: int = Field(ge=0)


class HostResourceInput(InputModel):
    cpu_percent: float = Field(ge=0, le=100)
    available_memory_percent: float = Field(ge=0, le=100)
    backend_p95_ms: float = Field(ge=0)


class RunTelemetryInput(InputModel):
    process_spawns: tuple[ProcessSpawnInput, ...]
    resources: RunnerResourceInput
    host_samples: tuple[HostResourceInput, ...]
    frontend_build_count: int = Field(ge=0)
    artifact_aggregation_seconds: float = Field(ge=0)
    resource_sample_errors: int = Field(ge=0)


class RunMetricsV2(RunMetricsBase):
    version: Literal[2]
    jobs: tuple[MetricJobV2, ...]
    status: Literal["complete", "partial", "interrupted"]
    expected_jobs: int = Field(ge=0)
    completed_jobs: int = Field(ge=0)
    partial: bool
    telemetry: RunTelemetryInput

    def validate_complete(self, latest: DynamicLatest) -> None:
        if self.status != "complete" or self.partial:
            raise BenchmarkCollectionError(
                "dynamic v2 metrics are partial or interrupted"
            )
        expected_completed = len(latest.jobs)
        if (
            self.expected_jobs != expected_completed
            or self.completed_jobs != expected_completed
            or len(self.jobs) != expected_completed
        ):
            raise BenchmarkCollectionError("dynamic v2 metrics job count mismatch")
        metric_assignments = tuple(
            sorted((job.job_id, job.worker_id) for job in self.jobs)
        )
        published_assignments = tuple(
            sorted((job.job_id, job.worker_id) for job in latest.jobs)
        )
        if metric_assignments != published_assignments:
            raise BenchmarkCollectionError(
                "dynamic v2 metrics job inventory mismatch"
            )
        if any(
            not job.metrics.execution.duration_inventory_complete
            for job in self.jobs
        ):
            raise BenchmarkCollectionError(
                "dynamic v2 test duration inventory is incomplete"
            )
        if any(job.metrics.setup.auth_failures for job in self.jobs):
            raise BenchmarkCollectionError("dynamic v2 auth setup failures recorded")
        if self.telemetry.frontend_build_count != 1:
            raise BenchmarkCollectionError(
                "dynamic v2 frontend build count must be exactly one"
            )
        if any(job.metrics.queue.avoidable_idle_count for job in self.jobs):
            raise BenchmarkCollectionError("dynamic v2 avoidable queue idle recorded")
        if any(
            spawn.role == "vite" and spawn.count
            for spawn in self.telemetry.process_spawns
        ):
            raise BenchmarkCollectionError("dynamic v2 Vite process spawn recorded")
        if self.telemetry.resources.active_process_count:
            raise BenchmarkCollectionError(
                "dynamic v2 runner-owned processes remained after cleanup"
            )
        if not self.telemetry.host_samples:
            raise BenchmarkCollectionError(
                "dynamic v2 resource sampling produced no usable samples"
            )


type RunMetrics = RunMetricsV1 | RunMetricsV2


_RUN_METRICS_ADAPTER: Final[TypeAdapter[RunMetrics]] = TypeAdapter(RunMetrics)


def read_run_metrics(path: Path) -> RunMetrics:
    try:
        return _RUN_METRICS_ADAPTER.validate_json(path.read_bytes())
    except OSError as error:
        raise BenchmarkCollectionError(f"cannot read {path}: {error}") from error
    except ValidationError as error:
        raise BenchmarkCollectionError(f"invalid {path}: {error}") from error


class Decision(InputModel):
    elapsed_seconds: float
    previous: int
    capacity: int
    reason: str
    detail: str


class Decisions(InputModel):
    version: Literal[1]
    decisions: tuple[Decision, ...]


@dataclass(frozen=True, slots=True)
class CollectedRun:
    run_id: str
    inventory: RunInventory
    worker_minutes: float
    job_durations_seconds: tuple[float, ...]
    cleanup_ok: bool
    backend_latency_ms_samples: tuple[float, ...]
    capacity_decisions: tuple[CapacityDecisionRecord, ...]
    concurrency: ConcurrencyMetadata
