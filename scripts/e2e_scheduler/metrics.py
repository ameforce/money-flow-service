"""Typed, backward-compatible scheduler metrics v2 seams."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class AuthSetupMode(StrEnum):
    NONE = "none"
    UI = "ui"
    API = "api"
    MIXED = "mixed"


@dataclass(frozen=True, slots=True)
class QueueMetrics:
    queue_wait_seconds: float = 0.0
    assignment_seconds: float = 0.0
    eligible_idle_seconds: float = 0.0
    affinity_blocked_seconds: float = 0.0
    lock_blocked_seconds: float = 0.0
    capacity_blocked_seconds: float = 0.0
    avoidable_idle_count: int = 0


@dataclass(frozen=True, slots=True)
class BrowserMetrics:
    acquire_seconds: float = 0.0
    switch_seconds: float = 0.0


@dataclass(frozen=True, slots=True)
class ExecutionMetrics:
    playwright_cli_startup_seconds: float = 0.0
    actual_test_seconds: float = 0.0
    duration_inventory_complete: bool = False


@dataclass(frozen=True, slots=True)
class SetupMetrics:
    auth_mode: AuthSetupMode = AuthSetupMode.NONE
    auth_count: int = 0
    auth_seconds: float = 0.0
    auth_failures: int = 0
    auth_ui_count: int = 0
    auth_ui_seconds: float = 0.0
    auth_api_count: int = 0
    auth_api_seconds: float = 0.0
    db_reset_seconds: float = 0.0
    db_reset_retry_count: int = 0
    db_reset_locked_seconds: float = 0.0
    filesystem_cleanup_seconds: float = 0.0
    artifact_aggregation_seconds: float = 0.0


@dataclass(frozen=True, slots=True)
class JobMetrics:
    queue: QueueMetrics = field(default_factory=QueueMetrics)
    browser: BrowserMetrics = field(default_factory=BrowserMetrics)
    execution: ExecutionMetrics = field(default_factory=ExecutionMetrics)
    setup: SetupMetrics = field(default_factory=SetupMetrics)


@dataclass(frozen=True, slots=True)
class ProcessSpawnCount:
    role: str
    count: int


@dataclass(frozen=True, slots=True)
class RunnerResourceMetrics:
    cpu_seconds: float = 0.0
    read_bytes: int = 0
    write_bytes: int = 0
    peak_working_set_bytes: int = 0
    peak_process_count: int = 0
    total_process_count: int = 0
    active_process_count: int = 0
    peak_launch_count: int = 0


@dataclass(frozen=True, slots=True)
class HostResourceMetrics:
    cpu_percent: float
    available_memory_percent: float
    backend_p95_ms: float


@dataclass(frozen=True, slots=True)
class RunTelemetry:
    process_spawns: tuple[ProcessSpawnCount, ...] = ()
    resources: RunnerResourceMetrics = field(default_factory=RunnerResourceMetrics)
    host_samples: tuple[HostResourceMetrics, ...] = ()
    frontend_build_count: int = 0
    artifact_aggregation_seconds: float = 0.0
    resource_sample_errors: int = 0
