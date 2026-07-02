from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.run_e2e_with_orchestrator as e2e_runner
import orchestrator


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


def test_orchestrator_defaults_missing_env_to_local(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENV", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)

    env = orchestrator.make_backend_env(database_url="sqlite:///./test-local-env.db")

    assert env["ENV"] == "local"


def test_with_local_playwright_runtime_prepends_vendored_lib_dir(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    local_lib_dir = tmp_path / "local-libs"
    local_lib_dir.mkdir()
    monkeypatch.setattr(e2e_runner, "LOCAL_PLAYWRIGHT_LIB_DIR", local_lib_dir)

    env = e2e_runner.with_local_playwright_runtime({"LD_LIBRARY_PATH": "/existing/lib"})

    parts = env["LD_LIBRARY_PATH"].split(":")
    assert parts[0] == str(local_lib_dir)
    assert "/existing/lib" in parts


def test_with_local_playwright_runtime_leaves_env_unchanged_when_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(e2e_runner, "LOCAL_PLAYWRIGHT_LIB_DIR", tmp_path / "missing-local-libs")

    env = e2e_runner.with_local_playwright_runtime({"LD_LIBRARY_PATH": "/existing/lib"})

    assert env["LD_LIBRARY_PATH"] == "/existing/lib"


def test_run_playwright_forwards_focused_args_and_records_manifest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    captured: dict[str, object] = {}

    @dataclass
    class DummyResult:
        returncode: int = 0

    def fake_run(cmd, **kwargs):  # noqa: ANN001
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        (tmp_path / "focused-auth.png").write_bytes(b"png")
        return DummyResult()

    monkeypatch.setattr(e2e_runner, "SCREENSHOT_DIR", tmp_path)
    monkeypatch.setattr(e2e_runner, "SCREENSHOT_MANIFEST", tmp_path / "latest-run.json")
    monkeypatch.setattr(e2e_runner, "with_local_playwright_runtime", lambda: {"LD_LIBRARY_PATH": "/playwright"})
    monkeypatch.setattr(e2e_runner.subprocess, "run", fake_run)

    result = e2e_runner.run_playwright(
        frontend_port=5173,
        backend_port=8000,
        playwright_args=["e2e/specs/auth.spec.js", "--project=desktop-chromium"],
    )

    assert result == 0
    assert captured["cmd"] == [
        "npx",
        "playwright",
        "test",
        "e2e/specs/auth.spec.js",
        "--project=desktop-chromium",
    ]
    env = dict(dict(captured["kwargs"])["env"])
    assert env["E2E_BASE_URL"] == "http://127.0.0.1:5173"
    assert env["E2E_API_BASE_URL"] == "http://127.0.0.1:8000"

    manifest = json.loads((tmp_path / "latest-run.json").read_text(encoding="utf-8"))
    assert manifest["count"] == 1
    assert manifest["files"] == ["focused-auth.png"]
    assert manifest["playwright_args"] == ["e2e/specs/auth.spec.js", "--project=desktop-chromium"]
