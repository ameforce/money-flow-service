from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path

import pytest

from backend.tests.e2e_scheduler_runner_probes import (
    DiscoveryInput,
    DurationHistoryInput,
    PersistedManifestInput,
)

from scripts.e2e_scheduler.discovery import (
    DiscoveredTestIdentityError,
    DuplicateDiscoveredTestError,
    DuplicateTestSelectorError,
    EmptyDiscoveryError,
    ProjectProfile,
    UnassignedLogicalGroupError,
    UnknownProjectError,
    build_jobs,
    discover_tests,
    write_test_list,
)
from scripts.e2e_scheduler.history import (
    BrowserOverheadRecord,
    DurationHistory,
    DurationHistoryFormatError,
    DurationRecord,
    DurationResult,
)
from scripts.e2e_scheduler.model import (
    DiscoveredTest,
    ManifestTestCoverageError,
    RunId,
    RunManifest,
    TestId,
)


FIXTURE_PATH = Path(__file__).parent / "fixtures" / "e2e-playwright-list.json"
PROJECTS = (
    ProjectProfile("desktop-chromium", "chromium", (1280, 720)),
    ProjectProfile("tablet-chromium", "chromium", (834, 1194)),
    ProjectProfile("mobile-chromium", "chromium", (393, 727)),
)


def load_discovery_input() -> DiscoveryInput:
    return DiscoveryInput.model_validate_json(load_discovery_payload())


@dataclass(frozen=True, slots=True)
class FakeLogicalGroupResolver:
    groups: dict[TestId, str]

    def resolve(self, test: DiscoveredTest) -> str | None:
        return self.groups.get(test.test_id)


def load_discovery_payload() -> str:
    return FIXTURE_PATH.read_text(encoding="utf-8")


def load_discovery_fixture() -> tuple[DiscoveredTest, ...]:
    return discover_tests(load_discovery_payload(), Path.cwd(), PROJECTS)


def make_test(*, title: str = "behavior", line: int = 7) -> DiscoveredTest:
    test_id = TestId(f"desktop-chromium::e2e/specs/example.spec.js:{line}::{title}")
    return DiscoveredTest(
        test_id=test_id,
        project="desktop-chromium",
        spec_path=Path("e2e/specs/example.spec.js"),
        line=line,
        title_path=(title,),
        browser="chromium",
        viewport=(1280, 720),
        estimated_seconds=30.0,
    )


def test_discover_tests_parses_projects_paths_and_nested_titles() -> None:
    discovered = load_discovery_fixture()

    assert len(discovered) == 6
    assert {test.project for test in discovered} == {
        profile.name for profile in PROJECTS
    }
    assert {test.spec_path for test in discovered} == {Path("e2e/specs/alpha.spec.js")}
    assert ("nested behavior", "updates a record") in {
        test.title_path for test in discovered
    }
    assert len({test.test_id for test in discovered}) == len(discovered)
    assert all(test.estimated_seconds == 30.0 for test in discovered)


def test_build_jobs_adds_browser_boundary_median_to_actual_test_estimates() -> None:
    discovered = make_test()
    history = DurationHistory(
        records=(
            DurationRecord(
                discovered.test_id,
                discovered.spec_path,
                4.0,
                (3.0, 4.0, 5.0),
            ),
        ),
        browser_overheads=(
            BrowserOverheadRecord("chromium", (1.0, 2.0, 9.0)),
        ),
    )
    resolver = FakeLogicalGroupResolver({discovered.test_id: "flow"})

    job = build_jobs((discovered,), history, resolver)[0]

    assert job.estimated_seconds == 6.0


def test_discover_tests_rejects_duplicate_identity() -> None:
    payload = load_discovery_input()
    payload.suites.append(payload.suites[0])

    with pytest.raises(DuplicateDiscoveredTestError):
        _ = discover_tests(payload.model_dump_json(by_alias=True), Path.cwd(), PROJECTS)


def test_discover_tests_rejects_unknown_project() -> None:
    payload = load_discovery_input()
    payload.suites[0].specs[0].tests[0].project_name = "firefox"

    with pytest.raises(UnknownProjectError):
        _ = discover_tests(payload.model_dump_json(by_alias=True), Path.cwd(), PROJECTS)


