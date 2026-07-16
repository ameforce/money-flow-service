from __future__ import annotations

from pathlib import Path

from scripts.e2e_scheduler.runner_worker import (
    RunMetricsSnapshot,
    RunMetricsStatus,
    TimedJobResult,
)

from backend.tests.e2e_scheduler_aggregate_fakes import complete_result_fixture


def test_metrics_v2_seams_default_to_empty_for_existing_callers(
    tmp_path: Path,
) -> None:
    # Given
    _, results = complete_result_fixture(tmp_path)

    # When
    timed = TimedJobResult(result=results[0], seconds=1.0)
    snapshot = RunMetricsSnapshot(
        results=(timed,),
        cleanup=(),
        final_sample=None,
        status=RunMetricsStatus.COMPLETE,
        expected_jobs=1,
    )

    # Then
    assert timed.metrics.queue.queue_wait_seconds == 0.0
    assert timed.metrics.queue.assignment_seconds == 0.0
    assert timed.metrics.queue.eligible_idle_seconds == 0.0
    assert timed.metrics.queue.affinity_blocked_seconds == 0.0
    assert timed.metrics.queue.lock_blocked_seconds == 0.0
    assert timed.metrics.queue.capacity_blocked_seconds == 0.0
    assert timed.metrics.browser.acquire_seconds == 0.0
    assert timed.metrics.browser.switch_seconds == 0.0
    assert timed.metrics.execution.playwright_cli_startup_seconds == 0.0
    assert timed.metrics.execution.actual_test_seconds == 0.0
    assert timed.metrics.setup.auth_count == 0
    assert timed.metrics.setup.auth_mode.value == "none"
    assert timed.metrics.setup.auth_seconds == 0.0
    assert timed.metrics.setup.db_reset_seconds == 0.0
    assert timed.metrics.setup.filesystem_cleanup_seconds == 0.0
    assert timed.metrics.setup.artifact_aggregation_seconds == 0.0
    assert snapshot.telemetry.process_spawns == ()
    assert snapshot.telemetry.resources.cpu_seconds == 0.0
    assert snapshot.telemetry.resources.read_bytes == 0
    assert snapshot.telemetry.resources.write_bytes == 0
    assert snapshot.telemetry.resources.peak_working_set_bytes == 0
    assert snapshot.telemetry.resources.peak_process_count == 0
    assert snapshot.telemetry.host_samples == ()
