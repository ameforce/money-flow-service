from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import NoReturn

import pytest

import scripts.e2e_scheduler.capsule as capsule_module
import scripts.e2e_scheduler.capsule_services as services_module
from backend.tests.e2e_scheduler_capsule_fakes import (
    FakeBrowserHandle,
)
from scripts.e2e_scheduler.browser import BrowserServerHandle
from scripts.e2e_scheduler.capsule import WorkerCapsule
from scripts.e2e_scheduler.model import (
    DiscoveredTest,
    JobId,
    JobSpec,
    RunId,
    TestId,
    WorkerId,
)
from scripts.e2e_scheduler.project_profiles import BrowserEngine


def make_capsule(tmp_path: Path, run_id: RunId, worker_id: WorkerId) -> WorkerCapsule:
    return WorkerCapsule(root=tmp_path, run_id=run_id, worker_id=worker_id)


def make_job(
    job_id: str = "job-1",
    *,
    project: str = "desktop-chromium",
    browser: BrowserEngine = "chromium",
) -> JobSpec:
    test = DiscoveredTest(
        test_id=TestId(f"{project}::e2e/specs/auth.spec.js:10::auth flow"),
        project=project,
        spec_path=Path("e2e/specs/auth.spec.js"),
        line=10,
        title_path=("auth flow",),
        browser=browser,
        viewport=(1280, 720),
        estimated_seconds=30.0,
    )
    return JobSpec(
        job_id=JobId(job_id),
        project=project,
        spec_path=test.spec_path,
        logical_group="all",
        tests=(test,),
        locks=frozenset(),
        estimated_seconds=30.0,
    )


def test_capsule_paths_are_unique_per_run_worker_and_job(tmp_path: Path) -> None:
    # Given
    first = make_capsule(tmp_path, RunId("run-a"), WorkerId("worker-1"))
    second = make_capsule(tmp_path, RunId("run-a"), WorkerId("worker-2"))
    other_run = make_capsule(tmp_path, RunId("run-b"), WorkerId("worker-1"))

    # When
    first_job = first.job_paths(JobId("job-1"))
    second_job = second.job_paths(JobId("job-1"))
    other_job = other_run.job_paths(JobId("job-2"))

    # Then
    assert first.database_path != second.database_path
    assert first.database_path != other_run.database_path
    assert first_job.screenshots != second_job.screenshots
    assert first_job.evidence != second_job.evidence
    assert first_job.temporary != second_job.temporary
    assert first_job.output != other_job.output


def test_capsule_closes_browser_when_orchestrator_start_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    browser = FakeBrowserHandle()
    ports = iter((8123, 8124))

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
        _ = (
            repository_root,
            stdout_path,
            stderr_path,
            endpoint_path,
            temporary_root,
            stop_requested,
            metrics_recorder,
        )
        return browser

    def fail_orchestrator(
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
    ) -> NoReturn:
        _ = (
            db_url,
            backend_port,
            frontend_port,
            skip_frontend,
            project_root,
            import_allowed_root,
            stdout_path,
            stderr_path,
            defer_port_ownership,
            metrics_recorder,
        )
        raise OSError("spawn failed")

    monkeypatch.setattr(services_module, "pick_free_port", lambda: next(ports))
    monkeypatch.setattr(
        BrowserServerHandle,
        "start",
        fake_browser_start,
    )
    monkeypatch.setattr(
        services_module,
        "start_orchestrator",
        fail_orchestrator,
    )
    capsule = make_capsule(tmp_path, RunId("run-a"), WorkerId("worker-1"))

    # When
    try:
        capsule.start()
    except capsule_module.CapsuleError as error:
        detail = str(error)
    else:
        pytest.fail("capsule startup unexpectedly succeeded")

    # Then
    assert "spawn failed" in detail
    assert browser.close_calls == 1
