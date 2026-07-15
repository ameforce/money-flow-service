"""Strict Playwright result aggregation and legacy evidence publication."""

from __future__ import annotations

from collections.abc import Sequence
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import NewType, override

from scripts.e2e_scheduler.aggregate_publish import (
    PublicationError,
    prepare_run,
)
from scripts.e2e_scheduler.aggregate_publish_models import PublicationJob
from scripts.e2e_scheduler.aggregate_paths import (
    ArtifactPathError,
    validate_result_artifact_roots,
)
from scripts.e2e_scheduler.aggregate_report import (
    ResultReportError,
    expected_profile,
    parse_job_report,
)
from scripts.e2e_scheduler.model import JobId, JobSpec, RunManifest, TestId, WorkerId
from scripts.e2e_scheduler.publication_transaction import (
    PreparedPublication,
    PublicationTransactionError,
    commit_publications,
    discard_publication,
)
from scripts.e2e_scheduler.uiux_evidence_publication import (
    EVIDENCE_VERSION,
    UiuxEvidencePublicationError,
    prepare_uiux_evidence,
)

EvidenceCount = NewType("EvidenceCount", int)


@dataclass(frozen=True, slots=True)
class JobResult:
    job_id: JobId
    worker_id: WorkerId
    project: str
    browser: str
    viewport: tuple[int, int] | None
    repository_root: Path
    report_path: Path
    screenshot_dir: Path
    evidence_dir: Path
    uiux_evidence_root: Path
    return_code: int
    expected_evidence_names: tuple[str, ...]
    cleanup_succeeded: bool


@dataclass(frozen=True, slots=True)
class AggregationSummary:
    expected_test_ids: frozenset[TestId]
    actual_test_ids: frozenset[TestId]
    expected_scenario_ids: frozenset[TestId]
    actual_scenario_ids: frozenset[TestId]
    skipped_test_ids: frozenset[TestId]
    expected_evidence_count: EvidenceCount
    actual_evidence_count: EvidenceCount
    published_files: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PreparedAggregation:
    summary: AggregationSummary
    publications: tuple[PreparedPublication, ...]


@dataclass(slots=True)
class AggregationError(Exception):
    reason: str

    @override
    def __str__(self) -> str:
        return f"E2E aggregation failed: {self.reason}"


@dataclass(frozen=True, slots=True)
class _ParsedJob:
    spec: JobSpec
    result: JobResult
    actual_test_ids: tuple[TestId, ...]
    skipped_test_ids: tuple[TestId, ...]
    screenshots: tuple[Path, ...]
    actual_evidence_names: tuple[str, ...]
    actual_evidence_count: EvidenceCount


def aggregate_run(
    manifest: RunManifest,
    job_results: Sequence[JobResult],
    output_root: Path,
) -> AggregationSummary:
    prepared = prepare_aggregation(manifest, job_results, output_root)
    try:
        _ = commit_publications(prepared.publications)
    except PublicationTransactionError as error:
        for publication in prepared.publications:
            discard_publication(publication)
        raise AggregationError(str(error)) from error
    except BaseException:
        for publication in prepared.publications:
            discard_publication(publication)
        raise
    return prepared.summary


