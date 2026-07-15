"""Direct suspended Windows target launch with parent-owned Job assignment."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
import secrets
import subprocess
from typing import BinaryIO, Protocol, override

import pywintypes
import win32api
import win32con
import win32job

from scripts.e2e_scheduler.windows_job import WindowsJob
from scripts.e2e_scheduler.windows_thread_resume import (
    resume_primary_thread as _resume_primary_thread,
)

type ProcessStream = int | BinaryIO | None


class ProcessLaunchSpec(Protocol):
    @property
    def command(self) -> tuple[str, ...]: ...

    @property
    def cwd(self) -> Path | None: ...

    @property
    def env(self) -> Mapping[str, str] | None: ...

    @property
    def stdin(self) -> ProcessStream: ...

    @property
    def stdout(self) -> ProcessStream: ...

    @property
    def stderr(self) -> ProcessStream: ...

    @property
    def creationflags(self) -> int: ...

    @property
    def start_new_session(self) -> bool: ...


class _DirectProcess(Protocol):
    pid: int

    def poll(self) -> int | None: ...

    def wait(self, timeout: float | None = None) -> int: ...

    def kill(self) -> None: ...


class _JobOwnership(Protocol):
    def terminate(self) -> None: ...

    def wait_until_empty(self, timeout_seconds: float) -> int: ...

    def close(self) -> None: ...


@dataclass(slots=True)
class WindowsDirectProcessSpawnError(OSError):
    pid: int
    process_running: bool
    reason: str

    @override
    def __str__(self) -> str:
        return f"Windows direct process spawn failed for pid {self.pid}: {self.reason}"


def spawn_direct_in_job(
    launch: ProcessLaunchSpec,
) -> tuple[subprocess.Popen[bytes], WindowsJob]:
    """Create the target suspended, assign it to its Job, then resume it."""
    ownership = WindowsJob.create(f"money-flow-e2e-{secrets.token_hex(32)}")
    creationflags = (
        launch.creationflags
        | win32con.CREATE_SUSPENDED
        | subprocess.CREATE_NO_WINDOW
    )
    startup_info = subprocess.STARTUPINFO(
        dwFlags=subprocess.STARTF_USESHOWWINDOW,
        wShowWindow=subprocess.SW_HIDE,
    )
    try:
        process: subprocess.Popen[bytes] = subprocess.Popen(
            list(launch.command),
            cwd=launch.cwd,
            env=launch.env,
            stdin=launch.stdin,
            stdout=launch.stdout,
            stderr=launch.stderr,
            creationflags=creationflags,
            start_new_session=launch.start_new_session,
            startupinfo=startup_info,
        )
    except OSError:
        ownership.close()
        raise
    try:
        _assign_process_to_job(ownership, process.pid)
        _resume_primary_thread(process.pid)
    except (OSError, pywintypes.error) as error:
        raise _spawn_error_after_cleanup(process, ownership, error) from error
    return process, ownership


def _assign_process_to_job(ownership: WindowsJob, pid: int) -> None:
    access = win32con.PROCESS_SET_QUOTA | win32con.PROCESS_TERMINATE
    process_handle = win32api.OpenProcess(access, False, pid)
    try:
        win32job.AssignProcessToJobObject(ownership.handle, process_handle)
    finally:
        win32api.CloseHandle(process_handle)


def _spawn_error_after_cleanup(
    process: _DirectProcess,
    ownership: _JobOwnership,
    error: OSError | pywintypes.error,
) -> WindowsDirectProcessSpawnError:
    cleanup_error = _stop_failed_target(process, ownership)
    reason = str(error)
    if cleanup_error is not None:
        reason = f"{reason}; cleanup failed: {cleanup_error}"
    return WindowsDirectProcessSpawnError(
        process.pid,
        process.poll() is None,
        reason,
    )


def _stop_failed_target(
    process: _DirectProcess,
    ownership: _JobOwnership,
) -> str | None:
    cleanup_error: str | None = None
    try:
        ownership.terminate()
        active = ownership.wait_until_empty(10.0)
        if active:
            cleanup_error = f"Job Object retained {active} active processes"
    except OSError as error:
        cleanup_error = str(error)
    finally:
        try:
            ownership.close()
        except OSError as error:
            cleanup_error = str(error)
    if process.poll() is None:
        try:
            _ = process.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            process.kill()
            try:
                _ = process.wait(timeout=5.0)
            except subprocess.TimeoutExpired as error:
                cleanup_error = str(error)
    return cleanup_error
