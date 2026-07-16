"""Race-free Windows process creation behind a Job-owned bootstrap gate."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Final, Protocol, override
import secrets
import socket
import subprocess
import sys

from pydantic import TypeAdapter

from scripts.e2e_scheduler.windows_job import WindowsJob

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


class _BootstrapProcess(Protocol):
    pid: int

    def poll(self) -> int | None: ...

    def wait(self, timeout: float | None = None) -> int: ...

    def kill(self) -> None: ...


class _JobOwnership(Protocol):
    def terminate(self) -> None: ...

    def wait_until_empty(self, timeout_seconds: float) -> int: ...

    def close(self) -> None: ...


_IPV4_ADDRESS_ADAPTER: Final = TypeAdapter(tuple[str, int])


@dataclass(slots=True)
class WindowsProcessSpawnError(OSError):
    pid: int
    process_running: bool
    reason: str

    @override
    def __str__(self) -> str:
        return f"Windows owned process spawn failed for pid {self.pid}: {self.reason}"


def spawn_in_job(
    launch: ProcessLaunchSpec,
) -> tuple[subprocess.Popen[bytes], WindowsJob]:
    """Block target creation until its bootstrap belongs to the Job Object."""
    token = secrets.token_hex(32)
    job_name = f"money-flow-e2e-{token}"
    ownership = WindowsJob.create(job_name)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as gate:
        gate.bind(("127.0.0.1", 0))
        gate.listen(1)
        gate.settimeout(10.0)
        host, port = _IPV4_ADDRESS_ADAPTER.validate_python(gate.getsockname())
        bootstrap = Path(__file__).with_name("windows_process_bootstrap.py")
        creationflags = launch.creationflags | subprocess.CREATE_NO_WINDOW
        command = [
            sys.executable,
            str(bootstrap),
            str(host),
            str(port),
            token,
            job_name,
            str(creationflags),
            *launch.command,
        ]
        try:
            startup_info = subprocess.STARTUPINFO(
                dwFlags=subprocess.STARTF_USESHOWWINDOW,
                wShowWindow=subprocess.SW_HIDE,
            )
            process: subprocess.Popen[bytes] = subprocess.Popen(
                command,
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
            connection = gate.accept()[0]
            with connection:
                connection.settimeout(10.0)
                handshake = _read_handshake(connection)
                if handshake != token:
                    raise WindowsProcessSpawnError(
                        process.pid,
                        process.poll() is None,
                        "bootstrap ownership handshake mismatch",
                    )
                connection.sendall(b"1")
        except (OSError, UnicodeError) as error:
            raise _spawn_error_after_cleanup(process, ownership, error) from error
    return process, ownership


def _read_handshake(connection: socket.socket) -> str:
    payload = bytearray()
    while len(payload) <= 128:
        chunk = connection.recv(1)
        if not chunk or chunk == b"\n":
            break
        payload.extend(chunk)
    return payload.decode()


def _spawn_error_after_cleanup(
    process: _BootstrapProcess,
    ownership: _JobOwnership,
    error: OSError | UnicodeError,
) -> WindowsProcessSpawnError:
    cleanup_error = _stop_failed_bootstrap(process, ownership)
    reason = str(error)
    if cleanup_error is not None:
        reason = f"{reason}; cleanup failed: {cleanup_error}"
    return WindowsProcessSpawnError(
        process.pid,
        process.poll() is None,
        reason,
    )


def _stop_failed_bootstrap(
    process: _BootstrapProcess,
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
    try:
        _ = process.wait(timeout=5.0)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            _ = process.wait(timeout=5.0)
        except subprocess.TimeoutExpired as error:
            cleanup_error = str(error)
    return cleanup_error