def prepare_aggregation(
    manifest: RunManifest,
    job_results: Sequence[JobResult],
    output_root: Path,
) -> PreparedAggregation:
    """Validate one complete run before publishing its compatibility manifest."""
    expected_jobs = Counter(job.job_id for job in manifest.jobs)
    actual_jobs = Counter(result.job_id for result in job_results)
    if expected_jobs != actual_jobs or any(
        count != 1 for count in expected_jobs.values()
    ):
        raise AggregationError(
            f"job parity mismatch: expected={expected_jobs}, actual={actual_jobs}"
        )
    for project in manifest.expected_projects:
        profiles = {
            (test.browser, test.viewport)
            for test in manifest.tests
            if test.project == project
        }
        if len(profiles) != 1:
            raise AggregationError(
                f"project {project} has inconsistent runtime profiles"
            )

    jobs_by_id = {job.job_id: job for job in manifest.jobs}
    parsed = tuple(
        _parse_job(jobs_by_id[result.job_id], result) for result in job_results
    )
    expected_tests = Counter(test.test_id for test in manifest.tests)
    actual_tests = Counter(test_id for job in parsed for test_id in job.actual_test_ids)
    if expected_tests != actual_tests:
        raise AggregationError(
            f"test parity mismatch: expected={expected_tests}, actual={actual_tests}"
        )

    publication_jobs = tuple(_publication_job(job) for job in parsed)
    repository_roots = {result.repository_root.resolve() for result in job_results}
    if len(repository_roots) != 1:
        raise AggregationError(
            f"job repository roots differ: {tuple(sorted(map(str, repository_roots)))}"
        )
    try:
        for result in job_results:
            validate_result_artifact_roots(result)
    except ArtifactPathError as error:
        raise AggregationError(str(error)) from error
    uiux_publication: PreparedPublication | None = None
    screenshot_publication: PreparedPublication | None = None
    try:
        uiux_publication = prepare_uiux_evidence(
            tuple(result.uiux_evidence_root for result in job_results),
            next(iter(repository_roots)),
        )
        screenshot_publication = prepare_run(
            manifest,
            publication_jobs,
            output_root,
            next(iter(repository_roots)),
        )
        prepared = (
            (uiux_publication, screenshot_publication)
            if uiux_publication is not None
            else (screenshot_publication,)
        )
    except (
        PublicationError,
        PublicationTransactionError,
        UiuxEvidencePublicationError,
    ) as error:
        if uiux_publication is not None:
            discard_publication(uiux_publication)
        if screenshot_publication is not None:
            discard_publication(screenshot_publication)
        raise AggregationError(str(error)) from error
    except BaseException:
        if uiux_publication is not None:
            discard_publication(uiux_publication)
        if screenshot_publication is not None:
            discard_publication(screenshot_publication)
        raise
    uiux_files = (
        uiux_publication.published_files if uiux_publication is not None else ()
    )
    published_files = screenshot_publication.published_files
    all_published_files = (
        *published_files,
        *(f".omo/evidence/{EVIDENCE_VERSION}/{name}" for name in uiux_files),
    )
    expected_evidence = EvidenceCount(
        sum(len(job.result.expected_evidence_names) for job in parsed)
    )
    actual_evidence = EvidenceCount(sum(job.actual_evidence_count for job in parsed))
    return PreparedAggregation(
        summary=AggregationSummary(
            expected_test_ids=frozenset(expected_tests),
            actual_test_ids=frozenset(actual_tests),
            expected_scenario_ids=frozenset(expected_tests),
            actual_scenario_ids=frozenset(actual_tests),
            skipped_test_ids=frozenset(
                test_id for job in parsed for test_id in job.skipped_test_ids
            ),
            expected_evidence_count=expected_evidence,
            actual_evidence_count=actual_evidence,
            published_files=all_published_files,
        ),
        publications=prepared,
    )


def _parse_job(spec: JobSpec, result: JobResult) -> _ParsedJob:
    if result.return_code != 0:
        raise AggregationError(f"job {result.job_id} exited {result.return_code}")
    if not result.cleanup_succeeded:
        raise AggregationError(f"job {result.job_id} cleanup failed")
    expected_evidence = Counter(result.expected_evidence_names)
    if any(count != 1 for count in expected_evidence.values()):
        raise AggregationError(
            f"job {result.job_id} has duplicate evidence expectations"
        )
    try:
        profile = expected_profile(spec)
    except ResultReportError as error:
        raise AggregationError(str(error)) from error
    if (result.project, result.browser, result.viewport) != (spec.project, *profile):
        raise AggregationError(f"job {result.job_id} runtime profile mismatch")
    try:
        report = parse_job_report(spec, result.report_path, result.repository_root)
    except ResultReportError as error:
        raise AggregationError(str(error)) from error
    screenshots = _artifact_files(result.screenshot_dir, "*.png")
    evidence = _artifact_files(result.evidence_dir, "*")
    actual_names = tuple(path.name for path in screenshots) + tuple(
        path.relative_to(result.evidence_dir).as_posix() for path in evidence
    )
    actual_evidence_names = Counter(actual_names)
    actual_evidence = EvidenceCount(len(actual_names))
    if actual_evidence_names != expected_evidence:
        reason = (
            f"job {result.job_id} evidence mismatch: expected="
            f"{expected_evidence}, actual={actual_evidence_names}"
        )
        raise AggregationError(reason)
    return _ParsedJob(
        spec,
        result,
        report.test_ids,
        report.skipped_test_ids,
        screenshots,
        tuple(sorted(actual_names)),
        actual_evidence,
    )


def _artifact_files(root: Path, pattern: str) -> tuple[Path, ...]:
    if not root.is_dir():
        raise AggregationError(f"missing artifact directory: {root}")
    files = tuple(sorted(path for path in root.rglob(pattern) if path.is_file()))
    empty = tuple(path for path in files if path.stat().st_size == 0)
    if empty:
        raise AggregationError(f"empty artifacts: {empty}")
    return files


def _publication_job(job: _ParsedJob) -> PublicationJob:
    profile = expected_profile(job.spec)
    return PublicationJob(
        job_id=str(job.result.job_id),
        worker_id=str(job.result.worker_id),
        project=job.spec.project,
        expected_browser=profile[0],
        actual_browser=job.result.browser,
        expected_viewport=profile[1],
        actual_viewport=job.result.viewport,
        expected_tests=len(job.spec.tests),
        expected_scenario_ids=tuple(test.test_id for test in job.spec.tests),
        actual_test_ids=job.actual_test_ids,
        skipped_test_ids=job.skipped_test_ids,
        expected_evidence_names=job.result.expected_evidence_names,
        actual_evidence_names=job.actual_evidence_names,
        actual_evidence_count=job.actual_evidence_count,
        return_code=job.result.return_code,
        cleanup_succeeded=job.result.cleanup_succeeded,
        screenshots=job.screenshots,
    )
