"""Convert complete Playwright reports into history samples."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from scripts.e2e_scheduler.aggregate import JobResult
from scripts.e2e_scheduler.aggregate_report import parse_job_report
from scripts.e2e_scheduler.history import DurationResult
from scripts.e2e_scheduler.model import RunManifest


class TimedJobResultLike(Protocol):
    @property
    def result(self) -> JobResult: ...

    @property
    def seconds(self) -> float: ...


def duration_results(
    manifest: RunManifest,
    results: Sequence[TimedJobResultLike],
) -> tuple[DurationResult, ...]:
    """Read actual test durations and isolate job-boundary overhead."""
    jobs = {job.job_id: job for job in manifest.jobs}
    durations: list[DurationResult] = []
    for timed in results:
        job = jobs[timed.result.job_id]
        if not timed.result.report_path.is_file():
            continue
        reported = parse_job_report(
            job,
            timed.result.report_path,
            timed.result.repository_root,
        )
        if not reported.duration_inventory_complete:
            continue
        boundary_seconds = max(
            timed.seconds - sum(item.seconds for item in reported.durations),
            0.0,
        )
        browser = job.tests[0].browser
        durations.extend(
            DurationResult(
                item.test_id,
                item.spec_path,
                item.seconds,
                complete=True,
                browser=browser,
                job_boundary_seconds=boundary_seconds if index == 0 else None,
            )
            for index, item in enumerate(reported.durations)
        )
    return tuple(durations)
