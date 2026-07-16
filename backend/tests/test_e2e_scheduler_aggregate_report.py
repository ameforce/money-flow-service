from __future__ import annotations

from pathlib import Path
from typing import Callable, ClassVar, Final, Literal

import pytest
from pydantic import BaseModel, ConfigDict, Field

from backend.tests.e2e_scheduler_aggregate_fakes import complete_result_fixture
from scripts.e2e_scheduler.aggregate import AggregationError, aggregate_run
from scripts.e2e_scheduler.aggregate_report import parse_job_report

type _ReportField = Literal["expected", "test", "attempt"]
type _ExpectedStatus = Literal[
    "failed", "timedOut", "skipped", "interrupted", "undefined"
]
type _TestStatus = Literal["skipped", "flaky", "unexpected", "undefined"]
type _AttemptStatus = Literal[
    "failed", "timedOut", "skipped", "interrupted", "undefined"
]
type _RootMutation = Literal["missing", "wrong-root-same-basename"]


class _AttemptInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")

    status: str
    duration: float | None = None


class _TestInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")

    expected_status: str = Field(alias="expectedStatus")
    status: str
    results: list[_AttemptInput]


class _SpecInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")

    tests: list[_TestInput]


class _SuiteInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")

    suites: list[_SuiteInput] = Field(default_factory=list)
    specs: list[_SpecInput] = Field(default_factory=list)


class _ProjectInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")

    name: str
    retries: int


class _ConfigInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")

    root_dir: str | None = Field(default=None, alias="rootDir")
    projects: list[_ProjectInput]


class _ReportInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")

    config: _ConfigInput
    suites: list[_SuiteInput]


def _load_report(report_path: Path) -> _ReportInput:
    return _ReportInput.model_validate_json(report_path.read_bytes())


def _save_report(report_path: Path, payload: _ReportInput) -> None:
    _ = report_path.write_text(
        payload.model_dump_json(by_alias=True, exclude_none=True),
        encoding="utf-8",
    )


def _first_test(payload: _ReportInput) -> _TestInput:
    return payload.suites[0].suites[0].specs[0].tests[0]


def _set_expected_status(test: _TestInput, value: str) -> None:
    test.expected_status = value


def _set_test_status(test: _TestInput, value: str) -> None:
    test.status = value


def _set_attempt_status(test: _TestInput, value: str) -> None:
    test.results[0].status = value


_STATUS_SETTERS: Final[dict[_ReportField, Callable[[_TestInput, str], None]]] = {
    "expected": _set_expected_status,
    "test": _set_test_status,
    "attempt": _set_attempt_status,
}


def _set_report_status(report_path: Path, field: _ReportField, value: str) -> None:
    payload = _load_report(report_path)
    _STATUS_SETTERS[field](_first_test(payload), value)
    _save_report(report_path, payload)


@pytest.mark.parametrize(
    "status",
    ["failed", "timedOut", "skipped", "interrupted", "undefined"],
)
def test_aggregation_rejects_non_passing_expected_status(
    tmp_path: Path,
    status: _ExpectedStatus,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    _set_report_status(results[0].report_path, "expected", status)

    with pytest.raises(AggregationError):
        _ = aggregate_run(manifest, results, tmp_path / "published")


@pytest.mark.parametrize("status", ["skipped", "flaky", "unexpected", "undefined"])
def test_aggregation_rejects_non_expected_test_status(
    tmp_path: Path,
    status: _TestStatus,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    _set_report_status(results[0].report_path, "test", status)

    with pytest.raises(AggregationError):
        _ = aggregate_run(manifest, results, tmp_path / "published")


@pytest.mark.parametrize(
    "status",
    ["failed", "timedOut", "skipped", "interrupted", "undefined"],
)
def test_aggregation_rejects_non_passing_attempt_status(
    tmp_path: Path,
    status: _AttemptStatus,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    _set_report_status(results[0].report_path, "attempt", status)

    with pytest.raises(AggregationError):
        _ = aggregate_run(manifest, results, tmp_path / "published")


def test_aggregation_rejects_duplicate_attempts_when_retries_are_zero(
    tmp_path: Path,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    report_path = results[0].report_path
    payload = _load_report(report_path)
    _first_test(payload).results.append(_AttemptInput(status="passed"))
    _save_report(report_path, payload)

    with pytest.raises(AggregationError):
        _ = aggregate_run(manifest, results, tmp_path / "published")


@pytest.mark.parametrize("attempt_status", [None, "skipped"])
def test_aggregation_accepts_expected_skip_and_publishes_skip_id(
    tmp_path: Path,
    attempt_status: str | None,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    report_path = results[0].report_path
    payload = _load_report(report_path)
    test = _first_test(payload)
    test.expected_status = "skipped"
    test.status = "skipped"
    test.results = (
        [] if attempt_status is None else [_AttemptInput(status=attempt_status)]
    )
    _save_report(report_path, payload)

    summary = aggregate_run(manifest, results, tmp_path / "published")

    assert summary.skipped_test_ids == frozenset({manifest.tests[0].test_id})


def test_aggregation_rejects_report_with_retries_enabled(tmp_path: Path) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    report_path = results[0].report_path
    payload = _load_report(report_path)
    payload.config.projects[0].retries = 1
    _save_report(report_path, payload)

    with pytest.raises(AggregationError):
        _ = aggregate_run(manifest, results, tmp_path / "published")


def test_aggregation_accepts_selected_project_from_full_config_metadata(
    tmp_path: Path,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    report_path = results[0].report_path
    payload = _load_report(report_path)
    payload.config.projects.append(_ProjectInput(name="mobile-chromium", retries=0))
    _save_report(report_path, payload)

    summary = aggregate_run(manifest, results, tmp_path / "published")

    assert summary.actual_test_ids == manifest.expected_test_ids


@pytest.mark.parametrize("mutation", ["missing", "wrong-root-same-basename"])
def test_aggregation_rejects_missing_or_foreign_report_root(
    tmp_path: Path,
    mutation: _RootMutation,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    report_path = results[0].report_path
    payload = _load_report(report_path)
    root_dirs: dict[_RootMutation, str | None] = {
        "missing": None,
        "wrong-root-same-basename": str(tmp_path / "foreign" / "e2e" / "specs"),
    }
    payload.config.root_dir = root_dirs[mutation]
    _save_report(report_path, payload)

    with pytest.raises(AggregationError):
        _ = aggregate_run(manifest, results, tmp_path / "published")


def test_report_parser_exposes_actual_playwright_attempt_duration(
    tmp_path: Path,
) -> None:
    # Given
    manifest, results = complete_result_fixture(tmp_path)
    payload = _load_report(results[0].report_path)
    _first_test(payload).results[0].duration = 1_234.0
    _save_report(results[0].report_path, payload)

    # When
    reported = parse_job_report(
        manifest.jobs[0],
        results[0].report_path,
        results[0].repository_root,
    )

    # Then
    assert tuple(item.seconds for item in reported.durations) == (1.234,)
    assert reported.duration_inventory_complete
