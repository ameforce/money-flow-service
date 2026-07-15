from __future__ import annotations

from collections import Counter
import os
from pathlib import Path
import subprocess
from typing import ClassVar

import pytest
from pydantic import BaseModel, ConfigDict

from backend.tests.e2e_scheduler_runner_fakes import FakeRuntime, make_options
from scripts.e2e_scheduler.discovery import build_jobs
from scripts.e2e_scheduler.history import DurationHistory
from scripts.e2e_scheduler.logical_groups import (
    MOBILE_MATRIX_GROUP_BY_TITLE,
    MOBILE_MATRIX_GROUPS,
    MOBILE_MATRIX_SPEC,
    TRANSACTION_GROUP_BY_TITLE,
    TRANSACTION_GROUPS,
    TRANSACTION_SPEC,
    CurrentLogicalGroupResolver,
)
from scripts.e2e_scheduler.model import DiscoveredTest, RunId, RunManifest
from scripts.e2e_scheduler.runner import run_dynamic
from scripts.e2e_scheduler.runner_options import parse_runner_options
from scripts.e2e_scheduler.runner_runtime import LocalSchedulerRuntime
from scripts.e2e_scheduler.benchmark_report import parse_playwright_inventory


ROOT = Path(__file__).resolve().parents[2]
EXPECTED_PROJECTS = {
    "desktop-chromium",
    "tablet-chromium",
    "mobile-chromium",
    "matrix-chromium",
    "matrix-firefox",
    "matrix-webkit",
}
TRANSACTION_PROJECTS = {
    "desktop-chromium",
    "tablet-chromium",
    "mobile-chromium",
}
MOBILE_MATRIX_PROJECTS = {
    "matrix-chromium",
    "matrix-firefox",
    "matrix-webkit",
}


