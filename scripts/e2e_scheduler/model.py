"""Immutable scheduler identifiers, tests, jobs, and run manifests."""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import NewType, override

from scripts.e2e_scheduler.project_profiles import ProjectProfile, project_profile

TestId = NewType("TestId", str)
RunId = NewType("RunId", str)
JobId = NewType("JobId", str)
WorkerId = NewType("WorkerId", str)


@dataclass(frozen=True, slots=True)
class DiscoveredTest:
    test_id: TestId
    project: str
    spec_path: Path
    line: int
    title_path: tuple[str, ...]
    browser: str
    viewport: tuple[int, int] | None
    estimated_seconds: float


@dataclass(frozen=True, slots=True)
class JobSpec:
    job_id: JobId
    project: str
    spec_path: Path
    logical_group: str
    tests: tuple[DiscoveredTest, ...]
    locks: frozenset[str]
    estimated_seconds: float


@dataclass(frozen=True, slots=True)
class ManifestTestCoverageError(ValueError):
    missing: tuple[TestId, ...]
    duplicates: tuple[TestId, ...]
    foreign: tuple[TestId, ...]

    @override
    def __str__(self) -> str:
        return (
            "run manifest test coverage mismatch: "
            f"missing={tuple(map(str, self.missing))}, "
            f"duplicates={tuple(map(str, self.duplicates))}, "
            f"foreign={tuple(map(str, self.foreign))}"
        )


@dataclass(frozen=True, slots=True)
class ManifestProjectProfileError(ValueError):
    test_id: TestId
    expected: ProjectProfile
    actual: tuple[str, tuple[int, int] | None]

    @override
    def __str__(self) -> str:
        return (
            "run manifest project profile mismatch: "
            f"test={self.test_id}, project={self.expected.name}, "
            f"expected={(self.expected.browser, self.expected.viewport)}, "
            f"actual={self.actual}"
        )


@dataclass(frozen=True, slots=True)
class ManifestJobMetadataError(ValueError):
    job_id: JobId
    reason: str

    @override
    def __str__(self) -> str:
        return f"run manifest job metadata mismatch: job={self.job_id}, {self.reason}"


@dataclass(frozen=True, slots=True)
class RunManifest:
    run_id: RunId
    tests: tuple[DiscoveredTest, ...]
    jobs: tuple[JobSpec, ...]
    playwright_args: tuple[str, ...] = ()
    benchmark_invocation_id: str | None = None
    benchmark_label: str | None = None

    def __post_init__(self) -> None:
        for test in self.tests:
            expected_profile = project_profile(test.project)
            actual_profile = (test.browser, test.viewport)
            if actual_profile != (
                expected_profile.browser,
                expected_profile.viewport,
            ):
                raise ManifestProjectProfileError(
                    test.test_id,
                    expected_profile,
                    actual_profile,
                )
        for job in self.jobs:
            if any(test.project != job.project for test in job.tests):
                raise ManifestJobMetadataError(
                    job.job_id,
                    "assigned test project differs from job project",
                )
            if any(test.spec_path != job.spec_path for test in job.tests):
                raise ManifestJobMetadataError(
                    job.job_id,
                    "assigned test spec differs from job spec",
                )
        expected = Counter(test.test_id for test in self.tests)
        assigned = Counter(test.test_id for job in self.jobs for test in job.tests)
        missing = tuple(
            sorted(test_id for test_id in expected if assigned[test_id] == 0)
        )
        duplicates = tuple(
            sorted(
                test_id
                for test_id in expected | assigned
                if expected[test_id] > 1 or assigned[test_id] > 1
            )
        )
        foreign = tuple(
            sorted(test_id for test_id in assigned if test_id not in expected)
        )
        if missing or duplicates or foreign:
            raise ManifestTestCoverageError(
                missing=missing,
                duplicates=duplicates,
                foreign=foreign,
            )

    @property
    def expected_projects(self) -> frozenset[str]:
        return frozenset(test.project for test in self.tests)

    @property
    def expected_test_ids(self) -> frozenset[TestId]:
        return frozenset(test.test_id for test in self.tests)

    def save(self, path: Path) -> None:
        """Persist the immutable coordinator input before workers start."""
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f"{path.suffix}.tmp")
        _ = temporary.write_text(self._to_json(), encoding="utf-8")
        _ = temporary.replace(path)

    def _to_json(self) -> str:
        tests = [
            {
                "test_id": str(test.test_id),
                "project": test.project,
                "spec_path": test.spec_path.as_posix(),
                "line": test.line,
                "title_path": list(test.title_path),
                "browser": test.browser,
                "viewport": list(test.viewport) if test.viewport is not None else None,
                "estimated_seconds": test.estimated_seconds,
            }
            for test in self.tests
        ]
        jobs = [
            {
                "job_id": str(job.job_id),
                "project": job.project,
                "spec_path": job.spec_path.as_posix(),
                "logical_group": job.logical_group,
                "test_ids": [str(test.test_id) for test in job.tests],
                "locks": sorted(job.locks),
                "estimated_seconds": job.estimated_seconds,
            }
            for job in self.jobs
        ]
        return (
            json.dumps(
                {
                    "version": 1,
                    "run_id": str(self.run_id),
                    "playwright_args": list(self.playwright_args),
                    "benchmark_invocation_id": self.benchmark_invocation_id,
                    "benchmark_label": self.benchmark_label,
                    "tests": tests,
                    "jobs": jobs,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            )
            + "\n"
        )
