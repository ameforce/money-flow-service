"""Standalone Playwright JSON inventory parser for benchmark parity."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Literal, override

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, ValidationError

from scripts.e2e_scheduler.discovery import canonical_test_id

type _Expected = Literal["passed", "failed", "timedOut", "skipped", "interrupted"]
type _Outcome = Literal["expected", "skipped", "unexpected", "flaky"]
type _AttemptStatus = Literal["passed", "failed", "timedOut", "skipped", "interrupted"]


class _Input(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)


class _Project(_Input):
    name: str
    retries: Literal[0]


class _Config(_Input):
    root_dir: str = Field(validation_alias=AliasChoices("rootDir", "root_dir"))
    projects: tuple[_Project, ...]


class _Attempt(_Input):
    status: _AttemptStatus
    duration: float = Field(default=0, ge=0)
    retry: int = Field(default=0, ge=0)


class _Test(_Input):
    project_name: str = Field(validation_alias=AliasChoices("projectName", "project_name"))
    expected_status: _Expected = Field(
        validation_alias=AliasChoices("expectedStatus", "expected_status")
    )
    status: _Outcome
    results: tuple[_Attempt, ...]


class _Spec(_Input):
    title: str
    file: str
    line: int = Field(gt=0)
    tests: tuple[_Test, ...]


class _Suite(_Input):
    title: str
    specs: tuple[_Spec, ...] = ()
    suites: tuple[_Suite, ...] = ()


class _Error(_Input):
    message: str = "unknown reporter error"


class _Report(_Input):
    config: _Config
    suites: tuple[_Suite, ...]
    errors: tuple[_Error, ...] = ()


@dataclass(frozen=True, slots=True)
class PlaywrightInventory:
    test_ids: tuple[str, ...]
    skipped_test_ids: tuple[str, ...]
    projects: tuple[str, ...]
    durations_seconds: tuple[float, ...]
    passed: int
    failed: int
    skipped: int
    interrupted: int


@dataclass(frozen=True, slots=True)
class BenchmarkReportError(Exception):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


def parse_playwright_inventory(
    path: Path,
    repository_root: Path,
) -> PlaywrightInventory:
    try:
        report = _Report.model_validate_json(path.read_bytes())
    except OSError as error:
        raise BenchmarkReportError(f"cannot read benchmark report {path}: {error}") from error
    except ValidationError as error:
        raise BenchmarkReportError(f"invalid benchmark report {path}: {error}") from error
    if report.errors:
        raise BenchmarkReportError(f"benchmark report contains errors: {report.errors}")
    root_dir = Path(report.config.root_dir)
    if not root_dir.is_absolute():
        root_dir = repository_root / root_dir
    tests: list[str] = []
    skipped: list[str] = []
    projects: list[str] = []
    durations: list[float] = []
    outcomes: list[str] = []
    for suite in report.suites:
        _collect(
            suite,
            (),
            False,
            root_dir,
            repository_root,
            tests,
            skipped,
            projects,
            durations,
            outcomes,
        )
    configured_projects = {project.name for project in report.config.projects}
    if len(configured_projects) != len(report.config.projects):
        raise BenchmarkReportError("benchmark report has duplicate configured projects")
    unknown_projects = set(projects).difference(configured_projects)
    if unknown_projects:
        raise BenchmarkReportError(
            f"benchmark report used unknown projects: {sorted(unknown_projects)}"
        )
    return PlaywrightInventory(
        test_ids=tuple(sorted(tests)),
        skipped_test_ids=tuple(sorted(skipped)),
        projects=tuple(sorted(set(projects))),
        durations_seconds=tuple(durations),
        passed=outcomes.count("passed"),
        failed=outcomes.count("failed"),
        skipped=outcomes.count("skipped"),
        interrupted=outcomes.count("interrupted"),
    )


def _collect(
    suite: _Suite,
    parents: tuple[str, ...],
    include_title: bool,
    root_dir: Path,
    repository_root: Path,
    tests: list[str],
    skipped: list[str],
    projects: list[str],
    durations: list[float],
    outcomes: list[str],
) -> None:
    titles = parents + ((suite.title,) if include_title else ())
    for spec in suite.specs:
        try:
            spec_path = (root_dir / spec.file).resolve().relative_to(
                repository_root.resolve()
            )
        except (OSError, ValueError) as error:
            raise BenchmarkReportError(f"reported path outside repository: {spec.file}") from error
        for test in spec.tests:
            status = _classify(test)
            test_id = str(
                canonical_test_id(
                    test.project_name,
                    spec_path,
                    spec.line,
                    titles + (spec.title,),
                )
            )
            tests.append(test_id)
            projects.append(test.project_name)
            outcomes.append(status)
            if status == "skipped":
                skipped.append(test_id)
            durations.extend(attempt.duration / 1000.0 for attempt in test.results)
    for child in suite.suites:
        _collect(
            child,
            titles,
            True,
            root_dir,
            repository_root,
            tests,
            skipped,
            projects,
            durations,
            outcomes,
        )


def _classify(
    test: _Test,
) -> Literal["passed", "skipped", "failed", "interrupted"]:
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
    if any(attempt.status == "interrupted" for attempt in test.results):
        return "interrupted"
    return "failed"
