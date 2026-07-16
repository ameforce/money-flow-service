"""Run a Windows E2E command and fail if its process tree owns foreground UI."""

# pyright: reportAny=false

from __future__ import annotations

import argparse
from collections.abc import Mapping
import ctypes
from ctypes import wintypes
from dataclasses import dataclass
from datetime import UTC, datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Final, final, override
from uuid import uuid4

if __package__ in {None, ""}:
    repository_root = str(Path(__file__).resolve().parents[1])
    if repository_root not in sys.path:
        sys.path.insert(0, repository_root)

from scripts.e2e_scheduler.process_launch import (  # noqa: E402
    ProcessLaunch,
    WindowsSpawnMode,
)
from scripts.e2e_scheduler.processes import OwnedProcess  # noqa: E402


_TH32CS_SNAPPROCESS: Final = 0x00000002
_INVALID_HANDLE_VALUE: Final = ctypes.c_void_p(-1).value


@dataclass(slots=True)
class ForegroundMonitorFinalizationError(RuntimeError):
    monitor_error_type: str | None
    cleanup_error_type: str | None
    artifact_error_type: str | None

    @override
    def __str__(self) -> str:
        return (
            "foreground monitor finalization failed: "
            f"monitor={self.monitor_error_type}, "
            f"cleanup={self.cleanup_error_type}, "
            f"artifact={self.artifact_error_type}"
        )


