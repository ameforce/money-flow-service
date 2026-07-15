"""Stable legacy runner argument, port, build, and orchestrator launch helpers."""

from __future__ import annotations

from dataclasses import dataclass
import os
import socket
from typing import Final, TypedDict, override

from pydantic import TypeAdapter

from scripts.e2e_scheduler.orchestrator_launch import (
    ROOT as ROOT,
    start_orchestrator as start_orchestrator,
)
from scripts.e2e_scheduler.owned_command import run_owned_command
from scripts.e2e_scheduler.process_launch import ProcessLaunch, WindowsSpawnMode
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.subprocess_visibility import (
    run_hidden,
    with_hidden_node_children,
)


BROWSER_UNSAFE_PORTS: Final = {
    1,
    7,
    9,
    11,
    13,
    15,
    17,
    19,
    20,
    21,
    22,
    23,
    25,
    37,
    42,
    43,
    53,
    69,
    77,
    79,
    87,
    95,
    101,
    102,
    103,
    104,
    109,
    110,
    111,
    113,
    115,
    117,
    119,
    123,
    135,
    137,
    139,
    143,
    161,
    179,
    389,
    427,
    465,
    512,
    513,
    514,
    515,
    526,
    530,
    531,
    532,
    540,
    548,
    554,
    556,
    563,
    587,
    601,
    636,
    989,
    990,
    993,
    995,
    1719,
    1720,
    1723,
    2049,
    3659,
    4045,
    5060,
    5061,
    6000,
    6566,
    6697,
    10080,
    *range(6665, 6670),
}
_IPV4_ADDRESS_ADAPTER: Final = TypeAdapter(tuple[str, int])


class RunnerOptions(TypedDict):
    html_report: bool
    project_matrix: bool
    include_slow: bool


@dataclass(frozen=True, slots=True)
class FreePortError(RuntimeError):
    attempts: int

    @override
    def __str__(self) -> str:
        return f"failed to pick a browser-safe free port after {self.attempts} attempts"


def is_browser_unsafe_port(port: int) -> bool:
    return int(port) in BROWSER_UNSAFE_PORTS


def pick_free_port() -> int:
    for _attempt in range(100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = _IPV4_ADDRESS_ADAPTER.validate_python(sock.getsockname())[1]
        if not is_browser_unsafe_port(port):
            return port
    raise FreePortError(attempts=100)


def has_workers_arg(playwright_args: list[str]) -> bool:
    for index, arg in enumerate(playwright_args):
        if arg == "--workers" and index + 1 < len(playwright_args):
            return True
        if arg.startswith("--workers="):
            return True
    return False


def normalize_playwright_args(
    playwright_args: list[str],
    *,
    cap_windows_workers: bool = True,
) -> list[str]:
    resolved_args = list(playwright_args)
    if cap_windows_workers and os.name == "nt" and not has_workers_arg(resolved_args):
        resolved_args.append("--workers=3")
    return resolved_args


def split_runner_args(args: list[str]) -> tuple[list[str], RunnerOptions]:
    runner_options = RunnerOptions(
        html_report=False,
        project_matrix=False,
        include_slow=False,
    )
    playwright_args: list[str] = []
    for arg in args:
        if arg == "--html-report":
            runner_options["html_report"] = True
            continue
        if arg == "--project-matrix":
            runner_options["project_matrix"] = True
            continue
        if arg == "--include-slow":
            runner_options["include_slow"] = True
            continue
        playwright_args.append(arg)
    return playwright_args, runner_options


def resolve_frontend_mode(playwright_args: list[str]) -> str:
    explicit_mode = str(os.environ.get("E2E_FRONTEND_MODE", "")).strip().lower()
    if explicit_mode in {"dev", "static"}:
        return explicit_mode
    if os.name == "nt" and not playwright_args:
        return "static"
    return "dev"


def build_frontend_for_static(
    backend_port: int | None,
    *,
    metrics_recorder: ProcessMetricsRecorder | None = None,
    windows_spawn_mode: WindowsSpawnMode = WindowsSpawnMode.BOOTSTRAP,
) -> int:
    env = os.environ.copy()
    if backend_port is not None:
        env["VITE_BACKEND_ORIGIN"] = f"http://127.0.0.1:{backend_port}"
    env["VITE_DEBUG_TOKEN_OPT_IN"] = "true"
    command = ["npm", "run", "frontend:build"]
    if os.name == "nt":
        command = ["cmd", "/c", *command]
    print("[e2e-runner] build frontend for backend static serving", flush=True)
    if metrics_recorder is not None:
        return run_owned_command(
            ProcessLaunch(
                tuple(command),
                cwd=ROOT,
                env=with_hidden_node_children(env),
                role="frontend-build",
                metrics_recorder=metrics_recorder,
                windows_spawn_mode=windows_spawn_mode,
            )
        ).returncode
    return int(run_hidden(command, cwd=ROOT, env=env).returncode)
