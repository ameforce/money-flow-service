from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import subprocess

import pytest

import scripts.run_e2e_with_orchestrator as e2e_runner
from scripts.e2e_scheduler.benchmark_collect_models import Profiles


ROOT = Path(__file__).resolve().parents[2]
PROFILE_REPORTER = ROOT / "scripts/e2e_scheduler/benchmark_profile_reporter.mjs"


@dataclass(frozen=True, slots=True)
class _Call:
    command: tuple[str, ...]
    environment: dict[str, str]


@dataclass(frozen=True, slots=True)
class _Result:
    returncode: int = 0


def test_benchmark_opt_in_adds_isolated_json_reporter_without_normal_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    captured: list[_Call] = []

    def fake_run_hidden(cmd: list[str], *, cwd: Path, env: dict[str, str]) -> _Result:
        _ = cwd
        captured.append(_Call(tuple(cmd), dict(env)))
        _ = (tmp_path / "benchmark.png").write_bytes(b"png")
        return _Result()

    report = tmp_path / "legacy-playwright.json"
    expectations = tmp_path / "legacy-evidence.jsonl"
    profile = tmp_path / "legacy-profiles.json"
    monkeypatch.setenv("E2E_BENCHMARK_PLAYWRIGHT_JSON_FILE", str(report))
    monkeypatch.setenv("E2E_BENCHMARK_EVIDENCE_EXPECTATIONS_FILE", str(expectations))
    monkeypatch.setenv("E2E_BENCHMARK_PROFILE_FILE", str(profile))
    monkeypatch.setattr(e2e_runner, "SCREENSHOT_DIR", tmp_path)
    monkeypatch.setattr(e2e_runner, "SCREENSHOT_MANIFEST", tmp_path / "latest-run.json")

    def empty_environment() -> dict[str, str]:
        return {}

    monkeypatch.setattr(e2e_runner, "with_local_playwright_runtime", empty_environment)
    monkeypatch.setattr(e2e_runner, "run_hidden", fake_run_hidden)

    result = e2e_runner.run_playwright(5173, 8000)

    assert result == 0
    command = captured[0].command
    assert any(argument.startswith("--reporter=json,") for argument in command)
    assert captured[0].environment["PLAYWRIGHT_JSON_OUTPUT_FILE"] == str(report)
    assert captured[0].environment["E2E_EVIDENCE_EXPECTATIONS_FILE"] == str(
        expectations
    )
    assert captured[0].environment["E2E_BENCHMARK_PROFILE_FILE"] == str(profile)


def test_benchmark_profile_reporter_matches_collector_viewport_schema(
    tmp_path: Path,
) -> None:
    output = tmp_path / "profiles.json"
    env = os.environ.copy()
    env.update(
        {
            "E2E_PROJECT_MATRIX": "1",
            "E2E_BENCHMARK_PROFILE_FILE": str(output),
        }
    )
    command = [
        "npx",
        "playwright",
        "test",
        "e2e/specs/client-version.spec.js",
        "--project=desktop-chromium",
        "--list",
        f"--reporter={PROFILE_REPORTER.resolve().as_posix()}",
    ]
    if os.name == "nt":
        command = ["cmd", "/c", *command]

    completed = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    assert completed.returncode == 0, completed.stderr
    profiles = Profiles.model_validate_json(output.read_bytes()).profiles
    assert tuple(
        (profile.name, profile.browser, profile.viewport) for profile in profiles
    ) == (("desktop-chromium", "chromium", (1280, 720)),)