@final
class _ProcessEntry(ctypes.Structure):
    _fields_ = (
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", wintypes.WCHAR * 260),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    _ = parser.add_argument("--output", type=Path, required=True)
    _ = parser.add_argument("--interval-ms", type=float, default=5.0)
    _ = parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    command = tuple(args.command)
    if command[:1] == ("--",):
        command = command[1:]
    if os.name != "nt":
        parser.error("foreground ownership monitoring is Windows-only")
    if not command:
        parser.error("a command is required after --")
    return _run_monitored(
        command,
        output=args.output,
        interval_seconds=max(args.interval_ms / 1000.0, 0.001),
    )


def _run_monitored(
    command: tuple[str, ...],
    *,
    output: Path,
    interval_seconds: float,
) -> int:
    win32gui, win32process = _window_apis()
    started_at = datetime.now(UTC)
    transitions: list[dict[str, str | int]] = []
    last_window = 0
    samples = 0
    return_code: int | None = None
    monitor_error: BaseException | None = None
    cleanup_error: BaseException | None = None
    artifact_error: BaseException | None = None
    owned: OwnedProcess | None = None
    try:
        owned = _spawn_monitored(command)
        process = owned.process
        while process.poll() is None:
            samples += 1
            window = int(getattr(win32gui, "GetForegroundWindow")() or 0)
            if window and window != last_window:
                _record_owned_transition(
                    window,
                    process.pid,
                    _process_parents(),
                    transitions,
                    win32gui,
                    win32process,
                )
            last_window = window
            time.sleep(interval_seconds)
        return_code = int(process.wait())
    except BaseException as error:
        monitor_error = error
    if owned is not None:
        try:
            owned.close()
        except BaseException as error:
            cleanup_error = error
        if return_code is None:
            polled = owned.process.poll()
            if polled is not None:
                return_code = int(polled)
    payload = {
        "version": 1,
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
        "command_program": command[0],
        "argument_count": len(command) - 1,
        "child_exit_code": return_code,
        "sample_interval_ms": interval_seconds * 1000.0,
        "sample_count": samples,
        "owned_transition_count": len(transitions),
        "transitions": transitions,
        "monitor_error_type": _error_type(monitor_error),
        "cleanup_error_type": _error_type(cleanup_error),
    }
    try:
        _write_payload(output, payload)
    except BaseException as error:
        artifact_error = error
    if monitor_error is not None:
        if cleanup_error is not None or artifact_error is not None:
            raise _finalization_error(
                monitor_error,
                cleanup_error,
                artifact_error,
            ) from monitor_error
        raise monitor_error
    if cleanup_error is not None or artifact_error is not None:
        error = _finalization_error(None, cleanup_error, artifact_error)
        raise error from cleanup_error or artifact_error
    if return_code is None:
        raise ForegroundMonitorFinalizationError(None, None, None)
    if return_code != 0:
        return return_code
    return 1 if transitions else 0


def _spawn_monitored(command: tuple[str, ...]) -> OwnedProcess:
    return OwnedProcess.spawn(
        ProcessLaunch(
            command=_windows_command(command),
            cwd=Path.cwd(),
            creationflags=subprocess.CREATE_NO_WINDOW,
            role="foreground-monitored-e2e",
            windows_spawn_mode=WindowsSpawnMode.DIRECT,
        )
    )


def _window_apis() -> tuple[object, object]:
    import win32gui
    import win32process

    return win32gui, win32process


def _write_payload(output: Path, payload: Mapping[str, object]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp-{uuid4().hex}")
    try:
        _ = temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        _ = temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


def _error_type(error: BaseException | None) -> str | None:
    return type(error).__name__ if error is not None else None


def _finalization_error(
    monitor_error: BaseException | None,
    cleanup_error: BaseException | None,
    artifact_error: BaseException | None,
) -> ForegroundMonitorFinalizationError:
    return ForegroundMonitorFinalizationError(
        _error_type(monitor_error),
        _error_type(cleanup_error),
        _error_type(artifact_error),
    )


def _record_owned_transition(
    window: int,
    root_pid: int,
    parents: dict[int, int],
    transitions: list[dict[str, str | int]],
    win32gui: object,
    win32process: object,
) -> None:
    get_owner = getattr(win32process, "GetWindowThreadProcessId")
    _thread_id, owner_pid = get_owner(window)
    if not _is_descendant(int(owner_pid), root_pid, parents):
        return
    get_text = getattr(win32gui, "GetWindowText")
    get_class = getattr(win32gui, "GetClassName")
    transitions.append(
        {
            "observed_at": datetime.now(UTC).isoformat(),
            "window": window,
            "process_id": int(owner_pid),
            "title": str(get_text(window)),
            "class_name": str(get_class(window)),
        }
    )


def _is_descendant(process_id: int, root_pid: int, parents: dict[int, int]) -> bool:
    current = process_id
    visited: set[int] = set()
    while current and current not in visited:
        if current == root_pid:
            return True
        visited.add(current)
        current = parents.get(current, 0)
    return False


def _process_parents() -> dict[int, int]:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_snapshot = kernel32.CreateToolhelp32Snapshot
    create_snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
    create_snapshot.restype = wintypes.HANDLE
    process_first = kernel32.Process32FirstW
    process_first.argtypes = (wintypes.HANDLE, ctypes.POINTER(_ProcessEntry))
    process_first.restype = wintypes.BOOL
    process_next = kernel32.Process32NextW
    process_next.argtypes = (wintypes.HANDLE, ctypes.POINTER(_ProcessEntry))
    process_next.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    snapshot = create_snapshot(_TH32CS_SNAPPROCESS, 0)
    if snapshot == _INVALID_HANDLE_VALUE:
        raise OSError(ctypes.get_last_error(), "CreateToolhelp32Snapshot failed")
    parents: dict[int, int] = {}
    try:
        entry = _ProcessEntry()
        entry.dwSize = ctypes.sizeof(_ProcessEntry)
        success = bool(process_first(snapshot, ctypes.byref(entry)))
        while success:
            parents[int(entry.th32ProcessID)] = int(entry.th32ParentProcessID)
            success = bool(process_next(snapshot, ctypes.byref(entry)))
    finally:
        _ = close_handle(snapshot)
    return parents


def _windows_command(command: tuple[str, ...]) -> tuple[str, ...]:
    executable = shutil.which(command[0]) or command[0]
    if Path(executable).suffix.lower() not in {".cmd", ".bat"}:
        return (executable, *command[1:])
    return (
        os.environ.get("COMSPEC", "cmd.exe"),
        "/d",
        "/s",
        "/c",
        subprocess.list2cmdline((executable, *command[1:])),
    )


if __name__ == "__main__":
    sys.exit(main())
