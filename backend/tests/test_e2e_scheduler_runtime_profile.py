from __future__ import annotations

import os
from pathlib import Path
import subprocess

import pytest

from scripts.e2e_scheduler.runtime_profile import (
    RuntimeProfileError,
    parse_runtime_profile,
)


ROOT = Path(__file__).resolve().parents[2]
REPORTER = ROOT / "scripts" / "e2e_scheduler" / "runtime_profile_reporter.mjs"


@pytest.mark.parametrize(
    ("project", "browser", "viewport", "spec"),
    [
        ("desktop-chromium", "chromium", (1280, 720), "client-version.spec.js"),
        ("tablet-chromium", "chromium", (834, 1194), "client-version.spec.js"),
        ("mobile-chromium", "chromium", (393, 727), "client-version.spec.js"),
        ("matrix-chromium", "chromium", (1280, 720), "mobile-browser-matrix.spec.js"),
        ("matrix-firefox", "firefox", (1280, 720), "mobile-browser-matrix.spec.js"),
        ("matrix-webkit", "webkit", (1280, 720), "mobile-browser-matrix.spec.js"),
    ],
)
def test_internal_reporter_records_resolved_playwright_project_profile(
    tmp_path: Path,
    project: str,
    browser: str,
    viewport: tuple[int, int],
    spec: str,
) -> None:
    # Given
    output = tmp_path / "runtime-profile.json"
    env = os.environ.copy()
    env.update(
        {
            "E2E_PROJECT_MATRIX": "1",
            "E2E_RUNTIME_PROFILE_FILE": str(output),
        }
    )

    # When
    command = [
        "npx",
        "playwright",
        "test",
        f"e2e/specs/{spec}",
        f"--project={project}",
        "--list",
        f"--reporter={REPORTER.resolve().as_posix()}",
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

    # Then
    assert completed.returncode == 0, completed.stderr
    profile = parse_runtime_profile(output)
    assert profile.project == project
    assert profile.browser == browser
    assert profile.viewport == viewport


@pytest.mark.parametrize("content", [None, "{", '{"version":1}'])
def test_runtime_profile_parser_fails_closed(
    tmp_path: Path,
    content: str | None,
) -> None:
    # Given
    path = tmp_path / "runtime-profile.json"
    if content is not None:
        _ = path.write_text(content, encoding="utf-8")

    # When / Then
    with pytest.raises(RuntimeProfileError):
        _ = parse_runtime_profile(path)
