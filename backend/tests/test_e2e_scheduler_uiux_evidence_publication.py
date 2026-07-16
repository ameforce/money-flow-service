from __future__ import annotations

import json
from pathlib import Path
import shutil

import pytest
from pydantic import TypeAdapter

from backend.tests.e2e_scheduler_path_links import create_directory_link
from scripts.e2e_scheduler.uiux_evidence_publication import (
    EVIDENCE_VERSION,
    UiuxEvidencePublicationError,
    publish_uiux_evidence,
)


METADATA_ADAPTER = TypeAdapter(dict[str, str])


def _write_artifact(
    finding_dir: Path,
    stem: str,
    artifact: str | None = None,
) -> None:
    finding_dir.mkdir(parents=True, exist_ok=True)
    _ = (finding_dir / f"{stem}.png").write_bytes(b"png-content")
    _ = (finding_dir / f"{stem}.json").write_text(
        json.dumps({"artifact": artifact or f"{stem}.png"}),
        encoding="utf-8",
    )


def _published_target(repository_root: Path) -> Path:
    return repository_root / ".omo" / "evidence" / EVIDENCE_VERSION


def test_publish_combines_valid_job_owned_artifacts_atomically(tmp_path: Path) -> None:
    # Given
    repository_root = tmp_path / "repo"
    target = _published_target(repository_root)
    target.mkdir(parents=True)
    _ = (target / "stale.txt").write_text("old", encoding="utf-8")
    first_root = tmp_path / "job-1" / "uiux-evidence"
    second_root = tmp_path / "job-2" / "uiux-evidence"
    _write_artifact(first_root / EVIDENCE_VERSION / "MUI-004", "first")
    _write_artifact(second_root / EVIDENCE_VERSION / "MUI-006", "second")

    # When
    published = publish_uiux_evidence((first_root, second_root), repository_root)

    # Then
    assert published == (
        "MUI-004/first.json",
        "MUI-004/first.png",
        "MUI-006/second.json",
        "MUI-006/second.png",
    )
    assert not (target / "stale.txt").exists()
    assert (target / "MUI-004" / "first.png").read_bytes() == b"png-content"
    metadata = METADATA_ADAPTER.validate_json(
        (target / "MUI-006" / "second.json").read_bytes()
    )
    assert metadata["artifact"] == "second.png"


def test_publish_with_zero_artifacts_preserves_existing_target(tmp_path: Path) -> None:
    # Given
    repository_root = tmp_path / "repo"
    target = _published_target(repository_root)
    target.mkdir(parents=True)
    marker = target / "existing.json"
    _ = marker.write_text('{"kept": true}', encoding="utf-8")
    empty_root = tmp_path / "job-empty" / "uiux-evidence"
    (empty_root / EVIDENCE_VERSION).mkdir(parents=True)

    # When
    published = publish_uiux_evidence(
        (empty_root, tmp_path / "missing"), repository_root
    )

    # Then
    assert published == ()
    assert marker.read_text("utf-8") == '{"kept": true}'


@pytest.mark.parametrize(
    ("artifact", "reason"),
    [
        ("../shot.png", "same-directory PNG filename"),
        ("nested/shot.png", "same-directory PNG filename"),
        ("C:\\outside\\shot.png", "same-directory PNG filename"),
        ("shot.json", "PNG filename"),
        ("missing.png", "missing PNG"),
    ],
)
def test_publish_rejects_invalid_json_artifact_reference_and_preserves_target(
    tmp_path: Path,
    artifact: str,
    reason: str,
) -> None:
    # Given
    repository_root = tmp_path / "repo"
    target = _published_target(repository_root)
    target.mkdir(parents=True)
    marker = target / "existing.txt"
    _ = marker.write_text("keep", encoding="utf-8")
    job_root = tmp_path / "job" / "uiux-evidence"
    finding = job_root / EVIDENCE_VERSION / "MUI-004"
    _write_artifact(finding, "shot", artifact)

    # When / Then
    with pytest.raises(UiuxEvidencePublicationError, match=reason):
        _ = publish_uiux_evidence((job_root,), repository_root)
    assert marker.read_text("utf-8") == "keep"


