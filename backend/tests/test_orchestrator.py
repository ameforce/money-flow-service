from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import orchestrator


def test_make_backend_env_forces_dev_when_prod_uses_sqlite_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    env = orchestrator.make_backend_env(None)
    assert env["DATABASE_URL"] == "sqlite:///./dev_orchestrator.db"
    assert env["ENV"] == "dev"


def test_make_backend_env_keeps_prod_with_explicit_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENV", "prod")
    monkeypatch.delenv("AUTH_COOKIE_SECURE", raising=False)
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    env = orchestrator.make_backend_env("postgresql://user:pass@127.0.0.1:5432/moneyflow")
    assert env["DATABASE_URL"] == "postgresql://user:pass@127.0.0.1:5432/moneyflow"
    assert env["ENV"] == "prod"
    assert "AUTH_COOKIE_SECURE" not in env


def test_make_backend_env_keeps_production_with_explicit_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENV", "production")
    monkeypatch.delenv("AUTH_COOKIE_SECURE", raising=False)
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    env = orchestrator.make_backend_env("postgresql://user:pass@127.0.0.1:5432/moneyflow")
    assert env["DATABASE_URL"] == "postgresql://user:pass@127.0.0.1:5432/moneyflow"
    assert env["ENV"] == "production"
    assert "AUTH_COOKIE_SECURE" not in env


def test_make_backend_env_sets_insecure_cookie_for_local_non_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ENV", "dev")
    monkeypatch.delenv("AUTH_COOKIE_SECURE", raising=False)
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    env = orchestrator.make_backend_env("sqlite:///./dev.db")
    assert env["AUTH_COOKIE_SECURE"] == "false"


def test_spawn_frontend_injects_backend_origin(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    @dataclass
    class DummyProc:
        pid: int = 1234

    def fake_popen(cmd, **kwargs):  # noqa: ANN001
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return DummyProc()

    monkeypatch.setattr(orchestrator.subprocess, "Popen", fake_popen)
    args = argparse.Namespace(
        frontend_host="127.0.0.1",
        frontend_port=5173,
        backend_host="127.0.0.1",
        backend_port=8123,
    )
    proc = orchestrator.spawn_frontend(args)
    assert getattr(proc, "pid", 0) == 1234
    kwargs = dict(captured.get("kwargs", {}))
    env = dict(kwargs.get("env", {}))
    assert env.get("VITE_BACKEND_ORIGIN") == "http://127.0.0.1:8123"


def test_make_backend_env_keeps_schema_bootstrap_out_of_orchestrator_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SKIP_STARTUP_SCHEMA_BOOTSTRAP", raising=False)
    env = orchestrator.make_backend_env("sqlite:///./tmp.db")
    assert "SKIP_STARTUP_SCHEMA_BOOTSTRAP" not in env


def test_wait_for_backend_ready_probes_localhost_for_wildcard_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class DummyProc:
        returncode = None

        def poll(self):  # noqa: ANN001
            return None

    captured_urls: list[str] = []

    def fake_is_http_ready(url: str) -> bool:
        captured_urls.append(url)
        return True

    monkeypatch.setattr(orchestrator, "is_http_ready", fake_is_http_ready)
    ready = orchestrator.wait_for_backend_ready(DummyProc(), "0.0.0.0", 8123, timeout_sec=1)
    assert ready is True
    assert captured_urls == ["http://127.0.0.1:8123/healthz"]

