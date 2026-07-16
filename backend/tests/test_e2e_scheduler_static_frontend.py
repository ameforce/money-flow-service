from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import NoReturn

import pytest

import scripts.e2e_scheduler.capsule_services as services_module
import scripts.e2e_scheduler.processes as process_module
from backend.tests.e2e_scheduler_capsule_fakes import FakeBrowserHandle, FakeProcess
from scripts.e2e_scheduler.browser import BrowserServerHandle
from scripts.e2e_scheduler.capsule_services import CapsuleServices


def test_dynamic_capsules_serve_shared_dist_from_isolated_backend_origins_without_vite(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    browsers = (FakeBrowserHandle(), FakeBrowserHandle())
    available_browsers = iter(browsers)
    orchestrator_processes = iter((FakeProcess(), FakeProcess()))
    orchestrator_calls: list[tuple[str, int, int, bool]] = []
    selected_ports: list[int] = []
    available_ports = iter((8123, 8124))

    def stop_fake_process(process: FakeProcess) -> None:
        process.returncode = 0

    def pick_port() -> int:
        port = next(available_ports)
        selected_ports.append(port)
        return port

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
        return next(available_browsers)

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
    ) -> process_module.OwnedProcess:
        _ = (
            db_url,
            project_root,
            import_allowed_root,
            stdout_path,
            stderr_path,
            defer_port_ownership,
            metrics_recorder,
        )
        orchestrator_calls.append(
            (db_url, backend_port, frontend_port, skip_frontend)
        )
        return process_module.OwnedProcess(next(orchestrator_processes))

    class ForbiddenStaticFrontend:
        @classmethod
        def start(
            cls,
            *,
            repository_root: Path,
            backend_port: int,
            frontend_port: int,
            stdout_path: Path,
            stderr_path: Path,
            stop_requested: Callable[[], bool] = lambda: False,
        ) -> NoReturn:
            _ = (
                cls,
                repository_root,
                backend_port,
                frontend_port,
                stdout_path,
                stderr_path,
                stop_requested,
            )
            raise AssertionError("dynamic capsule started a Vite preview process")

    monkeypatch.setattr(services_module, "pick_free_port", pick_port)
    monkeypatch.setattr(services_module, "start_orchestrator", start_orchestrator)
    monkeypatch.setattr(services_module, "wait_until_up", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(BrowserServerHandle, "start", start_browser)
    monkeypatch.setattr(
        services_module,
        "StaticFrontendHandle",
        ForbiddenStaticFrontend,
        raising=False,
    )
    monkeypatch.setattr(process_module, "port_is_open", lambda _port: False)
    monkeypatch.setattr(process_module, "kill_process_tree", stop_fake_process)

    # When
    first_services = CapsuleServices.start(
        repository_root=tmp_path,
        worker_root=tmp_path / "worker-a",
        database_path=tmp_path / "worker-a.sqlite3",
        logs_root=tmp_path / "worker-a-logs",
    )
    second_services = CapsuleServices.start(
        repository_root=tmp_path,
        worker_root=tmp_path / "worker-b",
        database_path=tmp_path / "worker-b.sqlite3",
        logs_root=tmp_path / "worker-b-logs",
    )

    # Then
    assert selected_ports == [8123, 8124]
    assert orchestrator_calls == [
        (
            f"sqlite:///{(tmp_path / 'worker-a.sqlite3').as_posix()}",
            8123,
            8123,
            True,
        ),
        (
            f"sqlite:///{(tmp_path / 'worker-b.sqlite3').as_posix()}",
            8124,
            8124,
            True,
        ),
    ]
    assert first_services.origin == "http://127.0.0.1:8123"
    assert second_services.origin == "http://127.0.0.1:8124"
    assert first_services.origin != second_services.origin
    assert first_services.close() == ()
    assert second_services.close() == ()
    assert tuple(browser.close_calls for browser in browsers) == (1, 1)
