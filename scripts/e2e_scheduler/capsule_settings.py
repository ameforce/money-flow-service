"""Immutable Playwright arguments and runner flags for one capsule."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from scripts.e2e_scheduler.project_profiles import BrowserEngine


@dataclass(frozen=True, slots=True)
class CapsuleSettings:
    playwright_args: tuple[str, ...] = ()
    html_report: bool = False
    project_matrix: bool = False
    include_slow: bool = False
    browser_engines: tuple[BrowserEngine, ...] = ("chromium", "firefox", "webkit")

    def environment(self) -> Mapping[str, str]:
        env: dict[str, str] = {}
        if self.html_report:
            env["E2E_HTML_REPORT"] = "1"
        if self.project_matrix:
            env["E2E_PROJECT_MATRIX"] = "1"
        if self.include_slow:
            env["E2E_INCLUDE_SLOW"] = "1"
        return env
