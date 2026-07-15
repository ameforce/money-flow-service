"""Owned child-process termination and port cleanup verification."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
import os
import signal
import socket
import subprocess
import time
from typing import Final, override

from scripts.e2e_scheduler.process_launch import (
    OwnedPopen as OwnedPopen,
    PosixProcessGroupError as PosixProcessGroupError,
    ProcessLaunch as ProcessLaunch,
    ProcessOwnership as ProcessOwnership,
    WindowsSpawnMode as WindowsSpawnMode,
    WindowsSpawnModeError as WindowsSpawnModeError,
    resolve_dynamic_windows_spawn_mode as resolve_dynamic_windows_spawn_mode,
)
from scripts.e2e_scheduler.process_metrics import (
    ProcessMetricsRecorder,
    ProcessRecordingId,
    ProcessResourceUsage,
)

POSIX_SIGTERM: Final = getattr(signal, "SIGTERM", 15)
POSIX_SIGKILL: Final = getattr(signal, "SIGKILL", 9)
PORT_CLOSE_TIMEOUT_SECONDS: Final = 15.0
PORT_CLOSE_POLL_SECONDS: Final = 0.1
OWNED_BOOTSTRAP_EXIT_TIMEOUT_SECONDS: Final = 2.0

@dataclass(slots=True)
class OwnedProcessCleanupError(Exception):
    pid: int
    open_ports: tuple[int, ...]
    process_running: bool
    active_processes: int | None = None
    ownership_error: str | None = None

    @override
    def __str__(self) -> str:
        return (
            f"owned process cleanup failed for pid {self.pid}: "
            f"process_running={self.process_running}, open_ports={self.open_ports}, "
            f"active_processes={self.active_processes}, "
            f"ownership_error={self.ownership_error}"
        )


@dataclass(frozen=True, slots=True)
class OwnedProcess:
    process: OwnedPopen
    ports: tuple[int, ...] = ()
    ownership: ProcessOwnership | None = None
    role: str = "process"
    metrics_recorder: ProcessMetricsRecorder | None = None
    metrics_recording_id: ProcessRecordingId | None = None
    resource_usage_reader: Callable[[], ProcessResourceUsage] | None = None

    @classmethod
    def spawn(
        cls,
        launch: ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> OwnedProcess:
        if os.name == "nt":
            from scripts.e2e_scheduler.windows_process_direct import (
                WindowsDirectProcessSpawnError,
                spawn_direct_in_job,
            )
            from scripts.e2e_scheduler.windows_process_spawn import (
                WindowsProcessSpawnError,
                spawn_in_job,
            )

            spawn = {
                WindowsSpawnMode.BOOTSTRAP: spawn_in_job,
                WindowsSpawnMode.DIRECT: spawn_direct_in_job,
            }[launch.windows_spawn_mode]

            try:
                process, ownership = spawn(launch)
            except (
                WindowsDirectProcessSpawnError,
                WindowsProcessSpawnError,
            ) as error:
                raise OwnedProcessCleanupError(
                    error.pid,
                    (),
                    error.process_running,
                    ownership_error=error.reason,
                ) from error
            recording_id = None
            if launch.metrics_recorder is not None:
                recording_id = launch.metrics_recorder.record_spawn(
                    launch.role,
                    ownership.resource_usage,
                )
            return cls(
                process,
                ports,
                ownership,
                launch.role,
                launch.metrics_recorder,
                recording_id,
                ownership.resource_usage if recording_id is not None else None,
            )
        if not launch.start_new_session:
            raise PosixProcessGroupError(launch.command)
        process: subprocess.Popen[bytes] = subprocess.Popen(
            list(launch.command),
            cwd=launch.cwd,
            env=launch.env,
            stdin=launch.stdin,
            stdout=launch.stdout,
            stderr=launch.stderr,
            creationflags=launch.creationflags,
            start_new_session=launch.start_new_session,
        )
        recording_id = None
        if launch.metrics_recorder is not None:
            recording_id = launch.metrics_recorder.record_spawn(launch.role)
        return cls(
            process,
            ports,
            None,
            launch.role,
            launch.metrics_recorder,
            recording_id,
            None,
        )

    @property
    def pid(self) -> int:
        return self.process.pid

    def with_ports(self, ports: tuple[int, ...]) -> OwnedProcess:
        return replace(self, ports=tuple(sorted(set((*self.ports, *ports)))))

    def request_stop(self) -> None:
        """Stop active work without releasing cleanup ownership."""
        if self.ownership is None:
            kill_process_tree(self.process)
            return
        try:
            self.ownership.terminate()
        except OSError:
            kill_process_tree(self.process)
            raise

    def close(self) -> None:
        """Stop only the recorded process tree and verify its owned ports closed."""
        ownership_error: str | None = None
        active_processes: int | None = None
        resource_usage: ProcessResourceUsage | None = None
        if self.ownership is None:
            try:
                kill_process_tree(self.process)
            except subprocess.TimeoutExpired as error:
                ownership_error = str(error)
        else:
            try:
                active_processes = self.ownership.active_processes()
                if active_processes:
                    self.ownership.terminate()
                active_processes = self.ownership.wait_until_empty(10.0)
            except OSError as error:
                ownership_error = str(error)
            finally:
                if self.resource_usage_reader is not None:
                    try:
                        resource_usage = self.resource_usage_reader()
                    except OSError as error:
                        ownership_error = str(error)
                try:
                    self.ownership.close()
                except OSError as error:
                    ownership_error = str(error)
            _wait_for_owned_bootstrap(self.process)
        if (
            self.metrics_recorder is not None
            and self.metrics_recording_id is not None
        ):
            self.metrics_recorder.record_close(
                self.metrics_recording_id,
                resource_usage,
            )
        open_ports = _wait_for_owned_ports(self.ports)
        process_running = self.process.poll() is None
        if (
            process_running
            or open_ports
            or active_processes not in (None, 0)
            or ownership_error is not None
        ):
            raise OwnedProcessCleanupError(
                self.pid,
                open_ports,
                process_running,
                active_processes,
                ownership_error,
            )


def _wait_for_owned_bootstrap(process: OwnedPopen) -> None:
    if process.poll() is not None:
        return
    try:
        _ = process.wait(timeout=OWNED_BOOTSTRAP_EXIT_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        kill_process_tree(process)


def port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def _wait_for_owned_ports(ports: tuple[int, ...]) -> tuple[int, ...]:
    deadline = time.monotonic() + PORT_CLOSE_TIMEOUT_SECONDS
    while True:
        open_ports = tuple(port for port in sorted(set(ports)) if port_is_open(port))
        if not open_ports or time.monotonic() >= deadline:
            return open_ports
        time.sleep(PORT_CLOSE_POLL_SECONDS)


def kill_process_tree(process: OwnedPopen) -> None:
    """Cooperatively stop, then force only the owned process group if needed."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        _kill_windows_process_tree(process)
        return
    try:
        os.kill(-process.pid, POSIX_SIGTERM)
    except ProcessLookupError:
        return
    try:
        _ = process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.kill(-process.pid, POSIX_SIGKILL)
        except ProcessLookupError:
            return
        _ = process.wait(timeout=10)


def _kill_windows_process_tree(process: OwnedPopen) -> None:
    try:
        process.send_signal(signal.CTRL_BREAK_EVENT)
        _ = process.wait(timeout=10)
    except OSError, subprocess.TimeoutExpired:
        try:
            startup_info = subprocess.STARTUPINFO(
                dwFlags=subprocess.STARTF_USESHOWWINDOW,
                wShowWindow=subprocess.SW_HIDE,
            )
            _ = subprocess.run(
                ["cmd", "/c", "taskkill", "/PID", str(process.pid), "/T", "/F"],
                check=False,
                timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW,
                startupinfo=startup_info,
            )
            _ = process.wait(timeout=5)
        except OSError, subprocess.TimeoutExpired:
            return
