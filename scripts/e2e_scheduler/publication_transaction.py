"""Atomic multi-target directory publication with rollback."""

from __future__ import annotations

from dataclasses import dataclass, replace
import os
from pathlib import Path
import shutil
from typing import override
from uuid import uuid4

from scripts.e2e_scheduler.publication_paths import (
    PublicationPathError,
    validate_publication_path,
    validate_published_files,
)


@dataclass(slots=True)
class PublicationTransactionError(Exception):
    """Fail-closed publication transaction failure."""

    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


@dataclass(frozen=True, slots=True)
class PreparedPublication:
    """One fully staged directory ready for an atomic target swap."""

    trusted_root: Path
    target: Path
    stage: Path
    backup: Path
    published_files: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _SwapState:
    publication: PreparedPublication
    had_previous: bool
    installed: bool
    recovery: Path | None = None


def prepare_publication(
    trusted_root: Path,
    target: Path,
    published_files: tuple[str, ...],
) -> PreparedPublication:
    """Allocate an empty stage owned by one future transaction."""
    _validate_files(published_files)
    _validate_path(trusted_root, target)
    target.parent.mkdir(parents=True, exist_ok=True)
    token = uuid4().hex
    stage = target.parent / f".{target.name}.stage-{token}"
    backup = target.parent / f".{target.name}.backup-{token}"
    stage.mkdir()
    return PreparedPublication(trusted_root, target, stage, backup, published_files)


def discard_publication(publication: PreparedPublication) -> None:
    """Best-effort removal of an uncommitted stage."""
    _remove_directory(publication.stage)


def commit_publications(publications: tuple[PreparedPublication, ...]) -> None:
    """Commit all prepared targets or restore every previous target."""
    if not publications:
        return
    _validate_prepared(publications)
    states: list[_SwapState] = []
    try:
        for publication in publications:
            had_previous = publication.target.exists()
            if had_previous:
                _ = publication.target.replace(publication.backup)
            states.append(_SwapState(publication, had_previous, False))
            _ = publication.stage.replace(publication.target)
            states[-1] = replace(states[-1], installed=True)
        states = _create_recoveries(states)
        for state in states:
            if state.had_previous:
                cleanup_error = _remove_directory_strict(state.publication.backup)
                if cleanup_error is not None:
                    raise cleanup_error
    except OSError as error:
        rollback_error = _rollback(states)
        _discard_uncommitted(publications, states)
        if rollback_error is not None:
            reason = f"publication failed: {error}; rollback failed: {rollback_error}"
            raise PublicationTransactionError(reason) from rollback_error
        raise PublicationTransactionError(f"publication failed: {error}") from error
    for state in states:
        if state.recovery is not None:
            cleanup_error = _remove_directory_strict(state.recovery)
            if cleanup_error is not None:
                raise PublicationTransactionError(
                    f"publication recovery cleanup failed: {cleanup_error}"
                ) from cleanup_error


def _validate_prepared(publications: tuple[PreparedPublication, ...]) -> None:
    targets = tuple(publication.target.resolve() for publication in publications)
    if len(targets) != len(set(targets)):
        raise PublicationTransactionError("publication targets collide")
    for publication in publications:
        _validate_path(publication.trusted_root, publication.target)
        _validate_path(publication.trusted_root, publication.stage)
        _validate_path(publication.trusted_root, publication.backup)
        if publication.stage.parent != publication.target.parent:
            raise PublicationTransactionError(
                "publication stage parent differs from target"
            )
        if publication.backup.parent != publication.target.parent:
            raise PublicationTransactionError(
                "publication backup parent differs from target"
            )
        if publication.target.is_symlink() or publication.target.is_junction():
            raise PublicationTransactionError(
                f"publication target cannot be a link: {publication.target}"
            )
        if publication.stage.is_symlink() or publication.stage.is_junction():
            raise PublicationTransactionError(
                f"publication stage cannot be a link: {publication.stage}"
            )
        if not publication.stage.is_dir():
            raise PublicationTransactionError(
                f"publication stage is missing: {publication.stage}"
            )
        if publication.backup.exists():
            raise PublicationTransactionError(
                f"publication backup already exists: {publication.backup}"
            )


