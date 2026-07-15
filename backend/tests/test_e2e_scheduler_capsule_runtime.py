from __future__ import annotations

from collections.abc import Callable, Mapping
from io import BufferedWriter
from pathlib import Path
import json
import subprocess
from typing import NoReturn, cast, final

import pytest

import scripts.e2e_scheduler.capsule as capsule_module
import scripts.e2e_scheduler.capsule_services as services_module
import scripts.e2e_scheduler.processes as process_module
from backend.tests.e2e_scheduler_capsule_fakes import (
    FakeBrowserHandle,
    FakeProcess,
)
from backend.tests.test_e2e_scheduler_capsule import make_job
from scripts.e2e_scheduler.browser import BrowserServerHandle
from scripts.e2e_scheduler.capsule import WorkerCapsule
from scripts.e2e_scheduler.capsule_settings import CapsuleSettings
from scripts.e2e_scheduler.model import JobId, RunId, WorkerId

type RunKwarg = Mapping[str, str] | BufferedWriter | Path | str | bool | int | None


@final
class InterruptingJobProcess:
    pid = 7002
    stdin = None

    def poll(self) -> int | None:
        return None

    def send_signal(self, sig: int) -> None:
        _ = sig

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        raise KeyboardInterrupt


def test_capsule_keeps_services_warm_and_namespaces_each_job(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    process = FakeProcess()
    browser = FakeBrowserHandle()
    start_calls: list[tuple[str, int, int, bool]] = []
    browser_calls: list[tuple[Path, Path, Path, Path, Path]] = []
    commands: list[list[str]] = []
    environments: list[dict[str, str]] = []
    resets: list[Path] = []
    closed_job_pids: list[int] = []
    job_process = FakeProcess(returncode=0)
    job_process.pid = 7002

    def fake_start_orchestrator(
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
        metrics_recorder: object | None = None,
    ) -> process_module.OwnedProcess:
        _ = metrics_recorder
        start_calls.append((db_url, backend_port, frontend_port, skip_frontend))
        assert project_root == capsule.worker_root
        assert import_allowed_root == capsule.repository_root / "legacy"
        assert stdout_path == capsule.logs_root / "orchestrator.stdout.log"
        assert stderr_path == capsule.logs_root / "orchestrator.stderr.log"
        assert defer_port_ownership is True
        return process_module.OwnedProcess(process, (backend_port,))

    def fake_browser_start(
        *,
        repository_root: Path,
        stdout_path: Path,
        stderr_path: Path,
        endpoint_path: Path,
        temporary_root: Path,
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: object | None = None,
    ) -> FakeBrowserHandle:
        _ = (stop_requested, metrics_recorder)
        browser_calls.append(
            (
                repository_root,
                stdout_path,
                stderr_path,
                endpoint_path,
                temporary_root,
            )
        )
        return browser

    def fake_spawn(
        _cls: type[process_module.OwnedProcess],
        launch: process_module.ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> process_module.OwnedProcess:
        commands.append(list(launch.command))
        env = dict(cast(Mapping[str, str], launch.env))
        environments.append(env)
        auth_metrics_path = Path(env["E2E_AUTH_SETUP_METRICS_FILE"])
        auth_metrics_path.parent.mkdir(parents=True, exist_ok=True)
        _ = auth_metrics_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "kind": "auth_setup",
                    "mode": "api",
                    "duration_ms": 250.0,
                    "status": "passed",
                }
            )
            + "\n",
            encoding="utf-8",
        )
        _ = (Path(env["TMP"]) / "temporary.txt").write_text(
            "temporary", encoding="utf-8"
        )
        _ = (capsule.uploads_root / env["E2E_JOB_ID"] / "upload.txt").write_text(
            "upload", encoding="utf-8"
        )
        capsule.backend_upload_root.mkdir(parents=True, exist_ok=True)
        _ = (capsule.backend_upload_root / "backend-upload.tmp").write_text(
            "upload", encoding="utf-8"
        )
        _ = cast(BufferedWriter, launch.stdout).write(b"job stdout")
        _ = cast(BufferedWriter, launch.stderr).write(b"job stderr")
        return process_module.OwnedProcess(job_process, ports)

    original_close = process_module.OwnedProcess.close

    def record_close(owned: process_module.OwnedProcess) -> None:
        if owned.pid == job_process.pid:
            closed_job_pids.append(owned.pid)
        original_close(owned)

    def forbid_raw_run(*_args: RunKwarg, **_kwargs: RunKwarg) -> NoReturn:
        raise AssertionError("Playwright job bypassed OwnedProcess.spawn")

    def reset_state(
        database_path: Path,
        _temporary_root: Path,
        _uploads_root: Path,
        _backend_upload_root: Path,
    ) -> tuple[float, int, float, float]:
        resets.append(database_path)
        return (0.0, 0, 0.0, 0.0)

    def service_ready(
        *_urls: str,
        timeout_sec: float,
        stop_if: Callable[[], bool] | None = None,
    ) -> bool:
        _ = (timeout_sec, stop_if)
        return True

    def port_closed(_port: int) -> bool:
        return False

    monkeypatch.setattr(services_module, "pick_free_port", lambda: 8123)
    monkeypatch.setattr(services_module, "start_orchestrator", fake_start_orchestrator)
    monkeypatch.setattr(services_module, "wait_until_up", service_ready)
    monkeypatch.setattr(BrowserServerHandle, "start", fake_browser_start)
    monkeypatch.setattr(
        process_module.OwnedProcess,
        "spawn",
        classmethod(fake_spawn),
    )
    monkeypatch.setattr(process_module.OwnedProcess, "close", record_close)
    monkeypatch.setattr(subprocess, "run", forbid_raw_run)
    monkeypatch.setattr(capsule_module, "reset_capsule_state", reset_state)
    monkeypatch.setattr(process_module, "port_is_open", port_closed)
    capsule = WorkerCapsule(
        tmp_path,
        RunId("run-a"),
        WorkerId("worker-1"),
        settings=CapsuleSettings(
            playwright_args=("--grep", "auth", "--reporter", "line"),
            html_report=True,
            project_matrix=True,
            include_slow=True,
        ),
    )

    capsule.start()
    first_code = capsule.run_job(make_job("job-1"))
    second_code = capsule.run_job(make_job("job-2"))
    capsule.close()

    assert first_code == second_code == 0
    assert closed_job_pids == [job_process.pid, job_process.pid]
    assert start_calls == [(start_calls[0][0], 8123, 8123, True)]
    assert len(commands) == 2
    assert commands[0][0] == "node"
    assert (
        Path(commands[0][1]).as_posix().endswith("node_modules/@playwright/test/cli.js")
    )
    assert commands[0][2] == "test"
    assert "cmd" not in commands[0][:1]
    assert "npx" not in commands[0][:1]
    assert len(browser_calls) == 1
    reporter = next(arg for arg in commands[0] if arg.startswith("--reporter"))
    assert reporter.startswith("--reporter=line,json,html,")
    assert reporter.endswith("runtime_profile_reporter.mjs")
    first_paths = capsule.job_paths(JobId("job-1"))
    first_env = environments[0]
    assert first_env["PW_TEST_CONNECT_WS_ENDPOINT"] == browser.ws_endpoint
    assert first_env["PLAYWRIGHT_JSON_OUTPUT_FILE"] == str(first_paths.json_report)
    assert first_env["E2E_RUNTIME_PROFILE_FILE"] == str(first_paths.runtime_profile)
    assert first_env["E2E_EVIDENCE_EXPECTATIONS_FILE"] == str(
        first_paths.evidence_expectations
    )
    assert first_env["E2E_SCREENSHOT_DIR"] == str(first_paths.screenshots)
    assert first_env["E2E_EVIDENCE_DIR"] == str(first_paths.evidence)
    assert first_env["E2E_BASE_URL"] == "http://127.0.0.1:8123"
    assert first_env["E2E_API_BASE_URL"] == first_env["E2E_BASE_URL"]
    assert first_env["E2E_AUTH_SETUP_MODE"] == "api"
    assert first_env["E2E_AUTH_SETUP_METRICS_FILE"] == str(
        first_paths.root / "auth-setup.jsonl"
    )
    assert first_env["E2E_RUN_ID"] == "run-a"
    assert first_env["E2E_WORKER_ID"] == "worker-1"
    assert first_env["E2E_JOB_ID"] == "job-1"
    assert first_env["TMP"] == str(first_paths.temporary)
    assert first_env["TEMP"] == str(first_paths.temporary)
    assert first_env["TMPDIR"] == str(first_paths.temporary)
    assert first_paths.stdout.read_bytes() == b"job stdout"
    assert first_paths.stderr.read_bytes() == b"job stderr"
    job_metrics = json.loads(
        (first_paths.root / "scheduler-metrics.json").read_text(encoding="utf-8")
    )
    assert job_metrics["version"] == 1
    assert job_metrics["auth"] == {
        "mode": "api",
        "count": 1,
        "duration_seconds": 0.25,
        "failed": 0,
        "ui_count": 0,
        "ui_seconds": 0.0,
        "api_count": 1,
        "api_seconds": 0.25,
    }
    assert job_metrics["db_reset_seconds"] >= 0.0
    assert job_metrics["db_reset_retry_count"] == 0
    assert job_metrics["db_reset_locked_seconds"] == 0.0
    assert job_metrics["filesystem_cleanup_seconds"] >= 0.0
    assert job_metrics["browser_acquire_seconds"] >= 0.0
    assert job_metrics["playwright_boundary_seconds"] >= 0.0
    assert resets == [capsule.database_path, capsule.database_path]
    assert browser.close_calls == 1
    assert browser_calls[0][4] == capsule.browser_profile_root / "chromium"
    assert not capsule.temporary_root.exists()
    assert not capsule.uploads_root.exists()
    assert not capsule.backend_upload_root.exists()
    assert not capsule.browser_profile_root.exists()


