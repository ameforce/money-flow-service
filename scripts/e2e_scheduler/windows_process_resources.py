"""Current scheduler-process resource accounting on Windows."""

from __future__ import annotations

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, TypeAdapter
import pywintypes
import win32api
import win32con
import win32process

from scripts.e2e_scheduler.process_metrics import ProcessResourceUsage


class _ProcessPayload(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)


class _ProcessMemory(_ProcessPayload):
    WorkingSetSize: int
    PeakWorkingSetSize: int


class _ProcessIo(_ProcessPayload):
    ReadTransferCount: int
    WriteTransferCount: int


class _ProcessTimes(_ProcessPayload):
    KernelTime: int
    UserTime: int


_MEMORY = TypeAdapter(_ProcessMemory)
_IO = TypeAdapter(_ProcessIo)
_TIMES = TypeAdapter(_ProcessTimes)


def current_process_resource_usage() -> ProcessResourceUsage:
    handle = win32api.GetCurrentProcess()
    memory = _MEMORY.validate_python(
        win32process.__dict__["GetProcessMemoryInfo"](handle)
    )
    io = _IO.validate_python(win32process.__dict__["GetProcessIoCounters"](handle))
    times = _TIMES.validate_python(win32process.__dict__["GetProcessTimes"](handle))
    return ProcessResourceUsage(
        cpu_seconds=(times.KernelTime + times.UserTime) / 10_000_000,
        read_bytes=io.ReadTransferCount,
        write_bytes=io.WriteTransferCount,
        current_working_set_bytes=memory.WorkingSetSize,
        peak_working_set_bytes=memory.PeakWorkingSetSize,
        active_process_count=1,
        peak_process_count=1,
        total_process_count=1,
    )


def process_working_set_bytes(process_id: int) -> int | None:
    process_handle = None
    try:
        process_handle = win32api.OpenProcess(
            win32con.PROCESS_QUERY_INFORMATION | win32con.PROCESS_VM_READ,
            False,
            process_id,
        )
        memory = _MEMORY.validate_python(
            win32process.__dict__["GetProcessMemoryInfo"](process_handle)
        )
        return memory.WorkingSetSize
    except pywintypes.error:
        return None
    finally:
        if process_handle is not None:
            win32api.CloseHandle(process_handle)
