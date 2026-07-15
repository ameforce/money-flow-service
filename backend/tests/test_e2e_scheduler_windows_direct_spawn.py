from __future__ import annotations

from collections.abc import Mapping
import os
from pathlib import Path
import subprocess
import sys
from threading import Event, Thread
import time
from typing import BinaryIO, final

import pytest
from pydantic import TypeAdapter

import scripts.e2e_scheduler.processes as process_module

type ProcessStream = int | BinaryIO | None

_WINDOW_OWNER_ADAPTER = TypeAdapter(tuple[int, int])


@final
class FakeDirectProcess:
    pid = 8101
    stdin = None

    def __init__(self) -> None:
        self.returncode: int | None = None
        self.kill_calls = 0
        self.wait_calls: list[float | None] = []

    def poll(self) -> int | None:
        return self.returncode

    def send_signal(self, _sig: int) -> None:
        return None

    def wait(self, timeout: float | None = None) -> int:
        self.wait_calls.append(timeout)
        self.returncode = 1
        return self.returncode

    def kill(self) -> None:
        self.kill_calls += 1
        self.returncode = 1


@final
class FakeJob:
    handle = 41

    def __init__(self, events: list[str]) -> None:
        self.events = events

    def active_processes(self) -> int:
        return 1

    def terminate(self) -> None:
        self.events.append("terminate")

    def wait_until_empty(self, timeout_seconds: float) -> int:
        self.events.append(f"wait:{timeout_seconds}")
        return 0

    def close(self) -> None:
        self.events.append("close")


