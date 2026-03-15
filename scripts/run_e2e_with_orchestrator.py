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


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


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


def start_orchestrator(db_url: str, backend_port: int, frontend_port: int) -> subprocess.Popen:
    env = os.environ.copy()
    env["VITE_BACKEND_ORIGIN"] = f"http://127.0.0.1:{backend_port}"
    env["VITE_DEBUG_TOKEN_OPT_IN"] = "true"
    env["CORS_ORIGINS"] = f"http://127.0.0.1:{frontend_port}"
    # E2E runs must be deterministic regardless of parent shell env.
    env["ENV"] = "test"
    env["AUTH_COOKIE_SECURE"] = "false"
    env["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] = "true"
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
    if os.name == "nt":
        command = ["cmd", "/c", *command]
    return subprocess.Popen(
        command,
        cwd=ROOT,
        env=env,
        creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0),
    )


def run_playwright(frontend_port: int, backend_port: int) -> int:
    env = os.environ.copy()
    env["E2E_BASE_URL"] = f"http://127.0.0.1:{frontend_port}"
    env["E2E_API_BASE_URL"] = f"http://127.0.0.1:{backend_port}"
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

    playwright_command = ["npx", "playwright", "test"]
    if os.name == "nt":
        playwright_command = ["cmd", "/c", "npx", "playwright", "test"]
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


def main() -> int:
    backend_port = pick_free_port()
    frontend_port = pick_free_port()
    backend_health = f"http://127.0.0.1:{backend_port}/healthz"
    frontend_health = f"http://127.0.0.1:{frontend_port}"
    ephemeral_db_path = ROOT / "e2e" / f"e2e_run_{uuid.uuid4().hex}.db"
    db_url = f"sqlite:///./e2e/{ephemeral_db_path.name}"

    print(
        f"[e2e-runner] isolated run -> backend:{backend_port}, frontend:{frontend_port}, db:{ephemeral_db_path.name}",
        flush=True,
    )
    orchestrator_proc = start_orchestrator(db_url, backend_port, frontend_port)
    try:
        if not wait_until_up(backend_health, frontend_health, timeout_sec=180):
            print("[e2e-runner] service startup timed out", flush=True)
            return 1
        return run_playwright(frontend_port, backend_port)
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
