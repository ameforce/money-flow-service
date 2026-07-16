from __future__ import annotations

from pathlib import Path

import pytest

import scripts.e2e_scheduler.capsule_cleanup as cleanup_module


def test_remove_file_waits_for_windows_handle_release(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    database = tmp_path / "database.sqlite3"
    _ = database.write_text("locked", encoding="utf-8")
    unlink = Path.unlink
    calls = 0

    def flaky_unlink(
        path: Path,
        missing_ok: bool = False,
    ) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise PermissionError(32, "file is in use", str(path))
        unlink(path, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", flaky_unlink)
    monkeypatch.setattr(cleanup_module, "FILE_REMOVE_POLL_SECONDS", 0.0)

    # When
    cleanup_module.remove_file_with_retry(database)

    # Then
    assert calls == 2
    assert not database.exists()
