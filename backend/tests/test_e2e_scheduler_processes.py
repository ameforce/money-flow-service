from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from typing import final

import pytest

import scripts.e2e_scheduler.processes as process_module


@final
class FakeProcess:
    def __init__(self, *, returncode: int | None = None) -> None:
        self.pid = 7001
        self.returncode = returncode
        self.signals: list[int] = []
        self.wait_calls = 0
        self.stdin = None

    def poll(self) -> int | None:
        return self.returncode

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        self.wait_calls += 1
        self.returncode = 0
        return 0


@final
class FakeOwnership:
    def __init__(self, remaining: int) -> None:
        self.remaining = remaining
        self.terminated = False
        self.closed = False

    def active_processes(self) -> int:
        return 1

    def terminate(self) -> None:
        self.terminated = True

    def wait_until_empty(self, timeout_seconds: float) -> int:
        _ = timeout_seconds
        return self.remaining

    def close(self) -> None:
        self.closed = True


def test_windows_cleanup_escalates_owned_pid_after_ctrl_break(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    process = FakeProcess()
    taskkill_commands: list[list[str]] = []
    taskkill_timeouts: list[float] = []
    taskkill_creation_flags: list[int] = []
    taskkill_startup_infos: list[subprocess.STARTUPINFO] = []

    def fake_wait(timeout: float | None = None) -> int:
        raise subprocess.TimeoutExpired(cmd="owned", timeout=timeout or 0.0)

    def fake_run(
        command: list[str],
        *,
        check: bool,
        timeout: float,
        creationflags: int,
        startupinfo: subprocess.STARTUPINFO,
    ) -> subprocess.CompletedProcess[bytes]:
        _ = check
        taskkill_commands.append(command)
        taskkill_timeouts.append(timeout)
        taskkill_creation_flags.append(creationflags)
        taskkill_startup_infos.append(startupinfo)
        return subprocess.CompletedProcess(command, 0, b"", b"")

    process.wait = fake_wait
    monkeypatch.setattr("scripts.e2e_scheduler.processes.os.name", "nt")
    monkeypatch.setattr("scripts.e2e_scheduler.processes.subprocess.run", fake_run)

    # When
    process_module.kill_process_tree(process)

    # Then
    assert process.signals == [signal.CTRL_BREAK_EVENT]
    assert taskkill_commands == [
        ["cmd", "/c", "taskkill", "/PID", str(process.pid), "/T", "/F"]
    ]
    assert taskkill_timeouts == [10.0]
    assert taskkill_creation_flags == [subprocess.CREATE_NO_WINDOW]
    assert taskkill_startup_infos[0].dwFlags & subprocess.STARTF_USESHOWWINDOW
    assert taskkill_startup_infos[0].wShowWindow == subprocess.SW_HIDE


def test_owned_process_request_stop_terminates_job_without_closing_handle() -> None:
    # Given
    process = FakeProcess()
    ownership = FakeOwnership(remaining=1)
    owned = process_module.OwnedProcess(process, ownership=ownership)

    # When
    owned.request_stop()

    # Then
    assert ownership.terminated
    assert not ownership.closed
    assert process.signals == []


def test_posix_cleanup_signals_owned_process_group(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    process = FakeProcess()
    sent_signals: list[tuple[int, int]] = []

    def fake_wait(timeout: float | None = None) -> int:
        if process.wait_calls == 0:
            process.wait_calls += 1
            raise subprocess.TimeoutExpired(cmd="owned", timeout=timeout or 0.0)
        return 0

    def record_signal(pid: int, sent_signal: int) -> None:
        sent_signals.append((pid, sent_signal))

    process.wait = fake_wait
    monkeypatch.setattr("scripts.e2e_scheduler.processes.os.name", "posix")
    monkeypatch.setattr(
        "scripts.e2e_scheduler.processes.os.kill",
        record_signal,
    )

    # When
    process_module.kill_process_tree(process)

    # Then
    assert sent_signals == [(-process.pid, 15), (-process.pid, 9)]


def test_owned_process_reports_ports_left_open(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given
    process = FakeProcess(returncode=0)

    def is_open(port: int) -> bool:
        return port == 8123

    monkeypatch.setattr(process_module, "PORT_CLOSE_TIMEOUT_SECONDS", 0.0)
    monkeypatch.setattr(process_module, "port_is_open", is_open)
    owned = process_module.OwnedProcess(process=process, ports=(8123, 8124))

    # When / Then
    with pytest.raises(process_module.OwnedProcessCleanupError) as error:
        owned.close()

    assert error.value.pid == process.pid
    assert error.value.open_ports == (8123,)


def test_owned_process_waits_for_signalled_child_port_to_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    process = FakeProcess(returncode=0)
    checks = iter((True, False))
    monotonic = iter((0.0, 0.0))

    def next_port_state(_port: int) -> bool:
        return next(checks)

    def next_time() -> float:
        return next(monotonic)

    def skip_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(process_module, "port_is_open", next_port_state)
    monkeypatch.setattr(
        "scripts.e2e_scheduler.processes.time.monotonic",
        next_time,
    )
    monkeypatch.setattr("scripts.e2e_scheduler.processes.time.sleep", skip_sleep)
    owned = process_module.OwnedProcess(process=process, ports=(8123,))

    # When
    owned.close()

    # Then
    assert process.poll() == 0


def test_owned_process_fails_closed_when_owned_job_remains_active() -> None:
    process = FakeProcess(returncode=0)
    ownership = FakeOwnership(remaining=1)
    owned = process_module.OwnedProcess(process, ownership=ownership)

    with pytest.raises(
        process_module.OwnedProcessCleanupError,
        match="active_processes=1",
    ):
        owned.close()

    assert ownership.terminated
    assert ownership.closed


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object regression")
@pytest.mark.parametrize(
    "windows_spawn_mode",
    [
        process_module.WindowsSpawnMode.BOOTSTRAP,
        process_module.WindowsSpawnMode.DIRECT,
    ],
)
def test_windows_owned_process_terminates_child_after_wrapper_exits(
    tmp_path: Path,
    windows_spawn_mode: process_module.WindowsSpawnMode,
) -> None:
    # Given
    wrapper = (
        "import subprocess,sys;"
        "child=subprocess.Popen([sys.executable,'-c',"
        "'import time; time.sleep(120)']);"
        "__import__('pathlib').Path(sys.argv[1]).write_text(str(child.pid))"
    )
    child_pid_path = tmp_path / "child.pid"
    owned = process_module.OwnedProcess.spawn(
        process_module.ProcessLaunch(
            (sys.executable, "-c", wrapper, str(child_pid_path)),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
            windows_spawn_mode=windows_spawn_mode,
        )
    )
    try:
        _ = owned.process.wait(timeout=10)
        assert child_pid_path.exists()
        child_pid = int(child_pid_path.read_text(encoding="utf-8"))
        assert _pid_exists(child_pid)

        # When
        owned.close()

        # Then
        assert not _pid_exists(child_pid)
    finally:
        if owned.process.poll() is None:
            owned.close()


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object regression")
def test_windows_owned_process_closes_live_job_without_bootstrap_grace(
    tmp_path: Path,
) -> None:
    # Given
    target_pid_path = tmp_path / "target.pid"
    target = (
        "import ctypes,os,pathlib,sys,time;"
        "console=ctypes.windll.kernel32.GetConsoleWindow();"
        "pathlib.Path(sys.argv[1]).write_text(f'{os.getpid()},{console}');"
        "time.sleep(120)"
    )
    owned = process_module.OwnedProcess.spawn(
        process_module.ProcessLaunch(
            (sys.executable, "-c", target, str(target_pid_path)),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    )
    target_pid = 0
    try:
        deadline = time.monotonic() + 10.0
        while not target_pid_path.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert target_pid_path.exists()
        target_pid_text, console_handle_text = target_pid_path.read_text(
            encoding="utf-8"
        ).split(",", maxsplit=1)
        target_pid = int(target_pid_text)
        assert target_pid != owned.pid
        assert int(console_handle_text) == 0
        assert owned.ownership is not None
        assert owned.ownership.active_processes() >= 1

        # When
        started = time.monotonic()
        owned.close()
        elapsed = time.monotonic() - started

        # Then
        assert elapsed < 3.0
        assert owned.process.poll() is not None
        assert not _pid_exists(target_pid)
    finally:
        if owned.process.poll() is None:
            owned.close()
        if target_pid and _pid_exists(target_pid):
            _ = subprocess.run(
                ["taskkill", "/PID", str(target_pid), "/T", "/F"],
                check=False,
                capture_output=True,
                timeout=10,
            )


def _pid_exists(pid: int) -> bool:
    completed = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
        check=False,
        capture_output=True,
        text=True,
    )
    return f'"{pid}"' in completed.stdout
