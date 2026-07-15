"""Synchronous command execution with owned-process cleanup and accounting."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, cast, override

from scripts.e2e_scheduler.process_launch import ProcessLaunch
from scripts.e2e_scheduler.processes import OwnedProcess


class CommunicatingProcess(Protocol):
    def communicate(
        self,
        input: bytes | None = None,
        timeout: float | None = None,
    ) -> tuple[bytes | None, bytes | None]: ...

    def poll(self) -> int | None: ...


@dataclass(slots=True)
class OwnedCommandStateError(Exception):
    command: tuple[str, ...]

    @override
    def __str__(self) -> str:
        return f"owned command did not publish an exit code: {self.command!r}"


@dataclass(frozen=True, slots=True)
class OwnedCommandResult:
    returncode: int
    stdout: bytes
    stderr: bytes


def run_owned_command(launch: ProcessLaunch) -> OwnedCommandResult:
    owned = OwnedProcess.spawn(launch)
    process = cast(CommunicatingProcess, cast(object, owned.process))
    try:
        stdout, stderr = process.communicate()
        returncode = process.poll()
        if returncode is None:
            raise OwnedCommandStateError(launch.command)
        return OwnedCommandResult(returncode, stdout or b"", stderr or b"")
    finally:
        owned.close()
