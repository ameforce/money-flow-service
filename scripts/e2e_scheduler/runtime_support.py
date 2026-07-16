"""Shared repository paths, health probes, and Playwright process environment."""

from __future__ import annotations

from dataclasses import dataclass
from http.client import HTTPConnection
import os
from pathlib import Path
import time
from collections.abc import Callable
from types import TracebackType
from typing import Self
from urllib.error import URLError
from urllib.parse import urlsplit

from scripts.e2e_scheduler.subprocess_visibility import with_hidden_node_children

ROOT = Path(__file__).resolve().parents[2]
SCREENSHOT_DIR = ROOT / "output" / "playwright" / "e2e-flow"
SCREENSHOT_MANIFEST = SCREENSHOT_DIR / "latest-run.json"
LOCAL_PLAYWRIGHT_LIB_DIR = (
    ROOT / ".omx" / "local-libs" / "root" / "usr" / "lib" / "x86_64-linux-gnu"
)


@dataclass(frozen=True, slots=True)
class _HealthResponse:
    status: int
    connection: HTTPConnection

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        _ = (exc_type, exc_value, traceback)
        self.connection.close()
        return False


def _open_health_url(url: str, *, timeout: float) -> _HealthResponse:
    parsed = urlsplit(url)
    if parsed.scheme != "http" or parsed.hostname is None:
        raise OSError(f"unsupported health URL: {url}")
    connection = HTTPConnection(parsed.hostname, parsed.port, timeout=timeout)
    request_path = parsed.path or "/"
    if parsed.query:
        request_path = f"{request_path}?{parsed.query}"
    try:
        connection.request("GET", request_path)
        response = connection.getresponse()
    except OSError:
        connection.close()
        raise
    return _HealthResponse(status=response.status, connection=connection)


urlopen = _open_health_url


def is_up(url: str) -> bool:
    try:
        with urlopen(url, timeout=2) as response:
            return 200 <= response.status < 300
        return False
    except (OSError, TimeoutError, URLError):
        return False


def wait_until_up(
    backend_url: str,
    frontend_url: str,
    timeout_sec: int = 180,
    *,
    stop_if: Callable[[], bool] | None = None,
) -> bool:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if stop_if is not None and stop_if():
            return False
        if is_up(backend_url) and is_up(frontend_url):
            return True
        time.sleep(0.1)
    return False


def with_local_playwright_runtime(
    env: dict[str, str] | None = None,
) -> dict[str, str]:
    resolved_env = with_hidden_node_children(env or os.environ.copy())
    if not LOCAL_PLAYWRIGHT_LIB_DIR.is_dir():
        return resolved_env
    existing = str(resolved_env.get("LD_LIBRARY_PATH") or "")
    lib_dir = str(LOCAL_PLAYWRIGHT_LIB_DIR)
    path_parts = [part for part in existing.split(os.pathsep) if part]
    if lib_dir not in path_parts:
        path_parts.insert(0, lib_dir)
    resolved_env["LD_LIBRARY_PATH"] = os.pathsep.join(path_parts)
    return resolved_env
