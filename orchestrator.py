from __future__ import annotations

import argparse
import contextlib
from datetime import datetime
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
from typing import Sequence
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent
IS_WINDOWS = os.name == "nt"
NEW_PROCESS_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
SHUTDOWN_REQUESTED = False
SHUTDOWN_SIGNAL: int | None = None
ANSI_RESET = "\x1b[0m"
LOG_LABEL_COLOR = {
    "backend": "\x1b[36m",
    "frontend": "\x1b[35m",
    "orchestrator": "\x1b[33m",
}


def _is_color_enabled() -> bool:
    if str(os.environ.get("NO_COLOR", "")).strip():
        return False
    if str(os.environ.get("FORCE_COLOR", "")).strip():
        return True
    return bool(getattr(sys.stdout, "isatty", lambda: False)())


COLOR_ENABLED = _is_color_enabled()


def request_shutdown(signum: int, _frame: object) -> None:
    global SHUTDOWN_REQUESTED, SHUTDOWN_SIGNAL
    if SHUTDOWN_REQUESTED:
        return
    SHUTDOWN_REQUESTED = True
    SHUTDOWN_SIGNAL = signum
    print(f"\n[orchestrator] shutdown signal received(signum={signum})", flush=True)


def install_signal_handlers() -> None:
    signal.signal(signal.SIGINT, request_shutdown)
    if IS_WINDOWS and hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, request_shutdown)


def run_cmd(cmd: Sequence[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> int:
    proc = subprocess.Popen(cmd, cwd=cwd or ROOT, env=env or os.environ.copy())
    return proc.wait()


def ensure_frontend_deps() -> None:
    node_modules = ROOT / "frontend" / "node_modules"
    if node_modules.exists():
        return
    print("[orchestrator] frontend/node_modules missing -> run npm install", flush=True)
    frontend_install_cmd = ["npm", "install", "--prefix", "frontend"]
    if IS_WINDOWS:
        frontend_install_cmd = ["cmd", "/c", "npm", "install", "--prefix", "frontend"]
    code = run_cmd(frontend_install_cmd)
    if code != 0:
        raise SystemExit(code)


def make_backend_env(database_url: str | None) -> dict[str, str]:
    env = os.environ.copy()
    env_name = str(env.get("ENV", "")).strip().lower()
    if not env_name:
        env["ENV"] = "dev"
        env_name = "dev"
    is_production_env = env_name in {"prod", "production"}
    if not env.get("SECRET_KEY"):
        env["SECRET_KEY"] = secrets.token_urlsafe(48)
        print("[orchestrator] SECRET_KEY not set -> generated ephemeral key for local run", flush=True)
    if database_url:
        env["DATABASE_URL"] = database_url
    elif not env.get("DATABASE_URL"):
        # Local development fallback if PostgreSQL is not configured.
        env["DATABASE_URL"] = "sqlite:///./dev_orchestrator.db"
        if is_production_env:
            # sqlite fallback is for local runs only; avoid prod-mode validation mismatch.
            env["ENV"] = "dev"
            print("[orchestrator] ENV=production with sqlite fallback -> forcing ENV=dev", flush=True)
        print(f"[orchestrator] DATABASE_URL not set -> using {env['DATABASE_URL']}", flush=True)
    effective_env_name = str(env.get("ENV", "")).strip().lower()
    if not env.get("AUTH_COOKIE_SECURE") and effective_env_name not in {"prod", "production"}:
        # Local HTTP dev runner: keep cookies usable without forcing users to edit env.
        env["AUTH_COOKIE_SECURE"] = "false"
    return env


def spawn_backend(args: argparse.Namespace, backend_env: dict[str, str]) -> subprocess.Popen:
    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--app-dir",
        "backend",
        "--host",
        args.backend_host,
        "--port",
        str(args.backend_port),
        "--use-colors",
    ]
    if not args.no_reload:
        backend_cmd.append("--reload")
    print("[orchestrator] backend start:", " ".join(backend_cmd), flush=True)
    creationflags = NEW_PROCESS_GROUP if IS_WINDOWS else 0
    return subprocess.Popen(
        backend_cmd,
        cwd=ROOT,
        env=backend_env,
        creationflags=creationflags,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )


def spawn_frontend(args: argparse.Namespace) -> subprocess.Popen:
    frontend_cmd = [
        "npm",
        "run",
        "dev",
        "--prefix",
        "frontend",
        "--",
        "--strictPort",
        "--host",
        args.frontend_host,
        "--port",
        str(args.frontend_port),
    ]
    if IS_WINDOWS:
        frontend_cmd = ["cmd", "/c", *frontend_cmd]
    print("[orchestrator] frontend start:", " ".join(frontend_cmd), flush=True)
    creationflags = NEW_PROCESS_GROUP if IS_WINDOWS else 0
    frontend_env = os.environ.copy()
    frontend_env["VITE_BACKEND_ORIGIN"] = f"http://{args.backend_host}:{args.backend_port}"
    frontend_env.pop("NO_COLOR", None)
    frontend_env.setdefault("FORCE_COLOR", "1")
    return subprocess.Popen(
        frontend_cmd,
        cwd=ROOT,
        env=frontend_env,
        creationflags=creationflags,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )


def start_log_pump(proc: subprocess.Popen, name: str) -> threading.Thread | None:
    if proc.stdout is None:
        return None

    def safe_write(text: str) -> None:
        try:
            sys.stdout.write(text)
        except UnicodeEncodeError:
            encoded = text.encode(sys.stdout.encoding or "utf-8", errors="replace")
            sys.stdout.buffer.write(encoded)
        sys.stdout.flush()

    def format_line(raw_line: str) -> str:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        label = f"[{name}]"
        if COLOR_ENABLED:
            color = LOG_LABEL_COLOR.get(name, "")
            if color:
                label = f"{color}{label}{ANSI_RESET}"
        text = raw_line.rstrip("\r\n")
        return f"{timestamp} {label} {text}\n"

    def pump() -> None:
        try:
            for line in proc.stdout:
                safe_write(format_line(line))
        except Exception as exc:  # noqa: BLE001
            safe_write(format_line(f"log pump error: {exc}"))

    thread = threading.Thread(target=pump, name=f"{name}-log-pump", daemon=True)
    thread.start()
    return thread


def is_http_ready(url: str) -> bool:
    try:
        with urlopen(url, timeout=1.5) as response:  # noqa: S310
            return 200 <= response.status < 300
    except URLError:
        return False
    except Exception:
        return False


def normalize_probe_host(host: str) -> str:
    if host in {"0.0.0.0", "::"}:
        return "127.0.0.1"
    return host


def is_tcp_port_open(host: str, port: int) -> bool:
    probe_host = normalize_probe_host(host)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5)
            return sock.connect_ex((probe_host, port)) == 0
    except Exception:
        return False