def test_discover_tests_rejects_zero_tests() -> None:
    payload = load_discovery_input()
    payload.suites = []

    with pytest.raises(EmptyDiscoveryError):
        _ = discover_tests(payload.model_dump_json(by_alias=True), Path.cwd(), PROJECTS)


def test_write_test_list_uses_canonical_relative_selectors(tmp_path: Path) -> None:
    tests = tuple(
        test for test in load_discovery_fixture() if test.project == "desktop-chromium"
    )
    resolver = FakeLogicalGroupResolver(groups={test.test_id: "all" for test in tests})
    job = build_jobs(tests, DurationHistory.empty(), resolver)[0]
    output = tmp_path / "job.list"

    write_test_list(job, output)

    assert output.read_text(encoding="utf-8").splitlines() == [
        "[desktop-chromium] › alpha.spec.js:10 › creates a record",
        "[desktop-chromium] › alpha.spec.js:21 › nested behavior › updates a record",
    ]


def test_write_test_list_rejects_modified_test_identity(tmp_path: Path) -> None:
    test = replace(make_test(), test_id=TestId("modified"))
    resolver = FakeLogicalGroupResolver(groups={test.test_id: "all"})
    job = build_jobs((test,), DurationHistory.empty(), resolver)[0]

    with pytest.raises(DiscoveredTestIdentityError):
        write_test_list(job, tmp_path / "job.list")


def test_build_jobs_rejects_same_selector_split_across_logical_groups() -> None:
    first = make_test(title="parameter one", line=12)
    second = make_test(title="parameter two", line=12)
    resolver = FakeLogicalGroupResolver(
        groups={first.test_id: "group-a", second.test_id: "group-b"}
    )

    with pytest.raises(DuplicateTestSelectorError):
        _ = build_jobs((first, second), DurationHistory.empty(), resolver)


def test_write_test_list_keeps_distinct_titles_on_a_shared_line(tmp_path: Path) -> None:
    first = make_test(title="parameter one", line=12)
    second = make_test(title="parameter two", line=12)
    resolver = FakeLogicalGroupResolver(
        groups={first.test_id: "same-group", second.test_id: "same-group"}
    )
    job = build_jobs((first, second), DurationHistory.empty(), resolver)[0]
    output = tmp_path / "job.list"

    write_test_list(job, output)

    assert output.read_text(encoding="utf-8").splitlines() == [
        "[desktop-chromium] › example.spec.js:12 › parameter one",
        "[desktop-chromium] › example.spec.js:12 › parameter two",
    ]


def test_build_jobs_uses_resolver_and_preserves_every_test_exactly_once() -> None:
    discovered = load_discovery_fixture()
    resolver = FakeLogicalGroupResolver(
        groups={
            test.test_id: f"group-{index % 3}" for index, test in enumerate(discovered)
        }
    )

    jobs = build_jobs(discovered, DurationHistory.empty(), resolver)

    assigned = [test.test_id for job in jobs for test in job.tests]
    assert sorted(assigned) == sorted(test.test_id for test in discovered)
    assert len(assigned) == len(set(assigned))
    assert {job.logical_group for job in jobs} == {"group-0", "group-1", "group-2"}


def test_build_jobs_rejects_resolver_without_a_group() -> None:
    discovered = (make_test(title="unassigned behavior"),)

    with pytest.raises(UnassignedLogicalGroupError):
        _ = build_jobs(
            discovered,
            DurationHistory.empty(),
            FakeLogicalGroupResolver(groups={}),
        )


def test_run_manifest_exposes_exact_inventory_and_persists(tmp_path: Path) -> None:
    discovered = load_discovery_fixture()
    resolver = FakeLogicalGroupResolver(
        groups={test.test_id: "all" for test in discovered}
    )
    jobs = build_jobs(discovered, DurationHistory.empty(), resolver)
    manifest = RunManifest(
        run_id=RunId("run-1"),
        tests=discovered,
        jobs=jobs,
        playwright_args=("--project-matrix",),
    )
    path = tmp_path / "manifest.json"

    manifest.save(path)

    persisted = PersistedManifestInput.model_validate_json(path.read_bytes())
    assert manifest.expected_projects == {
        "desktop-chromium",
        "tablet-chromium",
        "mobile-chromium",
    }
    assert manifest.expected_test_ids == frozenset(test.test_id for test in discovered)
    assert persisted.run_id == "run-1"
    assert len(persisted.tests) == len(discovered)
    assert len(persisted.jobs) == len(jobs)


