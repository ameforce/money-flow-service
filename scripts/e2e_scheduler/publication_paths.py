"""Trusted publication destination and filename validation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath, PureWindowsPath
from typing import override
import unicodedata


@dataclass(slots=True)
class PublicationPathError(Exception):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


def validate_publication_path(trusted_root: Path, path: Path) -> None:
    try:
        relative = path.relative_to(trusted_root)
        _ = path.resolve().relative_to(trusted_root.resolve())
    except ValueError as error:
        raise PublicationPathError(
            f"publication path escaped trusted root: {path}"
        ) from error
    if ".." in relative.parts:
        raise PublicationPathError(
            f"publication path contains parent traversal: {path}"
        )
    current = trusted_root
    if current.is_symlink() or current.is_junction():
        raise PublicationPathError(
            f"publication trusted root cannot be a link: {current}"
        )
    for part in relative.parts:
        current /= part
        if current.is_symlink() or current.is_junction():
            raise PublicationPathError(f"publication path contains a link: {current}")


def validate_published_files(published_files: tuple[str, ...]) -> None:
    keys: set[str] = set()
    for name in published_files:
        posix = PurePosixPath(name)
        windows = PureWindowsPath(name)
        valid = (
            bool(name)
            and not posix.is_absolute()
            and not windows.is_absolute()
            and ".." not in posix.parts
            and ".." not in windows.parts
        )
        if not valid:
            raise PublicationPathError(f"invalid published file name: {name}")
        key = unicodedata.normalize("NFC", name.replace("\\", "/")).casefold()
        if key in keys:
            raise PublicationPathError(
                "published file names collide in the target namespace"
            )
        keys.add(key)