def wait_for_ports_closed(targets: list[tuple[str, int]], timeout_sec: int = 15) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        still_open = [(host, port) for host, port in targets if is_tcp_port_open(host, port)]
        if not still_open:
            return
        time.sleep(0.2)
    remaining = ", ".join([f"{normalize_probe_host(host)}:{port}" for host, port in targets if is_tcp_port_open(host, port)])
    if remaining:
        print(f"[orchestrator] warning: ports still open after shutdown wait -> {remaining}", flush=True)


def ensure_required_ports_available(targets: list[tuple[str, int, str]]) -> bool:
    # Prevent false-readiness by failing fast when required ports are already occupied.
    unavailable: list[tuple[str, int, str]] = []
    for host, port, label in targets:
        if is_tcp_port_open(host, port):
            unavailable.append((host, port, label))
    if not unavailable:
        return True

    print("[orchestrator] required port is already in use.", flush=True)
    for host, port, label in unavailable:
        probe_host = normalize_probe_host(host)
        print(f"  - {label}: {probe_host}:{port}", flush=True)
        if IS_WINDOWS:
            print(f"    check: cmd /c netstat -ano | findstr :{port}", flush=True)
    print("[orchestrator] stop existing process or run with different ports.", flush=True)
    return False


def wait_for_backend_ready(backend_proc: subprocess.Popen, host: str, port: int, timeout_sec: int = 60) -> bool:
    probe_host = normalize_probe_host(host)
    health_url = f"http://{probe_host}:{port}/healthz"
    if probe_host == host:
        print(f"[orchestrator] waiting backend ready: {health_url}", flush=True)
    else:
        print(
            f"[orchestrator] waiting backend ready: {health_url} (bind={host})",
            flush=True,
        )
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if SHUTDOWN_REQUESTED:
            print("[orchestrator] backend readiness cancelled by shutdown signal", flush=True)
            return False
        if backend_proc.poll() is not None:
            print(f"[orchestrator] backend exited before ready(code={backend_proc.returncode})", flush=True)
            return False
        if is_http_ready(health_url):
            print("[orchestrator] backend is ready", flush=True)
            return True
        time.sleep(0.25)
    print("[orchestrator] backend readiness timeout", flush=True)
    return False