def test_run_manifest_rejects_omitted_test() -> None:
    first = make_test(title="first", line=1)
    second = make_test(title="second", line=2)
    resolver = FakeLogicalGroupResolver(groups={first.test_id: "all"})
    jobs = build_jobs((first,), DurationHistory.empty(), resolver)

    with pytest.raises(ManifestTestCoverageError):
        _ = RunManifest(RunId("run-omitted"), (first, second), jobs)


def test_run_manifest_rejects_duplicate_job_test() -> None:
    test = make_test()
    resolver = FakeLogicalGroupResolver(groups={test.test_id: "all"})
    job = build_jobs((test,), DurationHistory.empty(), resolver)[0]

    with pytest.raises(ManifestTestCoverageError):
        _ = RunManifest(RunId("run-duplicate"), (test,), (job, job))


def test_run_manifest_rejects_foreign_job_test() -> None:
    declared = make_test(title="declared", line=1)
    foreign = make_test(title="foreign", line=2)
    resolver = FakeLogicalGroupResolver(groups={foreign.test_id: "all"})
    jobs = build_jobs((foreign,), DurationHistory.empty(), resolver)

    with pytest.raises(ManifestTestCoverageError):
        _ = RunManifest(RunId("run-foreign"), (declared,), jobs)


def test_duration_history_estimates_exact_then_spec_median_then_default() -> None:
    history = DurationHistory(
        records=(
            DurationRecord(TestId("known"), Path("e2e/specs/a.spec.js"), 9.0),
            DurationRecord(TestId("other"), Path("e2e/specs/a.spec.js"), 15.0),
        )
    )

    assert history.estimate(TestId("known"), Path("e2e/specs/a.spec.js")) == 9.0
    assert history.estimate(TestId("new"), Path("e2e/specs/a.spec.js")) == 12.0
    assert history.estimate(TestId("new"), Path("e2e/specs/new.spec.js")) == 30.0


def test_duration_history_loads_versioned_json_and_saves_atomically(
    tmp_path: Path,
) -> None:
    source = tmp_path / "history.json"
    _ = source.write_text(
        json.dumps(
            {
                "version": 1,
                "records": [
                    {
                        "test_id": "known",
                        "spec_path": "e2e/specs/a.spec.js",
                        "seconds": 4.5,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    history = DurationHistory.load(source)
    output = tmp_path / "saved.json"
    history.save(output)

    assert history.estimate(TestId("known"), Path("e2e/specs/a.spec.js")) == 4.5
    persisted = DurationHistoryInput.model_validate_json(output.read_bytes())
    assert persisted.version == 1
    assert not output.with_suffix(".json.tmp").exists()


def test_duration_history_rejects_unknown_version(tmp_path: Path) -> None:
    source = tmp_path / "history.json"
    _ = source.write_text('{"version": 2, "records": []}', encoding="utf-8")

    with pytest.raises(DurationHistoryFormatError):
        _ = DurationHistory.load(source)


def test_duration_history_merges_only_complete_results() -> None:
    original = DurationHistory(
        records=(DurationRecord(TestId("existing"), Path("e2e/specs/a.spec.js"), 8.0),)
    )

    updated = original.with_results(
        (
            DurationResult(TestId("existing"), Path("e2e/specs/a.spec.js"), 11.0, True),
            DurationResult(
                TestId("interrupted"), Path("e2e/specs/b.spec.js"), 99.0, False
            ),
        )
    )

    assert original.estimate(TestId("existing"), Path("e2e/specs/a.spec.js")) == 8.0
    assert updated.estimate(TestId("existing"), Path("e2e/specs/a.spec.js")) == 11.0
    assert updated.estimate(TestId("interrupted"), Path("e2e/specs/b.spec.js")) == 30.0
