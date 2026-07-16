from __future__ import annotations

from pathlib import Path

import pytest

from backend.tests.e2e_scheduler_capsule_fakes import FakeBrowserHandle, FakeProcess
from backend.tests.test_e2e_scheduler_capsule import make_job
from scripts.e2e_scheduler.capsule import WorkerCapsule
from scripts.e2e_scheduler.model import RunId, WorkerId
from scripts.e2e_scheduler.processes import OwnedProcess, ProcessLaunch


def test_capsule_routes_each_project_to_its_warm_browser_engine(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    capsule = WorkerCapsule(tmp_path, RunId("run-a"), WorkerId("worker-1"))
    browsers = FakeBrowserHandle()
    endpoints: list[str] = []

    def running_services(
        _self: WorkerCapsule,
    ) -> tuple[int, FakeBrowserHandle, str]:
        return 8123, browsers, "http://127.0.0.1:8124"

    def capture_spawn(
        _cls: type[OwnedProcess],
        launch: ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> OwnedProcess:
        _ = ports
        assert launch.env is not None
        endpoints.append(launch.env["PW_TEST_CONNECT_WS_ENDPOINT"])
        return OwnedProcess(FakeProcess(returncode=0))

    def skip_reset(_self: WorkerCapsule) -> None:
        return None

    monkeypatch.setattr(WorkerCapsule, "_running_services", running_services)
    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(capture_spawn))
    monkeypatch.setattr(WorkerCapsule, "reset", skip_reset)

    # When
    firefox_code = capsule.run_job(
        make_job(
            "job-firefox",
            project="matrix-firefox",
            browser="firefox",
        )
    )
    webkit_code = capsule.run_job(
        make_job(
            "job-webkit",
            project="matrix-webkit",
            browser="webkit",
        )
    )

    # Then
    assert firefox_code == webkit_code == 0
    assert endpoints == [
        "ws://127.0.0.1:9222/browser/firefox",
        "ws://127.0.0.1:9222/browser/webkit",
    ]
