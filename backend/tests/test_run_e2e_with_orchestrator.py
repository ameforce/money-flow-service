from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.run_e2e_with_orchestrator as e2e_runner


class _DummyResponse:
    def __init__(self, status: int) -> None:
        self.status = int(status)

    def __enter__(self) -> "_DummyResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        _ = (exc_type, exc, tb)
        return False


def test_is_up_accepts_only_2xx(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        e2e_runner,
        "urlopen",
        lambda *_args, **_kwargs: _DummyResponse(404),
    )
    assert e2e_runner.is_up("http://127.0.0.1:9999/healthz") is False

    monkeypatch.setattr(
        e2e_runner,
        "urlopen",
        lambda *_args, **_kwargs: _DummyResponse(200),
    )
    assert e2e_runner.is_up("http://127.0.0.1:9999/healthz") is True


def test_start_orchestrator_enforces_deterministic_test_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    @dataclass
    class DummyProc:
        pid: int = 777

    def fake_popen(cmd, **kwargs):  # noqa: ANN001
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return DummyProc()

    monkeypatch.setenv("ENV", "prod")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")
    monkeypatch.setenv("AUTH_DEBUG_RETURN_VERIFY_TOKEN", "false")
    monkeypatch.setattr(e2e_runner.subprocess, "Popen", fake_popen)

    proc = e2e_runner.start_orchestrator(
        db_url="sqlite:///./test-runner.db",
        backend_port=1346,
        frontend_port=1347,
    )
    assert getattr(proc, "pid", 0) == 777

    kwargs = dict(captured.get("kwargs", {}))
    env = dict(kwargs.get("env", {}))
    assert env["ENV"] == "test"
    assert env["AUTH_COOKIE_SECURE"] == "false"
    assert env["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] == "true"
    assert env["VITE_BACKEND_ORIGIN"] == "http://127.0.0.1:1346"
    assert env["CORS_ORIGINS"] == "http://127.0.0.1:1347"

