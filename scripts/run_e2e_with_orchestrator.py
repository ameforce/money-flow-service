from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import uuid
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = ROOT / "output" / "playwright" / "e2e-flow"
SCREENSHOT_MANIFEST = SCREENSHOT_DIR / "latest-run.json"
LOCAL_PLAYWRIGHT_LIB_DIR = ROOT / ".omx" / "local-libs" / "root" / "usr" / "lib" / "x86_64-linux-gnu"
BROWSER_UNSAFE_PORTS = {
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


def is_browser_unsafe_port(port: int) -> bool:
    return int(port) in BROWSER_UNSAFE_PORTS


def pick_free_port() -> int:
    for _attempt in range(100):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = int(sock.getsockname()[1])
        if not is_browser_unsafe_port(port):
            return port
    raise RuntimeError("failed to pick a browser-safe free port for E2E")


def is_up(url: str) -> bool:
    try:
        with urlopen(url, timeout=2) as response:  # noqa: S310
            return 200 <= response.status < 300
    except URLError:
        return False
    except Exception:
        return False


def wait_until_up(backend_url: str, frontend_url: str, timeout_sec: int = 180) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if is_up(backend_url) and is_up(frontend_url):
            return True
        time.sleep(1)
    return False


def with_local_playwright_runtime(env: dict[str, str] | None = None) -> dict[str, str]:
    resolved_env = dict(env or os.environ.copy())
    if not LOCAL_PLAYWRIGHT_LIB_DIR.is_dir():
        return resolved_env

    existing = str(resolved_env.get("LD_LIBRARY_PATH") or "")
    lib_dir = str(LOCAL_PLAYWRIGHT_LIB_DIR)
    path_parts = [part for part in existing.split(os.pathsep) if part]
    if lib_dir not in path_parts:
        path_parts.insert(0, lib_dir)
    resolved_env["LD_LIBRARY_PATH"] = os.pathsep.join(path_parts)
    return resolved_env


def has_workers_arg(playwright_args: list[str]) -> bool:
    for index, arg in enumerate(playwright_args):
        if arg == "--workers" and index + 1 < len(playwright_args):
            return True
        if arg.startswith("--workers="):
            return True
    return False


def normalize_playwright_args(playwright_args: list[str], *, cap_windows_workers: bool = True) -> list[str]:
    resolved_args = list(playwright_args)
    if cap_windows_workers and os.name == "nt" and not has_workers_arg(resolved_args):
        # The local Windows dev server is less stable under Playwright's default
        # CPU-count worker fanout. Keep explicit caller choices intact.
        resolved_args.append("--workers=3")
    return resolved_args


def split_runner_args(args: list[str]) -> tuple[list[str], dict[str, bool]]:
    runner_options = {
        "html_report": False,
        "project_matrix": False,
        "include_slow": False,
    }
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


def build_frontend_for_static(backend_port: int) -> int:
    env = os.environ.copy()
    env["VITE_BACKEND_ORIGIN"] = f"http://127.0.0.1:{backend_port}"
    env["VITE_DEBUG_TOKEN_OPT_IN"] = "true"
    command = ["npm", "run", "frontend:build"]
    if os.name == "nt":
        command = ["cmd", "/c", *command]
    print("[e2e-runner] build frontend for backend static serving", flush=True)
    return int(subprocess.run(command, cwd=ROOT, env=env).returncode)


def start_orchestrator(
    db_url: str,
    backend_port: int,
    frontend_port: int,
    *,
    skip_frontend: bool = False,
) -> subprocess.Popen:
    env = os.environ.copy()
    env["VITE_BACKEND_ORIGIN"] = f"http://127.0.0.1:{backend_port}"
    env["VITE_DEBUG_TOKEN_OPT_IN"] = "true"
    env["CORS_ORIGINS"] = f"http://127.0.0.1:{frontend_port}"
    env["FRONTEND_BASE_URL"] = f"http://127.0.0.1:{frontend_port}"
    # E2E runs must be deterministic regardless of parent shell env.
    env["ENV"] = "test"
    env["AUTH_COOKIE_SECURE"] = "false"
    env["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] = "true"
    # The full Playwright matrix registers many unique users from one loopback IP.
    # Keep production/local defaults intact, but avoid tripping the E2E-only IP guard.
    env["REGISTER_RATE_LIMIT_MAX_ATTEMPTS"] = "1000"
    command = [
        "uv",
        "run",
        "python",
        "orchestrator.py",
        "--backend-host",
        "127.0.0.1",
        "--backend-port",
        str(backend_port),
        "--frontend-host",
        "127.0.0.1",
        "--frontend-port",
        str(frontend_port),
        "--database-url",
        db_url,
        "--no-reload",
    ]
    if skip_frontend:
        command.append("--skip-frontend")
    if os.name == "nt":
        command = ["cmd", "/c", *command]
    return subprocess.Popen(
        command,
        cwd=ROOT,
        env=env,
        creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0),
    )


def run_playwright(
    frontend_port: int,
    backend_port: int,
    playwright_args: list[str] | None = None,
    *,
    cap_windows_workers: bool = True,
    html_report: bool = False,
    project_matrix: bool = False,
    include_slow: bool = False,
) -> int:
    resolved_playwright_args = normalize_playwright_args(
        list(playwright_args or []),
        cap_windows_workers=cap_windows_workers,
    )
    env = with_local_playwright_runtime()
    env["E2E_BASE_URL"] = f"http://127.0.0.1:{frontend_port}"
    env["E2E_API_BASE_URL"] = f"http://127.0.0.1:{backend_port}"
    if html_report:
        env["E2E_HTML_REPORT"] = "1"
    if project_matrix:
        env["E2E_PROJECT_MATRIX"] = "1"
    if include_slow:
        env["E2E_INCLUDE_SLOW"] = "1"
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    for path in SCREENSHOT_DIR.glob("*.png"):
        try:
            path.unlink()
        except Exception:
            pass
    try:
        SCREENSHOT_MANIFEST.unlink()
    except Exception:
        pass

    playwright_command = ["npx", "playwright", "test", *resolved_playwright_args]
    if os.name == "nt":
        playwright_command = ["cmd", "/c", "npx", "playwright", "test", *resolved_playwright_args]
    result = subprocess.run(playwright_command, cwd=ROOT, env=env)
    if int(result.returncode) != 0:
        return int(result.returncode)

    screenshots = list(SCREENSHOT_DIR.glob("*.png"))
    if not screenshots:
        print("[e2e-runner] screenshot capture missing: output/playwright/e2e-flow/*.png", flush=True)
        return 1
    SCREENSHOT_MANIFEST.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(UTC).isoformat(),
                "count": len(screenshots),
                "files": sorted(path.name for path in screenshots),
                "playwright_args": resolved_playwright_args,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"[e2e-runner] screenshot capture: {len(screenshots)} files", flush=True)
    return 0


