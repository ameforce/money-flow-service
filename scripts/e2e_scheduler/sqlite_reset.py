"""Deterministically clear one worker-owned SQLite database between jobs."""

from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
import sqlite3
import time
from typing import Final, override


MAX_RESET_ATTEMPTS: Final = 20
RESET_BACKOFF_SECONDS: Final = 0.25
SQLITE_CONNECT_TIMEOUT_SECONDS: Final = 0.5
SQLITE_BUSY_TIMEOUT_MILLISECONDS: Final = 1000


@dataclass(slots=True)
class DatabaseResetError(Exception):
    path: Path
    attempts: int
    reason: str

    @override
    def __str__(self) -> str:
        return (
            f"failed to reset SQLite database {self.path} "
            f"after {self.attempts} attempt(s): {self.reason}"
        )


@dataclass(frozen=True, slots=True)
class DatabaseResetMetrics:
    retry_count: int = 0
    locked_seconds: float = 0.0


def reset_sqlite_database(path: Path) -> DatabaseResetMetrics:
    """Delete all application rows and reset AUTOINCREMENT sequences."""
    locked_seconds = 0.0
    for attempt in range(1, MAX_RESET_ATTEMPTS + 1):
        attempt_started = time.monotonic()
        try:
            _reset_once(path)
        except sqlite3.OperationalError as error:
            locked = "locked" in str(error).lower()
            if locked and attempt < MAX_RESET_ATTEMPTS:
                locked_seconds += max(time.monotonic() - attempt_started, 0.0)
                backoff_started = time.monotonic()
                time.sleep(RESET_BACKOFF_SECONDS)
                locked_seconds += max(time.monotonic() - backoff_started, 0.0)
                continue
            raise DatabaseResetError(
                path=path,
                attempts=attempt,
                reason=str(error),
            ) from error
        except sqlite3.Error as error:
            raise DatabaseResetError(
                path=path,
                attempts=attempt,
                reason=str(error),
            ) from error
        return DatabaseResetMetrics(
            retry_count=attempt - 1,
            locked_seconds=locked_seconds,
        )
    raise AssertionError("unreachable reset attempt exhaustion")


def _reset_once(path: Path) -> None:
    with closing(
        sqlite3.connect(path, timeout=SQLITE_CONNECT_TIMEOUT_SECONDS)
    ) as connection:
        _ = connection.execute(
            f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MILLISECONDS}"
        )
        _ = connection.execute("PRAGMA foreign_keys = OFF")
        try:
            _ = connection.execute("BEGIN IMMEDIATE")
            tables: list[tuple[str]] = connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
            for (table_name,) in tables:
                _ = connection.execute(f"DELETE FROM {_quoted_identifier(table_name)}")
            sequence_rows: list[tuple[int]] = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'"
            ).fetchall()
            if sequence_rows:
                _ = connection.execute("DELETE FROM sqlite_sequence")
            connection.commit()
        except sqlite3.Error:
            connection.rollback()
            raise
        finally:
            _ = connection.execute("PRAGMA foreign_keys = ON")


def _quoted_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'