@pytest.mark.parametrize("empty_suffix", [".png", ".json"])
def test_publish_rejects_empty_artifact_file_and_preserves_target(
    tmp_path: Path,
    empty_suffix: str,
) -> None:
    # Given
    repository_root = tmp_path / "repo"
    target = _published_target(repository_root)
    target.mkdir(parents=True)
    marker = target / "existing.txt"
    _ = marker.write_text("keep", encoding="utf-8")
    job_root = tmp_path / "job" / "uiux-evidence"
    finding = job_root / EVIDENCE_VERSION / "MUI-004"
    _write_artifact(finding, "shot")
    _ = (finding / f"shot{empty_suffix}").write_bytes(b"")

    # When / Then
    with pytest.raises(UiuxEvidencePublicationError, match="empty evidence file"):
        _ = publish_uiux_evidence((job_root,), repository_root)
    assert marker.read_text("utf-8") == "keep"


def test_publish_rejects_cross_job_filename_collision(tmp_path: Path) -> None:
    # Given
    repository_root = tmp_path / "repo"
    first_root = tmp_path / "job-1" / "uiux-evidence"
    second_root = tmp_path / "job-2" / "uiux-evidence"
    _write_artifact(first_root / EVIDENCE_VERSION / "MUI-004", "same")
    _write_artifact(second_root / EVIDENCE_VERSION / "MUI-004", "same")

    # When / Then
    with pytest.raises(UiuxEvidencePublicationError, match="filename collision"):
        _ = publish_uiux_evidence((first_root, second_root), repository_root)
    assert not _published_target(repository_root).exists()


def test_publish_rejects_windows_case_insensitive_collision(tmp_path: Path) -> None:
    repository_root = tmp_path / "repo"
    first_root = tmp_path / "job-1" / "uiux-evidence"
    second_root = tmp_path / "job-2" / "uiux-evidence"
    _write_artifact(first_root / EVIDENCE_VERSION / "MUI-004", "shot")
    _write_artifact(second_root / EVIDENCE_VERSION / "mui-004", "shot")

    with pytest.raises(UiuxEvidencePublicationError, match="target namespace"):
        _ = publish_uiux_evidence((first_root, second_root), repository_root)

    assert not _published_target(repository_root).exists()


def test_publish_rejects_linked_job_root_escape(tmp_path: Path) -> None:
    # Given
    repository_root = tmp_path / "repo"
    outside = tmp_path / "outside"
    _write_artifact(outside / EVIDENCE_VERSION / "MUI-004", "shot")
    job_root = tmp_path / "job" / "uiux-evidence"
    job_root.parent.mkdir(parents=True)
    create_directory_link(job_root, outside)

    # When / Then
    with pytest.raises(UiuxEvidencePublicationError, match="root cannot be a link"):
        _ = publish_uiux_evidence((job_root,), repository_root)
    assert not _published_target(repository_root).exists()


def test_publish_rejects_linked_target_ancestor_before_staging(tmp_path: Path) -> None:
    repository_root = tmp_path / "repo"
    repository_root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    create_directory_link(repository_root / ".omo", outside)
    job_root = tmp_path / "job" / "uiux-evidence"
    _write_artifact(job_root / EVIDENCE_VERSION / "MUI-004", "shot")

    with pytest.raises(UiuxEvidencePublicationError, match="link|escaped"):
        _ = publish_uiux_evidence((job_root,), repository_root)

    assert not (outside / "evidence").exists()


def test_publish_rejects_orphan_png(tmp_path: Path) -> None:
    # Given
    repository_root = tmp_path / "repo"
    job_root = tmp_path / "job" / "uiux-evidence"
    finding = job_root / EVIDENCE_VERSION / "MUI-004"
    _write_artifact(finding, "paired")
    _ = (finding / "orphan.png").write_bytes(b"png-content")

    # When / Then
    with pytest.raises(UiuxEvidencePublicationError, match="unreferenced PNG"):
        _ = publish_uiux_evidence((job_root,), repository_root)


