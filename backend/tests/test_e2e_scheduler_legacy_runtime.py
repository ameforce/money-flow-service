from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
from typing import final

import pytest

import scripts.e2e_scheduler.legacy_runtime as runtime
import scripts.run_e2e_with_orchestrator as runner
from scripts.e2e_scheduler.owned_command import OwnedCommandResult
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.processes import (
    OwnedProcess,
    ProcessLaunch,
    WindowsSpawnMode,
)
from scripts.e2e_scheduler.python_startup_environment import with_e2e_python_startup


@final
class FakeProcess:
    pid: int = 7002
    stdin: None = None

    def poll(self) -> int:
        return 0

    def send_signal(self, sig: int) -> None:
        _ = sig

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        return 0


def test_legacy_runtime_preserves_runner_and_playwright_args() -> None:
    # Given
    arguments = [
        "--project-matrix",
        "e2e/specs/auth.spec.js",
        "--include-slow",
        "--html-report",
        "--workers=2",
    ]

    # When
    playwright_args, options = runtime.split_runner_args(arguments)

    # Then
    assert playwright_args == ["e2e/specs/auth.spec.js", "--workers=2"]
    assert options == {
        "html_report": True,
        "project_matrix": True,
        "include_slow": True,
    }


def test_start_orchestrator_creates_posix_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    captured_command: list[str] = []
    captured_creationflags: list[int] = []
    captured_start_new_session: list[bool] = []

    def fake_spawn(
        _cls: type[OwnedProcess],
        launch: ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> OwnedProcess:
        captured_command.extend(launch.command)
        captured_creationflags.append(launch.creationflags)
        captured_start_new_session.append(launch.start_new_session)
        return OwnedProcess(FakeProcess(), ports)

    monkeypatch.setattr(os, "name", "posix")
    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(fake_spawn))

    # When
    _ = runtime.start_orchestrator(
        "sqlite:///capsule.db",
        8123,
        8123,
        skip_frontend=True,
    )

    # Then
    assert captured_creationflags == [0]
    assert captured_start_new_session == [True]
    assert "--skip-frontend" in captured_command


def test_start_orchestrator_uses_current_python_without_shell_or_uv(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_command: list[str] = []

    def fake_spawn(
        _cls: type[OwnedProcess],
        launch: ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> OwnedProcess:
        _ = ports
        captured_command.extend(launch.command)
        return OwnedProcess(FakeProcess())

    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(fake_spawn))

    _ = runtime.start_orchestrator("sqlite:///capsule.db", 8123, 8124)

    assert captured_command[:2] == [sys.executable, "orchestrator.py"]
    assert "cmd" not in captured_command
    assert "uv" not in captured_command


def test_capsule_backend_root_is_captured_without_changing_legacy_defaults(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    captured_environments: list[dict[str, str]] = []
    captured_spawn_modes: list[WindowsSpawnMode] = []

    def fake_spawn(
        _cls: type[OwnedProcess],
        launch: ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> OwnedProcess:
        assert launch.env is not None
        captured_environments.append(dict(launch.env))
        captured_spawn_modes.append(launch.windows_spawn_mode)
        return OwnedProcess(process=FakeProcess(), ports=ports)

    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(fake_spawn))
    repository_root = runtime.ROOT
    worker_root = tmp_path / "runs" / "run-a" / "workers" / "worker-1"

    # When
    _ = runtime.start_orchestrator(
        "sqlite:///capsule.db",
        8123,
        8123,
        project_root=worker_root,
        import_allowed_root=repository_root / "legacy",
        skip_frontend=True,
    )
    _ = runtime.start_orchestrator("sqlite:///legacy.db", 8124, 8124)

    # Then
    capsule_env, legacy_env = captured_environments
    assert captured_spawn_modes == [
        WindowsSpawnMode.DIRECT,
        WindowsSpawnMode.BOOTSTRAP,
    ]
    assert capsule_env["PROJECT_ROOT"] == str(worker_root)
    assert Path(capsule_env["PROJECT_ROOT"]) / "tmp_import_uploads" == (
        worker_root / "tmp_import_uploads"
    )
    assert capsule_env["IMPORT_ALLOWED_ROOT"] == str(repository_root / "legacy")
    expected_temporary_root = str(worker_root / "temporary")
    assert capsule_env["TMP"] == expected_temporary_root
    assert capsule_env["TEMP"] == expected_temporary_root
    assert capsule_env["TMPDIR"] == expected_temporary_root
    assert "PROJECT_ROOT" not in legacy_env or legacy_env[
        "PROJECT_ROOT"
    ] == os.environ.get("PROJECT_ROOT")
    assert "IMPORT_ALLOWED_ROOT" not in legacy_env or legacy_env[
        "IMPORT_ALLOWED_ROOT"
    ] == os.environ.get("IMPORT_ALLOWED_ROOT")
    for variable in ("TMP", "TEMP", "TMPDIR"):
        assert variable not in legacy_env or legacy_env[variable] == os.environ.get(
            variable
        )


def test_e2e_python_startup_overrides_windows_javascript_mime_type(
    tmp_path: Path,
) -> None:
    env = with_e2e_python_startup(os.environ.copy())

    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            "import mimetypes; print(mimetypes.guess_type('bundle.js')[0])",
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )

    assert completed.stdout.strip() == "application/javascript"
    assert Path(env["PYTHONPATH"].split(os.pathsep)[0]) == (
        runtime.ROOT / "scripts" / "e2e_scheduler" / "python_startup"
    )


def test_free_port_error_preserves_runtime_error_contract() -> None:
    assert issubclass(runtime.FreePortError, RuntimeError)


def test_dynamic_frontend_build_uses_accounted_owned_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[ProcessLaunch] = []

    def fake_run_owned(launch: ProcessLaunch) -> OwnedCommandResult:
        captured.append(launch)
        return OwnedCommandResult(0, b"", b"")

    monkeypatch.setattr(runtime, "run_owned_command", fake_run_owned)
    recorder = ProcessMetricsRecorder()

    result = runtime.build_frontend_for_static(
        None,
        metrics_recorder=recorder,
        windows_spawn_mode=WindowsSpawnMode.DIRECT,
    )

    assert result == 0
    assert captured[0].role == "frontend-build"
    assert captured[0].metrics_recorder is recorder
    assert captured[0].windows_spawn_mode is WindowsSpawnMode.DIRECT


def test_runner_reexports_legacy_port_contract() -> None:
    assert runner.BROWSER_UNSAFE_PORTS is runtime.BROWSER_UNSAFE_PORTS
    assert runner.has_workers_arg is runtime.has_workers_arg
