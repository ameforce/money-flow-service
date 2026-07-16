from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import shutil
from typing import Literal, assert_never

import pytest

from scripts.e2e_scheduler.aggregate import (
    AggregationError,
    JobResult,
    aggregate_run,
)
from backend.tests.e2e_scheduler_aggregate_fakes import (
    LegacyPublication,
    complete_result_fixture,
    read_previous_publication,
    read_report,
    write_report_payload,
)
from scripts.e2e_scheduler.model import JobId
from backend.tests.e2e_scheduler_path_links import create_directory_link
from scripts.verify_e2e_screenshots import verify_screenshot_manifest

type _InvalidSetMutation = Literal[
    "missing", "duplicate", "unexpected", "partial", "worker-crash", "missing-artifact"
]
type _BoundaryMutation = Literal[
    "project",
    "browser",
    "viewport",
    "evidence",
    "extra-evidence",
    "duplicate-expectation",
    "cleanup",
    "malformed-report",
]
type _InventoryMutation = Literal["duplicate", "unexpected"]


def _mutate_results(
    results: tuple[JobResult, ...],
    mutation: _InvalidSetMutation,
) -> tuple[JobResult, ...]:
    first, second = results
    match mutation:
        case "missing":
            return (first,)
        case "duplicate":
            return (*results, first)
        case "unexpected":
            return (first, replace(second, job_id=JobId("job-unexpected")))
        case "partial":
            payload = read_report(second.report_path)
            payload.suites = []
            write_report_payload(second.report_path, payload)
        case "worker-crash":
            return (first, replace(second, return_code=9))
        case "missing-artifact":
            _ = next(second.screenshot_dir.glob("*.png")).unlink()
        case _:
            assert_never(mutation)
    return results


@pytest.mark.parametrize(
    "mutation",
    [
        "missing",
        "duplicate",
        "unexpected",
        "partial",
        "worker-crash",
        "missing-artifact",
    ],
)
def test_aggregation_fails_closed_for_invalid_result_set(
    tmp_path: Path,
    mutation: _InvalidSetMutation,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)

    with pytest.raises(AggregationError):
        _ = aggregate_run(
            manifest,
            _mutate_results(results, mutation),
            tmp_path / "published",
        )


def test_complete_aggregation_publishes_legacy_manifest(tmp_path: Path) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    published = tmp_path / "published"
    published.mkdir()
    stale = published / "stale.png"
    _ = stale.write_bytes(b"old")

    summary = aggregate_run(manifest, results, published)

    manifest_path = published / "latest-run.json"
    legacy = LegacyPublication.model_validate_json(
        manifest_path.read_text(encoding="utf-8")
    )
    assert legacy.count == len(legacy.files)
    assert legacy.run_id == str(manifest.run_id)
    assert legacy.playwright_args == manifest.playwright_args
    assert legacy.cleanup_status == "complete"
    assert legacy.totals.model_dump() == {
        "expected_tests": 2,
        "actual_tests": 2,
        "expected_scenarios": 2,
        "actual_scenarios": 2,
        "expected_evidence_count": 2,
        "actual_evidence_count": 2,
        "jobs": 2,
        "projects": 1,
    }
    assert len(legacy.jobs) == 2
    assert legacy.projects[0].browser == "chromium"
    assert legacy.projects[0].actual_evidence_count == 2
    assert all(name.startswith("run-a-worker-") for name in legacy.files)
    assert summary.actual_test_ids == summary.expected_test_ids
    assert summary.actual_scenario_ids == summary.expected_scenario_ids
    scenario_ids = tuple(sorted(str(test.test_id) for test in manifest.tests))
    assert legacy.scenario_ids.actual == scenario_ids
    assert legacy.scenario_ids.expected == scenario_ids
    assert legacy.jobs[0].expected_browser == "chromium"
    assert legacy.jobs[0].actual_browser == "chromium"
    assert legacy.jobs[0].expected_viewport == (1280, 720)
    assert legacy.jobs[0].actual_viewport == (1280, 720)
    assert legacy.jobs[0].expected_evidence_files == ("shot-1.png",)
    assert legacy.jobs[0].actual_evidence_files == ("shot-1.png",)
    assert summary.actual_evidence_count == summary.expected_evidence_count == 2
    assert not stale.exists()
    assert verify_screenshot_manifest(manifest_path, published) == 0


