from __future__ import annotations

from pathlib import Path
import json
import os
import subprocess
from types import SimpleNamespace
from typing import Any

import pytest

import scripts.e2e_scheduler.subprocess_visibility as visibility


def test_hidden_creationflags_adds_no_window_on_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(
        visibility,
        "os",
        SimpleNamespace(name="nt", environ=os.environ),
    )
    monkeypatch.setattr(
        visibility.subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False
    )

    # When / Then
    assert visibility.hidden_creationflags(0x20) == (0x08000000 | 0x20)


def test_run_hidden_passes_windows_visibility_options(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(
        visibility,
        "os",
        SimpleNamespace(name="nt", environ=os.environ),
    )
    monkeypatch.setattr(
        visibility.subprocess, "CREATE_NO_WINDOW", 0x08000000, raising=False
    )
    monkeypatch.setattr(
        visibility.subprocess, "STARTF_USESHOWWINDOW", 0x1, raising=False
    )
    monkeypatch.setattr(visibility.subprocess, "SW_HIDE", 0, raising=False)

    class FakeStartupInfo:
        def __init__(self, *, dwFlags: int, wShowWindow: int) -> None:
            self.dwFlags = dwFlags
            self.wShowWindow = wShowWindow

    monkeypatch.setattr(
        visibility.subprocess, "STARTUPINFO", FakeStartupInfo, raising=False
    )

    def fake_run(command: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        calls.append({"command": command, **kwargs})
        return subprocess.CompletedProcess(command, 0, stdout="ok")

    monkeypatch.setattr(visibility.subprocess, "run", fake_run)

    # When
    completed = visibility.run_hidden(["node", "--version"], cwd=tmp_path)

    # Then
    assert completed.returncode == 0
    assert calls[0]["creationflags"] & 0x08000000
    assert calls[0]["startupinfo"].dwFlags & 0x1
    assert calls[0]["startupinfo"].wShowWindow == 0


def test_hidden_node_environment_injects_preload_on_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(
        visibility,
        "os",
        SimpleNamespace(name="nt", environ=os.environ),
    )

    # When
    env = visibility.with_hidden_node_children(
        {"NODE_OPTIONS": "--trace-warnings"}
    )

    # Then
    preload = visibility.WINDOWS_NODE_PRELOAD.resolve().as_posix()
    assert env["NODE_OPTIONS"] == f"--trace-warnings --require={preload}"


def test_windows_node_preload_forces_hidden_child_processes() -> None:
    # Given
    preload = visibility.WINDOWS_NODE_PRELOAD.resolve()
    probe = r"""
const childProcess = require("node:child_process");
Object.defineProperty(process, "platform", { value: "win32" });
const calls = [];
for (const method of ["spawn", "spawnSync", "execFileSync"]) {
  childProcess[method] = (...args) => {
    calls.push({ method, args });
    return { method };
  };
}
require(process.argv[1]);
childProcess.spawn("tool", ["arg"], { windowsHide: false });
childProcess.spawnSync("tool", { windowsHide: false });
childProcess.execFileSync("tool", ["arg"], { windowsHide: false });
process.stdout.write(JSON.stringify(calls));
""".strip()

    # When
    env = os.environ.copy()
    env.pop("NODE_OPTIONS", None)
    completed = subprocess.run(
        ["node", "--eval", probe, str(preload)],
        cwd=visibility.WINDOWS_NODE_PRELOAD.parents[2],
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        creationflags=visibility.hidden_creationflags(),
        startupinfo=visibility.hidden_startupinfo(),
    )

    # Then
    assert completed.returncode == 0, completed.stderr
    calls = json.loads(completed.stdout)
    assert calls[0]["args"][2]["windowsHide"] is True
    assert calls[1]["args"][1]["windowsHide"] is True
    assert calls[2]["args"][2]["windowsHide"] is True
