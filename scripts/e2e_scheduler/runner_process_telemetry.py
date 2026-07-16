"""Translate process accounting into persisted scheduler run telemetry."""

from __future__ import annotations

from scripts.e2e_scheduler.metrics import (
    ProcessSpawnCount,
    RunnerResourceMetrics,
    RunTelemetry,
)
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder


def snapshot_run_telemetry(recorder: ProcessMetricsRecorder) -> RunTelemetry:
    snapshot = recorder.snapshot()
    frontend_build_count = sum(
        item.count for item in snapshot.spawn_counts if item.role == "frontend-build"
    )
    return RunTelemetry(
        process_spawns=tuple(
            ProcessSpawnCount(item.role, item.count)
            for item in snapshot.spawn_counts
        ),
        resources=RunnerResourceMetrics(
            cpu_seconds=snapshot.cpu_seconds,
            read_bytes=snapshot.read_bytes,
            write_bytes=snapshot.write_bytes,
            peak_working_set_bytes=snapshot.peak_working_set_bytes,
            peak_process_count=max(
                snapshot.peak_process_count,
                snapshot.peak_launch_count,
            ),
            total_process_count=snapshot.total_process_count,
            active_process_count=snapshot.active_launch_count,
            peak_launch_count=snapshot.peak_launch_count,
        ),
        frontend_build_count=frontend_build_count,
    )
