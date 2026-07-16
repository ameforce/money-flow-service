from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import shutil
from typing import Literal

import pytest

from backend.tests.e2e_scheduler_aggregate_fakes import complete_result_fixture
import scripts.e2e_scheduler.publication_transaction as transaction_module
from scripts.e2e_scheduler.aggregate import AggregationError, aggregate_run
from scripts.e2e_scheduler.model import RunId
from scripts.e2e_scheduler.publication_transaction import (
    PublicationTransactionError,
    commit_publications,
    prepare_file_publication,
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


def test_keyboard_interrupt_between_swaps_restores_previous_publication(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "published"
    target.mkdir()
    _ = (target / "old.txt").write_text("old", encoding="utf-8")
    publication = prepare_publication(tmp_path, target, ("new.txt",))
    _ = (publication.stage / "new.txt").write_text("new", encoding="utf-8")
    original_replace = Path.replace

    def interrupt_stage_install(path: Path, destination: str | Path) -> Path:
        if path == publication.stage:
            raise KeyboardInterrupt
        return original_replace(path, destination)

    monkeypatch.setattr(Path, "replace", interrupt_stage_install)

    with pytest.raises(KeyboardInterrupt):
        commit_publications((publication,))

    assert (target / "old.txt").read_text(encoding="utf-8") == "old"
    assert not publication.backup.exists()
    assert not publication.stage.exists()


def test_directory_and_file_publications_rollback_together(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evidence = tmp_path / "published"
    evidence.mkdir()
    _ = (evidence / "old.txt").write_text("old", encoding="utf-8")
    metrics = tmp_path / "runs" / "run-a" / "run-metrics.json"
    metrics.parent.mkdir(parents=True)
    _ = metrics.write_text("old metrics", encoding="utf-8")
    evidence_publication = prepare_publication(tmp_path, evidence, ("new.txt",))
    _ = (evidence_publication.stage / "new.txt").write_text(
        "new", encoding="utf-8"
    )
    metrics_publication = prepare_file_publication(tmp_path, metrics)
    _ = metrics_publication.stage.write_text("new metrics", encoding="utf-8")
    original_replace = Path.replace

    def fail_metrics_install(path: Path, destination: str | Path) -> Path:
        if path == metrics_publication.stage:
            raise OSError("injected metrics publication failure")
        return original_replace(path, destination)

    monkeypatch.setattr(Path, "replace", fail_metrics_install)

    with pytest.raises(PublicationTransactionError):
        commit_publications((evidence_publication, metrics_publication))

    assert (evidence / "old.txt").read_text(encoding="utf-8") == "old"
    assert metrics.read_text(encoding="utf-8") == "old metrics"


def test_post_commit_recovery_cleanup_warning_preserves_complete_targets(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    evidence = tmp_path / "published"
    evidence.mkdir()
    _ = (evidence / "old.txt").write_text("old", encoding="utf-8")
    metrics = tmp_path / "runs" / "run-a" / "run-metrics.json"
    metrics.parent.mkdir(parents=True)
    _ = metrics.write_text("old metrics", encoding="utf-8")
    evidence_publication = prepare_publication(tmp_path, evidence, ("new.txt",))
    _ = (evidence_publication.stage / "new.txt").write_text(
        "new", encoding="utf-8"
    )
    metrics_publication = prepare_file_publication(tmp_path, metrics)
    _ = metrics_publication.stage.write_text("new metrics", encoding="utf-8")
    original_remove = transaction_module._remove_path_strict

    def fail_recovery_cleanup(path: Path) -> OSError | None:
        if ".recovery-" in path.name:
            return OSError("injected post-commit recovery cleanup failure")
        return original_remove(path)

    monkeypatch.setattr(
        transaction_module,
        "_remove_path_strict",
        fail_recovery_cleanup,
    )

    warnings = commit_publications((evidence_publication, metrics_publication))

    assert len(warnings) == 2
    assert (evidence / "new.txt").read_text(encoding="utf-8") == "new"
    assert metrics.read_text(encoding="utf-8") == "new metrics"


def test_directory_recovery_copy_interrupt_removes_partial_recovery(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "published"
    target.mkdir()
    _ = (target / "old.txt").write_text("old", encoding="utf-8")
    publication = prepare_publication(tmp_path, target, ("new.txt",))
    _ = (publication.stage / "new.txt").write_text("new", encoding="utf-8")

    def interrupt_copytree(
        _source: str | Path,
        destination: str | Path,
        *,
        copy_function: object,
    ) -> Path:
        _ = copy_function
        recovery = Path(destination)
        recovery.mkdir()
        _ = (recovery / "partial.txt").write_text("partial", encoding="utf-8")
        raise KeyboardInterrupt

    monkeypatch.setattr(shutil, "copytree", interrupt_copytree)

    with pytest.raises(KeyboardInterrupt):
        _ = commit_publications((publication,))

    assert (target / "old.txt").read_text(encoding="utf-8") == "old"
    assert not tuple(tmp_path.glob(".published.recovery-*"))


def test_file_recovery_copy_interrupt_removes_partial_recovery(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "run-metrics.json"
    _ = target.write_text("old", encoding="utf-8")
    publication = prepare_file_publication(tmp_path, target)
    _ = publication.stage.write_text("new", encoding="utf-8")

    def interrupt_copy2(
        _source: str | Path,
        destination: str | Path,
    ) -> Path:
        recovery = Path(destination)
        _ = recovery.write_text("partial", encoding="utf-8")
        raise KeyboardInterrupt

    monkeypatch.setattr(shutil, "copy2", interrupt_copy2)

    with pytest.raises(KeyboardInterrupt):
        _ = commit_publications((publication,))

    assert target.read_text(encoding="utf-8") == "old"
    assert not tuple(tmp_path.glob(".run-metrics.json.recovery-*"))
