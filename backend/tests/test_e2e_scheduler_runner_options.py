from __future__ import annotations

import pytest

from scripts.e2e_scheduler.runner_options import (
    RunnerMode,
    RunnerOptionError,
    parse_runner_options,
)


def test_npm_separator_is_consumed_before_runner_and_playwright_options() -> None:
    options = parse_runner_options(
        [
            "--project-matrix",
            "--",
            "--legacy-runner",
            "auth.spec.js",
            "--project=desktop-chromium",
        ]
    )

    assert options.mode is RunnerMode.LEGACY
    assert options.playwright_args == (
        "auth.spec.js",
        "--project=desktop-chromium",
    )


def test_only_first_separator_is_consumed() -> None:
    options = parse_runner_options(
        [
            "--project-matrix",
            "--legacy-runner",
            "--",
            "auth.spec.js",
            "--",
            "--grep",
            "literal",
        ]
    )

    assert options.playwright_args == (
        "auth.spec.js",
        "--",
        "--grep",
        "literal",
    )


@pytest.mark.parametrize(
    "option",
    ["--headed", "--fully-parallel", "--pass-with-no-tests"],
)
def test_dynamic_mode_rejects_playwright_flags_that_lose_semantics(
    monkeypatch: pytest.MonkeyPatch,
    option: str,
) -> None:
    # Given
    monkeypatch.setenv("E2E_RUNNER_MODE", "dynamic")

    # When / Then
    with pytest.raises(
        RunnerOptionError,
        match=rf"{option}.*--legacy-runner",
    ):
        _ = parse_runner_options(["--project-matrix", option])


def test_legacy_mode_forwards_dynamic_incompatible_flags_unchanged() -> None:
    # Given
    playwright_flags = (
        "--headed",
        "--fully-parallel",
        "--pass-with-no-tests",
    )

    # When
    options = parse_runner_options(
        ["--project-matrix", "--legacy-runner", *playwright_flags]
    )

    # Then
    assert options.mode is RunnerMode.LEGACY
    assert options.playwright_args == playwright_flags
