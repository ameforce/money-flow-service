from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

from scripts.e2e_scheduler.history import (
    DurationHistory,
    DurationRecord,
)
from scripts.e2e_scheduler.job_builder import build_jobs
from scripts.e2e_scheduler.model import DiscoveredTest, TestId, WorkerId
from scripts.e2e_scheduler.queue import EligibleJobQueue
from scripts.e2e_scheduler.resource_locks import (
    DeclarativeResourceLockResolver,
    InvalidResourceLockDeclarationError,
    ResourceLockCandidate,
    ResourceLockDeclaration,
    SharedResourceLock,
    UnknownResourceLockError,
)


@dataclass(frozen=True, slots=True)
class _LogicalGroupResolver:
    groups: dict[TestId, str]

    def resolve(self, test: DiscoveredTest) -> str | None:
        return self.groups.get(test.test_id)


def _test(spec_name: str, *, seconds: float) -> DiscoveredTest:
    spec_path = Path(f"e2e/specs/{spec_name}.spec.js")
    test_id = TestId(f"desktop-chromium::{spec_path}:7::behavior")
    return DiscoveredTest(
        test_id=test_id,
        project="desktop-chromium",
        spec_path=spec_path,
        line=7,
        title_path=("behavior",),
        browser="chromium",
        viewport=(1280, 720),
        estimated_seconds=seconds,
    )


def _history(*tests: DiscoveredTest) -> DurationHistory:
    return DurationHistory(
        records=tuple(
            DurationRecord(test.test_id, test.spec_path, test.estimated_seconds)
            for test in tests
        )
    )


def test_build_jobs_unions_every_matching_shared_resource_declaration() -> None:
    # Given
    discovered = _test("registration", seconds=30.0)
    group = "registration"
    resolver = DeclarativeResourceLockResolver(
        declarations=(
            ResourceLockDeclaration(
                project=None,
                spec_path=discovered.spec_path,
                logical_group=group,
                locks=("mail-server",),
            ),
            ResourceLockDeclaration(
                project="desktop-chromium",
                spec_path=discovered.spec_path,
                logical_group=group,
                locks=("registration-rate-state",),
            ),
        )
    )

    # When
    job = build_jobs(
        (discovered,),
        _history(discovered),
        _LogicalGroupResolver(groups={discovered.test_id: group}),
        resource_lock_resolver=resolver,
    )[0]

    # Then
    assert job.locks == frozenset(
        {"mail-server", "registration-rate-state"}
    )


@pytest.mark.parametrize(
    ("project", "spec_path", "logical_group"),
    [
        ("mobile-chromium", Path("e2e/specs/registration.spec.js"), "registration"),
        ("desktop-chromium", Path("e2e/specs/auth.spec.js"), "registration"),
        ("desktop-chromium", Path("e2e/specs/registration.spec.js"), "auth"),
    ],
)
def test_declarative_resolver_does_not_overlock_selector_mismatches(
    project: str,
    spec_path: Path,
    logical_group: str,
) -> None:
    discovered = _test("registration", seconds=30.0)
    resolver = DeclarativeResourceLockResolver(
        declarations=(
            ResourceLockDeclaration(
                project="desktop-chromium",
                spec_path=discovered.spec_path,
                logical_group="registration",
                locks=("mail-server",),
            ),
        )
    )

    locks = resolver.resolve(
        ResourceLockCandidate(
            project=project,
            spec_path=spec_path,
            logical_group=logical_group,
            tests=(discovered,),
        )
    )

    assert locks == frozenset()


def test_shared_resource_registry_excludes_worker_isolated_resources() -> None:
    # Given / When
    declared_names = {resource.value for resource in SharedResourceLock}

    # Then
    assert declared_names == {
        "mail-server",
        "registration-rate-state",
        "global-version-config",
        "migration-package",
        "legacy-evidence-root",
    }
    assert declared_names.isdisjoint(
        {
            "database",
            "backend-port",
            "frontend-port",
            "http",
            "websocket",
            "auth",
            "migration-output",
        }
    )


@pytest.mark.parametrize(
    "resource_name",
    ["database", "backend-port", "websocket", "auth", "migration-output"],
)
def test_declarative_resolver_rejects_non_shared_resource_lock(
    resource_name: str,
) -> None:
    # Given
    declaration = ResourceLockDeclaration(
        project=None,
        spec_path=Path("e2e/specs/example.spec.js"),
        logical_group="all",
        locks=(resource_name,),
    )

    # When / Then
    with pytest.raises(UnknownResourceLockError, match=resource_name):
        _ = DeclarativeResourceLockResolver(declarations=(declaration,))


@pytest.mark.parametrize(
    "spec_path",
    [
        Path("output/migration-result.json"),
        Path("e2e/specs/../migration.spec.js"),
    ],
)
def test_declarative_resolver_rejects_invalid_selector(spec_path: Path) -> None:
    # Given
    declaration = ResourceLockDeclaration(
        project=None,
        spec_path=spec_path,
        logical_group="migration",
        locks=("migration-package",),
    )

    # When / Then
    with pytest.raises(InvalidResourceLockDeclarationError, match="spec path"):
        _ = DeclarativeResourceLockResolver(declarations=(declaration,))


def test_queue_skips_conflicting_job_until_shared_lock_is_released() -> None:
    # Given
    first_shared = _test("shared-a", seconds=90.0)
    second_shared = _test("shared-b", seconds=80.0)
    isolated = _test("isolated", seconds=70.0)
    discovered = (first_shared, second_shared, isolated)
    group = "all"
    lock_resolver = DeclarativeResourceLockResolver(
        declarations=tuple(
            ResourceLockDeclaration(
                project=None,
                spec_path=test.spec_path,
                logical_group=group,
                locks=("mail-server",),
            )
            for test in (first_shared, second_shared)
        )
    )
    jobs = build_jobs(
        discovered,
        _history(*discovered),
        _LogicalGroupResolver(
            groups={test.test_id: group for test in discovered}
        ),
        resource_lock_resolver=lock_resolver,
    )
    queue = EligibleJobQueue(jobs)

    # When
    first = queue.acquire(WorkerId("worker-1"))
    while_first_lock_is_held = queue.acquire(WorkerId("worker-2"))

    # Then
    assert first is not None
    assert first.spec_path == first_shared.spec_path
    assert first.locks == frozenset({"mail-server"})
    assert while_first_lock_is_held is not None
    assert while_first_lock_is_held.spec_path == isolated.spec_path
    assert not while_first_lock_is_held.locks

    # When
    queue.complete(WorkerId("worker-1"), first.job_id)
    after_release = queue.acquire(WorkerId("worker-3"))

    # Then
    assert after_release is not None
    assert after_release.spec_path == second_shared.spec_path
    assert after_release.locks == frozenset({"mail-server"})
