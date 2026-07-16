from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path

import pytest

from backend.tests.e2e_scheduler_aggregate_fakes import complete_result_fixture
from backend.tests.e2e_scheduler_path_links import create_directory_link
from scripts.e2e_scheduler.aggregate import AggregationError, aggregate_run
from scripts.e2e_scheduler.uiux_evidence_publication import EVIDENCE_VERSION


def _write_uiux_pair(root: Path, finding: str, stem: str) -> None:
    finding_root = root / EVIDENCE_VERSION / finding
    finding_root.mkdir(parents=True)
    _ = (finding_root / f"{stem}.png").write_bytes(b"png-content")
    _ = (finding_root / f"{stem}.json").write_text(
        json.dumps({"artifact": f"{stem}.png"}),
        encoding="utf-8",
    )


def test_aggregation_publishes_valid_job_owned_uiux_evidence(tmp_path: Path) -> None:
    # Given
    manifest, results = complete_result_fixture(tmp_path)
    first_root = results[0].report_path.parent / "uiux-evidence"
    second_root = results[1].report_path.parent / "uiux-evidence"
    _write_uiux_pair(first_root, "MUI-004", "matrix-chromium-core")
    _write_uiux_pair(second_root, "MUI-006", "matrix-webkit-focus")
    isolated = (
        replace(results[0], uiux_evidence_root=first_root),
        replace(results[1], uiux_evidence_root=second_root),
    )

    # When
    summary = aggregate_run(manifest, isolated, tmp_path / "published")

    # Then
    target = tmp_path / ".omo" / "evidence" / EVIDENCE_VERSION
    assert (target / "MUI-004" / "matrix-chromium-core.png").is_file()
    assert (target / "MUI-006" / "matrix-webkit-focus.json").is_file()
    assert (
        f".omo/evidence/{EVIDENCE_VERSION}/MUI-006/matrix-webkit-focus.png"
        in summary.published_files
    )


def test_aggregation_rejects_uiux_root_outside_job_namespace(tmp_path: Path) -> None:
    # Given
    manifest, results = complete_result_fixture(tmp_path)
    escaped = replace(
        results[0],
        uiux_evidence_root=tmp_path / "shared-uiux-evidence",
    )

    # When / Then
    with pytest.raises(AggregationError, match="escaped its job namespace"):
        _ = aggregate_run(manifest, (escaped, results[1]), tmp_path / "published")
    assert not (tmp_path / "published").exists()


def test_invalid_uiux_evidence_does_not_replace_screenshot_publication(
    tmp_path: Path,
) -> None:
    # Given
    manifest, results = complete_result_fixture(tmp_path)
    published = tmp_path / "published"
    published.mkdir()
    previous = published / "latest-run.json"
    _ = previous.write_text('{"previous": true}\n', encoding="utf-8")
    uiux_root = results[0].report_path.parent / "uiux-evidence"
    orphan = uiux_root / EVIDENCE_VERSION / "MUI-004" / "orphan.png"
    orphan.parent.mkdir(parents=True)
    _ = orphan.write_bytes(b"png-content")
    invalid = replace(results[0], uiux_evidence_root=uiux_root)

    # When / Then
    with pytest.raises(AggregationError, match="unreferenced PNG"):
        _ = aggregate_run(manifest, (invalid, results[1]), published)
    assert previous.read_text(encoding="utf-8") == '{"previous": true}\n'


def test_second_target_swap_failure_restores_both_previous_publications(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    manifest, results = complete_result_fixture(tmp_path)
    published = tmp_path / "published"
    published.mkdir()
    screenshot_marker = published / "previous.txt"
    _ = screenshot_marker.write_text("screenshots-before", encoding="utf-8")
    uiux_target = tmp_path / ".omo" / "evidence" / EVIDENCE_VERSION
    uiux_target.mkdir(parents=True)
    uiux_marker = uiux_target / "previous.txt"
    _ = uiux_marker.write_text("uiux-before", encoding="utf-8")
    uiux_root = results[0].report_path.parent / "uiux-evidence"
    _write_uiux_pair(uiux_root, "MUI-004", "matrix-chromium-core")
    isolated = replace(results[0], uiux_evidence_root=uiux_root)
    original_replace = Path.replace

    def fail_second_target_swap(path: Path, destination: str | Path) -> Path:
        if ".stage-" in path.name and Path(destination) == published:
            raise OSError("injected second target swap failure")
        return original_replace(path, destination)

    monkeypatch.setattr(Path, "replace", fail_second_target_swap)

    # When / Then
    with pytest.raises(AggregationError, match="second target swap failure"):
        _ = aggregate_run(manifest, (isolated, results[1]), published)
    assert screenshot_marker.read_text(encoding="utf-8") == "screenshots-before"
    assert uiux_marker.read_text(encoding="utf-8") == "uiux-before"


def test_aggregation_rejects_linked_uiux_root_escape(tmp_path: Path) -> None:
    # Given
    manifest, results = complete_result_fixture(tmp_path)
    outside = tmp_path / "outside-uiux"
    outside.mkdir()
    uiux_root = results[0].report_path.parent / "uiux-evidence"
    create_directory_link(uiux_root, outside)
    escaped = replace(results[0], uiux_evidence_root=uiux_root)

    # When / Then
    with pytest.raises(AggregationError, match="link|escaped"):
        _ = aggregate_run(manifest, (escaped, results[1]), tmp_path / "published")
    assert not (tmp_path / "published").exists()
