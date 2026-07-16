"""Typed Playwright JSON reporter boundary for E2E aggregation."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Literal, override

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError

from scripts.e2e_scheduler.discovery import canonical_test_id
from scripts.e2e_scheduler.model import JobSpec, TestId

type _ExpectedStatus = Literal["passed", "failed", "timedOut", "skipped", "interrupted"]
type _TestStatus = Literal["expected", "skipped", "unexpected", "flaky"]
type _AttemptStatus = Literal["passed", "failed", "timedOut", "skipped", "interrupted"]


@dataclass(slots=True)
class ResultReportError(Exception):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


class _StrictInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(
        extra="ignore",
        frozen=True,
        strict=True,
    )


class _ProjectInput(_StrictInput):
    name: str
    retries: Literal[0]


class _ConfigInput(_StrictInput):
    root_dir: str = Field(validation_alias=AliasChoices("rootDir", "root_dir"))
    projects: tuple[_ProjectInput, ...]


class _AttemptInput(_StrictInput):
    status: _AttemptStatus
    duration: float | None = Field(default=None, ge=0)
    retry: Literal[0] = 0


class _TestInput(_StrictInput):
    project_name: str = Field(validation_alias=AliasChoices("projectName", "project_name"))
    expected_status: _ExpectedStatus = Field(
        validation_alias=AliasChoices("expectedStatus", "expected_status")
    )
    status: _TestStatus
    results: tuple[_AttemptInput, ...] = Field(max_length=1)


class _SpecInput(_StrictInput):
    title: str
    file: str
    line: int = Field(gt=0)
    tests: tuple[_TestInput, ...]


class _SuiteInput(_StrictInput):
    title: str
    specs: tuple[_SpecInput, ...] = ()
    suites: tuple[_SuiteInput, ...] = ()


class _ReportErrorInput(_StrictInput):
    message: str = "unknown reporter error"


class _ReportInput(_StrictInput):
    config: _ConfigInput
    suites: tuple[_SuiteInput, ...]
    errors: tuple[_ReportErrorInput, ...] = ()


@dataclass(frozen=True, slots=True)
class ReportedDuration:
    test_id: TestId
    spec_path: Path
    seconds: float


@dataclass(frozen=True, slots=True)
class ReportedJob:
    test_ids: tuple[TestId, ...]
    skipped_test_ids: tuple[TestId, ...]
    durations: tuple[ReportedDuration, ...]
    duration_inventory_complete: bool


def parse_job_report(
    spec: JobSpec,
    report_path: Path,
    repository_root: Path,
) -> ReportedJob:
    """Parse and validate one job-owned Playwright JSON report."""
    try:
        report = _ReportInput.model_validate_json(report_path.read_bytes())
    except OSError as error:
        raise ResultReportError(f"cannot read {report_path}: {error}") from error
    except ValidationError as error:
        raise ResultReportError(f"invalid report {report_path}: {error}") from error
    if report.errors:
        raise ResultReportError(f"job {spec.job_id} reporter errors: {report.errors}")
    profiles = {project.name: project for project in report.config.projects}
    if len(profiles) != len(report.config.projects):
        raise ResultReportError(f"job {spec.job_id} has duplicate project metadata")
    if spec.project not in profiles:
        raise ResultReportError(f"job {spec.job_id} project metadata mismatch")
    root_dir = Path(report.config.root_dir)
    if not root_dir.is_absolute():
        raise ResultReportError(f"job {spec.job_id} reporter rootDir is not absolute")

    actual_ids: list[TestId] = []
    skipped_ids: list[TestId] = []
    durations: list[ReportedDuration] = []
    missing_duration_ids: list[TestId] = []
    for suite in report.suites:
        _collect_tests(
            suite,
            (),
            False,
            spec,
            root_dir,
            repository_root,
            actual_ids,
            skipped_ids,
            durations,
            missing_duration_ids,
        )
    if Counter(test.test_id for test in spec.tests) != Counter(actual_ids):
        raise ResultReportError(f"job {spec.job_id} result inventory mismatch")
    return ReportedJob(
        tuple(actual_ids),
        tuple(skipped_ids),
        tuple(durations),
        not missing_duration_ids,
    )


def expected_profile(spec: JobSpec) -> tuple[str, tuple[int, int] | None]:
    """Return the one runtime profile declared by a scheduler job."""
    profiles = {(test.browser, test.viewport) for test in spec.tests}
    if len(profiles) != 1:
        raise ResultReportError(f"job {spec.job_id} has inconsistent expected runtime profiles")
    return next(iter(profiles))


def _collect_tests(
    suite: _SuiteInput,
    parents: tuple[str, ...],
    include_title: bool,
    spec: JobSpec,
    root_dir: Path,
    repository_root: Path,
    actual_ids: list[TestId],
    skipped_ids: list[TestId],
    durations: list[ReportedDuration],
    missing_duration_ids: list[TestId],
) -> None:
    titles = parents + ((suite.title,) if include_title else ())
    for reported_spec in suite.specs:
        try:
            reported_path = (root_dir / reported_spec.file).resolve().relative_to(
                repository_root.resolve()
            )
        except (OSError, ValueError) as error:
            raise ResultReportError(
                f"job {spec.job_id} reported path outside repository: {reported_spec.file}"
            ) from error
        if reported_path != spec.spec_path:
            raise ResultReportError(f"job {spec.job_id} reported foreign file {reported_path}")
        for test in reported_spec.tests:
            if test.project_name != spec.project:
                raise ResultReportError(f"job {spec.job_id} reported foreign project {test.project_name}")
            test_id = canonical_test_id(
                test.project_name,
                reported_path,
                reported_spec.line,
                titles + (reported_spec.title,),
            )
            outcome = _outcome(test)
            actual_ids.append(test_id)
            if outcome == "skipped":
                skipped_ids.append(test_id)
            else:
                duration = test.results[0].duration
                if duration is None or duration <= 0:
                    missing_duration_ids.append(test_id)
                else:
                    durations.append(
                        ReportedDuration(
                            test_id=test_id,
                            spec_path=reported_path,
                            seconds=duration / 1000.0,
                        )
                    )
    for child in suite.suites:
        _collect_tests(
            child,
            titles,
            True,
            spec,
            root_dir,
            repository_root,
            actual_ids,
            skipped_ids,
            durations,
            missing_duration_ids,
        )


def _outcome(test: _TestInput) -> Literal["passed", "skipped"]:
    attempts = tuple(attempt.status for attempt in test.results)
    if (
        test.expected_status == "passed"
        and test.status == "expected"
        and attempts == ("passed",)
    ):
        return "passed"
    if (
        test.expected_status == "skipped"
        and test.status == "skipped"
        and attempts in ((), ("skipped",))
    ):
        return "skipped"
    raise ResultReportError("reported unexpected, interrupted, timed out, or retry outcome")