def test_capsule_closes_playwright_job_and_resets_after_interrupt(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    capsule = WorkerCapsule(tmp_path, RunId("run-a"), WorkerId("worker-1"))
    browser = FakeBrowserHandle()
    closed: list[int] = []
    resets: list[bool] = []

    def running_services(
        _self: WorkerCapsule,
    ) -> tuple[int, FakeBrowserHandle, str]:
        return 8123, browser, "http://127.0.0.1:8123"

    def spawn_interrupting_job(
        _cls: type[process_module.OwnedProcess],
        _launch: process_module.ProcessLaunch,
        _ports: tuple[int, ...] = (),
    ) -> process_module.OwnedProcess:
        return process_module.OwnedProcess(InterruptingJobProcess())

    def record_close(owned: process_module.OwnedProcess) -> None:
        closed.append(owned.pid)

    def record_reset(_self: WorkerCapsule) -> None:
        resets.append(True)

    monkeypatch.setattr(WorkerCapsule, "_running_services", running_services)
    monkeypatch.setattr(
        process_module.OwnedProcess,
        "spawn",
        classmethod(spawn_interrupting_job),
    )
    monkeypatch.setattr(process_module.OwnedProcess, "close", record_close)
    monkeypatch.setattr(WorkerCapsule, "reset", record_reset)

    # When / Then
    with pytest.raises(KeyboardInterrupt):
        _ = capsule.run_job(make_job("job-1"))

    assert closed == [InterruptingJobProcess.pid]
    assert resets == [True]


def test_capsule_resets_after_playwright_job_spawn_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    capsule = WorkerCapsule(tmp_path, RunId("run-a"), WorkerId("worker-1"))
    browser = FakeBrowserHandle()
    resets: list[bool] = []

    def running_services(
        _self: WorkerCapsule,
    ) -> tuple[int, FakeBrowserHandle, str]:
        return 8123, browser, "http://127.0.0.1:8123"

    def fail_spawn(
        _cls: type[process_module.OwnedProcess],
        _launch: process_module.ProcessLaunch,
        _ports: tuple[int, ...] = (),
    ) -> NoReturn:
        raise OSError("Playwright spawn failed")

    def record_reset(_self: WorkerCapsule) -> None:
        resets.append(True)

    monkeypatch.setattr(WorkerCapsule, "_running_services", running_services)
    monkeypatch.setattr(
        process_module.OwnedProcess,
        "spawn",
        classmethod(fail_spawn),
    )
    monkeypatch.setattr(WorkerCapsule, "reset", record_reset)

    # When / Then
    with pytest.raises(OSError, match="Playwright spawn failed"):
        _ = capsule.run_job(make_job("job-1"))

    assert resets == [True]
