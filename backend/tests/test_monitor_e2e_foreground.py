from __future__ import annotations

import json
from pathlib import Path

import pytest

import scripts.monitor_e2e_foreground as monitor


def test_descendant_walk_accepts_root_and_nested_processes() -> None:
    parents = {30: 20, 20: 10, 10: 1}

    assert monitor._is_descendant(10, 10, parents)
    assert monitor._is_descendant(30, 10, parents)
    assert not monitor._is_descendant(30, 99, parents)


def test_descendant_walk_fails_closed_on_parent_cycle() -> None:
    assert not monitor._is_descendant(20, 10, {20: 30, 30: 20})


def test_windows_command_wraps_batch_files(
    monkeypatch,
) -> None:
    monkeypatch.setattr(monitor.shutil, "which", lambda _command: "C:/bin/npm.cmd")
    monkeypatch.setenv("COMSPEC", "C:/Windows/System32/cmd.exe")

    command = monitor._windows_command(("npm", "run", "e2e:matrix"))

    assert command[:4] == (
        "C:/Windows/System32/cmd.exe",
        "/d",
        "/s",
        "/c",
    )
    assert "npm.cmd" in command[4]


def test_windows_command_preserves_native_executable(
    monkeypatch,
    tmp_path: Path,
) -> None:
    executable = tmp_path / "python.exe"
    monkeypatch.setattr(monitor.shutil, "which", lambda _command: str(executable))

    assert monitor._windows_command(("python", "-V")) == (
        str(executable),
        "-V",
    )


class _FakeProcess:
    pid = 8123

    def __init__(self) -> None:
        self.return_code: int | None = None

    @property
    def stdin(self) -> None:
        return None

    def poll(self) -> int | None:
        return self.return_code

    def send_signal(self, _signal: int) -> None:
        self.return_code = 1

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        if self.return_code is None:
            raise AssertionError("wait called before cleanup")
        return self.return_code


class _FakeOwned:
    def __init__(self) -> None:
        self.process = _FakeProcess()
        self.closed = False

    def close(self) -> None:
        self.closed = True
        self.process.return_code = 1


class _FakeWindowApi:
    def GetForegroundWindow(self) -> int:
        return 22


@pytest.mark.parametrize(
    "monitor_error",
    [OSError("snapshot failed"), KeyboardInterrupt()],
    ids=["snapshot-error", "keyboard-interrupt"],
)
def test_monitor_failure_closes_owned_tree_and_publishes_fail_closed_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    monitor_error: BaseException,
) -> None:
    owned = _FakeOwned()
    output = tmp_path / "foreground.json"
    monkeypatch.setattr(monitor, "_spawn_monitored", lambda _command: owned)
    monkeypatch.setattr(
        monitor,
        "_window_apis",
        lambda: (_FakeWindowApi(), object()),
    )

    def fail_snapshot() -> dict[int, int]:
        raise monitor_error

    monkeypatch.setattr(monitor, "_process_parents", fail_snapshot)

    with pytest.raises(type(monitor_error)):
        monitor._run_monitored(
            ("npm", "run", "e2e:matrix"),
            output=output,
            interval_seconds=0.001,
        )

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert owned.closed
    assert owned.process.poll() == 1
    assert payload["child_exit_code"] == 1
    assert payload["monitor_error_type"] == type(monitor_error).__name__
    assert payload["cleanup_error_type"] is None
