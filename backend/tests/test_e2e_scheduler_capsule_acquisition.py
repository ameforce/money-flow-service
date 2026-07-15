from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import socket
from typing import NoReturn

import pytest

import scripts.e2e_scheduler.capsule_services as services_module
import scripts.e2e_scheduler.processes as process_module
from backend.tests.e2e_scheduler_capsule_fakes import FakeBrowserHandle, FakeProcess
from scripts.e2e_scheduler.browser import BrowserServerHandle
from scripts.e2e_scheduler.capsule_services import (
    CapsuleServices,
    CapsuleServiceStartError,
)
from scripts.e2e_scheduler.processes import OwnedProcess, OwnedProcessCleanupError


def _ownership_failure(pid: int) -> OwnedProcessCleanupError:
    return OwnedProcessCleanupError(
        pid=pid,
        open_ports=(),
        process_running=True,
        ownership_error="AssignProcessToJobObject failed",
    )


def test_orchestrator_ownership_failure_closes_acquired_browser(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    browser = FakeBrowserHandle()
    acquisition_order: list[str] = []

    def pick_port() -> int:
        acquisition_order.append("port")
        return 8123

    def start_browser(
        *,
        repository_root: Path,
        stdout_path: Path,
        stderr_path: Path,
        endpoint_path: Path,
        temporary_root: Path,
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: object | None = None,
    ) -> FakeBrowserHandle:
        _ = (
            repository_root,
            stdout_path,
            stderr_path,
            endpoint_path,
            temporary_root,
            stop_requested,
            metrics_recorder,
        )
        acquisition_order.append("browser")
        return browser

    def fail_orchestrator(
        db_url: str,
        backend_port: int,
        frontend_port: int,
        *,
        skip_frontend: bool = False,
        project_root: Path | None = None,
        import_allowed_root: Path | None = None,
        stdout_path: Path | None = None,
        stderr_path: Path | None = None,
        defer_port_ownership: bool = False,
        metrics_recorder: object | None = None,
    ) -> NoReturn:
        _ = (
            db_url,
            backend_port,
            frontend_port,
            skip_frontend,
            project_root,
            import_allowed_root,
            stdout_path,
            stderr_path,
            defer_port_ownership,
            metrics_recorder,
        )
        raise _ownership_failure(7201)

    monkeypatch.setattr(services_module, "pick_free_port", pick_port)
    monkeypatch.setattr(BrowserServerHandle, "start", start_browser)
    monkeypatch.setattr(services_module, "start_orchestrator", fail_orchestrator)

    # When / Then
    with pytest.raises(
        CapsuleServiceStartError,
        match="AssignProcessToJobObject failed",
    ):
        _ = CapsuleServices.start(
            repository_root=tmp_path,
            worker_root=tmp_path / "worker",
            database_path=tmp_path / "worker.db",
            logs_root=tmp_path / "logs",
        )

    assert browser.close_calls == 1
    assert acquisition_order == ["browser", "port"]


def test_startup_cancelled_before_acquisition_starts_no_process(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    def fail_browser(
        *,
        repository_root: Path,
        stdout_path: Path,
        stderr_path: Path,
        endpoint_path: Path,
        temporary_root: Path,
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: object | None = None,
    ) -> NoReturn:
        _ = (
            repository_root,
            stdout_path,
            stderr_path,
            endpoint_path,
            temporary_root,
            stop_requested,
            metrics_recorder,
        )
        raise AssertionError("cancelled startup acquired a browser")

    monkeypatch.setattr(BrowserServerHandle, "start", fail_browser)

    # When / Then
    with pytest.raises(CapsuleServiceStartError, match="startup cancelled"):
        _ = CapsuleServices.start(
            repository_root=tmp_path,
            worker_root=tmp_path / "worker",
            database_path=tmp_path / "worker.db",
            logs_root=tmp_path / "logs",
            stop_requested=lambda: True,
        )


def test_backend_bind_exit_retries_with_a_fresh_same_origin_port(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    browser = FakeBrowserHandle()
    first_backend = FakeProcess(returncode=1)
    second_backend = FakeProcess()
    backend_processes = iter((first_backend, second_backend))
    orchestrator_ports: list[tuple[int, int]] = []

    def stop_fake_process(process: FakeProcess) -> None:
        process.returncode = 0

    def start_browser(
        *,
        repository_root: Path,
        stdout_path: Path,
        stderr_path: Path,
        endpoint_path: Path,
        temporary_root: Path,
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: object | None = None,
    ) -> FakeBrowserHandle:
        _ = (
            repository_root,
            stdout_path,
            stderr_path,
            endpoint_path,
            temporary_root,
            stop_requested,
            metrics_recorder,
        )
        return browser

    def start_orchestrator(
        db_url: str,
        backend_port: int,
        frontend_port: int,
        *,
        skip_frontend: bool = False,
        project_root: Path | None = None,
        import_allowed_root: Path | None = None,
        stdout_path: Path | None = None,
        stderr_path: Path | None = None,
        defer_port_ownership: bool = False,
        metrics_recorder: object | None = None,
    ) -> OwnedProcess:
        _ = (
            db_url,
            skip_frontend,
            project_root,
            import_allowed_root,
            stdout_path,
            stderr_path,
            defer_port_ownership,
            metrics_recorder,
        )
        orchestrator_ports.append((backend_port, frontend_port))
        return OwnedProcess(next(backend_processes))

    def ready_or_exited(
        _backend_url: str,
        _frontend_url: str,
        *,
        timeout_sec: float,
        stop_if: Callable[[], bool],
    ) -> bool:
        _ = timeout_sec
        return not stop_if()

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as external_listener:
        external_listener.bind(("127.0.0.1", 0))
        external_listener.listen()
        collision_port = int(external_listener.getsockname()[1])
        replacement_port = services_module.pick_free_port()
        ports = iter((collision_port, replacement_port))
        monkeypatch.setattr(services_module, "pick_free_port", lambda: next(ports))
        monkeypatch.setattr(BrowserServerHandle, "start", start_browser)
        monkeypatch.setattr(services_module, "start_orchestrator", start_orchestrator)
        monkeypatch.setattr(services_module, "wait_until_up", ready_or_exited)
        monkeypatch.setattr(process_module, "kill_process_tree", stop_fake_process)
        monkeypatch.setattr(
            "scripts.e2e_scheduler.processes.port_is_open",
            lambda _port: False,
        )

        # When
        services = CapsuleServices.start(
            repository_root=tmp_path,
            worker_root=tmp_path / "worker",
            database_path=tmp_path / "worker.db",
            logs_root=tmp_path / "logs",
        )

        # Then
        assert orchestrator_ports == [
            (collision_port, collision_port),
            (replacement_port, replacement_port),
        ]
        assert services.backend_port == replacement_port
        assert services.origin == f"http://127.0.0.1:{replacement_port}"
        assert external_listener.getsockname()[1] == collision_port
        assert browser.close_calls == 0
        assert services.close() == ()
        assert browser.close_calls == 1
