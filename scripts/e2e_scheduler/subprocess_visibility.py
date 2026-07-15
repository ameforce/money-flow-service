"""Windows subprocess visibility helpers for local E2E infrastructure."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
import os
import subprocess
from typing import Final


WINDOWS_NODE_PRELOAD: Final = Path(__file__).with_name(
    "windows_hide_node_children.cjs"
)


def hidden_creationflags(extra_flags: int = 0) -> int:
    """Return Windows flags that prevent transient console windows."""
    if os.name != "nt":
        return extra_flags
    return extra_flags | subprocess.CREATE_NO_WINDOW


def hidden_startupinfo() -> subprocess.STARTUPINFO | None:
    """Return STARTUPINFO that asks Windows to hide any created window."""
    if os.name != "nt":
        return None
    return subprocess.STARTUPINFO(
        dwFlags=subprocess.STARTF_USESHOWWINDOW,
        wShowWindow=subprocess.SW_HIDE,
    )


def with_hidden_node_children(env: Mapping[str, str]) -> dict[str, str]:
    """Preload the Windows policy that hides console-subsystem Node children."""
    resolved = dict(env)
    if os.name != "nt":
        return resolved
    preload = WINDOWS_NODE_PRELOAD.resolve().as_posix()
    existing = str(resolved.get("NODE_OPTIONS") or "").strip()
    if preload in existing:
        return resolved
    require_option = f"--require={preload}"
    resolved["NODE_OPTIONS"] = " ".join(
        part for part in (existing, require_option) if part
    )
    return resolved


def run_hidden(
    command: Sequence[str],
    *,
    cwd: Path,
    env: Mapping[str, str] | None = None,
    capture_output: bool = False,
    text: bool = False,
    encoding: str | None = None,
    errors: str | None = None,
) -> subprocess.CompletedProcess[str] | subprocess.CompletedProcess[bytes]:
    """Run a subprocess without flashing a console window on Windows."""
    resolved_env = with_hidden_node_children(env or os.environ.copy())
    return subprocess.run(
        list(command),
        cwd=cwd,
        env=resolved_env,
        capture_output=capture_output,
        text=text,
        encoding=encoding,
        errors=errors,
        creationflags=hidden_creationflags(),
        startupinfo=hidden_startupinfo(),
    )
