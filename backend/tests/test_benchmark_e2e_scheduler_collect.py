from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from backend.tests.e2e_scheduler_benchmark_collect_fakes import (
    report as _report,
    write_json as _write_json,
)

from scripts.e2e_scheduler.benchmark_collect import (
    collect_dynamic,
    collect_legacy,
)
from scripts.e2e_scheduler.benchmark_collect_models import BenchmarkCollectionError
from scripts.e2e_scheduler.benchmark_report import parse_playwright_inventory
from scripts.e2e_scheduler.metrics import (
    ExecutionMetrics,
    HostResourceMetrics,
    JobMetrics,
    RunTelemetry,
)
from scripts.e2e_scheduler.run_metrics import RunMetricsConfiguration, save_run_metrics
from scripts.e2e_scheduler.resources import ResourceSample
from scripts.e2e_scheduler.runner_cleanup import CleanupOutcome
from scripts.e2e_scheduler.runner_worker import RunMetricsSnapshot, RunMetricsStatus, TimedJobResult

from backend.tests.e2e_scheduler_aggregate_fakes import complete_result_fixture


def test_playwright_inventory_reports_only_projects_with_executed_tests(
    tmp_path: Path,
) -> None:
    report, _test_id = _report(tmp_path)
    config = report["config"]
    assert isinstance(config, dict)
    config["projects"] = [
        {"name": "desktop-chromium", "retries": 0},
        {"name": "tablet-chromium", "retries": 0},
        {"name": "mobile-chromium", "retries": 0},
    ]
    _write_json(path := tmp_path / "playwright.json", report)

    inventory = parse_playwright_inventory(path, tmp_path)

    assert inventory.projects == ("desktop-chromium",)