class _PersistedJob(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    logical_group: str
    locks: tuple[str, ...]


class _PersistedManifest(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    jobs: tuple[_PersistedJob, ...]


@pytest.fixture(scope="module")
def real_matrix_discovery() -> tuple[DiscoveredTest, ...]:
    # Given
    options = parse_runner_options(["--project-matrix", "--scheduler-smoke-workers=1"])
    runtime = LocalSchedulerRuntime(options=options, repository_root=ROOT)

    # When
    discovered = runtime.discover(())

    # Then
    assert discovered
    return discovered


def test_real_matrix_partition_assigns_every_discovered_test_once(
    real_matrix_discovery: tuple[DiscoveredTest, ...],
) -> None:
    # Given
    resolver = CurrentLogicalGroupResolver()

    # When
    jobs = build_jobs(real_matrix_discovery, DurationHistory.empty(), resolver)
    manifest = RunManifest(
        run_id=RunId("run-parity"),
        tests=real_matrix_discovery,
        jobs=jobs,
        playwright_args=("--project-matrix",),
    )

    # Then
    assert len(real_matrix_discovery) == 570
    assert len(manifest.jobs) == 105
    assert manifest.expected_projects == EXPECTED_PROJECTS
    assert manifest.expected_test_ids == frozenset(
        test.test_id for test in real_matrix_discovery
    )
    assigned = [test.test_id for job in manifest.jobs for test in job.tests]
    assert len(assigned) == len(real_matrix_discovery)
    assert len(assigned) == len(set(assigned))


def test_scheduler_discovery_matches_independent_legacy_list_inventory(
    tmp_path: Path,
    real_matrix_discovery: tuple[DiscoveredTest, ...],
) -> None:
    # Given
    env = os.environ.copy()
    env["E2E_PROJECT_MATRIX"] = "1"
    command = ["npx", "playwright", "test", "--list", "--reporter=json"]
    if os.name == "nt":
        command = ["cmd", "/c", *command]

    # When
    completed = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    report_path = tmp_path / "legacy-list.json"
    _ = report_path.write_text(completed.stdout, encoding="utf-8")
    legacy = parse_playwright_inventory(report_path, ROOT)

    # Then
    scheduler_ids = Counter(str(test.test_id) for test in real_matrix_discovery)
    scheduler_projects = Counter(test.project for test in real_matrix_discovery)
    assert Counter(legacy.test_ids) == scheduler_ids
    assert (
        Counter(test_id.partition("::")[0] for test_id in legacy.test_ids)
        == scheduler_projects
    )


def test_current_transaction_titles_have_one_business_group(
    real_matrix_discovery: tuple[DiscoveredTest, ...],
) -> None:
    # Given
    titles = {
        test.title_path[-1]
        for test in real_matrix_discovery
        if test.spec_path == TRANSACTION_SPEC
    }

    # When
    mapped_titles = set(TRANSACTION_GROUP_BY_TITLE)

    # Then
    assert len(titles) == 71
    assert mapped_titles == titles
    assert sum(len(group_titles) for group_titles in TRANSACTION_GROUPS.values()) == 71


def test_current_mobile_matrix_titles_have_one_business_group(
    real_matrix_discovery: tuple[DiscoveredTest, ...],
) -> None:
    # Given
    titles = {
        test.title_path[-1]
        for test in real_matrix_discovery
        if test.spec_path == MOBILE_MATRIX_SPEC
    }

    # When
    mapped_titles = set(MOBILE_MATRIX_GROUP_BY_TITLE)

    # Then
    assert len(titles) == 19
    assert mapped_titles == titles
    assert (
        sum(len(group_titles) for group_titles in MOBILE_MATRIX_GROUPS.values()) == 19
    )


def test_current_resolver_splits_transactions_and_keeps_default_spec_jobs(
    real_matrix_discovery: tuple[DiscoveredTest, ...],
) -> None:
    # Given
    resolver = CurrentLogicalGroupResolver()

    # When
    jobs = build_jobs(real_matrix_discovery, DurationHistory.empty(), resolver)

    # Then
    transaction_jobs = [job for job in jobs if job.spec_path == TRANSACTION_SPEC]
    assert len(transaction_jobs) == len(TRANSACTION_GROUPS) * len(TRANSACTION_PROJECTS)
    assert {job.logical_group for job in transaction_jobs} == set(TRANSACTION_GROUPS)
    assert {job.project for job in transaction_jobs} == TRANSACTION_PROJECTS

    mobile_matrix_jobs = [job for job in jobs if job.spec_path == MOBILE_MATRIX_SPEC]
    assert len(mobile_matrix_jobs) == 24
    assert len(mobile_matrix_jobs) == len(MOBILE_MATRIX_GROUPS) * len(
        MOBILE_MATRIX_PROJECTS
    )
    assert {job.logical_group for job in mobile_matrix_jobs} == set(
        MOBILE_MATRIX_GROUPS
    )
    assert {job.project for job in mobile_matrix_jobs} == MOBILE_MATRIX_PROJECTS
    assert all(not job.locks for job in jobs)
    default_jobs = [
        job
        for job in jobs
        if job.spec_path not in {TRANSACTION_SPEC, MOBILE_MATRIX_SPEC}
    ]
    assert all(
        job.logical_group == f"spec:{job.spec_path.as_posix()}" for job in default_jobs
    )


def test_dynamic_coordinator_persists_current_logical_groups(
    tmp_path: Path,
    real_matrix_discovery: tuple[DiscoveredTest, ...],
) -> None:
    # Given
    transaction_tests = tuple(
        test
        for test in real_matrix_discovery
        if test.project == "desktop-chromium" and test.spec_path == TRANSACTION_SPEC
    )
    runtime = FakeRuntime(tmp_path, transaction_tests)

    # When
    return_code = run_dynamic(make_options(workers=1), (), runtime=runtime)

    # Then
    manifest = _PersistedManifest.model_validate_json(
        runtime.manifest_path(RunId("run-test")).read_text(encoding="utf-8")
    )
    assert return_code == 0
    assert {job.logical_group for job in manifest.jobs} == set(TRANSACTION_GROUPS)
    assert all(not job.locks for job in manifest.jobs)


def test_feature_matrix_documents_current_mobile_successor_coverage() -> None:
    # Given / When
    matrix = (ROOT / "e2e" / "feature-matrix.md").read_text(encoding="utf-8")

    # Then
    assert "mobile-browser-matrix.spec.js" in matrix
    assert "three dedicated Playwright matrix projects" in matrix
    assert "not present in the current develop inventory" not in matrix
