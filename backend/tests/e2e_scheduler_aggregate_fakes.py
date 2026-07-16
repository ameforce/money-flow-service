from __future__ import annotations

import json
from pathlib import Path
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field

from scripts.e2e_scheduler.aggregate import JobResult
from scripts.e2e_scheduler.discovery import canonical_test_id
from scripts.e2e_scheduler.model import (
    DiscoveredTest,
    JobId,
    JobSpec,
    RunId,
    RunManifest,
    WorkerId,
)


class LegacyTotals(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    expected_tests: int
    actual_tests: int
    expected_scenarios: int
    actual_scenarios: int
    expected_evidence_count: int
    actual_evidence_count: int
    jobs: int
    projects: int


class LegacyJob(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    expected_browser: str
    actual_browser: str
    expected_viewport: tuple[int, int]
    actual_viewport: tuple[int, int]
    expected_evidence_files: tuple[str, ...]
    actual_evidence_files: tuple[str, ...]


class LegacyProject(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    browser: str
    actual_evidence_count: int


class LegacyScenarioIds(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    expected: tuple[str, ...]
    actual: tuple[str, ...]
    skipped: tuple[str, ...] = ()


class LegacyPublication(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    count: int
    files: tuple[str, ...]
    run_id: str
    playwright_args: tuple[str, ...]
    cleanup_status: str
    totals: LegacyTotals
    jobs: tuple[LegacyJob, ...]
    projects: tuple[LegacyProject, ...]
    scenario_ids: LegacyScenarioIds


class _ReportModel(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore")


class ReportAttempt(_ReportModel):
    status: str


class ReportTest(_ReportModel):
    project_name: str = Field(alias="projectName")
    expected_status: str = Field(alias="expectedStatus")
    status: str
    results: list[ReportAttempt]


class ReportSpec(_ReportModel):
    title: str
    file: str
    line: int
    tests: list[ReportTest]


class ReportSuite(_ReportModel):
    title: str
    suites: list[ReportSuite] = Field(default_factory=list)
    specs: list[ReportSpec] = Field(default_factory=list)


class ReportProject(_ReportModel):
    name: str
    retries: int


class ReportConfig(_ReportModel):
    root_dir: str = Field(alias="rootDir")
    projects: list[ReportProject]


class ReportPayload(_ReportModel):
    config: ReportConfig
    suites: list[ReportSuite]
    errors: list[str]


class PreviousPublication(_ReportModel):
    previous: bool


def make_test(project: str, spec_name: str, line: int, title: str) -> DiscoveredTest:
    spec_path = Path("e2e/specs") / spec_name
    title_path = ("flow", title)
    return DiscoveredTest(
        test_id=canonical_test_id(project, spec_path, line, title_path),
        project=project,
        spec_path=spec_path,
        line=line,
        title_path=title_path,
        browser="chromium",
        viewport=(1280, 720),
        estimated_seconds=1.0,
    )


def write_report(path: Path, test: DiscoveredTest) -> None:
    payload = {
        "config": {
            "rootDir": str(path.parents[4] / "e2e" / "specs"),
            "projects": [{"name": test.project, "retries": 0}],
        },
        "suites": [
            {
                "title": test.spec_path.name,
                "suites": [
                    {
                        "title": test.title_path[0],
                        "specs": [
                            {
                                "title": test.title_path[-1],
                                "file": test.spec_path.name,
                                "line": test.line,
                                "tests": [
                                    {
                                        "projectName": test.project,
                                        "expectedStatus": "passed",
                                        "status": "expected",
                                        "results": [{"status": "passed"}],
                                    }
                                ],
                            }
                        ],
                    }
                ],
            }
        ],
        "errors": [],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_text(json.dumps(payload), encoding="utf-8")


def complete_result_fixture(
    tmp_path: Path,
) -> tuple[RunManifest, tuple[JobResult, ...]]:
    tests = (
        make_test("desktop-chromium", "auth.spec.js", 10, "logs in"),
        make_test("desktop-chromium", "dashboard.spec.js", 20, "loads totals"),
    )
    jobs = tuple(
        JobSpec(
            job_id=JobId(f"job-{index}"),
            project=test.project,
            spec_path=test.spec_path,
            logical_group="flow",
            tests=(test,),
            locks=frozenset(),
            estimated_seconds=1.0,
        )
        for index, test in enumerate(tests, start=1)
    )
    manifest = RunManifest(
        run_id=RunId("run-a"),
        tests=tests,
        jobs=jobs,
        playwright_args=("--project-matrix",),
    )
    results: list[JobResult] = []
    for index, (job, test) in enumerate(zip(jobs, tests, strict=True), start=1):
        root = (
            tmp_path
            / "runs"
            / str(manifest.run_id)
            / f"worker-{index}"
            / str(job.job_id)
        )
        screenshots = root / "screenshots"
        evidence = root / "evidence"
        screenshots.mkdir(parents=True)
        evidence.mkdir()
        _ = (screenshots / f"shot-{index}.png").write_bytes(b"png")
        write_report(root / "result.json", test)
        results.append(
            JobResult(
                job_id=job.job_id,
                worker_id=WorkerId(f"worker-{index}"),
                project=test.project,
                browser=test.browser,
                viewport=test.viewport,
                repository_root=tmp_path,
                report_path=root / "result.json",
                screenshot_dir=screenshots,
                evidence_dir=evidence,
                uiux_evidence_root=root / "uiux-evidence",
                return_code=0,
                expected_evidence_names=(f"shot-{index}.png",),
                cleanup_succeeded=True,
            )
        )
    return manifest, tuple(results)


def read_report(path: Path) -> ReportPayload:
    return ReportPayload.model_validate_json(path.read_text(encoding="utf-8"))


def write_report_payload(path: Path, payload: ReportPayload) -> None:
    _ = path.write_text(payload.model_dump_json(by_alias=True), encoding="utf-8")


def read_previous_publication(path: Path) -> PreviousPublication:
    return PreviousPublication.model_validate_json(path.read_text(encoding="utf-8"))
