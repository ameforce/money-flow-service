from __future__ import annotations

from dataclasses import replace

import pytest

from backend.tests.test_e2e_scheduler_discovery import (
    FakeLogicalGroupResolver,
    make_test,
)
from scripts.e2e_scheduler.discovery import build_jobs
from scripts.e2e_scheduler.history import DurationHistory
from scripts.e2e_scheduler.model import RunId, RunManifest


def test_manifest_rejects_project_profile_metadata_drift() -> None:
    # Given
    discovered = replace(make_test(), browser="firefox")
    jobs = build_jobs(
        (discovered,),
        DurationHistory.empty(),
        FakeLogicalGroupResolver(groups={discovered.test_id: "all"}),
    )

    # When / Then
    with pytest.raises(ValueError, match="profile"):
        _ = RunManifest(RunId("run-profile-drift"), (discovered,), jobs)


def test_manifest_rejects_job_project_drift_from_assigned_tests() -> None:
    # Given
    discovered = make_test()
    job = build_jobs(
        (discovered,),
        DurationHistory.empty(),
        FakeLogicalGroupResolver(groups={discovered.test_id: "all"}),
    )[0]

    # When / Then
    with pytest.raises(ValueError, match="job metadata"):
        _ = RunManifest(
            RunId("run-job-drift"),
            (discovered,),
            (replace(job, project="matrix-firefox"),),
        )
