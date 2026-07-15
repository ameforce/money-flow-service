from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

from backend.tests.e2e_scheduler_runner_probes import (
    CapturedCall,
    DummyResult,
    ScreenshotManifest,
    expected_frontend_build_command,
    expected_playwright_command,
    not_found_response,
    ok_response,
)


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import scripts.run_e2e_with_orchestrator as e2e_runner  # noqa: E402
import scripts.e2e_scheduler.legacy_runtime as legacy_runtime  # noqa: E402
import scripts.e2e_scheduler.runtime_support as runtime_support  # noqa: E402
import orchestrator  # noqa: E402
from scripts.verify_e2e_screenshots import verify_screenshot_manifest  # noqa: E402


def test_is_up_accepts_only_2xx(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        runtime_support,
        "urlopen",
        not_found_response,
    )
    assert e2e_runner.is_up("http://127.0.0.1:9999/healthz") is False

    monkeypatch.setattr(
        runtime_support,
        "urlopen",
        ok_response,
    )
    assert e2e_runner.is_up("http://127.0.0.1:9999/healthz") is True


def test_e2e_runner_avoids_browser_unsafe_ports() -> None:
    assert e2e_runner.is_browser_unsafe_port(6665) is True
    assert e2e_runner.is_browser_unsafe_port(6669) is True
    assert e2e_runner.is_browser_unsafe_port(5173) is False


def test_orchestrator_defaults_missing_env_to_local(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
    monkeypatch.setattr(runtime_support, "LOCAL_PLAYWRIGHT_LIB_DIR", local_lib_dir)

    env = e2e_runner.with_local_playwright_runtime({"LD_LIBRARY_PATH": "/existing/lib"})

    parts = env["LD_LIBRARY_PATH"].split(os.pathsep)
    assert parts[0] == str(local_lib_dir)
    assert "/existing/lib" in parts


def test_with_local_playwright_runtime_leaves_env_unchanged_when_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(
        runtime_support,
        "LOCAL_PLAYWRIGHT_LIB_DIR",
        tmp_path / "missing-local-libs",
    )

    env = e2e_runner.with_local_playwright_runtime({"LD_LIBRARY_PATH": "/existing/lib"})

    assert env["LD_LIBRARY_PATH"] == "/existing/lib"


def test_normalize_playwright_args_caps_default_windows_workers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        legacy_runtime,
        "os",
        SimpleNamespace(name="nt", environ=os.environ),
    )

    assert e2e_runner.normalize_playwright_args(["e2e/specs/auth.spec.js"]) == [
        "e2e/specs/auth.spec.js",
        "--workers=3",
    ]
    assert e2e_runner.normalize_playwright_args(
        ["e2e/specs/auth.spec.js"],
        cap_windows_workers=False,
    ) == ["e2e/specs/auth.spec.js"]
    assert e2e_runner.normalize_playwright_args(["--workers=1"]) == ["--workers=1"]
    assert e2e_runner.normalize_playwright_args(["--workers", "2"]) == [
        "--workers",
        "2",
    ]


def test_split_runner_args_removes_runner_only_options() -> None:
    playwright_args, options = e2e_runner.split_runner_args(
        [
            "--project-matrix",
            "e2e/specs/auth.spec.js",
            "--include-slow",
            "--html-report",
            "--workers=2",
        ]
    )

    assert playwright_args == ["e2e/specs/auth.spec.js", "--workers=2"]
    assert options == {
        "html_report": True,
        "project_matrix": True,
        "include_slow": True,
    }


def test_resolve_frontend_mode_uses_static_for_full_windows_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        legacy_runtime,
        "os",
        SimpleNamespace(name="nt", environ=os.environ),
    )
    monkeypatch.delenv("E2E_FRONTEND_MODE", raising=False)

    assert e2e_runner.resolve_frontend_mode([]) == "static"
    assert e2e_runner.resolve_frontend_mode(["e2e/specs/auth.spec.js"]) == "dev"

    monkeypatch.setenv("E2E_FRONTEND_MODE", "dev")
    assert e2e_runner.resolve_frontend_mode([]) == "dev"
    monkeypatch.setenv("E2E_FRONTEND_MODE", "static")
    assert e2e_runner.resolve_frontend_mode(["e2e/specs/auth.spec.js"]) == "static"


def test_build_frontend_for_static_uses_backend_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[CapturedCall] = []

    def fake_run(
        cmd: list[str],
        *,
        cwd: Path,
        env: dict[str, str],
        **_kwargs: object,
    ) -> DummyResult:
        _ = cwd
        captured.append(CapturedCall(cmd=list(cmd), env=dict(env)))
        return DummyResult()

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert e2e_runner.build_frontend_for_static(1818) == 0

    expected_cmd = expected_frontend_build_command()
    assert captured[0].cmd == expected_cmd
    env = captured[0].env
    assert env["VITE_BACKEND_ORIGIN"] == "http://127.0.0.1:1818"
    assert env["VITE_DEBUG_TOKEN_OPT_IN"] == "true"


def test_run_playwright_forwards_focused_args_and_records_manifest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    captured: list[CapturedCall] = []

    def fake_run(
        cmd: list[str],
        *,
        cwd: Path,
        env: dict[str, str],
        **_kwargs: object,
    ) -> DummyResult:
        _ = cwd
        captured.append(CapturedCall(cmd=list(cmd), env=dict(env)))
        _ = (tmp_path / "focused-auth.png").write_bytes(b"png")
        return DummyResult()

    monkeypatch.setattr(e2e_runner, "SCREENSHOT_DIR", tmp_path)
    monkeypatch.setattr(e2e_runner, "SCREENSHOT_MANIFEST", tmp_path / "latest-run.json")
    monkeypatch.setattr(
        e2e_runner,
        "with_local_playwright_runtime",
        lambda: {"LD_LIBRARY_PATH": "/playwright"},
    )
    monkeypatch.setattr(subprocess, "run", fake_run)

    result = e2e_runner.run_playwright(
        frontend_port=5173,
        backend_port=8000,
        playwright_args=["e2e/specs/auth.spec.js", "--project=desktop-chromium"],
    )

    assert result == 0
    expected_cmd, expected_manifest_args = expected_playwright_command(
        ["e2e/specs/auth.spec.js", "--project=desktop-chromium"]
    )
    assert captured[-1].cmd == expected_cmd
    env = captured[-1].env
    assert env["E2E_BASE_URL"] == "http://127.0.0.1:5173"
    assert env["E2E_AUTH_SETUP_MODE"] == "ui"
    assert env["E2E_API_BASE_URL"] == "http://127.0.0.1:8000"

    _ = e2e_runner.run_playwright(
        frontend_port=5173,
        backend_port=8000,
        playwright_args=["e2e/specs/auth.spec.js", "--project=desktop-chromium"],
        html_report=True,
        project_matrix=True,
        include_slow=True,
    )
    env = captured[-1].env
    assert env["E2E_HTML_REPORT"] == "1"
    assert env["E2E_PROJECT_MATRIX"] == "1"
    assert env["E2E_INCLUDE_SLOW"] == "1"

    manifest = ScreenshotManifest.model_validate_json(
        (tmp_path / "latest-run.json").read_bytes()
    )
    assert manifest.count == 1
    assert manifest.files == ["focused-auth.png"]
    assert manifest.playwright_args == expected_manifest_args
    assert verify_screenshot_manifest(tmp_path / "latest-run.json", tmp_path) == 0
