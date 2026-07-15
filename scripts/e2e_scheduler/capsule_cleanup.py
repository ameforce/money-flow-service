"""Deterministic capsule filesystem reset and Windows handle cleanup."""

from __future__ import annotations

from pathlib import Path
import shutil
import time
from typing import Final


FILE_REMOVE_TIMEOUT_SECONDS: Final = 15.0
FILE_REMOVE_POLL_SECONDS: Final = 0.1


def replace_directory(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def remove_file_with_retry(path: Path) -> None:
    """Remove a file after a signalled Windows child releases its handle."""
    deadline = time.monotonic() + FILE_REMOVE_TIMEOUT_SECONDS
    while True:
        try:
            path.unlink(missing_ok=True)
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(FILE_REMOVE_POLL_SECONDS)
        else:
            return
