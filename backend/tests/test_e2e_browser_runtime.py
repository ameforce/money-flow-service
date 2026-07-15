from __future__ import annotations

import os
from pathlib import Path
import subprocess
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field


ROOT = Path(__file__).resolve().parents[2]


class _RuntimeIdentity(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1]
    decision: Literal["system-chrome", "playwright-chromium"]
    channel: str | None
    executable_path: str = Field(min_length=1)
    browser_version: str = Field(min_length=1)


class _LaunchOptions(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    channel: Literal["chrome"]
    executable_path: str = Field(alias="executablePath", min_length=1)


class _ResolvedRuntime(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    decision: Literal["system-chrome"]
    channel: Literal["chrome"]
    executable_path: str = Field(alias="executablePath", min_length=1)
    launch_options: _LaunchOptions = Field(alias="launchOptions")


def test_browser_runtime_identity_resolves_bundled_chromium_once() -> None:
    env = os.environ.copy()
    env["E2E_USE_SYSTEM_CHROME"] = "0"

    completed = subprocess.run(
        ["node", "scripts/e2e_scheduler/browser_runtime_identity.mjs"],
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    identity = _RuntimeIdentity.model_validate_json(completed.stdout)
    assert identity.decision == "playwright-chromium"
    assert identity.channel is None
    assert Path(identity.executable_path).is_file()
    assert identity.browser_version[0].isdigit()


def test_config_and_browser_server_reuse_one_runtime_resolution_rule() -> None:
    config = (ROOT / "playwright.config.js").read_text(encoding="utf-8")
    server = (ROOT / "scripts/e2e_scheduler/browser_server.mjs").read_text(
        encoding="utf-8"
    )

    assert "resolveBrowserRuntime" in config
    assert "resolveBrowserRuntime" in server
    assert "browser_runtime.mjs" in config
    assert "browser_runtime.mjs" in server


def test_system_chrome_records_the_exact_selected_launch_executable() -> None:
    script = r"""
import { resolveBrowserRuntime } from "./scripts/e2e_scheduler/browser_runtime.mjs";
const localAppData = "C:\\Users\\tester\\AppData\\Local";
const installed = new Set([
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${localAppData}\\Google\\Chrome\\Application\\chrome.exe`,
]);
const runtime = resolveBrowserRuntime({
  environment: { LOCALAPPDATA: localAppData },
  platform: "win32",
  fileExists: (candidate) => installed.has(candidate),
});
process.stdout.write(JSON.stringify(runtime));
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    runtime = _ResolvedRuntime.model_validate_json(completed.stdout)
    assert runtime.executable_path == runtime.launch_options.executable_path
