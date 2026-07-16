from __future__ import annotations

from pathlib import Path
from typing import ClassVar

import pytest
from pydantic import BaseModel, ConfigDict

import scripts.e2e_scheduler.runner as runner_module
import scripts.run_e2e_with_orchestrator as e2e_runner
from backend.tests.e2e_scheduler_runner_fakes import (
    FakeRuntime,
    make_test,
)
from scripts.e2e_scheduler.model import RunId
from scripts.e2e_scheduler.runner import run_dynamic
from scripts.e2e_scheduler.runner_cli import run_cli
from scripts.e2e_scheduler.runner_options import RunnerOptions


class _ManifestLabel(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    benchmark_label: str


@pytest.mark.parametrize("workers", [4, 10])
def test_fixed_scheduler_workers_accept_public_bounds(workers: int) -> None:
    options = e2e_runner.parse_runner_options(
        ["--project-matrix", f"--scheduler-workers={workers}"]
    )
    assert options.scheduler_workers == workers


@pytest.mark.parametrize("workers", [0, 1, 3, 11])
def test_scheduler_workers_stay_within_public_bounds(workers: int) -> None:
    with pytest.raises(e2e_runner.RunnerOptionError, match="4..10"):
        _ = e2e_runner.parse_runner_options(
            ["--project-matrix", f"--scheduler-workers={workers}"]
        )


@pytest.mark.parametrize("workers", [1, 3])
def test_scheduler_smoke_workers_accept_diagnostic_bounds(workers: int) -> None:
    options = e2e_runner.parse_runner_options(
        ["--project-matrix", f"--scheduler-smoke-workers={workers}"]
    )
    assert options.scheduler_workers == workers
    assert options.scheduler_smoke_workers == workers


@pytest.mark.parametrize("workers", [0, 4, 11])
def test_scheduler_smoke_workers_reject_values_outside_diagnostic_bounds(
    workers: int,
) -> None:
    with pytest.raises(e2e_runner.RunnerOptionError, match="1..3"):
        _ = e2e_runner.parse_runner_options(
            ["--project-matrix", f"--scheduler-smoke-workers={workers}"]
        )


def test_scheduler_worker_modes_are_mutually_exclusive() -> None:
    with pytest.raises(e2e_runner.RunnerOptionError, match="cannot be combined"):
        _ = e2e_runner.parse_runner_options(
            [
                "--project-matrix",
                "--scheduler-workers=4",
                "--scheduler-smoke-workers=2",
            ]
        )


@pytest.mark.parametrize(
    "args",
    [
        ["--browser=chromium"],
        ["--browser", "chromium"],
        ["--debug"],
        ["--global-timeout=1000"],
        ["--global-timeout", "1000"],
        ["--last-failed"],
        ["--list"],
        ["--max-failures=2"],
        ["--max-failures", "2"],
        ["-x"],
        ["--output=artifacts"],
        ["--repeat-each", "2"],
        ["--retries=1"],
        ["--shard", "1/2"],
        ["--test-list=list.txt"],
        ["--test-list-invert", "skip.txt"],
        ["--ui"],
        ["--ui-host=127.0.0.1"],
        ["--ui-port", "0"],
        ["--workers=2"],
        ["-j", "2"],
    ],
)
def test_dynamic_mode_rejects_incompatible_playwright_options_before_build(
    monkeypatch: pytest.MonkeyPatch,
    args: list[str],
) -> None:
    monkeypatch.setenv("E2E_RUNNER_MODE", "dynamic")
    build_events: list[str] = []

    def fake_dynamic(
        _options: RunnerOptions,
        _playwright_args: tuple[str, ...],
    ) -> int:
        build_events.append("build")
        return 0

    monkeypatch.setattr(runner_module, "run_dynamic", fake_dynamic)
    return_code = run_cli(["--project-matrix", *args], lambda _options: 0)
    assert return_code == 2
    assert build_events == []


def test_dynamic_mode_routes_filters_only_to_discovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("E2E_RUNNER_MODE", "dynamic")
    options = e2e_runner.parse_runner_options(
        [
            "--project-matrix",
            "e2e/specs/auth.spec.js",
            "--project=desktop-chromium",
            "-g",
            "logs in",
            "--grep-invert=slow",
            "--only-changed",
            "origin/develop",
            "--config=playwright.config.js",
            "--timeout",
            "90000",
            "--trace=retain-on-failure",
            "--forbid-only",
            "--fail-on-flaky-tests",
            "--no-deps",
            "--quiet",
        ],
        platform_name="nt",
    )
    assert options.discovery_args == (
        "e2e/specs/auth.spec.js",
        "--project=desktop-chromium",
        "-g",
        "logs in",
        "--grep-invert=slow",
        "--only-changed",
        "origin/develop",
        "--config=playwright.config.js",
    )
    assert options.job_args == (
        "--config=playwright.config.js",
        "--timeout",
        "90000",
        "--trace=retain-on-failure",
        "--forbid-only",
        "--fail-on-flaky-tests",
        "--no-deps",
        "--quiet",
        "--reporter=json",
    )


@pytest.mark.parametrize(
    "args",
    [
        ["--config=alternate.playwright.config.js"],
        ["--config", "alternate.playwright.config.js"],
        ["-c", "alternate.playwright.config.js"],
    ],
)
def test_dynamic_mode_rejects_alternate_playwright_config_before_build(
    monkeypatch: pytest.MonkeyPatch,
    args: list[str],
) -> None:
    monkeypatch.setenv("E2E_RUNNER_MODE", "dynamic")
    build_events: list[str] = []

    def fake_dynamic(
        _options: RunnerOptions,
        _playwright_args: tuple[str, ...],
    ) -> int:
        build_events.append("build")
        return 0

    monkeypatch.setattr(runner_module, "run_dynamic", fake_dynamic)
    return_code = run_cli(["--project-matrix", *args], lambda _options: 0)
    assert return_code == 2
    assert build_events == []


def test_benchmark_label_is_persisted_from_cli_in_immutable_manifest(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("E2E_RUNNER_MODE", "dynamic")
    runtime = FakeRuntime(tmp_path, (make_test(1),))
    options = e2e_runner.parse_runner_options(
        ["--project-matrix", "--benchmark-label=candidate-a"],
        platform_name="nt",
    )
    return_code = run_dynamic(options, (), runtime=runtime)
    payload = _ManifestLabel.model_validate_json(
        runtime.manifest_path(RunId("run-test")).read_text(encoding="utf-8")
    )
    assert return_code == 0
    assert payload.benchmark_label == "candidate-a"


def test_fixed_dynamic_rejects_non_windows_before_runtime_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("E2E_RUNNER_MODE", "dynamic")

    with pytest.raises(e2e_runner.RunnerOptionError, match="requires Windows"):
        _ = e2e_runner.parse_runner_options(
            ["--project-matrix"],
            platform_name="posix",
        )
