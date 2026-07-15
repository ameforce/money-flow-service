from __future__ import annotations

import os
from pathlib import Path
import subprocess
from typing import Any, ClassVar, Literal

import pytest
from pydantic import BaseModel, ConfigDict, Field

import scripts.e2e_scheduler.browser_runtime as browser_runtime
from scripts.e2e_scheduler.browser_runtime import (
    BrowserRuntimeResolutionError,
    resolve_browser_runtime_identity,
)

ROOT = Path(__file__).resolve().parents[2]


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


class _BundledResolvedRuntime(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    decision: Literal["playwright-chromium"]
    channel: None
    executable_path: str = Field(alias="executablePath", min_length=1)
    launch_options: dict[str, object] = Field(alias="launchOptions")


def test_browser_runtime_identity_resolves_bundled_chromium_once() -> None:
    env = os.environ.copy()
    env["E2E_USE_SYSTEM_CHROME"] = "0"

    identity = resolve_browser_runtime_identity(ROOT, env)

    assert identity.decision == "playwright-chromium"
    assert identity.channel is None
    assert Path(identity.executable_path).is_file()
    assert identity.browser_version[0].isdigit()


def test_bundled_runtime_resolution_does_not_require_browser_launch() -> None:
    script = r"""
import { resolveBrowserRuntime } from "./scripts/e2e_scheduler/browser_runtime.mjs";
process.stdout.write(JSON.stringify(resolveBrowserRuntime({
  environment: { E2E_USE_SYSTEM_CHROME: "0" },
  platform: "linux",
  fileExists: () => false,
})));
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    runtime = _BundledResolvedRuntime.model_validate_json(completed.stdout)
    assert runtime.decision == "playwright-chromium"
    assert runtime.channel is None
    assert runtime.launch_options == {}
    assert Path(runtime.executable_path).is_file()


def test_browser_runtime_adapter_applies_local_runtime_and_parses_identity(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    captured: list[dict[str, str]] = []

    def with_runtime(environment: dict[str, str]) -> dict[str, str]:
        return {**environment, "LD_LIBRARY_PATH": "/vendored/playwright/libs"}

    def fake_run(
        _command: list[str],
        **kwargs: Any,
    ) -> subprocess.CompletedProcess[str]:
        captured.append(dict(kwargs["env"]))
        return subprocess.CompletedProcess(
            _command,
            0,
            stdout=(
                '{"version":1,"decision":"playwright-chromium",'
                '"channel":null,"executable_path":"/browser/chromium",'
                '"browser_version":"140.0"}\n'
            ),
            stderr="",
        )

    monkeypatch.setattr(browser_runtime, "with_local_playwright_runtime", with_runtime)
    monkeypatch.setattr(browser_runtime, "run_hidden", fake_run)

    identity = resolve_browser_runtime_identity(tmp_path, {"RUN_ID": "run-1"})

    assert captured == [
        {
            "RUN_ID": "run-1",
            "LD_LIBRARY_PATH": "/vendored/playwright/libs",
        }
    ]
    assert identity.decision == "playwright-chromium"
    assert identity.channel is None
    assert identity.executable_path == "/browser/chromium"
    assert identity.browser_version == "140.0"


@pytest.mark.parametrize(
    ("completed", "match"),
    [
        (subprocess.CompletedProcess(["node"], 1, "", "launch failed"), "launch failed"),
        (subprocess.CompletedProcess(["node"], 0, "not-json", ""), "invalid browser runtime identity"),
    ],
)
def test_browser_runtime_adapter_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    completed: subprocess.CompletedProcess[str],
    match: str,
) -> None:
    monkeypatch.setattr(
        browser_runtime,
        "run_hidden",
        lambda *_args, **_kwargs: completed,
    )

    with pytest.raises(BrowserRuntimeResolutionError, match=match):
        _ = resolve_browser_runtime_identity(tmp_path, {})


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
