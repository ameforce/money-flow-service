"""Windows Job Object ownership boundary for launched process trees."""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import ClassVar, Final, final, override

from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError
import pywintypes
import win32api
import win32job

from scripts.e2e_scheduler.process_metrics import ProcessResourceUsage
from scripts.e2e_scheduler.windows_process_resources import (
    process_working_set_bytes,
)


WINDOWS_TICKS_PER_SECOND = 10_000_000
JOB_OBJECT_BASIC_AND_IO_ACCOUNTING_INFORMATION: Final = 8
JOB_OBJECT_BASIC_PROCESS_ID_LIST: Final = 3


class _BasicAccounting(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    TotalUserTime: int
    TotalKernelTime: int
    TotalProcesses: int
    ActiveProcesses: int


class _IoAccounting(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    ReadTransferCount: int
    WriteTransferCount: int


class _BasicAndIoAccounting(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    BasicInfo: _BasicAccounting
    IoInfo: _IoAccounting


class _MemoryAccounting(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    PeakJobMemoryUsed: int


_BASIC_ACCOUNTING_ADAPTER: Final = TypeAdapter(_BasicAccounting)
_BASIC_AND_IO_ACCOUNTING_ADAPTER: Final = TypeAdapter(_BasicAndIoAccounting)
_MEMORY_ACCOUNTING_ADAPTER: Final = TypeAdapter(_MemoryAccounting)
_PROCESS_ID_LIST_ADAPTER: Final = TypeAdapter(tuple[int, ...])


@dataclass(slots=True)
class WindowsJobError(OSError):
    operation: str
    error_code: int

    @override
    def __str__(self) -> str:
        return f"Windows Job Object {self.operation} failed with error {self.error_code}"


@dataclass(slots=True)
class WindowsJobAccountingError(OSError):
    operation: str

    @override
    def __str__(self) -> str:
        return f"Windows Job Object {self.operation} returned an invalid accounting payload"


@final
class WindowsJob:
    """Mutable owner of one Windows Job handle until cleanup proof completes."""

    __slots__ = ("_handle", "_observed_peak_processes")

    def __init__(self, handle: int) -> None:
        self._handle = handle
        self._observed_peak_processes = 0

    @classmethod
    def create(cls, name: str = "") -> WindowsJob:
        handle = _create_job(name)
        job = cls(handle)
        try:
            limits = _query_extended_limits(handle)
            limits["BasicLimitInformation"]["LimitFlags"] |= (
                win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            )
            _set_extended_limits(handle, limits)
        except WindowsJobError:
            job.close()
            raise
        return job

    @property
    def handle(self) -> int:
        return int(self._handle)

    def active_processes(self) -> int:
        try:
            accounting = _BASIC_ACCOUNTING_ADAPTER.validate_python(
                win32job.QueryInformationJobObject(
                    self._handle,
                    win32job.JobObjectBasicAccountingInformation,
                )
            )
        except pywintypes.error as error:
            raise _job_error("QueryInformationJobObject", error) from error
        except ValidationError as error:
            raise WindowsJobAccountingError("QueryInformationJobObject") from error
        active_processes = accounting.ActiveProcesses
        self._observed_peak_processes = max(
            self._observed_peak_processes,
            active_processes,
        )
        return active_processes

    def resource_usage(self) -> ProcessResourceUsage:
        """Snapshot cumulative Job accounting while the handle is still valid."""
        try:
            accounting = _BASIC_AND_IO_ACCOUNTING_ADAPTER.validate_python(
                win32job.__dict__["QueryInformationJobObject"](
                    self._handle,
                    JOB_OBJECT_BASIC_AND_IO_ACCOUNTING_INFORMATION,
                )
            )
            memory = _MEMORY_ACCOUNTING_ADAPTER.validate_python(
                win32job.QueryInformationJobObject(
                    self._handle,
                    win32job.JobObjectExtendedLimitInformation,
                )
            )
        except pywintypes.error as error:
            raise _job_error("QueryInformationJobObject", error) from error
        except ValidationError as error:
            raise WindowsJobAccountingError("QueryInformationJobObject") from error
        basic = accounting.BasicInfo
        io = accounting.IoInfo
        active_processes = basic.ActiveProcesses
        current_working_set_bytes = _current_working_set_bytes(self._handle)
        minimum_historical_peak = 1 if basic.TotalProcesses else 0
        self._observed_peak_processes = max(
            self._observed_peak_processes,
            active_processes,
            minimum_historical_peak,
        )
        return ProcessResourceUsage(
            cpu_seconds=(
                basic.TotalUserTime + basic.TotalKernelTime
            )
            / WINDOWS_TICKS_PER_SECOND,
            read_bytes=io.ReadTransferCount,
            write_bytes=io.WriteTransferCount,
            current_working_set_bytes=current_working_set_bytes,
            peak_working_set_bytes=memory.PeakJobMemoryUsed,
            active_process_count=active_processes,
            peak_process_count=self._observed_peak_processes,
            total_process_count=basic.TotalProcesses,
        )

    def terminate(self) -> None:
        try:
            win32job.TerminateJobObject(self._handle, 1)
        except pywintypes.error as error:
            raise _job_error("TerminateJobObject", error) from error

    def wait_until_empty(self, timeout_seconds: float) -> int:
        deadline = time.monotonic() + max(timeout_seconds, 0.0)
        while True:
            active = self.active_processes()
            if active == 0 or time.monotonic() >= deadline:
                return active
            time.sleep(0.05)

    def close(self) -> None:
        handle = self._handle
        if handle == 0:
            return
        self._handle = 0
        try:
            win32api.CloseHandle(handle)
        except pywintypes.error as error:
            raise _job_error("CloseHandle", error) from error


def _create_job(name: str) -> int:
    try:
        return win32job.CreateJobObject(None, name)
    except pywintypes.error as error:
        raise _job_error("CreateJobObject", error) from error


def _current_working_set_bytes(handle: int) -> int:
    try:
        process_ids = _PROCESS_ID_LIST_ADAPTER.validate_python(
            win32job.__dict__["QueryInformationJobObject"](
                handle,
                JOB_OBJECT_BASIC_PROCESS_ID_LIST,
            )
        )
    except pywintypes.error as error:
        raise _job_error("QueryInformationJobObject", error) from error
    total = 0
    for process_id in process_ids:
        working_set = process_working_set_bytes(process_id)
        if working_set is not None:
            total += working_set
    return total


def _query_extended_limits(handle: int) -> win32job.ExtendedLimitInformation:
    try:
        return win32job.QueryInformationJobObject(
            handle,
            win32job.JobObjectExtendedLimitInformation,
        )
    except pywintypes.error as error:
        raise _job_error("QueryInformationJobObject", error) from error


def _set_extended_limits(
    handle: int,
    limits: win32job.ExtendedLimitInformation,
) -> None:
    try:
        win32job.SetInformationJobObject(
            handle,
            win32job.JobObjectExtendedLimitInformation,
            limits,
        )
    except pywintypes.error as error:
        raise _job_error("SetInformationJobObject", error) from error


def _job_error(operation: str, error: pywintypes.error) -> WindowsJobError:
    return WindowsJobError(operation, error.winerror)
