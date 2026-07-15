"""Public launch contracts and Windows spawn-mode selection."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum, unique
import os
from pathlib import Path
from typing import BinaryIO, Protocol, override

from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder


class ClosableInput(Protocol):
    def close(self) -> None: ...


class OwnedPopen(Protocol):
    pid: int

    @property
    def stdin(self) -> ClosableInput | None: ...

    def poll(self) -> int | None: ...

    def send_signal(self, sig: int) -> None: ...

    def wait(self, timeout: float | None = None) -> int: ...


class ProcessOwnership(Protocol):
    def active_processes(self) -> int: ...

    def terminate(self) -> None: ...

    def wait_until_empty(self, timeout_seconds: float) -> int: ...

    def close(self) -> None: ...


type ProcessStream = int | BinaryIO | None


@unique
class WindowsSpawnMode(StrEnum):
    BOOTSTRAP = "bootstrap"
    DIRECT = "direct"


@dataclass(slots=True)
class WindowsSpawnModeError(ValueError):
    value: str

    @override
    def __str__(self) -> str:
        return (
            "E2E_WINDOWS_SPAWN_MODE must be 'direct' or 'bootstrap', "
            f"got {self.value!r}"
        )


@dataclass(slots=True)
class PosixProcessGroupError(ValueError):
    command: tuple[str, ...]

    @override
    def __str__(self) -> str:
        return "POSIX owned processes require start_new_session=True"


def resolve_dynamic_windows_spawn_mode(
    environment: Mapping[str, str] | None = None,
) -> WindowsSpawnMode:
    """Parse the dynamic scheduler's Windows launch mode at its env boundary."""
    source = os.environ if environment is None else environment
    raw_value = source.get("E2E_WINDOWS_SPAWN_MODE", "direct").strip().lower()
    try:
        return WindowsSpawnMode(raw_value)
    except ValueError as error:
        raise WindowsSpawnModeError(raw_value) from error


@dataclass(frozen=True, slots=True)
class ProcessLaunch:
    command: tuple[str, ...]
    cwd: Path | None = None
    env: Mapping[str, str] | None = None
    stdin: ProcessStream = None
    stdout: ProcessStream = None
    stderr: ProcessStream = None
    creationflags: int = 0
    start_new_session: bool = os.name != "nt"
    role: str = "process"
    metrics_recorder: ProcessMetricsRecorder | None = None
    windows_spawn_mode: WindowsSpawnMode = WindowsSpawnMode.BOOTSTRAP
