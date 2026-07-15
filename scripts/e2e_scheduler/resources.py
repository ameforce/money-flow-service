"""Pure adaptive-capacity policy and private Windows system sampler."""

from __future__ import annotations

import ctypes
import os
import time
from ctypes import wintypes
from dataclasses import dataclass
from typing import final, override


@dataclass(frozen=True, slots=True)
class AdaptivePolicyConfigError(ValueError):
    """Raised when adaptive policy bounds or cooldown are invalid."""

    minimum: int
    maximum: int
    cooldown_seconds: float

    @override
    def __str__(self) -> str:
        return (
            "adaptive policy requires "
            "4 <= minimum <= maximum <= 10 and cooldown_seconds >= 0; "
            f"got minimum={self.minimum}, maximum={self.maximum}, "
            f"cooldown_seconds={self.cooldown_seconds}"
        )


@dataclass(frozen=True, slots=True)
class CapacityOutOfBoundsError(ValueError):
    """Raised when current capacity is outside policy bounds."""

    current: int
    minimum: int
    maximum: int

    @override
    def __str__(self) -> str:
        return (
            f"current capacity {self.current} must be within "
            f"[{self.minimum}, {self.maximum}]"
        )


@dataclass(frozen=True, slots=True)
class ResourceSample:
    """Signals used for one adaptive scheduler capacity decision."""

    cpu_percent: float
    available_memory_percent: float
    backend_p95_ms: float
    recent_worker_crashes: int
    recent_unexpected_failures: int


@dataclass(frozen=True, slots=True)
class AdaptivePolicy:
    """Move scheduler capacity by at most one within configured bounds."""

    minimum: int = 4
    maximum: int = 10
    cooldown_seconds: float = 60.0

    def __post_init__(self) -> None:
        if (
            not 4 <= self.minimum <= self.maximum <= 10
            or self.cooldown_seconds < 0
        ):
            raise AdaptivePolicyConfigError(
                minimum=self.minimum,
                maximum=self.maximum,
                cooldown_seconds=self.cooldown_seconds,
            )

    def next_capacity(
        self,
        current: int,
        sample: ResourceSample,
        elapsed_seconds: float,
        *,
        pressure_streak: int = 0,
        healthy_streak: int = 0,
        expansion_allowed: bool = True,
    ) -> int:
        """Return the next capacity without mutating policy state."""
        if not self.minimum <= current <= self.maximum:
            raise CapacityOutOfBoundsError(
                current=current,
                minimum=self.minimum,
                maximum=self.maximum,
            )
        immediate_reduction = (
            sample.available_memory_percent < 15.0
            or sample.backend_p95_ms > 750.0
            or sample.recent_worker_crashes > 0
            or sample.recent_unexpected_failures > 0
        )
        sustained_pressure = (
            sample.cpu_percent >= 92.0
            and sample.available_memory_percent < 20.0
            and sample.backend_p95_ms > 500.0
            and pressure_streak >= 2
        )
        if immediate_reduction or sustained_pressure:
            return max(self.minimum, current - 1)
        healthy = (
            sample.cpu_percent <= 75.0
            and sample.available_memory_percent >= 25.0
            and sample.backend_p95_ms <= 350.0
        )
        if (
            expansion_allowed
            and healthy
            and healthy_streak >= 3
            and elapsed_seconds >= self.cooldown_seconds
        ):
            return min(self.maximum, current + 1)
        return current


@dataclass(frozen=True, slots=True)
class SystemResourceSample:
    cpu_percent: float
    available_memory_percent: float


@dataclass(frozen=True, slots=True)
class _WindowsSamplingError(OSError):
    """Raised when a required Windows system counter cannot be read."""

    operation: str
    error_code: int

    @override
    def __str__(self) -> str:
        return f"{self.operation} failed with Windows error {self.error_code}"


@final
class _MemoryStatus(ctypes.Structure):
    ullTotalPhys: int
    ullAvailPhys: int

    _fields_ = [
        ("dwLength", wintypes.DWORD),
        ("dwMemoryLoad", wintypes.DWORD),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]

    def __init__(self) -> None:
        super().__init__()
        self.ullTotalPhys = 0
        self.ullAvailPhys = 0


@final
class _WindowsSystemSampler:
    """Read host CPU and memory through standard-library Windows APIs."""

    __slots__ = ("_interval_seconds",)

    def __init__(self, interval_seconds: float = 0.1) -> None:
        self._interval_seconds = interval_seconds

    def sample(self) -> SystemResourceSample:
        """Sample CPU over the configured interval and current free memory."""
        if os.name != "nt":
            raise _WindowsSamplingError(
                operation="WindowsSystemSampler unsupported platform",
                error_code=0,
            )
        idle_before, kernel_before, user_before = self._read_cpu_times()
        time.sleep(self._interval_seconds)
        idle_after, kernel_after, user_after = self._read_cpu_times()
        idle_delta = idle_after - idle_before
        total_delta = (
            kernel_after - kernel_before + user_after - user_before
        )
        cpu_percent = 0.0
        if total_delta > 0:
            cpu_percent = 100.0 * (total_delta - idle_delta) / total_delta
        return SystemResourceSample(
            cpu_percent=min(100.0, max(0.0, cpu_percent)),
            available_memory_percent=self._read_available_memory_percent(),
        )

    @staticmethod
    def _read_cpu_times() -> tuple[int, int, int]:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        idle = wintypes.FILETIME()
        kernel = wintypes.FILETIME()
        user = wintypes.FILETIME()
        if not kernel32.GetSystemTimes(
            ctypes.byref(idle),
            ctypes.byref(kernel),
            ctypes.byref(user),
        ):
            raise _WindowsSamplingError(
                operation="GetSystemTimes",
                error_code=ctypes.get_last_error(),
            )
        return (
            _filetime_value(idle),
            _filetime_value(kernel),
            _filetime_value(user),
        )

    @staticmethod
    def _read_available_memory_percent() -> float:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        status = _MemoryStatus()
        status.dwLength = ctypes.sizeof(_MemoryStatus)
        if not kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            raise _WindowsSamplingError(
                operation="GlobalMemoryStatusEx",
                error_code=ctypes.get_last_error(),
            )
        return 100.0 * status.ullAvailPhys / status.ullTotalPhys


WindowsSystemSampler = _WindowsSystemSampler


def _filetime_value(value: wintypes.FILETIME) -> int:
    return (value.dwHighDateTime << 32) | value.dwLowDateTime


__all__ = (
    "AdaptivePolicy",
    "AdaptivePolicyConfigError",
    "CapacityOutOfBoundsError",
    "ResourceSample",
    "SystemResourceSample",
    "WindowsSystemSampler",
)
