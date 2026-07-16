from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

import scripts.run_e2e_with_orchestrator as e2e_runner
from backend.tests.e2e_scheduler_runner_probes import CapturedCall, DummyProcess
from scripts.e2e_scheduler.processes import OwnedProcess, ProcessLaunch

type SpawnFake = Callable[
    [type[OwnedProcess], ProcessLaunch, tuple[int, ...]],
    OwnedProcess,
]


def _fake_spawn(
    captured: list[CapturedCall],
    pid: int,
) -> SpawnFake:
    def spawn(
        _cls: type[OwnedProcess],
        launch: ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> OwnedProcess:
        assert launch.env is not None
        captured.append(CapturedCall(cmd=list(launch.command), env=dict(launch.env)))
        return OwnedProcess(process=DummyProcess(pid=pid), ports=ports)

    return spawn


def test_start_orchestrator_enforces_deterministic_test_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[CapturedCall] = []

    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")
    monkeypatch.setenv("AUTH_DEBUG_RETURN_VERIFY_TOKEN", "false")
    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(_fake_spawn(captured, 777)))
    proc = e2e_runner.start_orchestrator(
        db_url="sqlite:///./test-runner.db",
        backend_port=1346,
        frontend_port=1347,
    )
    assert proc.pid == 777
    env = captured[0].env
    assert env["ENV"] == "test"
    assert env["AUTH_COOKIE_SECURE"] == "false"
    assert env["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] == "true"
    assert env["REGISTER_RATE_LIMIT_MAX_ATTEMPTS"] == "1000"
    assert env["VITE_BACKEND_ORIGIN"] == "http://127.0.0.1:1346"
    assert env["CORS_ORIGINS"] == "http://127.0.0.1:1347"
    assert env["FRONTEND_BASE_URL"] == "http://127.0.0.1:1347"


def test_start_orchestrator_can_skip_frontend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[CapturedCall] = []

    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(_fake_spawn(captured, 778)))
    _ = e2e_runner.start_orchestrator(
        db_url="sqlite:///./test-runner.db",
        backend_port=1346,
        frontend_port=1346,
        skip_frontend=True,
    )
    assert "--skip-frontend" in captured[0].cmd


def test_dynamic_same_origin_backend_keeps_warm_client_connections(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    captured: list[CapturedCall] = []

    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(_fake_spawn(captured, 779)))
    _ = e2e_runner.start_orchestrator(
        db_url="sqlite:///./test-runner.db",
        backend_port=1346,
        frontend_port=1346,
        skip_frontend=True,
        project_root=tmp_path,
    )

    command = captured[0].cmd
    option_index = command.index("--backend-timeout-keep-alive")
    assert command[option_index + 1] == "120"
