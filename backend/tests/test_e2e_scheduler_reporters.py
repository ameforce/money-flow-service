from __future__ import annotations

from pathlib import Path

import pytest

from scripts.e2e_scheduler.reporters import (
    ReporterOptionError,
    resolve_reporters,
)


def test_reporter_resolution_preserves_equals_and_split_builtin_values() -> None:
    # Given
    playwright_args = (
        "e2e/specs/auth.spec.js",
        "--reporter=line,json",
        "--headed",
        "--reporter",
        "dot",
    )

    # When
    resolved = resolve_reporters(playwright_args, include_html=False)

    # Then
    assert resolved.playwright_args == (
        "e2e/specs/auth.spec.js",
        "--headed",
        "--reporter=line,json,dot",
    )


def test_reporter_resolution_adds_json_and_html_with_job_output_namespace(
    tmp_path: Path,
) -> None:
    # Given
    output_dir = tmp_path / "run-a" / "worker-1" / "job-1" / "html-report"

    # When
    resolved = resolve_reporters(("--reporter=html",), include_html=True)
    environment = resolved.environment(output_dir)

    # Then
    assert resolved.playwright_args == ("--reporter=html,json",)
    assert environment == {
        "PLAYWRIGHT_HTML_OUTPUT_DIR": str(output_dir),
        "PLAYWRIGHT_HTML_OPEN": "never",
    }


def test_internal_runtime_reporter_is_appended_after_supported_reporters(
    tmp_path: Path,
) -> None:
    # Given
    reporter = tmp_path / "runtime-profile-reporter.mjs"
    resolved = resolve_reporters(("--reporter=line",), include_html=False)

    # When
    args = resolved.with_internal_reporter(reporter)

    # Then
    assert args == (
        f"--reporter=line,json,{reporter.resolve().as_posix()}",
    )


@pytest.mark.parametrize(
    "playwright_args",
    [
        ("--reporter=./custom-reporter.js",),
        ("--reporter", "../reporters/custom.mjs"),
        ("--reporter=",),
        ("--reporter",),
    ],
)
def test_reporter_resolution_rejects_noncanonical_or_missing_values(
    playwright_args: tuple[str, ...],
) -> None:
    # When / Then
    with pytest.raises(ReporterOptionError, match="reporter"):
        _ = resolve_reporters(playwright_args, include_html=False)
