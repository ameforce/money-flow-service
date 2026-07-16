from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import JsonValue, TypeAdapter

from backend.tests.e2e_scheduler_aggregate_fakes import complete_result_fixture
from scripts.e2e_scheduler.history import (
    DurationHistory,
    DurationHistoryFormatError,
    DurationResult,
)
from scripts.e2e_scheduler.model import TestId
from scripts.e2e_scheduler.runner_worker import TimedJobResult, duration_results


_JSON_OBJECT = TypeAdapter(dict[str, JsonValue])


def _set_first_attempt_duration(report_path: Path, milliseconds: float) -> None:
    payload = _JSON_OBJECT.validate_json(report_path.read_bytes())
    suites = payload["suites"]
    assert isinstance(suites, list)
    outer = suites[0]
    assert isinstance(outer, dict)
    children = outer["suites"]
    assert isinstance(children, list)
    child = children[0]
    assert isinstance(child, dict)
    specs = child["specs"]
    assert isinstance(specs, list)
    spec = specs[0]
    assert isinstance(spec, dict)
    tests = spec["tests"]
    assert isinstance(tests, list)
    test = tests[0]
    assert isinstance(test, dict)
    attempts = test["results"]
    assert isinstance(attempts, list)
    attempt = attempts[0]
    assert isinstance(attempt, dict)
    attempt["duration"] = milliseconds
    _ = report_path.write_text(json.dumps(payload), encoding="utf-8")


def test_duration_results_use_playwright_attempt_duration_not_job_wall(
    tmp_path: Path,
) -> None:
    # Given
    manifest, results = complete_result_fixture(tmp_path)
    _set_first_attempt_duration(results[0].report_path, 1_250.0)
    _set_first_attempt_duration(results[1].report_path, 2_500.0)
    timed = (
        TimedJobResult(results[0], seconds=10.0),
        TimedJobResult(results[1], seconds=20.0),
    )

    # When
    actual = duration_results(manifest, timed)

    # Then
    assert tuple(item.seconds for item in actual) == (1.25, 2.5)
    assert tuple(item.job_boundary_seconds for item in actual) == (8.75, 17.5)


def test_duration_history_keeps_five_green_samples_and_uses_median() -> None:
    # Given
    history = DurationHistory.empty()
    test_id = TestId("desktop-chromium::e2e/specs/a.spec.js:1::flow")

    # When
    for seconds in (1.0, 2.0, 3.0, 4.0, 5.0, 6.0):
        history = history.with_results(
            (
                DurationResult(
                    test_id,
                    Path("e2e/specs/a.spec.js"),
                    seconds,
                    complete=True,
                    browser="chromium",
                ),
            )
        )

    # Then
    assert history.estimate(test_id, Path("e2e/specs/a.spec.js")) == 4.0
    assert history.records[0].samples_seconds == (2.0, 3.0, 4.0, 5.0, 6.0)


def test_duration_history_records_one_browser_boundary_median_per_green_run() -> None:
    # Given
    first = TestId("desktop-chromium::e2e/specs/a.spec.js:1::first")
    second = TestId("desktop-chromium::e2e/specs/b.spec.js:1::second")

    # When
    history = DurationHistory.empty().with_results(
        (
            DurationResult(
                first,
                Path("e2e/specs/a.spec.js"),
                1.0,
                complete=True,
                browser="chromium",
                job_boundary_seconds=2.0,
            ),
            DurationResult(
                second,
                Path("e2e/specs/b.spec.js"),
                1.0,
                complete=True,
                browser="chromium",
                job_boundary_seconds=4.0,
            ),
        )
    )

    # Then
    assert history.browser_overhead("chromium") == 3.0


def test_incomplete_run_does_not_change_or_migrate_v1_history(tmp_path: Path) -> None:
    # Given
    source = tmp_path / "history.json"
    _ = source.write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {
                        "test_id": "known",
                        "spec_path": "e2e/specs/a.spec.js",
                        "seconds": 4.5,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    history = DurationHistory.load(source)

    # When
    unchanged = history.with_results(
        (
            DurationResult(
                TestId("known"),
                Path("e2e/specs/a.spec.js"),
                99.0,
                complete=False,
                browser="chromium",
                job_boundary_seconds=50.0,
            ),
        )
    )
    unchanged.save(source)

    # Then
    payload = _JSON_OBJECT.validate_json(source.read_bytes())
    assert payload["version"] == 1
    assert unchanged.estimate(TestId("known"), Path("e2e/specs/a.spec.js")) == 4.5


def test_first_complete_green_atomically_migrates_v1_history_to_v2(
    tmp_path: Path,
) -> None:
    # Given
    source = tmp_path / "history.json"
    _ = source.write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {
                        "test_id": "known",
                        "spec_path": "e2e/specs/a.spec.js",
                        "seconds": 4.5,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    history = DurationHistory.load(source)

    # When
    migrated = history.with_results(
        (
            DurationResult(
                TestId("known"),
                Path("e2e/specs/a.spec.js"),
                6.5,
                complete=True,
                browser="chromium",
                job_boundary_seconds=2.0,
            ),
        )
    )
    migrated.save(source)

    # Then
    payload = _JSON_OBJECT.validate_json(source.read_bytes())
    assert payload["version"] == 2
    assert migrated.estimate(TestId("known"), Path("e2e/specs/a.spec.js")) == 6.5
    assert migrated.records[0].samples_seconds == (6.5,)
    assert migrated.browser_overhead("chromium") == 2.0
    assert not source.with_suffix(".json.tmp").exists()


def test_v1_migration_drops_unmeasured_equal_share_estimates(
    tmp_path: Path,
) -> None:
    source = tmp_path / "history.json"
    _ = source.write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {
                        "test_id": "measured",
                        "spec_path": "e2e/specs/a.spec.js",
                        "seconds": 4.5,
                    },
                    {
                        "test_id": "unmeasured",
                        "spec_path": "e2e/specs/b.spec.js",
                        "seconds": 99.0,
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    history = DurationHistory.load(source)

    migrated = history.with_results(
        (
            DurationResult(
                TestId("measured"),
                Path("e2e/specs/a.spec.js"),
                6.5,
                complete=True,
                browser="chromium",
            ),
        )
    )
    migrated.save(source)
    reloaded = DurationHistory.load(source)

    assert reloaded.version == 2
    assert tuple(record.test_id for record in reloaded.records) == (
        TestId("measured"),
    )
    assert reloaded.records[0].samples_seconds == (6.5,)
    assert reloaded.estimate(
        TestId("unmeasured"),
        Path("e2e/specs/b.spec.js"),
    ) == 30.0


def test_v2_history_rejects_non_positive_test_samples(tmp_path: Path) -> None:
    # Given
    source = tmp_path / "history.json"
    _ = source.write_text(
        json.dumps(
            {
                "version": 2,
                "records": [
                    {
                        "test_id": "known",
                        "spec_path": "e2e/specs/a.spec.js",
                        "samples_seconds": [4.5, 0.0],
                    }
                ],
                "browser_overheads": [],
            }
        ),
        encoding="utf-8",
    )

    # When / Then
    with pytest.raises(DurationHistoryFormatError):
        _ = DurationHistory.load(source)
