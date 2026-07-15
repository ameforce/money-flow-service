from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import shutil
from typing import Literal

import pytest

from backend.tests.e2e_scheduler_aggregate_fakes import complete_result_fixture
from scripts.e2e_scheduler.aggregate import AggregationError, aggregate_run
from scripts.e2e_scheduler.model import RunId
from scripts.e2e_scheduler.publication_transaction import (
    PublicationTransactionError,
    commit_publications,
    prepare_publication,
)
from scripts.verify_e2e_screenshots import verify_screenshot_manifest

type _FailurePoint = Literal["temp-write", "replace"]


@pytest.mark.parametrize("failure_point", ["temp-write", "replace"])
def test_publication_failure_preserves_entire_previous_verified_run(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure_point: _FailurePoint,
) -> None:
    repository_root = tmp_path / "repo"
    old_manifest, old_results = complete_result_fixture(repository_root)
    old_manifest = replace(old_manifest, run_id=RunId("run-old"))
    published = repository_root / "published"
    _ = aggregate_run(old_manifest, old_results, published)
    old_files = {path.name: path.read_bytes() for path in published.iterdir()}
    assert verify_screenshot_manifest(published / "latest-run.json", published) == 0

    shutil.rmtree(repository_root / "runs")
    new_manifest, new_results = complete_result_fixture(repository_root)
    new_manifest = replace(new_manifest, run_id=RunId("run-new"))
    original_write_text = Path.write_text
    original_replace = Path.replace

    def failing_write_text(
        path: Path,
        data: str,
        encoding: str | None = None,
        errors: str | None = None,
        newline: str | None = None,
    ) -> int:
        if failure_point == "temp-write" and path.name in {
            ".latest-run.json.tmp",
            "latest-run.json",
        }:
            raise OSError("injected temp write failure")
        return original_write_text(path, data, encoding, errors, newline)

    def failing_replace(path: Path, target: str | Path) -> Path:
        target_path = Path(target)
        old_manifest_replace = path.name == ".latest-run.json.tmp"
        staged_directory_replace = target_path == published and ".stage-" in path.name
        if failure_point == "replace" and (
            old_manifest_replace or staged_directory_replace
        ):
            raise OSError("injected replace failure")
        return original_replace(path, target)

    monkeypatch.setattr(Path, "write_text", failing_write_text)
    monkeypatch.setattr(Path, "replace", failing_replace)

    with pytest.raises(AggregationError):
        _ = aggregate_run(new_manifest, new_results, published)

    assert {path.name: path.read_bytes() for path in published.iterdir()} == old_files
    assert verify_screenshot_manifest(published / "latest-run.json", published) == 0


def test_rollback_reports_stale_backup_move_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "published"
    target.mkdir()
    _ = (target / "old.txt").write_text("old", encoding="utf-8")
    publication = prepare_publication(tmp_path, target, ("new.txt",))
    _ = (publication.stage / "new.txt").write_text("new", encoding="utf-8")
    original_rmtree = shutil.rmtree
    original_replace = Path.replace

    def fail_backup_cleanup(path: str | Path) -> None:
        if Path(path) == publication.backup:
            raise OSError("injected backup cleanup failure")
        original_rmtree(path)

    def fail_stale_backup_move(path: Path, destination: str | Path) -> Path:
        if (
            path == publication.backup
            and ".discarded-backup-" in Path(destination).name
        ):
            raise OSError("injected stale backup move failure")
        return original_replace(path, destination)

    monkeypatch.setattr(shutil, "rmtree", fail_backup_cleanup)
    monkeypatch.setattr(Path, "replace", fail_stale_backup_move)

    with pytest.raises(PublicationTransactionError, match="rollback failed"):
        commit_publications((publication,))

    assert (target / "old.txt").read_text(encoding="utf-8") == "old"
    assert publication.backup.exists()
