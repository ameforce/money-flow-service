"""Build exact project/spec/logical-group scheduler jobs."""

from __future__ import annotations

from dataclasses import dataclass, replace
from hashlib import sha256
from pathlib import Path
from typing import Final, Protocol, override

from scripts.e2e_scheduler.discovery_parser import (
    DuplicateDiscoveredTestError,
    canonical_test_id,
)
from scripts.e2e_scheduler.history import DurationHistory
from scripts.e2e_scheduler.model import DiscoveredTest, JobId, JobSpec, TestId
from scripts.e2e_scheduler.resource_locks import (
    CurrentResourceLockResolver,
    ResourceLockCandidate,
    ResourceLockResolver,
)


PLAYWRIGHT_TEST_DIR: Final = Path("e2e/specs")


class LogicalGroupResolver(Protocol):
    def resolve(self, test: DiscoveredTest) -> str | None:
        raise NotImplementedError


@dataclass(slots=True)
class UnassignedLogicalGroupError(Exception):
    test_id: TestId

    @override
    def __str__(self) -> str:
        return f"logical group resolver did not assign {self.test_id}"


@dataclass(slots=True)
class DiscoveredTestIdentityError(Exception):
    test_id: TestId

    @override
    def __str__(self) -> str:
        return f"test identity no longer matches discovered metadata: {self.test_id}"


@dataclass(slots=True)
class DuplicateTestSelectorError(Exception):
    selector: str

    @override
    def __str__(self) -> str:
        return f"test-list selector cannot span logical groups: {self.selector}"


@dataclass(slots=True)
class SpecPathOutsideTestDirectoryError(Exception):
    path: Path

    @override
    def __str__(self) -> str:
        return f"test-list spec is outside {PLAYWRIGHT_TEST_DIR}: {self.path}"


def build_jobs(
    discovered: tuple[DiscoveredTest, ...],
    history: DurationHistory,
    resolver: LogicalGroupResolver,
    *,
    resource_lock_resolver: ResourceLockResolver | None = None,
) -> tuple[JobSpec, ...]:
    grouped: dict[tuple[str, Path, str], list[DiscoveredTest]] = {}
    selector_groups: dict[tuple[str, Path, int], str] = {}
    assigned: set[TestId] = set()
    for test in discovered:
        if test.test_id in assigned:
            raise DuplicateDiscoveredTestError(test_id=test.test_id)
        logical_group = resolver.resolve(test)
        if logical_group is None or not logical_group.strip():
            raise UnassignedLogicalGroupError(test_id=test.test_id)
        selector_key = (test.project, test.spec_path, test.line)
        existing_group = selector_groups.get(selector_key)
        if existing_group is not None and existing_group != logical_group:
            raise DuplicateTestSelectorError(
                selector=f"{test.spec_path.as_posix()}:{test.line}"
            )
        selector_groups[selector_key] = logical_group
        estimated_test = replace(
            test,
            estimated_seconds=history.estimate(test.test_id, test.spec_path),
        )
        grouped.setdefault(
            (test.project, test.spec_path, logical_group),
            [],
        ).append(estimated_test)
        assigned.add(test.test_id)

    lock_resolver = (
        CurrentResourceLockResolver()
        if resource_lock_resolver is None
        else resource_lock_resolver
    )
    jobs: list[JobSpec] = []
    for (project, spec_path, logical_group), tests in grouped.items():
        sorted_tests = tuple(sorted(tests, key=_test_sort_key))
        locks = lock_resolver.resolve(
            ResourceLockCandidate(
                project=project,
                spec_path=spec_path,
                logical_group=logical_group,
                tests=sorted_tests,
            )
        )
        jobs.append(
            JobSpec(
                job_id=_job_id(project, spec_path, logical_group),
                project=project,
                spec_path=spec_path,
                logical_group=logical_group,
                tests=sorted_tests,
                locks=locks,
                estimated_seconds=(
                    sum(test.estimated_seconds for test in sorted_tests)
                    + history.browser_overhead(sorted_tests[0].browser)
                ),
            )
        )
    return tuple(
        sorted(
            jobs,
            key=lambda job: (
                job.project,
                job.spec_path.as_posix(),
                job.logical_group,
            ),
        )
    )


def write_test_list(job: JobSpec, path: Path) -> None:
    selectors: list[str] = []
    for test in job.tests:
        expected_id = canonical_test_id(
            test.project,
            test.spec_path,
            test.line,
            test.title_path,
        )
        if expected_id != test.test_id:
            raise DiscoveredTestIdentityError(test_id=test.test_id)
        try:
            test_list_path = test.spec_path.relative_to(PLAYWRIGHT_TEST_DIR)
        except ValueError as error:
            raise SpecPathOutsideTestDirectoryError(path=test.spec_path) from error
        title = " › ".join(test.title_path)
        selectors.append(
            f"[{test.project}] › {test_list_path.as_posix()}:{test.line} › {title}"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_text("\n".join(selectors) + "\n", encoding="utf-8")


def _job_id(project: str, spec_path: Path, logical_group: str) -> JobId:
    identity = f"{project}\0{spec_path.as_posix()}\0{logical_group}"
    digest = sha256(identity.encode()).hexdigest()[:16]
    return JobId(f"job-{digest}")


def _test_sort_key(test: DiscoveredTest) -> tuple[str, str, int, tuple[str, ...]]:
    return (test.project, test.spec_path.as_posix(), test.line, test.title_path)
