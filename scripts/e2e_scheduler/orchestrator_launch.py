"""E2E orchestrator process launch configuration."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
from typing import Final

from scripts.e2e_scheduler.process_launch import (
    ProcessLaunch,
    WindowsSpawnMode,
    resolve_dynamic_windows_spawn_mode,
)
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.processes import OwnedProcess
from scripts.e2e_scheduler.python_startup_environment import with_e2e_python_startup


ROOT: Final = Path(__file__).resolve().parents[2]
DYNAMIC_BACKEND_KEEP_ALIVE_SECONDS: Final = 120


def start_orchestrator(
    db_url: str,
    backend_port: int,
    frontend_port: int,
    *,
    skip_frontend: bool = False,
    project_root: Path | None = None,
    import_allowed_root: Path | None = None,
    stdout_path: Path | None = None,
    stderr_path: Path | None = None,
    defer_port_ownership: bool = False,
    metrics_recorder: ProcessMetricsRecorder | None = None,
) -> OwnedProcess:
    env = with_e2e_python_startup(os.environ.copy())
    env.update(
        {
            "VITE_BACKEND_ORIGIN": f"http://127.0.0.1:{backend_port}",
            "VITE_DEBUG_TOKEN_OPT_IN": "true",
            "CORS_ORIGINS": f"http://127.0.0.1:{frontend_port}",
            "FRONTEND_BASE_URL": f"http://127.0.0.1:{frontend_port}",
            "ENV": "test",
            "SECRET_KEY": "test-secret-key-for-e2e-toss-import-1234567890",
            "AUTH_COOKIE_SECURE": "false",
            "AUTH_DEBUG_RETURN_VERIFY_TOKEN": "true",
            "REGISTER_RATE_LIMIT_MAX_ATTEMPTS": "1000",
        }
    )
    if project_root is not None:
        env["PROJECT_ROOT"] = str(project_root)
        temporary_root = project_root / "temporary"
        temporary_root.mkdir(parents=True, exist_ok=True)
        env.update(
            {
                "TMP": str(temporary_root),
                "TEMP": str(temporary_root),
                "TMPDIR": str(temporary_root),
            }
        )
    if import_allowed_root is not None:
        env["IMPORT_ALLOWED_ROOT"] = str(import_allowed_root)
    command = [
        sys.executable,
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
    if project_root is not None and skip_frontend:
        command.extend(
            [
                "--backend-timeout-keep-alive",
                str(DYNAMIC_BACKEND_KEEP_ALIVE_SECONDS),
            ]
        )
    if stdout_path is not None:
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
    if stderr_path is not None:
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
    stdout_file = stdout_path.open("ab") if stdout_path is not None else None
    stderr_file = stderr_path.open("ab") if stderr_path is not None else None
    try:
        ports = (
            ()
            if defer_port_ownership
            else ((backend_port,) if skip_frontend else (backend_port, frontend_port))
        )
        return OwnedProcess.spawn(
            ProcessLaunch(
                tuple(command),
                cwd=ROOT,
                env=env,
                stdout=stdout_file,
                stderr=stderr_file,
                creationflags=(
                    subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
                ),
                start_new_session=os.name != "nt",
                role="orchestrator",
                metrics_recorder=metrics_recorder,
                windows_spawn_mode=(
                    resolve_dynamic_windows_spawn_mode()
                    if project_root is not None and skip_frontend
                    else WindowsSpawnMode.BOOTSTRAP
                ),
            ),
            ports,
        )
    finally:
        if stdout_file is not None:
            stdout_file.close()
        if stderr_file is not None:
            stderr_file.close()