def _validate_path(trusted_root: Path, path: Path) -> None:
    try:
        validate_publication_path(trusted_root, path)
    except PublicationPathError as error:
        raise PublicationTransactionError(str(error)) from error


def _validate_files(published_files: tuple[str, ...]) -> None:
    try:
        validate_published_files(published_files)
    except PublicationPathError as error:
        raise PublicationTransactionError(str(error)) from error


def _create_recoveries(states: list[_SwapState]) -> list[_SwapState]:
    for index, state in enumerate(states):
        if not state.had_previous:
            continue
        recovery = state.publication.backup.parent / (
            f".{state.publication.target.name}.recovery-{uuid4().hex}"
        )
        try:
            _ = shutil.copytree(
                state.publication.backup,
                recovery,
                copy_function=os.link,
            )
        except OSError:
            cleanup_error = _remove_directory_strict(recovery)
            if cleanup_error is not None:
                raise OSError(
                    f"recovery creation and cleanup failed: {cleanup_error}"
                ) from cleanup_error
            raise
        states[index] = replace(state, recovery=recovery)
    return states


def _rollback(states: list[_SwapState]) -> OSError | None:
    first_error: OSError | None = None
    for state in reversed(states):
        error = _rollback_one(state)
        if first_error is None and error is not None:
            first_error = error
    return first_error


def _rollback_one(state: _SwapState) -> OSError | None:
    publication = state.publication
    discarded = publication.target.parent / (
        f".{publication.target.name}.discarded-{uuid4().hex}"
    )
    if state.installed and publication.target.exists():
        move_error = _move_with_retry(publication.target, discarded)
        if move_error is not None:
            return move_error
    if state.had_previous:
        source = state.recovery or publication.backup
        if not source.exists():
            return OSError(f"recoverable backup is missing: {source}")
        try:
            _ = source.replace(publication.target)
        except OSError as error:
            if discarded.exists():
                try:
                    _ = discarded.replace(publication.target)
                except OSError as restore_error:
                    return OSError(
                        f"{error}; preserve new target failed: {restore_error}"
                    )
            return error
    cleanup_error = _remove_directory_strict(discarded)
    if cleanup_error is not None:
        return cleanup_error
    if state.recovery is not None and state.recovery.exists():
        cleanup_error = _remove_directory_strict(state.recovery)
        if cleanup_error is not None:
            return cleanup_error
    if publication.backup.exists() and publication.target.exists():
        stale_backup = publication.backup.parent / (
            f".{publication.target.name}.discarded-backup-{uuid4().hex}"
        )
        try:
            _ = publication.backup.replace(stale_backup)
        except OSError as error:
            return error
        cleanup_error = _remove_directory_strict(stale_backup)
        if cleanup_error is not None:
            return cleanup_error
    return None


def _move_with_retry(source: Path, destination: Path) -> OSError | None:
    first_error: OSError | None = None
    for _ in range(2):
        try:
            _ = source.replace(destination)
        except OSError as error:
            first_error = error
            continue
        return None
    return first_error


def _discard_uncommitted(
    publications: tuple[PreparedPublication, ...],
    states: list[_SwapState],
) -> None:
    attempted = {state.publication.stage for state in states}
    for publication in publications:
        if publication.stage not in attempted or publication.stage.exists():
            _remove_directory(publication.stage)


def _remove_directory(path: Path) -> None:
    if not path.exists():
        return
    try:
        shutil.rmtree(path)
    except OSError:
        return


def _remove_directory_strict(path: Path) -> OSError | None:
    first_error: OSError | None = None
    for _ in range(2):
        if not path.exists():
            return None
        try:
            shutil.rmtree(path)
        except OSError as error:
            if first_error is None:
                first_error = error
            continue
        if not path.exists():
            return None
    return first_error or OSError(f"directory cleanup left residue: {path}")
