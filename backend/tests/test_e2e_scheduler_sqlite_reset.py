from __future__ import annotations

from contextlib import closing
from pathlib import Path
import sqlite3
import time

import pytest

import scripts.e2e_scheduler.sqlite_reset as reset_module
from scripts.e2e_scheduler.sqlite_reset import (
    DatabaseResetError,
    reset_sqlite_database,
)


def create_sqlite_fixture(tmp_path: Path) -> Path:
    db_path = tmp_path / "capsule.sqlite3"
    with closing(sqlite3.connect(db_path)) as connection:
        _ = connection.execute("PRAGMA foreign_keys = ON")
        _ = connection.execute(
            "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)"
        )
        _ = connection.execute(
            "CREATE TABLE entries ("
            + "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            + "user_id INTEGER NOT NULL REFERENCES users(id), "
            + "amount INTEGER NOT NULL)"
        )
        user_id = connection.execute(
            "INSERT INTO users(name) VALUES ('owner')"
        ).lastrowid
        _ = connection.execute(
            "INSERT INTO entries(user_id, amount) VALUES (?, 1000)",
            (user_id,),
        )
    return db_path


def test_reset_sqlite_database_removes_rows_and_resets_sequences(
    tmp_path: Path,
) -> None:
    # Given
    db_path = create_sqlite_fixture(tmp_path)

    # When
    metrics = reset_sqlite_database(db_path)

    # Then
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("select count(*) from users").fetchone() == (0,)
        assert connection.execute("select count(*) from entries").fetchone() == (0,)
        assert connection.execute(
            "select count(*) from sqlite_sequence"
        ).fetchone() == (0,)
        _ = connection.execute("INSERT INTO users(name) VALUES ('next')")
        assert connection.execute("select id from users").fetchone() == (1,)
    assert metrics.retry_count == 0
    assert metrics.locked_seconds == 0.0


def test_reset_sqlite_database_releases_file_handle_before_return(
    tmp_path: Path,
) -> None:
    # Given
    db_path = create_sqlite_fixture(tmp_path)

    # When
    metrics = reset_sqlite_database(db_path)
    db_path.unlink()

    # Then
    assert not db_path.exists()
    assert metrics.retry_count == 0


def test_reset_sqlite_database_wraps_non_lock_operational_error(
    tmp_path: Path,
) -> None:
    # Given
    directory = tmp_path / "not-a-database"
    directory.mkdir()

    # When / Then
    with pytest.raises(DatabaseResetError) as error:
        reset_sqlite_database(directory)

    assert error.value.path == directory
    assert error.value.attempts == 1


def test_reset_sqlite_database_retries_only_locked_operational_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    attempts: list[Path] = []
    backoffs: list[float] = []

    def fake_reset(path: Path) -> None:
        attempts.append(path)
        if len(attempts) < reset_module.MAX_RESET_ATTEMPTS:
            raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(reset_module, "_reset_once", fake_reset)
    monkeypatch.setattr(time, "sleep", backoffs.append)
    db_path = tmp_path / "locked.sqlite3"

    # When
    metrics = reset_sqlite_database(db_path)

    # Then
    assert attempts == [db_path] * reset_module.MAX_RESET_ATTEMPTS
    assert backoffs == [reset_module.RESET_BACKOFF_SECONDS] * (
        reset_module.MAX_RESET_ATTEMPTS - 1
    )
    assert metrics.retry_count == reset_module.MAX_RESET_ATTEMPTS - 1
    assert metrics.locked_seconds >= 0.0
