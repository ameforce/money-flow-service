from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
import subprocess
import sys
from typing import BinaryIO, final

import pytest

from scripts.e2e_scheduler.processes import OwnedProcess, ProcessLaunch

type ProcessStream = int | BinaryIO | None


@final
class FakeBootstrap:
    pid = 7203
    stdin = None

    def __init__(self, wait_failures: int = 0) -> None:
        self.wait_failures = wait_failures
        self.wait_calls: list[float | None] = []
        self.kill_calls = 0

    def poll(self) -> int | None:
        return None

    def wait(self, timeout: float | None = None) -> int:
        self.wait_calls.append(timeout)
        if len(self.wait_calls) <= self.wait_failures:
            raise subprocess.TimeoutExpired("bootstrap", timeout or 0.0)
        return 0

    def kill(self) -> None:
        self.kill_calls += 1


@final
class FakeJob:
    handle = 41

    def __init__(self, remaining: int) -> None:
        self.remaining = remaining
        self.events: list[str] = []

    def terminate(self) -> None:
        self.events.append("terminate")

    def wait_until_empty(self, timeout_seconds: float) -> int:
        self.events.append(f"wait:{timeout_seconds}")
        return self.remaining

    def close(self) -> None:
        self.events.append("close")


@pytest.mark.skipif(os.name != "nt", reason="Windows owned spawn regression")
def test_windows_owned_spawn_preserves_target_stdin_eof(tmp_path: Path) -> None:
    marker = tmp_path / "stdin-closed.txt"
    target = (
        "import pathlib,sys;"
        "sys.stdin.buffer.read();"
        "pathlib.Path(sys.argv[1]).write_text('closed')"
    )
    owned = OwnedProcess.spawn(
        ProcessLaunch(
            (sys.executable, "-c", target, str(marker)),
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    )
    try:
        stdin = owned.process.stdin
        assert stdin is not None
        stdin.close()
        _ = owned.process.wait(timeout=10)
        assert marker.read_text(encoding="utf-8") == "closed"
        owned.close()
    finally:
        if owned.process.poll() is None:
            owned.close()


@pytest.mark.skipif(os.name != "nt", reason="Windows owned spawn regression")
def test_windows_owned_spawn_closes_job_when_bootstrap_launch_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import scripts.e2e_scheduler.windows_process_spawn as spawn_module
    from scripts.e2e_scheduler.windows_job import WindowsJob

    closed: list[bool] = []

    @final
    class PreLaunchFakeJob:
        handle: int = 41

        def close(self) -> None:
            closed.append(True)

    def create_job(_cls: type[WindowsJob], _name: str) -> PreLaunchFakeJob:
        return PreLaunchFakeJob()

    def fail_launch(
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
    ) -> None:
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
        raise OSError("cannot launch bootstrap")

    monkeypatch.setattr(
        WindowsJob,
        "create",
        classmethod(create_job),
    )
    monkeypatch.setattr(subprocess, "Popen", fail_launch)

    with pytest.raises(OSError, match="cannot launch"):
        _ = spawn_module.spawn_in_job(ProcessLaunch(("cmd", "/c", "exit")))

    assert closed == [True]


@pytest.mark.skipif(os.name != "nt", reason="Windows owned spawn regression")
def test_windows_owned_spawn_hides_bootstrap_and_target_console(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    import scripts.e2e_scheduler.windows_process_spawn as spawn_module

    job = FakeJob(remaining=0)
    launched_command: list[str] = []
    observed_creation_flags = 0
    observed_startup_info: subprocess.STARTUPINFO | None = None
    def popen(
        command: list[str],
        *,
        cwd: Path | None,
        env: Mapping[str, str] | None,
        stdin: ProcessStream,
        stdout: ProcessStream,
        stderr: ProcessStream,
        creationflags: int,
        start_new_session: bool,
        startupinfo: subprocess.STARTUPINFO,
    ) -> FakeBootstrap:
        nonlocal observed_creation_flags, observed_startup_info
        _ = (cwd, env, stdin, stdout, stderr, start_new_session)
        launched_command.extend(command)
        observed_creation_flags = creationflags
        observed_startup_info = startupinfo
        raise OSError("stop after bootstrap launch")

    monkeypatch.setattr(
        spawn_module.WindowsJob,
        "create",
        classmethod(lambda _cls, _name: job),
    )
    monkeypatch.setattr(subprocess, "Popen", popen)

    # When
    with pytest.raises(OSError, match="stop after"):
        _ = spawn_module.spawn_in_job(
            ProcessLaunch(
                ("cmd", "/c", "exit"),
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
            )
        )

    # Then
    expected_flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    assert observed_creation_flags == expected_flags
    assert int(launched_command[6]) == expected_flags
    assert observed_startup_info is not None
    assert observed_startup_info.dwFlags & subprocess.STARTF_USESHOWWINDOW
    assert observed_startup_info.wShowWindow == subprocess.SW_HIDE


@pytest.mark.skipif(os.name != "nt", reason="Windows owned spawn regression")
def test_post_launch_handle_reset_failure_stops_bootstrap_and_proves_empty_job(
) -> None:
    import scripts.e2e_scheduler.windows_process_spawn as spawn_module

    process = FakeBootstrap()
    job = FakeJob(remaining=0)
    error = spawn_module._spawn_error_after_cleanup(
        process,
        job,
        OSError("bootstrap handshake failed"),
    )

    assert "bootstrap handshake failed" in str(error)
    assert process.wait_calls == [5.0]
    assert process.kill_calls == 0
    assert job.events == ["terminate", "wait:10.0", "close"]


@pytest.mark.skipif(os.name != "nt", reason="Windows owned spawn regression")
def test_post_launch_handle_reset_failure_reports_cleanup_failure(
) -> None:
    import scripts.e2e_scheduler.windows_process_spawn as spawn_module

    process = FakeBootstrap(wait_failures=2)
    job = FakeJob(remaining=1)
    error = spawn_module._spawn_error_after_cleanup(
        process,
        job,
        OSError("bootstrap handshake failed"),
    )

    assert "cleanup failed" in str(error)
    assert "bootstrap" in str(error)
    assert process.wait_calls == [5.0, 5.0]
    assert process.kill_calls == 1
    assert job.events == ["terminate", "wait:10.0", "close"]