def test_collect_legacy_requires_actual_profile_cleanup_and_evidence(
    tmp_path: Path,
) -> None:
    report, test_id = _report(tmp_path)
    _write_json(tmp_path / "playwright.json", report)
    _ = (tmp_path / "expectations.jsonl").write_text(
        json.dumps(
            {
                "version": 2,
                "kind": "screenshot",
                "filename": "shot.png",
                "test_id": test_id,
                "capture_label": "ready",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    _write_json(tmp_path / "latest.json", {"count": 1, "files": ["shot.png"]})
    _write_json(
        tmp_path / "profiles.json",
        {
            "version": 1,
            "profiles": [
                {
                    "name": "desktop-chromium",
                    "browser": "chromium",
                    "viewport": [1280, 720],
                }
            ],
        },
    )
    _write_json(
        tmp_path / "cleanup.json",
        {
            "version": 1,
            "process_exited": True,
            "backend_port_closed": True,
            "frontend_port_closed": True,
            "database_removed": True,
            "backend_latency_ms_samples": [25.0],
            "failures": [],
            "concurrency": {
                "adaptive": False,
                "initial": None,
                "minimum": None,
                "maximum": None,
                "started_workers": None,
            },
        },
    )

    collected = collect_legacy(
        run_id="legacy-one",
        playwright_report=tmp_path / "playwright.json",
        evidence_expectations=tmp_path / "expectations.jsonl",
        profile_artifact=tmp_path / "profiles.json",
        cleanup_artifact=tmp_path / "cleanup.json",
        screenshot_manifest=tmp_path / "latest.json",
        repository_root=tmp_path,
    )

    assert collected.inventory.test_ids == (test_id,)
    assert collected.worker_minutes == 1.0
    assert collected.backend_latency_ms_samples == (25.0,)
    assert collected.cleanup_ok

    _write_json(tmp_path / "latest.json", {"count": 1, "files": ["wrong.png"]})
    with pytest.raises(BenchmarkCollectionError, match="evidence filenames"):
        _ = collect_legacy(
            run_id="legacy-two",
            playwright_report=tmp_path / "playwright.json",
            evidence_expectations=tmp_path / "expectations.jsonl",
            profile_artifact=tmp_path / "profiles.json",
            cleanup_artifact=tmp_path / "cleanup.json",
            screenshot_manifest=tmp_path / "latest.json",
            repository_root=tmp_path,
        )

@pytest.mark.parametrize("metrics_version", [1, 2])
def test_collect_dynamic_reads_v1_and_v2_job_wall_metrics(
    tmp_path: Path,
    metrics_version: int,
) -> None:
    report, test_id = _report(tmp_path)
    run_root = tmp_path / "scheduler" / "runs" / "run-one"
    _write_json(run_root / "workers/worker-1/jobs/job-1/result.json", report)
    journal = run_root / "workers/worker-1/jobs/job-1/evidence-expectations.jsonl"
    _ = journal.write_text(
        json.dumps(
            {
                "version": 2,
                "kind": "screenshot",
                "filename": "shot.png",
                "test_id": test_id,
                "capture_label": "ready",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    started = datetime.now(UTC)
    _write_json(
        tmp_path / "latest.json",
        {
            "generated_at": (started + timedelta(seconds=1)).isoformat(),
            "run_id": "run-one",
            "benchmark_invocation_id": "invocation-one",
            "cleanup_status": "complete",
            "totals": {
                "expected_tests": 1,
                "actual_tests": 1,
                "expected_scenarios": 1,
                "actual_scenarios": 1,
                "expected_evidence_count": 1,
                "actual_evidence_count": 1,
                "passed": 1,
            },
            "scenario_ids": {"expected": [test_id], "actual": [test_id], "skipped": []},
            "projects": [
                {
                    "name": "desktop-chromium",
                    "browser": "chromium",
                    "viewport": [1280, 720],
                }
            ],
            "count": 1,
            "files": ["run-one-worker-1-job-1-shot.png"],
            "jobs": [
                {
                    "job_id": "job-1",
                    "worker_id": "worker-1",
                    "expected_evidence_files": ["shot.png"],
                    "actual_evidence_files": ["shot.png"],
                }
            ],
        },
    )
    if metrics_version == 1:
        _write_json(
            run_root / "run-metrics.json",
            {
                "version": 1,
                "jobs": [{"wall_seconds": 42.0}],
                "worker_minutes": 0.7,
                "backend_latency_ms_samples": [30.0],
                "cleanup": [{"succeeded": True}],
                "benchmark_invocation_id": "invocation-one",
                "concurrency": {
                    "adaptive": False,
                    "initial": 8,
                    "minimum": 8,
                    "maximum": 8,
                    "started_workers": 8,
                },
            },
        )
    else:
        _, metric_results = complete_result_fixture(tmp_path)
        save_run_metrics(
            run_root / "run-metrics.json",
            RunMetricsSnapshot(
                results=(
                    TimedJobResult(
                        metric_results[0],
                        42.0,
                        JobMetrics(execution=ExecutionMetrics(duration_inventory_complete=True)),
                    ),
                ),
                cleanup=(CleanupOutcome(metric_results[0].worker_id, True),),
                final_sample=ResourceSample(0.0, 0.0, 30.0, 0, 0),
                    status=RunMetricsStatus.COMPLETE,
                    expected_jobs=1,
                    telemetry=RunTelemetry(
                        host_samples=(HostResourceMetrics(0.0, 0.0, 30.0),),
                        frontend_build_count=1,
                    ),
                ),
            RunMetricsConfiguration("invocation-one", False, 8, 8),
        )
    _write_json(
        run_root / "capacity-decisions.json",
        {
            "version": 1,
            "decisions": [
                {
                    "elapsed_seconds": 0,
                    "previous": 8,
                    "capacity": 8,
                    "reason": "initial",
                    "detail": "",
                }
            ],
        },
    )

    collected = collect_dynamic(
        screenshot_manifest=tmp_path / "latest.json",
        scheduler_root=tmp_path / "scheduler",
        repository_root=tmp_path,
        expected_invocation_id="invocation-one",
        started_at=started,
    )

    assert collected.job_durations_seconds == (42.0,)
    assert collected.backend_latency_ms_samples == (30.0,)
    assert collected.capacity_decisions[0].reason == "initial"

    if metrics_version == 2:
        metrics_path = run_root / "run-metrics.json"
        valid_metrics = metrics_path.read_text(encoding="utf-8")
        invalid_metrics = valid_metrics.replace(
            '"active_process_count": 0',
            '"active_process_count": 1',
        )
        assert invalid_metrics != valid_metrics
        _ = metrics_path.write_text(invalid_metrics, encoding="utf-8")
        with pytest.raises(
            BenchmarkCollectionError,
            match="runner-owned processes remained",
        ):
            _ = collect_dynamic(
                screenshot_manifest=tmp_path / "latest.json",
                scheduler_root=tmp_path / "scheduler",
                repository_root=tmp_path,
                expected_invocation_id="invocation-one",
                started_at=started,
            )
        _ = metrics_path.write_text(valid_metrics, encoding="utf-8")

    latest_path = tmp_path / "latest.json"
    raw_latest = latest_path.read_text(encoding="utf-8")
    _ = latest_path.write_text(
        raw_latest.replace(
            '"actual_evidence_files": ["shot.png"]',
            '"actual_evidence_files": ["wrong.png"]',
        ),
        encoding="utf-8",
    )
    with pytest.raises(BenchmarkCollectionError, match="evidence filenames"):
        _ = collect_dynamic(
            screenshot_manifest=tmp_path / "latest.json",
            scheduler_root=tmp_path / "scheduler",
            repository_root=tmp_path,
            expected_invocation_id="invocation-one",
            started_at=started,
        )
