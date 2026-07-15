from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pytest
from pydantic import BaseModel, ConfigDict

from scripts.e2e_scheduler.benchmark_collect_models import (
    BenchmarkCollectionError,
    DynamicJob,
    DynamicLatest,
    RunMetricsV2,
    read_run_metrics,
)
from scripts.e2e_scheduler.run_metrics import (
    RunMetricsConfiguration,
    save_run_metrics,
)
from scripts.e2e_scheduler.metrics import (
    AuthSetupMode,
    BrowserMetrics,
    ExecutionMetrics,
    HostResourceMetrics,
    JobMetrics,
    ProcessSpawnCount,
    QueueMetrics,
    RunnerResourceMetrics,
    RunTelemetry,
    SetupMetrics,
)
from scripts.e2e_scheduler.runner_cleanup import CleanupOutcome
from scripts.e2e_scheduler.runner_worker import (
    RunMetricsSnapshot,
    RunMetricsStatus,
    TimedJobResult,
)

from backend.tests.e2e_scheduler_aggregate_fakes import complete_result_fixture


class _PersistedMetrics(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    status: RunMetricsStatus
    expected_jobs: int
    completed_jobs: int
    partial: bool
    jobs: tuple[()]


def test_interrupted_metrics_persist_partial_job_inventory(tmp_path: Path) -> None:
    # Given
    path = tmp_path / "run-metrics.json"
    snapshot = RunMetricsSnapshot(
        results=(),
        cleanup=(),
        final_sample=None,
        status=RunMetricsStatus.INTERRUPTED,
        expected_jobs=2,
    )
    configuration = RunMetricsConfiguration(
        benchmark_invocation_id="benchmark-test",
        adaptive=False,
        initial_workers=4,
        started_workers=0,
    )

    # When
    save_run_metrics(path, snapshot, configuration)

    # Then
    persisted = _PersistedMetrics.model_validate_json(path.read_bytes())
    assert persisted.status is RunMetricsStatus.INTERRUPTED
    assert persisted.expected_jobs == 2
    assert persisted.completed_jobs == 0
    assert persisted.partial
    assert persisted.jobs == ()


def test_partial_status_marks_full_job_inventory_partial(tmp_path: Path) -> None:
    path = tmp_path / "run-metrics.json"
    _, results = complete_result_fixture(tmp_path)
    save_run_metrics(
        path,
        RunMetricsSnapshot(
            results=(TimedJobResult(results[0], 1.0),),
            cleanup=(),
            final_sample=None,
            status=RunMetricsStatus.PARTIAL,
            expected_jobs=1,
        ),
        RunMetricsConfiguration("partial-full-inventory", False, 8, 8),
    )

    persisted = RunMetricsV2.model_validate_json(path.read_bytes())

    assert persisted.completed_jobs == persisted.expected_jobs == 1
    assert persisted.partial


def test_adaptive_metrics_preserve_cold_reserve_capacity(tmp_path: Path) -> None:
    path = tmp_path / "run-metrics.json"
    save_run_metrics(
        path,
        RunMetricsSnapshot(
            results=(),
            cleanup=(),
            final_sample=None,
            status=RunMetricsStatus.INTERRUPTED,
            expected_jobs=1,
        ),
        RunMetricsConfiguration(
            benchmark_invocation_id="adaptive-capacity",
            adaptive=True,
            initial_workers=8,
            started_workers=8,
        ),
    )

    payload = RunMetricsV2.model_validate_json(path.read_bytes())

    assert payload.concurrency.minimum == 4
    assert payload.concurrency.initial == 8
    assert payload.concurrency.maximum == 10
    assert payload.concurrency.started_workers == 8


def test_complete_metrics_persist_every_v2_job_and_telemetry_field(
    tmp_path: Path,
) -> None:
    # Given
    path = tmp_path / "run-metrics.json"
    _, results = complete_result_fixture(tmp_path)
    timed = TimedJobResult(
        result=results[0],
        seconds=42.0,
        metrics=JobMetrics(
            queue=QueueMetrics(1.0, 2.0, 3.0, 4.0, 5.0, 6.0),
            browser=BrowserMetrics(7.0, 8.0),
            execution=ExecutionMetrics(9.0, 10.0, True),
            setup=SetupMetrics(
                auth_mode=AuthSetupMode.MIXED,
                auth_count=11,
                auth_seconds=12.0,
                auth_failures=1,
                auth_ui_count=5,
                auth_ui_seconds=5.5,
                auth_api_count=6,
                auth_api_seconds=6.5,
                db_reset_seconds=13.0,
                db_reset_retry_count=2,
                db_reset_locked_seconds=0.75,
                filesystem_cleanup_seconds=14.0,
                artifact_aggregation_seconds=15.0,
            ),
        ),
    )
    snapshot = RunMetricsSnapshot(
        results=(timed,),
        cleanup=(CleanupOutcome(results[0].worker_id, True),),
        final_sample=None,
        status=RunMetricsStatus.COMPLETE,
        expected_jobs=1,
        telemetry=RunTelemetry(
            process_spawns=(ProcessSpawnCount("playwright", 16),),
            resources=RunnerResourceMetrics(
                cpu_seconds=17.0,
                read_bytes=18,
                write_bytes=19,
                peak_working_set_bytes=20,
                peak_process_count=21,
                total_process_count=22,
                active_process_count=0,
                peak_launch_count=8,
            ),
            host_samples=(HostResourceMetrics(23.0, 24.0, 25.0),),
            frontend_build_count=1,
            artifact_aggregation_seconds=26.0,
            resource_sample_errors=0,
        ),
    )

    # When
    save_run_metrics(
        path,
        snapshot,
        RunMetricsConfiguration(
            benchmark_invocation_id="benchmark-v2",
            adaptive=False,
            initial_workers=8,
            started_workers=8,
        ),
    )

    # Then
    payload = path.read_text(encoding="utf-8")
    assert '"version": 2' in payload
    assert '"queue_wait_seconds": 1.0' in payload
    assert '"assignment_seconds": 2.0' in payload
    assert '"eligible_idle_seconds": 3.0' in payload
    assert '"affinity_blocked_seconds": 4.0' in payload
    assert '"lock_blocked_seconds": 5.0' in payload
    assert '"capacity_blocked_seconds": 6.0' in payload
    assert '"avoidable_idle_count": 0' in payload
    assert '"acquire_seconds": 7.0' in payload
    assert '"switch_seconds": 8.0' in payload
    assert '"playwright_cli_startup_seconds": 9.0' in payload
    assert '"actual_test_seconds": 10.0' in payload
    assert '"duration_inventory_complete": true' in payload
    assert '"auth_mode": "mixed"' in payload
    assert '"auth_count": 11' in payload
    assert '"auth_seconds": 12.0' in payload
    assert '"auth_failures": 1' in payload
    assert '"auth_ui_count": 5' in payload
    assert '"auth_ui_seconds": 5.5' in payload
    assert '"auth_api_count": 6' in payload
    assert '"auth_api_seconds": 6.5' in payload
    assert '"db_reset_seconds": 13.0' in payload
    assert '"db_reset_retry_count": 2' in payload
    assert '"db_reset_locked_seconds": 0.75' in payload
    assert '"filesystem_cleanup_seconds": 14.0' in payload
    assert '"artifact_aggregation_seconds": 15.0' in payload
    assert '"role": "playwright"' in payload
    assert '"count": 16' in payload
    assert '"cpu_seconds": 17.0' in payload
    assert '"read_bytes": 18' in payload
    assert '"write_bytes": 19' in payload
    assert '"peak_working_set_bytes": 20' in payload
    assert '"peak_process_count": 21' in payload
    assert '"total_process_count": 22' in payload
    assert '"active_process_count": 0' in payload
    assert '"peak_launch_count": 8' in payload
    assert '"cpu_percent": 23.0' in payload
    assert '"available_memory_percent": 24.0' in payload
    assert '"backend_p95_ms": 25.0' in payload
    assert '"frontend_build_count": 1' in payload
    assert '"artifact_aggregation_seconds": 26.0' in payload
    assert '"resource_sample_errors": 0' in payload
    assert not path.with_suffix(".json.tmp").exists()


def test_v2_metrics_reader_rejects_negative_phase_duration(tmp_path: Path) -> None:
    # Given
    _, results = complete_result_fixture(tmp_path)
    path = tmp_path / "run-metrics.json"
    save_run_metrics(
        path,
        RunMetricsSnapshot(
            results=(
                TimedJobResult(
                    results[0],
                    1.0,
                    JobMetrics(queue=QueueMetrics(queue_wait_seconds=-1.0)),
                ),
            ),
            cleanup=(),
            final_sample=None,
            status=RunMetricsStatus.COMPLETE,
            expected_jobs=1,
        ),
        RunMetricsConfiguration("negative-phase", False, 8, 8),
    )

    # When / Then
    with pytest.raises(BenchmarkCollectionError, match="invalid"):
        _ = read_run_metrics(path)


def test_v2_metrics_fail_closed_when_run_is_partial(tmp_path: Path) -> None:
    # Given
    path = tmp_path / "run-metrics.json"
    save_run_metrics(
        path,
        RunMetricsSnapshot(
            results=(),
            cleanup=(),
            final_sample=None,
            status=RunMetricsStatus.PARTIAL,
            expected_jobs=1,
        ),
        RunMetricsConfiguration("partial", False, 8, 8),
    )
    metrics = RunMetricsV2.model_validate_json(path.read_bytes())
    latest = DynamicLatest.model_construct(jobs=())

    # When / Then
    with pytest.raises(BenchmarkCollectionError, match="partial or interrupted"):
        metrics.validate_complete(latest)


def test_v2_metrics_fail_closed_when_duration_inventory_is_incomplete(
    tmp_path: Path,
) -> None:
    # Given
    _, results = complete_result_fixture(tmp_path)
    path = tmp_path / "run-metrics.json"
    save_run_metrics(
        path,
        RunMetricsSnapshot(
            results=(TimedJobResult(results[0], 1.0),),
            cleanup=(),
            final_sample=None,
            status=RunMetricsStatus.COMPLETE,
            expected_jobs=1,
        ),
        RunMetricsConfiguration("incomplete-duration", False, 8, 8),
    )
    metrics = RunMetricsV2.model_validate_json(path.read_bytes())
    latest = DynamicLatest.model_construct(
        jobs=(
            DynamicJob.model_construct(
                job_id=str(results[0].job_id),
                worker_id=str(results[0].worker_id),
            ),
        )
    )

    # When / Then
    with pytest.raises(BenchmarkCollectionError, match="duration inventory"):
        metrics.validate_complete(latest)


def test_v2_metrics_fail_closed_without_resource_samples(tmp_path: Path) -> None:
    _, results = complete_result_fixture(tmp_path)
    path = tmp_path / "run-metrics.json"
    save_run_metrics(
        path,
        RunMetricsSnapshot(
            results=(
                TimedJobResult(
                    results[0],
                    1.0,
                    JobMetrics(
                        execution=ExecutionMetrics(
                            playwright_cli_startup_seconds=0.5,
                            actual_test_seconds=0.5,
                            duration_inventory_complete=True,
                        )
                    ),
                ),
            ),
            cleanup=(),
            final_sample=None,
            status=RunMetricsStatus.COMPLETE,
            expected_jobs=1,
            telemetry=RunTelemetry(frontend_build_count=1),
        ),
        RunMetricsConfiguration("no-samples", False, 8, 8),
    )
    metrics = RunMetricsV2.model_validate_json(path.read_bytes())
    latest = DynamicLatest.model_construct(
        jobs=(
            DynamicJob.model_construct(
                job_id=str(results[0].job_id),
                worker_id=str(results[0].worker_id),
            ),
        )
    )

    with pytest.raises(BenchmarkCollectionError, match="no usable samples"):
        metrics.validate_complete(latest)
