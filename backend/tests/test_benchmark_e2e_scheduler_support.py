from __future__ import annotations

from pathlib import Path
from typing import final

import pytest

import scripts.e2e_scheduler.legacy_benchmark_artifact as legacy_artifact
from scripts.e2e_scheduler.benchmark_cli import parse_benchmark_options
from scripts.e2e_scheduler.benchmark_process import redact_command
from scripts.e2e_scheduler.legacy_benchmark_artifact import (
    LegacyCleanupError,
    finalize_legacy_cleanup,
)
from scripts.e2e_scheduler.processes import OwnedProcess, OwnedProcessCleanupError


@final
class _Process:
    pid: int = 1234
    stdin: None = None

    def poll(self) -> int:
        return 0

    def send_signal(self, sig: int) -> None:
        _ = sig

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        return 0


def test_cli_preserves_command_after_double_dash() -> None:
    options = parse_benchmark_options(
        [
            "--mode",
            "dynamic",
            "--runs=3",
            "--label",
            "candidate-a",
            "--output=output/raw.json",
            "--",
            "npm",
            "run",
            "e2e:matrix",
            "--",
            "--grep",
            "auth",
        ]
    )
    assert options.mode == "dynamic"
    assert options.runs == 3
    assert options.command == (
        "npm",
        "run",
        "e2e:matrix",
        "--",
        "--grep",
        "auth",
    )


def test_legacy_cleanup_writes_failure_artifact_and_removes_database(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    database = tmp_path / "run.db"
    database_files = (
        database,
        Path(f"{database}-journal"),
        Path(f"{database}-wal"),
        Path(f"{database}-shm"),
    )
    for path in database_files:
        _ = path.write_bytes(b"db")
    artifact = tmp_path / "cleanup.json"
    owned = OwnedProcess(_Process(), (8000, 5173))

    def fail_close(_owned: OwnedProcess) -> None:
        raise OwnedProcessCleanupError(1234, (8000,), False)

    def closed_port(_port: int) -> bool:
        return False

    monkeypatch.setattr(OwnedProcess, "close", fail_close)
    monkeypatch.setattr(legacy_artifact, "port_is_open", closed_port)
    with pytest.raises(LegacyCleanupError):
        finalize_legacy_cleanup(
            owned,
            database,
            8000,
            5173,
            (100.0,),
            artifact,
        )
    assert artifact.is_file()
    assert all(not path.exists() for path in database_files)


def test_benchmark_command_redacts_auth_values() -> None:
    redacted = redact_command(
        ("runner", "--token", "raw-token", "--password=hunter2", "--grep", "auth")
    )
    assert "raw-token" not in redacted
    assert "hunter2" not in " ".join(redacted)
    assert redacted[-2:] == ("--grep", "auth")