def test_process_launch_defaults_to_bootstrap_and_dynamic_defaults_to_direct(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.delenv("E2E_WINDOWS_SPAWN_MODE", raising=False)

    # When
    ordinary = process_module.ProcessLaunch(("cmd", "/c", "exit"))
    dynamic = process_module.resolve_dynamic_windows_spawn_mode()

    # Then
    assert ordinary.windows_spawn_mode is process_module.WindowsSpawnMode.BOOTSTRAP
    assert dynamic is process_module.WindowsSpawnMode.DIRECT


def test_dynamic_spawn_mode_rejects_unknown_environment_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setenv("E2E_WINDOWS_SPAWN_MODE", "visible")

    # When / Then
    with pytest.raises(
        process_module.WindowsSpawnModeError,
        match="E2E_WINDOWS_SPAWN_MODE",
    ):
        _ = process_module.resolve_dynamic_windows_spawn_mode()


@pytest.mark.skipif(os.name != "nt", reason="Windows spawn dispatch")
def test_owned_process_dispatches_explicit_direct_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    import scripts.e2e_scheduler.windows_process_direct as direct_module
    import scripts.e2e_scheduler.windows_process_spawn as bootstrap_module

    events: list[str] = []
    process = FakeDirectProcess()
    job = FakeJob(events)

    def direct_spawn(
        _launch: process_module.ProcessLaunch,
    ) -> tuple[FakeDirectProcess, FakeJob]:
        events.append("direct")
        return process, job

    def bootstrap_spawn(
        _launch: process_module.ProcessLaunch,
    ) -> tuple[FakeDirectProcess, FakeJob]:
        events.append("bootstrap")
        return process, job

    monkeypatch.setattr(direct_module, "spawn_direct_in_job", direct_spawn)
    monkeypatch.setattr(bootstrap_module, "spawn_in_job", bootstrap_spawn)

    # When
    owned = process_module.OwnedProcess.spawn(
        process_module.ProcessLaunch(
            ("cmd", "/c", "exit"),
            windows_spawn_mode=process_module.WindowsSpawnMode.DIRECT,
        )
    )

    # Then
    assert events == ["direct"]
    assert owned.process is process
    assert owned.ownership is job


@pytest.mark.skipif(os.name != "nt", reason="Windows direct spawn")
def test_direct_launcher_assigns_suspended_target_before_resume(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    import win32con

    import scripts.e2e_scheduler.windows_process_direct as direct_module
    from scripts.e2e_scheduler.windows_job import WindowsJob

    events: list[str] = []
    process = FakeDirectProcess()
    job = FakeJob(events)
    observed_creation_flags: list[int] = []
    observed_startup_infos: list[subprocess.STARTUPINFO] = []

    def create_job(_cls: type[WindowsJob], _name: str) -> FakeJob:
        events.append("create-job")
        return job

    def popen(
        _command: list[str],
        *,
        cwd: Path | None,
        env: Mapping[str, str] | None,
        stdin: ProcessStream,
        stdout: ProcessStream,
        stderr: ProcessStream,
        creationflags: int,
        start_new_session: bool,
        startupinfo: subprocess.STARTUPINFO,
    ) -> FakeDirectProcess:
        _ = (cwd, env, stdin, stdout, stderr, start_new_session)
        events.append("create-suspended")
        observed_creation_flags.append(creationflags)
        observed_startup_infos.append(startupinfo)
        return process

    def assign_process(assigned_job: WindowsJob, pid: int) -> None:
        events.append(f"assign:{assigned_job.handle}:{pid}")

    def resume_process(pid: int) -> None:
        events.append(f"resume:{pid}")

    monkeypatch.setattr(
        WindowsJob,
        "create",
        classmethod(create_job),
    )
    monkeypatch.setattr(subprocess, "Popen", popen)
    monkeypatch.setattr(
        direct_module,
        "_assign_process_to_job",
        assign_process,
    )
    monkeypatch.setattr(
        direct_module,
        "_resume_primary_thread",
        resume_process,
    )

    # When
    launched, ownership = direct_module.spawn_direct_in_job(
        process_module.ProcessLaunch(
            ("cmd", "/c", "exit"),
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    )

    # Then
    assert launched is process
    assert ownership is job
    assert events == [
        "create-job",
        "create-suspended",
        "assign:41:8101",
        "resume:8101",
    ]
    assert observed_creation_flags[0] & subprocess.CREATE_NO_WINDOW
    assert observed_creation_flags[0] & win32con.CREATE_SUSPENDED
    assert observed_startup_infos[0].dwFlags & subprocess.STARTF_USESHOWWINDOW
    assert observed_startup_infos[0].wShowWindow == subprocess.SW_HIDE


@pytest.mark.skipif(os.name != "nt", reason="Windows direct spawn")
def test_direct_launcher_fails_closed_when_resume_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    import scripts.e2e_scheduler.windows_process_direct as direct_module
    from scripts.e2e_scheduler.windows_job import WindowsJob

    events: list[str] = []
    process = FakeDirectProcess()
    job = FakeJob(events)
    def create_job(_cls: type[WindowsJob], _name: str) -> FakeJob:
        return job

    def popen(
        _command: list[str],
        *,
        cwd: Path | None,
        env: Mapping[str, str] | None,
        stdin: ProcessStream,
        stdout: ProcessStream,
        stderr: ProcessStream,
        creationflags: int,
        start_new_session: bool,
        startupinfo: subprocess.STARTUPINFO,
    ) -> FakeDirectProcess:
        _ = (
            cwd,
            env,
            stdin,
            stdout,
            stderr,
            creationflags,
            start_new_session,
            startupinfo,
        )
        return process

    def assign_process(_job: WindowsJob, _pid: int) -> None:
        return None

    def fail_resume(_pid: int) -> None:
        raise OSError("resume failed")

    monkeypatch.setattr(WindowsJob, "create", classmethod(create_job))
    monkeypatch.setattr(subprocess, "Popen", popen)
    monkeypatch.setattr(direct_module, "_assign_process_to_job", assign_process)
    monkeypatch.setattr(
        direct_module,
        "_resume_primary_thread",
        fail_resume,
    )

    # When / Then
    with pytest.raises(
        direct_module.WindowsDirectProcessSpawnError,
        match="resume failed",
    ):
        _ = direct_module.spawn_direct_in_job(
            process_module.ProcessLaunch(("cmd", "/c", "exit"))
        )

    assert events == ["terminate", "wait:10.0", "close"]
    assert process.poll() is not None


@pytest.mark.skipif(os.name != "nt", reason="Windows direct spawn integration")
def test_real_direct_launcher_preserves_io_env_cwd_and_has_no_visible_console(
    tmp_path: Path,
) -> None:
    # Given
    import win32gui
    import win32process

    marker = tmp_path / "direct-target.txt"
    target = (
        "import ctypes,os,pathlib,sys;"
        "pathlib.Path(sys.argv[1]).write_text('|'.join(("
        "str(os.getpid()),"
        "str(ctypes.windll.kernel32.GetConsoleWindow()),"
        "os.getcwd(),"
        "os.environ['E2E_DIRECT_PROBE'])),encoding='utf-8');"
        "sys.stdin.buffer.read()"
    )
    environment = os.environ.copy()
    environment["E2E_DIRECT_PROBE"] = "preserved"
    stderr_path = tmp_path / "direct-target.stderr.log"
    python_executable = Path(sys.base_prefix) / "python.exe"
    observed_foreground_pids: list[int] = []
    monitor_stop = Event()

    def monitor_foreground() -> None:
        while not monitor_stop.wait(0.002):
            foreground_window = win32gui.GetForegroundWindow()
            if foreground_window:
                observed_foreground_pids.append(
                    _WINDOW_OWNER_ADAPTER.validate_python(
                        win32process.__dict__["GetWindowThreadProcessId"](
                            foreground_window
                        )
                    )[1]
                )

    monitor = Thread(target=monitor_foreground, daemon=True)
    monitor.start()
    try:
        with stderr_path.open("wb") as stderr_file:
            owned = process_module.OwnedProcess.spawn(
                process_module.ProcessLaunch(
                    (str(python_executable), "-c", target, str(marker)),
                    cwd=tmp_path,
                    env=environment,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=stderr_file,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
                    windows_spawn_mode=process_module.WindowsSpawnMode.DIRECT,
                )
            )
        try:
            deadline = time.monotonic() + 10.0
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            assert marker.exists(), stderr_path.read_text(encoding="utf-8")
            target_pid_text, console_text, cwd_text, env_text = marker.read_text(
                encoding="utf-8"
            ).split("|", maxsplit=3)
            target_pid = int(target_pid_text)

            # When
            stdin = owned.process.stdin
            assert stdin is not None
            stdin.close()
            return_code = owned.process.wait(timeout=10.0)

            # Then
            assert return_code == 0
            assert target_pid == owned.pid
            assert int(console_text) == 0
            assert target_pid not in observed_foreground_pids
            assert Path(cwd_text) == tmp_path
            assert env_text == "preserved"
            assert owned.ownership is not None
            assert owned.ownership.wait_until_empty(2.0) == 0
            owned.close()
        finally:
            if owned.process.poll() is None:
                owned.close()
    finally:
        monitor_stop.set()
        monitor.join(timeout=2.0)
