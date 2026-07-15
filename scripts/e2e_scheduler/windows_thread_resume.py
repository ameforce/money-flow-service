"""Public Win32 Toolhelp adapter for resuming one suspended process thread."""

from __future__ import annotations

import ctypes
from ctypes import wintypes
from dataclasses import dataclass
from typing import Final, final, override

from pydantic import TypeAdapter, ValidationError
import win32con


@final
class _ThreadEntry32(ctypes.Structure):
    th32ThreadID: int
    th32OwnerProcessID: int

    _fields_ = (
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ThreadID", wintypes.DWORD),
        ("th32OwnerProcessID", wintypes.DWORD),
        ("tpBasePri", wintypes.LONG),
        ("tpDeltaPri", wintypes.LONG),
        ("dwFlags", wintypes.DWORD),
    )

    def __init__(self) -> None:
        super().__init__()
        self.th32ThreadID = 0
        self.th32OwnerProcessID = 0


TH32CS_SNAPTHREAD: Final = 0x00000004
INVALID_HANDLE_VALUE: Final = ctypes.c_void_p(-1).value
RESUME_THREAD_FAILED: Final = 0xFFFFFFFF
_NATIVE_INT_ADAPTER: Final = TypeAdapter(int)
_KERNEL32: Final = ctypes.WinDLL("kernel32", use_last_error=True)
_CREATE_TOOLHELP32_SNAPSHOT: Final = ctypes.WINFUNCTYPE(
    wintypes.HANDLE,
    wintypes.DWORD,
    wintypes.DWORD,
)(("CreateToolhelp32Snapshot", _KERNEL32))
_THREAD32_FIRST: Final = ctypes.WINFUNCTYPE(
    wintypes.BOOL,
    wintypes.HANDLE,
    ctypes.POINTER(_ThreadEntry32),
)(("Thread32First", _KERNEL32))
_THREAD32_NEXT: Final = ctypes.WINFUNCTYPE(
    wintypes.BOOL,
    wintypes.HANDLE,
    ctypes.POINTER(_ThreadEntry32),
)(("Thread32Next", _KERNEL32))
_OPEN_THREAD: Final = ctypes.WINFUNCTYPE(
    wintypes.HANDLE,
    wintypes.DWORD,
    wintypes.BOOL,
    wintypes.DWORD,
)(("OpenThread", _KERNEL32))
_RESUME_THREAD: Final = ctypes.WINFUNCTYPE(
    wintypes.DWORD,
    wintypes.HANDLE,
)(("ResumeThread", _KERNEL32))
_CLOSE_HANDLE: Final = ctypes.WINFUNCTYPE(
    wintypes.BOOL,
    wintypes.HANDLE,
)(("CloseHandle", _KERNEL32))


@dataclass(frozen=True, slots=True)
class WindowsThreadResumeError(OSError):
    operation: str
    error_code: int

    @override
    def __str__(self) -> str:
        return f"Windows thread operation {self.operation} failed with {self.error_code}"


def resume_primary_thread(pid: int) -> None:
    """Resume the only thread created by CREATE_SUSPENDED before target code runs."""
    thread_ids = _thread_ids_for_process(pid)
    if not thread_ids:
        raise WindowsThreadResumeError("Thread32First", 0)
    thread_handle = _open_thread(thread_ids[0])
    try:
        previous_suspend_count = _resume_thread(thread_handle)
        if previous_suspend_count == RESUME_THREAD_FAILED:
            raise WindowsThreadResumeError(
                "ResumeThread",
                ctypes.get_last_error(),
            )
        if previous_suspend_count < 1:
            raise WindowsThreadResumeError("ResumeThread", 0)
    finally:
        _close_handle(thread_handle)


def _thread_ids_for_process(pid: int) -> tuple[int, ...]:
    snapshot = _create_thread_snapshot()
    if snapshot == INVALID_HANDLE_VALUE:
        raise WindowsThreadResumeError(
            "CreateToolhelp32Snapshot",
            ctypes.get_last_error(),
        )
    entry = _ThreadEntry32()
    entry.dwSize = ctypes.sizeof(_ThreadEntry32)
    thread_ids: list[int] = []
    try:
        has_entry = bool(_thread32_first(snapshot, entry))
        while has_entry:
            if entry.th32OwnerProcessID == pid:
                thread_ids.append(int(entry.th32ThreadID))
            has_entry = bool(_thread32_next(snapshot, entry))
    finally:
        _close_handle(snapshot)
    return tuple(thread_ids)


def _create_thread_snapshot() -> int:
    try:
        return _NATIVE_INT_ADAPTER.validate_python(
            _CREATE_TOOLHELP32_SNAPSHOT(TH32CS_SNAPTHREAD, 0)
        )
    except ValidationError as error:
        raise WindowsThreadResumeError(
            "CreateToolhelp32Snapshot",
            ctypes.get_last_error(),
        ) from error


def _thread32_first(snapshot: int, entry: _ThreadEntry32) -> int:
    return _NATIVE_INT_ADAPTER.validate_python(
        _THREAD32_FIRST(snapshot, ctypes.byref(entry))
    )


def _thread32_next(snapshot: int, entry: _ThreadEntry32) -> int:
    return _NATIVE_INT_ADAPTER.validate_python(
        _THREAD32_NEXT(snapshot, ctypes.byref(entry))
    )


def _open_thread(thread_id: int) -> int:
    try:
        handle = _NATIVE_INT_ADAPTER.validate_python(
            _OPEN_THREAD(win32con.THREAD_SUSPEND_RESUME, False, thread_id)
        )
    except ValidationError as error:
        raise WindowsThreadResumeError(
            "OpenThread",
            ctypes.get_last_error(),
        ) from error
    if not handle:
        raise WindowsThreadResumeError("OpenThread", ctypes.get_last_error())
    return handle


def _resume_thread(handle: int) -> int:
    return _NATIVE_INT_ADAPTER.validate_python(_RESUME_THREAD(handle))


def _close_handle(handle: int) -> None:
    closed = _NATIVE_INT_ADAPTER.validate_python(_CLOSE_HANDLE(handle))
    if not closed:
        raise WindowsThreadResumeError("CloseHandle", ctypes.get_last_error())
