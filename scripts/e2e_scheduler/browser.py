"""Launch and own one bounded Playwright browser server."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import os
from pathlib import Path
import subprocess
import time
from typing import ClassVar, Self, override
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from scripts.e2e_scheduler.processes import (
    OwnedPopen,
    OwnedProcess,
    OwnedProcessCleanupError,
    ProcessLaunch,
    resolve_dynamic_windows_spawn_mode,
)
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.project_profiles import BrowserEngine
from scripts.e2e_scheduler.runtime_support import with_local_playwright_runtime


@dataclass(frozen=True, slots=True)
class BrowserServerStartError(Exception):
    reason: str

    @override
    def __str__(self) -> str:
        return f"failed to start Playwright browser server: {self.reason}"


class _BrowserEndpoint(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    ws_endpoint: str = Field(alias="wsEndpoint")


@dataclass(frozen=True, slots=True)
class BrowserServerHandle:
    owned_process: OwnedProcess
    ws_endpoint: str

    @classmethod
    def start(
        cls,
        *,
        repository_root: Path,
        stdout_path: Path,
        stderr_path: Path,
        endpoint_path: Path,
        temporary_root: Path,
        engine: BrowserEngine = "chromium",
        endpoint_timeout_seconds: float = 10.0,
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: ProcessMetricsRecorder | None = None,
    ) -> Self:
        script = repository_root / "scripts" / "e2e_scheduler" / "browser_server.mjs"
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_root.mkdir(parents=True, exist_ok=True)
        endpoint_path.unlink(missing_ok=True)
        env = with_local_playwright_runtime()
        env["E2E_BROWSER_ENDPOINT_FILE"] = str(endpoint_path)
        env["E2E_BROWSER_ENGINE"] = engine
        env["TMP"] = str(temporary_root)
        env["TEMP"] = str(temporary_root)
        env["TMPDIR"] = str(temporary_root)
        creationflags, start_new_session = _process_group_options()
        with (
            stdout_path.open("ab") as stdout_file,
            stderr_path.open("ab") as stderr_file,
        ):
            owned = OwnedProcess.spawn(
                ProcessLaunch(
                    ("node", str(script)),
                    cwd=repository_root,
                    env=env,
                    stdin=subprocess.PIPE,
                    stdout=stdout_file,
                    stderr=stderr_file,
                    creationflags=creationflags,
                    start_new_session=start_new_session,
                    role="browser",
                    metrics_recorder=metrics_recorder,
                    windows_spawn_mode=resolve_dynamic_windows_spawn_mode(),
                )
            )
        process = owned.process
        try:
            endpoint, port = _wait_for_endpoint(
                endpoint_path,
                process,
                endpoint_timeout_seconds,
                stop_requested,
            )
        except BrowserServerStartError:
            owned.close()
            raise
        return cls(owned.with_ports((port,)), endpoint)

    def close(self) -> None:
        process = self.owned_process.process
        stdin = process.stdin
        if process.poll() is None and stdin is not None:
            try:
                stdin.close()
                _ = process.wait(timeout=10)
            except (BrokenPipeError, OSError, subprocess.TimeoutExpired) as error:
                try:
                    self.owned_process.close()
                except OwnedProcessCleanupError as cleanup_error:
                    raise cleanup_error from error
            else:
                self.owned_process.close()
        else:
            self.owned_process.close()


def _wait_for_endpoint(
    endpoint_path: Path,
    process: OwnedPopen,
    timeout_seconds: float,
    stop_requested: Callable[[], bool] = lambda: False,
) -> tuple[str, int]:
    deadline = time.monotonic() + max(0.0, timeout_seconds)
    last_read_error: OSError | None = None
    while True:
        if stop_requested():
            raise BrowserServerStartError(reason="endpoint publication cancelled")
        if process.poll() is not None:
            raise BrowserServerStartError(
                reason="process exited before endpoint publication"
            )
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            if last_read_error is not None:
                raise BrowserServerStartError(
                    reason=f"endpoint read timed out: {last_read_error}"
                ) from last_read_error
            raise BrowserServerStartError(reason="endpoint publication timed out")
        if endpoint_path.exists():
            try:
                payload = endpoint_path.read_text(encoding="utf-8")
            except OSError as error:
                last_read_error = error
            else:
                break
        time.sleep(min(0.05, remaining))
    try:
        endpoint = _BrowserEndpoint.model_validate_json(payload).ws_endpoint
        port = urlparse(endpoint).port
    except (ValidationError, ValueError) as error:
        raise BrowserServerStartError(reason=str(error)) from error
    if port is None:
        raise BrowserServerStartError(reason="invalid WebSocket endpoint")
    return endpoint, port


def _process_group_options() -> tuple[int, bool]:
    return (
        subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        os.name != "nt",
    )
