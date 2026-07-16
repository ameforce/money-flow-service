from __future__ import annotations

from collections.abc import Callable
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object regression")
def test_bootstrap_closes_opened_job_handle_immediately_after_assignment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    import scripts.e2e_scheduler.windows_process_bootstrap as bootstrap_module

    events: list[str] = []

    def create_process(
        _application: str | None,
        _command: str,
        _process_attributes: None,
        _thread_attributes: None,
        _inherit_handles: bool,
        _creation_flags: int,
        _environment: None,
        _current_directory: None,
        _startup_info: bootstrap_module.win32process.STARTUPINFO,
    ) -> tuple[int, int, int, int]:
        return 101, 102, 7001, 7002

    def assign_process(job_handle: int, process_handle: int) -> None:
        events.append(f"assign:{job_handle}:{process_handle}")

    def close_handle(handle: int) -> None:
        events.append(f"close:{handle}")

    monkeypatch.setattr(bootstrap_module.win32api, "GetStdHandle", lambda _kind: 10)
    monkeypatch.setattr(bootstrap_module.win32process, "CreateProcess", create_process)
    monkeypatch.setattr(
        bootstrap_module.win32job,
        "AssignProcessToJobObject",
        assign_process,
    )
    monkeypatch.setattr(bootstrap_module.win32api, "CloseHandle", close_handle)
    monkeypatch.setattr(bootstrap_module.os, "set_handle_inheritable", lambda *_args: None)

    # When
    process_handle, thread_handle = bootstrap_module._create_owned_suspended_process(
        41,
        ["cmd", "/c", "exit"],
        0,
    )

    # Then
    assert (process_handle, thread_handle) == (101, 102)
    assert events == ["assign:41:101", "close:41"]


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object regression")
def test_bootstrap_launches_target_suspended_without_a_console_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    import scripts.e2e_scheduler.windows_process_bootstrap as bootstrap_module

    observed_creation_flags = 0
    observed_startup_info: bootstrap_module.win32process.STARTUPINFO | None = None

    def create_process(
        _application: str | None,
        _command: str,
        _process_attributes: None,
        _thread_attributes: None,
        _inherit_handles: bool,
        creation_flags: int,
        _environment: None,
        _current_directory: None,
        startup_info: bootstrap_module.win32process.STARTUPINFO,
    ) -> tuple[int, int, int, int]:
        nonlocal observed_creation_flags, observed_startup_info
        observed_creation_flags = creation_flags
        observed_startup_info = startup_info
        return 101, 102, 7001, 7002

    monkeypatch.setattr(bootstrap_module.win32api, "GetStdHandle", lambda _kind: 10)
    monkeypatch.setattr(bootstrap_module.win32process, "CreateProcess", create_process)
    monkeypatch.setattr(
        bootstrap_module.win32job,
        "AssignProcessToJobObject",
        lambda _job, _process: None,
    )
    monkeypatch.setattr(bootstrap_module.win32api, "CloseHandle", lambda _handle: None)
    monkeypatch.setattr(bootstrap_module.os, "set_handle_inheritable", lambda *_args: None)

    # When
    _ = bootstrap_module._create_owned_suspended_process(
        41,
        ["cmd", "/c", "exit"],
        subprocess.CREATE_NEW_PROCESS_GROUP,
    )

    # Then
    assert observed_creation_flags & bootstrap_module.win32con.CREATE_SUSPENDED
    assert observed_creation_flags & bootstrap_module.win32con.CREATE_NO_WINDOW
    assert observed_startup_info is not None
    assert observed_startup_info.dwFlags & bootstrap_module.win32con.STARTF_USESHOWWINDOW
    assert observed_startup_info.wShowWindow == bootstrap_module.win32con.SW_HIDE


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object regression")
def test_parent_hard_crash_kills_job_target(tmp_path: Path) -> None:
    # Given
    target_pid_path = tmp_path / "target.pid"
    parent = (
        "import os,pathlib,sys,time;"
        "from scripts.e2e_scheduler.processes import OwnedProcess,ProcessLaunch;"
        "target=(\"import os,pathlib,sys,time;\""
        "+\"pathlib.Path(sys.argv[1]).write_text(str(os.getpid()));\""
        "+\"time.sleep(120)\");"
        "owned=OwnedProcess.spawn(ProcessLaunch("
        "(sys.executable,'-c',target,sys.argv[1]),"
        "creationflags=__import__('subprocess').CREATE_NEW_PROCESS_GROUP));"
        "deadline=time.monotonic()+10;"
        "marker=pathlib.Path(sys.argv[1]);"
        "exec(\"while not marker.exists() and time.monotonic() < deadline:\\n"
        "    time.sleep(0.02)\");"
        "os._exit(0)"
    )
    owner = subprocess.Popen(
        [sys.executable, "-c", parent, str(target_pid_path)],
        cwd=Path(__file__).parents[2],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    target_pid = 0
    try:
        _ = owner.wait(timeout=15)
        assert target_pid_path.exists()
        target_pid = int(target_pid_path.read_text(encoding="utf-8"))

        # When
        target_stopped = _wait_until(lambda: not _pid_exists(target_pid), 5.0)

        # Then
        assert target_stopped
    finally:
        if owner.poll() is None:
            owner.kill()
            _ = owner.wait(timeout=5)
        if target_pid and _pid_exists(target_pid):
            _ = subprocess.run(
                ["taskkill", "/PID", str(target_pid), "/T", "/F"],
                check=False,
                capture_output=True,
                timeout=10,
            )


def _wait_until(predicate: Callable[[], bool], timeout_seconds: float) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return predicate()


def _pid_exists(pid: int) -> bool:
    completed = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
        check=False,
        capture_output=True,
        text=True,
    )
    return f'"{pid}"' in completed.stdout
