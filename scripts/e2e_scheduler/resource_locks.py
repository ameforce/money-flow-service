"""Declarative analysis for genuinely shared E2E resources."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final, Protocol, override

from scripts.e2e_scheduler.model import DiscoveredTest


PLAYWRIGHT_TEST_DIR: Final = Path("e2e/specs")


class SharedResourceLock(StrEnum):
    """Coordinator locks permitted to serialize external shared state."""

    MAIL_SERVER = "mail-server"
    REGISTRATION_RATE_STATE = "registration-rate-state"
    GLOBAL_VERSION_CONFIG = "global-version-config"
    MIGRATION_PACKAGE = "migration-package"
    LEGACY_EVIDENCE_ROOT = "legacy-evidence-root"


@dataclass(frozen=True, slots=True)
class ResourceLockCandidate:
    """One project/spec/logical-group job awaiting dependency analysis."""

    project: str
    spec_path: Path
    logical_group: str
    tests: tuple[DiscoveredTest, ...]


class ResourceLockResolver(Protocol):
    """Resolve shared dependencies for one complete scheduler job."""

    def resolve(self, candidate: ResourceLockCandidate) -> frozenset[str]: ...


@dataclass(frozen=True, slots=True)
class ResourceLockDeclaration:
    """Explicit selector and shared resources used by matching jobs."""

    project: str | None
    spec_path: Path
    logical_group: str
    locks: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class UnknownResourceLockError(ValueError):
    resource_name: str

    @override
    def __str__(self) -> str:
        return f"unknown or worker-isolated E2E resource lock: {self.resource_name}"


@dataclass(frozen=True, slots=True)
class InvalidResourceLockDeclarationError(ValueError):
    declaration: ResourceLockDeclaration
    reason: str

    @override
    def __str__(self) -> str:
        return f"invalid E2E resource lock declaration ({self.reason})"


@dataclass(frozen=True, slots=True)
class DeclarativeResourceLockResolver:
    """Validate declarations eagerly and union every matching dependency."""

    declarations: tuple[ResourceLockDeclaration, ...]

    def __post_init__(self) -> None:
        for declaration in self.declarations:
            _validate_declaration(declaration)
            _ = _resolve_declared_locks(declaration)

    def resolve(self, candidate: ResourceLockCandidate) -> frozenset[str]:
        resolved: set[str] = set()
        for declaration in self.declarations:
            if not _matches(declaration, candidate):
                continue
            resolved.update(_resolve_declared_locks(declaration))
        return frozenset(resolved)


# The current matrix has no shared external consumer. Worker DB, HTTP/WS, auth,
# migration output, and evidence paths are isolated by the worker capsule.
CURRENT_RESOURCE_LOCK_DECLARATIONS: Final[
    tuple[ResourceLockDeclaration, ...]
] = ()


@dataclass(frozen=True, slots=True)
class CurrentResourceLockResolver:
    """Analyze jobs against the reviewed production declaration inventory."""

    def resolve(self, candidate: ResourceLockCandidate) -> frozenset[str]:
        return _CURRENT_RESOLVER.resolve(candidate)


_CURRENT_RESOLVER: Final = DeclarativeResourceLockResolver(
    declarations=CURRENT_RESOURCE_LOCK_DECLARATIONS
)


def _validate_declaration(declaration: ResourceLockDeclaration) -> None:
    if declaration.project is not None and not declaration.project.strip():
        raise InvalidResourceLockDeclarationError(
            declaration=declaration,
            reason="project selector is blank",
        )
    if not declaration.logical_group.strip():
        raise InvalidResourceLockDeclarationError(
            declaration=declaration,
            reason="logical group selector is blank",
        )
    if not declaration.locks:
        raise InvalidResourceLockDeclarationError(
            declaration=declaration,
            reason="lock set is empty",
        )
    if declaration.spec_path.is_absolute() or ".." in declaration.spec_path.parts:
        raise InvalidResourceLockDeclarationError(
            declaration=declaration,
            reason=f"spec path is outside {PLAYWRIGHT_TEST_DIR}",
        )
    try:
        _ = declaration.spec_path.relative_to(PLAYWRIGHT_TEST_DIR)
    except ValueError as error:
        raise InvalidResourceLockDeclarationError(
            declaration=declaration,
            reason=f"spec path is outside {PLAYWRIGHT_TEST_DIR}",
        ) from error
    if not declaration.spec_path.name.endswith(".spec.js"):
        raise InvalidResourceLockDeclarationError(
            declaration=declaration,
            reason="spec path is not a Playwright spec",
        )


def _resolve_declared_locks(
    declaration: ResourceLockDeclaration,
) -> frozenset[str]:
    resolved: set[str] = set()
    for resource_name in declaration.locks:
        try:
            resource = SharedResourceLock(resource_name)
        except ValueError as error:
            raise UnknownResourceLockError(resource_name=resource_name) from error
        resolved.add(resource.value)
    return frozenset(resolved)


def _matches(
    declaration: ResourceLockDeclaration,
    candidate: ResourceLockCandidate,
) -> bool:
    project_matches = (
        declaration.project is None or declaration.project == candidate.project
    )
    return (
        project_matches
        and declaration.spec_path == candidate.spec_path
        and declaration.logical_group == candidate.logical_group
    )