@pytest.mark.parametrize(
    "boundary",
    [
        "project",
        "browser",
        "viewport",
        "evidence",
        "extra-evidence",
        "duplicate-expectation",
        "cleanup",
        "malformed-report",
    ],
)
def test_aggregation_rejects_runtime_evidence_or_report_mismatch(
    tmp_path: Path,
    boundary: _BoundaryMutation,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    first, second = results
    match boundary:
        case "project":
            first = replace(first, project="mobile-chromium")
        case "browser":
            first = replace(first, browser="firefox")
        case "viewport":
            first = replace(first, viewport=(390, 844))
        case "evidence":
            first = replace(first, expected_evidence_names=("different.png",))
        case "extra-evidence":
            _ = (first.screenshot_dir / "extra.png").write_bytes(b"png")
        case "duplicate-expectation":
            first = replace(
                first,
                expected_evidence_names=("shot-1.png", "shot-1.png"),
            )
        case "cleanup":
            first = replace(first, cleanup_succeeded=False)
        case "malformed-report":
            _ = first.report_path.write_text("{", encoding="utf-8")
        case _:
            assert_never(boundary)

    with pytest.raises(AggregationError):
        _ = aggregate_run(manifest, (first, second), tmp_path / "published")


@pytest.mark.parametrize("mutation", ["duplicate", "unexpected"])
def test_aggregation_rejects_non_exact_test_inventory(
    tmp_path: Path,
    mutation: _InventoryMutation,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    report_path = results[0].report_path
    payload = read_report(report_path)
    specs = payload.suites[0].suites[0].specs
    match mutation:
        case "duplicate":
            specs.append(specs[0])
        case "unexpected":
            specs[0].title = "foreign test"
        case _:
            assert_never(mutation)
    write_report_payload(report_path, payload)

    with pytest.raises(AggregationError):
        _ = aggregate_run(manifest, results, tmp_path / "published")


def test_aggregation_does_not_replace_legacy_manifest_before_validation(
    tmp_path: Path,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    published = tmp_path / "published"
    published.mkdir()
    existing = published / "latest-run.json"
    _ = existing.write_text('{"previous": true}\n', encoding="utf-8")
    invalid = _mutate_results(results, "missing-artifact")

    with pytest.raises(AggregationError):
        _ = aggregate_run(manifest, invalid, published)

    assert read_previous_publication(existing).previous


@pytest.mark.parametrize("root_name", ["screenshots", "evidence"])
def test_aggregation_rejects_linked_artifact_root_escape(
    tmp_path: Path,
    root_name: str,
) -> None:
    manifest, results = complete_result_fixture(tmp_path)
    first = results[0]
    artifact_root = (
        first.screenshot_dir if root_name == "screenshots" else first.evidence_dir
    )
    outside = tmp_path / f"outside-{root_name}"
    outside.mkdir()
    if root_name == "screenshots":
        _ = (outside / "shot-1.png").write_bytes(b"external-secret-png")
    else:
        _ = (outside / "proof.txt").write_text("external", encoding="utf-8")
        first = replace(
            first,
            expected_evidence_names=("shot-1.png", "proof.txt"),
        )
    if root_name == "screenshots":
        next(artifact_root.glob("*.png")).unlink()
        artifact_root.rmdir()
    else:
        artifact_root.rmdir()
    create_directory_link(artifact_root, outside)

    with pytest.raises(AggregationError, match="linked or escaped"):
        _ = aggregate_run(manifest, (first, results[1]), tmp_path / "published")

    assert not (tmp_path / "published").exists()


def test_aggregation_rejects_parent_traversal_artifact_escape(tmp_path: Path) -> None:
    repository_root = tmp_path / "repo"
    manifest, results = complete_result_fixture(repository_root)
    first = results[0]
    original_job_root = first.report_path.parent
    outside_job_root = tmp_path / "outside-job"
    _ = shutil.move(original_job_root, outside_job_root)
    lexical_job_root = repository_root / ".." / outside_job_root.name
    escaped = replace(
        first,
        report_path=lexical_job_root / first.report_path.name,
        screenshot_dir=lexical_job_root / "screenshots",
        evidence_dir=lexical_job_root / "evidence",
        uiux_evidence_root=lexical_job_root / "uiux-evidence",
    )

    with pytest.raises(AggregationError, match="outside|parent traversal"):
        _ = aggregate_run(
            manifest, (escaped, results[1]), repository_root / "published"
        )

    assert not (repository_root / "published").exists()
