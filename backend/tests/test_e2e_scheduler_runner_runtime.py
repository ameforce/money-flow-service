from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import final

import pytest
from pydantic import JsonValue

from backend.tests.e2e_scheduler_runner_fakes import make_options, make_test
from scripts.e2e_scheduler.model import JobId, JobSpec, WorkerId
from scripts.e2e_scheduler.project_profiles import PROJECT_PROFILES
from scripts.e2e_scheduler.runner_runtime import LocalSchedulerRuntime
from scripts.e2e_scheduler.runtime_profile import RuntimeProfileError


@dataclass(frozen=True, slots=True)
class _Paths:
    json_report: Path
    runtime_profile: Path
    evidence_expectations: Path
    screenshots: Path
    evidence: Path
    uiux_evidence: Path


@final
class _Capsule:
    def __init__(self, root: Path, profile: JsonValue | None) -> None:
        self.worker_id = WorkerId("worker-1")
        self.repository_root = root
        self._profile = profile

    @property
    def is_started(self) -> bool:
        return True

    def start(self) -> None:
        return

    def close(self) -> None:
        return

    def request_stop(self) -> None:
        return

    def backend_health_latency_ms(self) -> float:
        return 1.0

    def run_job(self, job: JobSpec) -> int:
        paths = self.job_paths(job.job_id)
        paths.screenshots.mkdir(parents=True)
        paths.evidence.mkdir(parents=True)
        _ = paths.evidence_expectations.write_text(
            '{"version":1,"kind":"screenshot","filename":"actual.png"}\n',
            encoding="utf-8",
        )
        if self._profile is not None:
            _ = paths.runtime_profile.write_text(
                json.dumps(self._profile),
                encoding="utf-8",
            )
        return 0

    def job_paths(self, job_id: JobId) -> _Paths:
        root = self.repository_root / str(job_id)
        return _Paths(
            json_report=root / "result.json",
            runtime_profile=root / "runtime-profile.json",
            evidence_expectations=root / "evidence-expectations.jsonl",
            screenshots=root / "screenshots",
            evidence=root / "evidence",
            uiux_evidence=root / "uiux-evidence",
        )


def _job() -> JobSpec:
    test = make_test(1)
    return JobSpec(
        job_id=JobId("job-1"),
        project=test.project,
        spec_path=test.spec_path,
        logical_group="flow",
        tests=(test,),
        locks=frozenset(),
        estimated_seconds=1.0,
    )


def test_execute_job_uses_reported_profile_and_journal(tmp_path: Path) -> None:
    runtime = LocalSchedulerRuntime(options=make_options(), repository_root=tmp_path)
    capsule = _Capsule(
        tmp_path,
        {
            "version": 1,
            "project": "reported-project",
            "browser": "firefox",
            "viewport": {"width": 390, "height": 844},
        },
    )

    result = runtime.execute_job(capsule, _job()).result

    assert (result.project, result.browser, result.viewport) == (
        "reported-project",
        "firefox",
        (390, 844),
    )
    assert result.expected_evidence_names == ("actual.png",)
    assert result.uiux_evidence_root == tmp_path / "job-1" / "uiux-evidence"


def test_execute_job_fails_closed_without_reported_profile(tmp_path: Path) -> None:
    runtime = LocalSchedulerRuntime(options=make_options(), repository_root=tmp_path)

    with pytest.raises(RuntimeProfileError):
        _ = runtime.execute_job(_Capsule(tmp_path, None), _job())


def test_discovery_profiles_match_resolved_playwright_viewports() -> None:
    assert tuple(
        (profile.name, profile.browser, profile.viewport)
        for profile in PROJECT_PROFILES
    ) == (
        ("desktop-chromium", "chromium", (1280, 720)),
        ("tablet-chromium", "chromium", (834, 1194)),
        ("mobile-chromium", "chromium", (393, 727)),
        ("matrix-chromium", "chromium", (1280, 720)),
        ("matrix-firefox", "firefox", (1280, 720)),
        ("matrix-webkit", "webkit", (1280, 720)),
    )