def terminate(proc: subprocess.Popen | None, name: str) -> None:
    if proc is None or proc.poll() is not None:
        return
    print(f"[orchestrator] terminate {name}(pid={proc.pid})", flush=True)
    if IS_WINDOWS:
        # Ctrl+C in interactive console can race with uv/cmd signal handling.
        # Force tree kill to avoid delayed child logs printing after prompt.
        if SHUTDOWN_SIGNAL == signal.SIGINT:
            subprocess.run(
                ["cmd", "/c", "taskkill", "/PID", str(proc.pid), "/T", "/F"],
                cwd=ROOT,
                check=False,
            )
            with contextlib.suppress(Exception):
                proc.wait(timeout=5)
            return

        with contextlib.suppress(Exception):
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=8)
        if proc.poll() is None:
            subprocess.run(
                ["cmd", "/c", "taskkill", "/PID", str(proc.pid), "/T", "/F"],
                cwd=ROOT,
                check=False,
            )
        with contextlib.suppress(Exception):
            proc.wait(timeout=5)
        return

    try:
        proc.send_signal(signal.SIGINT)
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
        proc.wait(timeout=5)


def wait_loop(backend_proc: subprocess.Popen, frontend_proc: subprocess.Popen) -> int:
    while not SHUTDOWN_REQUESTED:
        backend_code = backend_proc.poll()
        frontend_code = frontend_proc.poll()

        if backend_code is not None:
            print(f"[orchestrator] backend exited(code={backend_code}) -> cleanup frontend", flush=True)
            terminate(frontend_proc, "frontend")
            return int(backend_code)
        if frontend_code is not None:
            print(f"[orchestrator] frontend exited(code={frontend_code}) -> cleanup backend", flush=True)
            terminate(backend_proc, "backend")
            return int(frontend_code)
        time.sleep(0.5)

    print("[orchestrator] shutdown requested -> cleanup all", flush=True)
    terminate(frontend_proc, "frontend")
    terminate(backend_proc, "backend")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run backend and frontend together.")
    parser.add_argument("--backend-host", default="127.0.0.1")
    parser.add_argument("--backend-port", type=int, default=8000)
    parser.add_argument("--frontend-host", default="0.0.0.0")
    parser.add_argument("--frontend-port", type=int, default=5173)
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--reload", dest="no_reload", action="store_false")
    parser.add_argument("--no-reload", dest="no_reload", action="store_true")
    parser.set_defaults(no_reload=True)
    parser.add_argument("--skip-frontend-install", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    backend_proc: subprocess.Popen | None = None
    frontend_proc: subprocess.Popen | None = None
    backend_log_thread: threading.Thread | None = None
    frontend_log_thread: threading.Thread | None = None
    install_signal_handlers()
    try:
        if not ensure_required_ports_available(
            [
                (args.backend_host, args.backend_port, "backend"),
                (args.frontend_host, args.frontend_port, "frontend"),
            ]
        ):
            return 1
        if not args.skip_frontend_install:
            ensure_frontend_deps()
        backend_env = make_backend_env(args.database_url)
        backend_proc = spawn_backend(args, backend_env)
        backend_log_thread = start_log_pump(backend_proc, "backend")
        if not wait_for_backend_ready(backend_proc, args.backend_host, args.backend_port):
            return 0 if SHUTDOWN_REQUESTED else 1
        frontend_proc = spawn_frontend(args)
        frontend_log_thread = start_log_pump(frontend_proc, "frontend")
        return wait_loop(backend_proc, frontend_proc)
    finally:
        terminate(frontend_proc, "frontend")
        terminate(backend_proc, "backend")
        if frontend_proc is not None and frontend_proc.stdout is not None:
            with contextlib.suppress(Exception):
                frontend_proc.stdout.close()
        if backend_proc is not None and backend_proc.stdout is not None:
            with contextlib.suppress(Exception):
                backend_proc.stdout.close()
        if frontend_log_thread is not None:
            frontend_log_thread.join(timeout=2)
        if backend_log_thread is not None:
            backend_log_thread.join(timeout=2)
        if frontend_proc is not None or backend_proc is not None:
            wait_for_ports_closed(
                [
                    (args.frontend_host, args.frontend_port),
                    (args.backend_host, args.backend_port),
                ]
            )


if __name__ == "__main__":
    raise SystemExit(main())