def test_swap_failure_restores_previous_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given
    repository_root = tmp_path / "repo"
    target = _published_target(repository_root)
    target.mkdir(parents=True)
    marker = target / "existing.txt"
    _ = marker.write_text("keep", encoding="utf-8")
    job_root = tmp_path / "job" / "uiux-evidence"
    _write_artifact(job_root / EVIDENCE_VERSION / "MUI-004", "shot")
    original_replace = Path.replace

    def fail_stage_swap(path: Path, destination: str | Path) -> Path:
        destination_path = Path(destination)
        if ".stage-" in path.name and destination_path == target:
            raise OSError("injected stage swap failure")
        return original_replace(path, destination)

    monkeypatch.setattr(Path, "replace", fail_stage_swap)

    # When / Then
    with pytest.raises(UiuxEvidencePublicationError, match="publication failed"):
        _ = publish_uiux_evidence((job_root,), repository_root)
    assert marker.read_text("utf-8") == "keep"
    assert tuple(target.parent.glob(f".{EVIDENCE_VERSION}.*-*")) == ()


def test_backup_cleanup_failure_retries_rollback_and_restores_previous_target(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    repository_root = tmp_path / "repo"
    target = _published_target(repository_root)
    target.mkdir(parents=True)
    marker = target / "existing.txt"
    _ = marker.write_text("keep", encoding="utf-8")
    job_root = tmp_path / "job" / "uiux-evidence"
    _write_artifact(job_root / EVIDENCE_VERSION / "MUI-004", "shot")
    original_replace = Path.replace
    original_rmtree = shutil.rmtree
    target_move_count = 0

    def fail_first_rollback_move(path: Path, destination: str | Path) -> Path:
        nonlocal target_move_count
        if path == target:
            target_move_count += 1
        if path == target and target_move_count == 2:
            raise OSError("injected first rollback move failure")
        return original_replace(path, destination)

    def fail_backup_cleanup(path: str | Path) -> None:
        candidate = Path(path)
        if ".backup-" in candidate.name:
            raise OSError("injected backup cleanup failure")
        original_rmtree(path)

    monkeypatch.setattr(Path, "replace", fail_first_rollback_move)
    monkeypatch.setattr(shutil, "rmtree", fail_backup_cleanup)

    # When / Then
    with pytest.raises(UiuxEvidencePublicationError, match="publication failed"):
        _ = publish_uiux_evidence((job_root,), repository_root)
    assert marker.read_text("utf-8") == "keep"
    assert tuple(target.parent.glob(f".{EVIDENCE_VERSION}.*-*")) == ()


def test_persistent_rollback_lock_preserves_recoverable_backup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    repository_root = tmp_path / "repo"
    target = _published_target(repository_root)
    target.mkdir(parents=True)
    _ = (target / "existing.txt").write_text("keep", encoding="utf-8")
    job_root = tmp_path / "job" / "uiux-evidence"
    _write_artifact(job_root / EVIDENCE_VERSION / "MUI-004", "shot")
    original_replace = Path.replace
    original_rmtree = shutil.rmtree
    target_move_count = 0

    def lock_new_target(path: Path, destination: str | Path) -> Path:
        nonlocal target_move_count
        if path == target:
            target_move_count += 1
        if path == target and target_move_count >= 2:
            raise OSError("injected persistent target lock")
        return original_replace(path, destination)

    def fail_backup_cleanup(path: str | Path) -> None:
        candidate = Path(path)
        if ".backup-" in candidate.name:
            raise OSError("injected backup cleanup failure")
        original_rmtree(path)

    monkeypatch.setattr(Path, "replace", lock_new_target)
    monkeypatch.setattr(shutil, "rmtree", fail_backup_cleanup)

    # When / Then
    with pytest.raises(UiuxEvidencePublicationError, match="rollback failed"):
        _ = publish_uiux_evidence((job_root,), repository_root)
    backups = tuple(target.parent.glob(f".{EVIDENCE_VERSION}.backup-*"))
    assert len(backups) == 1
    assert (backups[0] / "existing.txt").read_text(encoding="utf-8") == "keep"
    recoveries = tuple(target.parent.glob(f".{EVIDENCE_VERSION}.recovery-*"))
    assert len(recoveries) == 1
    assert (recoveries[0] / "existing.txt").stat().st_ino == (
        backups[0] / "existing.txt"
    ).stat().st_ino
