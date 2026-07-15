"""Collect comparable legacy and dynamic benchmark inventories."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, ValidationError

from scripts.e2e_scheduler.benchmark import (
    CapacityDecisionRecord,
    ConcurrencyMetadata,
    RunInventory,
)
from scripts.e2e_scheduler.benchmark_collect_models import (
    BenchmarkCollectionError,
    CollectedRun,
    ConcurrencyInput,
    Decisions,
    DynamicLatest,
    LegacyCleanup,
    LegacyLatest,
    Profiles,
    read_run_metrics,
)
from scripts.e2e_scheduler.benchmark_profiles import (
    validate_runtime_profiles,
    viewport_label,
)
from scripts.e2e_scheduler.benchmark_report import parse_playwright_inventory
from scripts.e2e_scheduler.evidence_expectations import parse_evidence_expectations
from scripts.e2e_scheduler.benchmark_evidence import (
    collect_dynamic_semantic_evidence,
    collect_legacy_semantic_evidence,
    semantic_evidence_fingerprint,
)


def collect_legacy(
    *,
    run_id: str,
    playwright_report: Path,
    evidence_expectations: Path,
    profile_artifact: Path,
    cleanup_artifact: Path,
    screenshot_manifest: Path,
    repository_root: Path,
) -> CollectedRun:
    report = parse_playwright_inventory(playwright_report, repository_root)
    latest = _read(LegacyLatest, screenshot_manifest)
    expected_evidence = parse_evidence_expectations(evidence_expectations)
    semantic_evidence = collect_legacy_semantic_evidence(
        evidence_expectations,
        report.test_ids,
    )
    canonical_expected_evidence = tuple(sorted(expected_evidence))
    if canonical_expected_evidence != latest.files:
        raise BenchmarkCollectionError(
            "legacy evidence filenames differ despite matching counts"
        )
    profiles = _read(Profiles, profile_artifact).profiles
    validate_runtime_profiles(report.projects, profiles)
    cleanup = _read(LegacyCleanup, cleanup_artifact)
    browsers = tuple(sorted({profile.browser for profile in profiles}))
    viewports = tuple(sorted(viewport_label(profile.viewport) for profile in profiles))
    inventory = RunInventory(
        test_ids=report.test_ids,
        skipped_test_ids=report.skipped_test_ids,
        projects=report.projects,
        browsers=browsers,
        viewports=viewports,
        expected_scenarios=len(report.test_ids),
        actual_scenarios=len(report.test_ids),
        expected_evidence=len(expected_evidence),
        actual_evidence=latest.count,
        passed=report.passed,
        failed=report.failed,
        skipped=report.skipped,
        interrupted=report.interrupted,
        missing=0,
        evidence_parity_ok=True,
        expected_evidence_fingerprint=semantic_evidence_fingerprint(semantic_evidence),
        actual_evidence_fingerprint=semantic_evidence_fingerprint(semantic_evidence),
        semantic_evidence=semantic_evidence,
    )
    return CollectedRun(
        run_id=run_id,
        inventory=inventory,
        worker_minutes=sum(report.durations_seconds) / 60.0,
        job_durations_seconds=report.durations_seconds,
        cleanup_ok=(
            latest.count == len(latest.files)
            and cleanup.process_exited
            and cleanup.backend_port_closed
            and cleanup.frontend_port_closed
            and cleanup.database_removed
            and not cleanup.failures
        ),
        backend_latency_ms_samples=cleanup.backend_latency_ms_samples,
        capacity_decisions=(),
        concurrency=_concurrency(cleanup.concurrency),
    )


def collect_dynamic(
    *,
    screenshot_manifest: Path,
    scheduler_root: Path,
    repository_root: Path,
    expected_invocation_id: str,
    started_at: datetime,
) -> CollectedRun:
    latest = _read(DynamicLatest, screenshot_manifest)
    if latest.generated_at <= started_at:
        raise BenchmarkCollectionError(
            "dynamic publication is stale for this invocation"
        )
    if latest.benchmark_invocation_id != expected_invocation_id:
        raise BenchmarkCollectionError("dynamic publication invocation marker mismatch")
    report_paths = tuple(
        sorted(
            (scheduler_root / "runs" / latest.run_id / "workers").glob(
                "*/jobs/*/result.json"
            )
        )
    )
    if not report_paths:
        raise BenchmarkCollectionError("dynamic run has no job result reports")
    reports_by_job = {
        path.parent.name: parse_playwright_inventory(path, repository_root)
        for path in report_paths
    }
    reports = tuple(reports_by_job.values())
    actual_ids = tuple(
        sorted(test_id for report in reports for test_id in report.test_ids)
    )
    skipped_ids = tuple(
        sorted(test_id for report in reports for test_id in report.skipped_test_ids)
    )
    if actual_ids != tuple(sorted(latest.scenario_ids.actual)):
        raise BenchmarkCollectionError(
            "dynamic report and publication inventories differ"
        )
    if skipped_ids != tuple(sorted(latest.scenario_ids.skipped)):
        raise BenchmarkCollectionError(
            "dynamic report and publication skip inventories differ"
        )
    run_root = scheduler_root / "runs" / latest.run_id
    metrics = read_run_metrics(run_root / "run-metrics.json")
    if metrics.benchmark_invocation_id != expected_invocation_id:
        raise BenchmarkCollectionError("dynamic benchmark invocation marker mismatch")
    metrics.validate_complete(latest)
    decisions = _read(Decisions, run_root / "capacity-decisions.json")
    semantic_evidence = collect_dynamic_semantic_evidence(
        run_root,
        latest.jobs,
        reports_by_job,
    )
    if any(
        tuple(sorted(job.expected_evidence_files))
        != tuple(sorted(job.actual_evidence_files))
        for job in latest.jobs
    ):
        raise BenchmarkCollectionError(
            "dynamic per-job evidence filenames differ despite matching counts"
        )
    expected_published = tuple(
        sorted(
            f"{latest.run_id}-{job.worker_id}-{job.job_id}-{Path(name).name}"
            for job in latest.jobs
            for name in job.actual_evidence_files
            if name.endswith(".png")
        )
    )
    if (
        latest.files != expected_published
        or latest.count != len(latest.files)
        or latest.count != len(expected_published)
    ):
        raise BenchmarkCollectionError("dynamic published evidence inventory mismatch")
    inventory = RunInventory(
        test_ids=actual_ids,
        skipped_test_ids=skipped_ids,
        projects=tuple(sorted(project.name for project in latest.projects)),
        browsers=tuple(sorted({project.browser for project in latest.projects})),
        viewports=tuple(
            sorted(viewport_label(project.viewport) for project in latest.projects)
        ),
        expected_scenarios=latest.totals.expected_scenarios,
        actual_scenarios=latest.totals.actual_scenarios,
        expected_evidence=latest.totals.expected_evidence_count,
        actual_evidence=latest.totals.actual_evidence_count,
        passed=latest.totals.passed,
        failed=latest.totals.failed,
        skipped=latest.totals.skipped,
        interrupted=latest.totals.interrupted,
        missing=latest.totals.missing,
        evidence_parity_ok=True,
        expected_evidence_fingerprint=semantic_evidence_fingerprint(semantic_evidence),
        actual_evidence_fingerprint=semantic_evidence_fingerprint(semantic_evidence),
        semantic_evidence=semantic_evidence,
    )
    return CollectedRun(
        run_id=latest.run_id,
        inventory=inventory,
        worker_minutes=metrics.worker_minutes,
        job_durations_seconds=tuple(job.wall_seconds for job in metrics.jobs),
        cleanup_ok=(
            latest.cleanup_status == "complete"
            and bool(metrics.cleanup)
            and all(outcome.succeeded for outcome in metrics.cleanup)
        ),
        backend_latency_ms_samples=metrics.backend_latency_ms_samples,
        capacity_decisions=tuple(
            CapacityDecisionRecord(
                item.elapsed_seconds,
                item.previous,
                item.capacity,
                item.reason,
                item.detail,
            )
            for item in decisions.decisions
        ),
        concurrency=_concurrency(metrics.concurrency),
    )


def _read[ModelT: BaseModel](model: type[ModelT], path: Path) -> ModelT:
    try:
        return model.model_validate_json(path.read_bytes())
    except OSError as error:
        raise BenchmarkCollectionError(f"cannot read {path}: {error}") from error
    except ValidationError as error:
        raise BenchmarkCollectionError(f"invalid {path}: {error}") from error


def _concurrency(value: ConcurrencyInput) -> ConcurrencyMetadata:
    return ConcurrencyMetadata(
        value.adaptive,
        value.initial,
        value.minimum,
        value.maximum,
        value.started_workers,
    )
