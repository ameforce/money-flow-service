"""Transactional legacy screenshot publication for scheduler runs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
from pathlib import Path
import shutil
from typing import override

from scripts.e2e_scheduler.aggregate_publish_models import (
    JobSummary,
    ProjectSummary,
    PublicationJob,
)
from scripts.e2e_scheduler.model import RunManifest
from scripts.e2e_scheduler.publication_transaction import (
    PreparedPublication,
    PublicationTransactionError,
    commit_publications,
    discard_publication,
    prepare_publication,
)


@dataclass(slots=True)
class PublicationError(Exception):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


def publish_run(
    manifest: RunManifest,
    jobs: tuple[PublicationJob, ...],
    output_root: Path,
    repository_root: Path,
) -> tuple[str, ...]:
    """Stage and swap one complete verifier-compatible publication."""
    prepared = prepare_run(manifest, jobs, output_root, repository_root)
    try:
        commit_publications((prepared,))
    except PublicationTransactionError as error:
        discard_publication(prepared)
        raise PublicationError(str(error)) from error
    return prepared.published_files


def prepare_run(
    manifest: RunManifest,
    jobs: tuple[PublicationJob, ...],
    output_root: Path,
    repository_root: Path,
) -> PreparedPublication:
    """Fully stage one verifier-compatible publication without swapping it."""
    copies = tuple(
        (source, f"{manifest.run_id}-{job.worker_id}-{job.job_id}-{source.name}")
        for job in jobs
        for source in job.screenshots
    )
    names = tuple(sorted(name for _, name in copies))
    if len(names) != len(set(names)):
        raise PublicationError("published screenshot names collide")
    try:
        prepared = prepare_publication(repository_root, output_root, names)
    except (OSError, PublicationTransactionError) as error:
        raise PublicationError(f"publication failed: {error}") from error
    try:
        for source, name in copies:
            _ = shutil.copyfile(source, prepared.stage / name)
        _ = (prepared.stage / "latest-run.json").write_text(
            _legacy_payload(manifest, jobs, names),
            encoding="utf-8",
        )
    except OSError as error:
        discard_publication(prepared)
        raise PublicationError(f"publication failed: {error}") from error
    return prepared


def _legacy_payload(
    manifest: RunManifest,
    jobs: tuple[PublicationJob, ...],
    names: tuple[str, ...],
) -> str:
    projects: list[ProjectSummary] = []
    for project in sorted(manifest.expected_projects):
        project_tests = tuple(
            test for test in manifest.tests if test.project == project
        )
        project_jobs = tuple(job for job in jobs if job.project == project)
        expected_profile = {
            (job.expected_browser, job.expected_viewport) for job in project_jobs
        }
        actual_profile = {
            (job.actual_browser, job.actual_viewport) for job in project_jobs
        }
        if len(expected_profile) != 1 or len(actual_profile) != 1:
            raise PublicationError(f"project {project} publication profile mismatch")
        expected_browser, expected_viewport = next(iter(expected_profile))
        actual_browser, actual_viewport = next(iter(actual_profile))
        projects.append(
            {
                "name": project,
                "browser": actual_browser,
                "viewport": list(actual_viewport)
                if actual_viewport is not None
                else None,
                "expected_browser": expected_browser,
                "actual_browser": actual_browser,
                "expected_viewport": list(expected_viewport)
                if expected_viewport
                else None,
                "actual_viewport": list(actual_viewport) if actual_viewport else None,
                "expected_tests": len(project_tests),
                "actual_tests": sum(len(job.actual_test_ids) for job in project_jobs),
                "passed": sum(
                    len(job.actual_test_ids) - len(job.skipped_test_ids)
                    for job in project_jobs
                ),
                "skipped": sum(len(job.skipped_test_ids) for job in project_jobs),
                "expected_scenarios": sum(
                    len(job.expected_scenario_ids) for job in project_jobs
                ),
                "actual_scenarios": sum(
                    len(job.actual_test_ids) for job in project_jobs
                ),
                "expected_evidence_count": sum(
                    len(job.expected_evidence_names) for job in project_jobs
                ),
                "actual_evidence_count": sum(
                    job.actual_evidence_count for job in project_jobs
                ),
            }
        )
    job_summaries: list[JobSummary] = [
        {
            "job_id": job.job_id,
            "worker_id": job.worker_id,
            "project": job.project,
            "expected_browser": job.expected_browser,
            "actual_browser": job.actual_browser,
            "expected_viewport": list(job.expected_viewport)
            if job.expected_viewport
            else None,
            "actual_viewport": list(job.actual_viewport)
            if job.actual_viewport
            else None,
            "expected_tests": job.expected_tests,
            "actual_tests": len(job.actual_test_ids),
            "expected_scenarios": len(job.expected_scenario_ids),
            "actual_scenarios": len(job.actual_test_ids),
            "expected_scenario_ids": list(job.expected_scenario_ids),
            "actual_scenario_ids": list(job.actual_test_ids),
            "skipped_scenario_ids": list(job.skipped_test_ids),
            "expected_evidence_count": len(job.expected_evidence_names),
            "actual_evidence_count": job.actual_evidence_count,
            "expected_evidence_files": list(job.expected_evidence_names),
            "actual_evidence_files": list(job.actual_evidence_names),
            "return_code": job.return_code,
            "cleanup_succeeded": job.cleanup_succeeded,
        }
        for job in sorted(jobs, key=lambda item: item.job_id)
    ]
    return (
        json.dumps(
            {
                "generated_at": datetime.now(UTC).isoformat(),
                "count": len(names),
                "files": list(names),
                "playwright_args": list(manifest.playwright_args),
                "run_id": str(manifest.run_id),
                "benchmark_invocation_id": manifest.benchmark_invocation_id,
                "totals": {
                    "expected_tests": len(manifest.tests),
                    "actual_tests": sum(len(job.actual_test_ids) for job in jobs),
                    "passed": sum(
                        len(job.actual_test_ids) - len(job.skipped_test_ids)
                        for job in jobs
                    ),
                    "skipped": sum(len(job.skipped_test_ids) for job in jobs),
                    "failed": 0,
                    "interrupted": 0,
                    "missing": 0,
                    "expected_scenarios": sum(
                        len(job.expected_scenario_ids) for job in jobs
                    ),
                    "actual_scenarios": sum(len(job.actual_test_ids) for job in jobs),
                    "expected_evidence_count": sum(
                        len(job.expected_evidence_names) for job in jobs
                    ),
                    "actual_evidence_count": sum(
                        job.actual_evidence_count for job in jobs
                    ),
                    "jobs": len(jobs),
                    "projects": len(projects),
                },
                "scenario_ids": {
                    "expected": sorted(
                        str(test_id)
                        for job in jobs
                        for test_id in job.expected_scenario_ids
                    ),
                    "actual": sorted(
                        str(test_id) for job in jobs for test_id in job.actual_test_ids
                    ),
                    "skipped": sorted(
                        str(test_id) for job in jobs for test_id in job.skipped_test_ids
                    ),
                },
                "projects": projects,
                "cleanup_status": "complete",
                "jobs": job_summaries,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