def kill_process_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        try:
            proc.send_signal(signal.CTRL_BREAK_EVENT)
            proc.wait(timeout=10)
            return
        except Exception:
            pass
        subprocess.run(["cmd", "/c", "taskkill", "/PID", str(proc.pid), "/T", "/F"], check=False)
    else:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def main(argv: list[str] | None = None) -> int:
    playwright_args, runner_options = split_runner_args(list(argv if argv is not None else sys.argv[1:]))
    frontend_mode = resolve_frontend_mode(playwright_args)
    backend_port = pick_free_port()
    frontend_port = backend_port if frontend_mode == "static" else pick_free_port()
    backend_health = f"http://127.0.0.1:{backend_port}/healthz"
    frontend_health = f"http://127.0.0.1:{frontend_port}"
    ephemeral_db_path = ROOT / "e2e" / f"e2e_run_{uuid.uuid4().hex}.db"
    db_url = f"sqlite:///./e2e/{ephemeral_db_path.name}"

    print(
        (
            "[e2e-runner] isolated run -> "
            f"backend:{backend_port}, frontend:{frontend_port}, mode:{frontend_mode}, db:{ephemeral_db_path.name}"
        ),
        flush=True,
    )
    if frontend_mode == "static":
        build_code = build_frontend_for_static(backend_port)
        if build_code != 0:
            return build_code
    orchestrator_proc = start_orchestrator(
        db_url,
        backend_port,
        frontend_port,
        skip_frontend=frontend_mode == "static",
    )
    try:
        if not wait_until_up(backend_health, frontend_health, timeout_sec=180):
            print("[e2e-runner] service startup timed out", flush=True)
            return 1
        return run_playwright(
            frontend_port,
            backend_port,
            playwright_args,
            cap_windows_workers=True,
            html_report=runner_options["html_report"],
            project_matrix=runner_options["project_matrix"],
            include_slow=runner_options["include_slow"],
        )
    finally:
        print("[e2e-runner] stop orchestrator", flush=True)
        kill_process_tree(orchestrator_proc)
        if ephemeral_db_path.exists():
            try:
                ephemeral_db_path.unlink()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
