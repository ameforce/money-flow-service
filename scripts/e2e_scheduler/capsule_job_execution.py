"""Playwright process execution and metric finalization for capsule jobs."""

from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass, replace
import os
from pathlib import Path
import subprocess
from time import monotonic

from scripts.e2e_scheduler.active_job import ActiveJobController
from scripts.e2e_scheduler.aggregate_report import ResultReportError, parse_job_report
from scripts.e2e_scheduler.browser_pool import BrowserServerPool
from scripts.e2e_scheduler.capsule_cleanup import remove_file_with_retry
from scripts.e2e_scheduler.capsule_job_launch import JobLaunch
from scripts.e2e_scheduler.capsule_paths import JobPaths
from scripts.e2e_scheduler.discovery import write_test_list
from scripts.e2e_scheduler.job_metrics import (
    load_auth_setup_metrics,
    save_job_metrics,
)
from scripts.e2e_scheduler.metrics import BrowserMetrics, ExecutionMetrics, JobMetrics
from scripts.e2e_scheduler.model import JobSpec
from scripts.e2e_scheduler.process_launch import ProcessLaunch
from scripts.e2e_scheduler.processes import (
    OwnedProcess,
    resolve_dynamic_windows_spawn_mode,
)
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.project_profiles import BrowserEngine


@dataclass(frozen=True, slots=True)
class BrowserAcquisition:
    endpoint: str
    metrics: BrowserMetrics


@dataclass(frozen=True, slots=True)
class PlaywrightProcessRequest:
    launch: JobLaunch
    paths: JobPaths
    repository_root: Path
    active_jobs: ActiveJobController
    metrics_recorder: ProcessMetricsRecorder | None


@dataclass(frozen=True, slots=True)
class JobMetricsRecord:
    job: JobSpec
    paths: JobPaths
    repository_root: Path
    browser: BrowserMetrics
    process_seconds: float
    reset_seconds: tuple[float, int, float, float]


def acquire_browser(
    browser: BrowserServerPool,
    engine: BrowserEngine,
    initial_engine: BrowserEngine,
) -> BrowserAcquisition:
    engines_before = tuple(getattr(browser, "engines", (engine,)))
    retire_others = engine == "chromium" and initial_engine != "chromium"
    started = monotonic()
    endpoint = browser.endpoint_for(engine, retire_others=retire_others)
    acquire_seconds = max(monotonic() - started, 0.0)
    switched = engine not in engines_before or (
        retire_others and any(current != engine for current in engines_before)
    )
    return BrowserAcquisition(
        endpoint=endpoint,
        metrics=BrowserMetrics(
            acquire_seconds=acquire_seconds,
            switch_seconds=acquire_seconds if switched else 0.0,
        ),
    )


def prepare_job_paths(job: JobSpec, paths: JobPaths) -> None:
    for path in (
        paths.output,
        paths.screenshots,
        paths.evidence,
        paths.uiux_evidence,
        paths.temporary,
        paths.uploads,
    ):
        path.mkdir(parents=True, exist_ok=True)
    write_test_list(job, paths.test_list)
    remove_file_with_retry(paths.runtime_profile)
    remove_file_with_retry(paths.root / "auth-setup.jsonl")
    remove_file_with_retry(paths.root / "scheduler-metrics.json")
    _ = paths.evidence_expectations.write_text("", encoding="utf-8")


def run_playwright_process(request: PlaywrightProcessRequest) -> int:
    with (
        request.paths.stdout.open("wb") as stdout_file,
        request.paths.stderr.open("wb") as stderr_file,
    ):
        owned = OwnedProcess.spawn(
            ProcessLaunch(
                request.launch.command,
                cwd=request.repository_root,
                env=request.launch.environment,
                stdout=stdout_file,
                stderr=stderr_file,
                creationflags=(
                    subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
                ),
                start_new_session=os.name != "nt",
                role="playwright-cli",
                metrics_recorder=request.metrics_recorder,
                windows_spawn_mode=resolve_dynamic_windows_spawn_mode(),
            )
        )
        with closing(owned):
            request.active_jobs.activate(owned)
            try:
                return int(owned.process.wait())
            finally:
                request.active_jobs.deactivate(owned)


def record_job_metrics(record: JobMetricsRecord) -> None:
    actual_test_seconds, duration_inventory_complete = _reported_test_seconds(
        record.job,
        record.paths,
        record.repository_root,
    )
    auth_setup = load_auth_setup_metrics(record.paths.root / "auth-setup.jsonl")
    (
        db_reset_seconds,
        db_reset_retry_count,
        db_reset_locked_seconds,
        filesystem_cleanup_seconds,
    ) = record.reset_seconds
    save_job_metrics(
        record.paths.root / "scheduler-metrics.json",
        JobMetrics(
            browser=record.browser,
            execution=ExecutionMetrics(
                playwright_cli_startup_seconds=max(
                    record.process_seconds - actual_test_seconds,
                    0.0,
                ),
                actual_test_seconds=actual_test_seconds,
                duration_inventory_complete=duration_inventory_complete,
            ),
            setup=replace(
                auth_setup,
                db_reset_seconds=db_reset_seconds,
                db_reset_retry_count=db_reset_retry_count,
                db_reset_locked_seconds=db_reset_locked_seconds,
                filesystem_cleanup_seconds=filesystem_cleanup_seconds,
            ),
        ),
    )


def _reported_test_seconds(
    job: JobSpec,
    paths: JobPaths,
    repository_root: Path,
) -> tuple[float, bool]:
    if not paths.json_report.exists():
        return 0.0, False
    try:
        reported = parse_job_report(job, paths.json_report, repository_root)
    except ResultReportError:
        return 0.0, False
    return (
        sum(duration.seconds for duration in reported.durations),
        reported.duration_inventory_complete,
    )
