"""Job-owned artifact path validation for fail-closed aggregation."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, override

from scripts.e2e_scheduler.model import JobId


@dataclass(frozen=True, slots=True)
class ArtifactPathError(Exception):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


class JobArtifactResult(Protocol):
    @property
    def job_id(self) -> JobId: ...

    @property
    def repository_root(self) -> Path: ...

    @property
    def report_path(self) -> Path: ...

    @property
    def screenshot_dir(self) -> Path: ...

    @property
    def evidence_dir(self) -> Path: ...

    @property
    def uiux_evidence_root(self) -> Path: ...


def validate_result_artifact_roots(result: JobArtifactResult) -> None:
    roots = (
        (result.screenshot_dir, "screenshots"),
        (result.evidence_dir, "evidence"),
        (result.uiux_evidence_root, "uiux-evidence"),
    )
    for root, name in roots:
        try:
            validate_job_artifact_root(
                result.repository_root,
                result.report_path.parent,
                root,
                name,
            )
        except ArtifactPathError as error:
            raise ArtifactPathError(
                f"job {result.job_id} {name} root is linked or escaped: {error}"
            ) from error


def validate_job_artifact_root(
    repository_root: Path,
    job_root: Path,
    artifact_root: Path,
    expected_name: str,
) -> None:
    """Reject links and resolved escapes from one worker job namespace."""
    expected_root = job_root / expected_name
    if artifact_root != expected_root:
        raise ArtifactPathError(f"{expected_name} root escaped its job namespace")
    _validate_unlinked_path(repository_root, job_root)
    _validate_unlinked_path(job_root, artifact_root)
    resolved_job_root = job_root.resolve()
    resolved_artifact_root = artifact_root.resolve()
    try:
        relative = resolved_artifact_root.relative_to(resolved_job_root)
    except ValueError as error:
        raise ArtifactPathError(
            f"{expected_name} root escaped its job namespace"
        ) from error
    if relative != Path(expected_name):
        raise ArtifactPathError(f"{expected_name} root escaped its job namespace")
    if not artifact_root.exists():
        return
    for child in artifact_root.rglob("*"):
        if child.is_symlink() or child.is_junction():
            raise ArtifactPathError(f"{expected_name} contains a linked artifact")
        try:
            _ = child.resolve().relative_to(resolved_artifact_root)
        except ValueError as error:
            raise ArtifactPathError(
                f"{expected_name} artifact escaped its job namespace"
            ) from error


def _validate_unlinked_path(base: Path, path: Path) -> None:
    try:
        relative = path.relative_to(base)
        _ = path.resolve().relative_to(base.resolve())
    except ValueError as error:
        raise ArtifactPathError(f"{path} is outside {base}") from error
    if ".." in relative.parts:
        raise ArtifactPathError(f"{path} contains parent traversal")
    current = base
    if current.is_symlink() or current.is_junction():
        raise ArtifactPathError(f"linked artifact path component: {current}")
    for part in relative.parts:
        current /= part
        if current.is_symlink() or current.is_junction():
            raise ArtifactPathError(f"linked artifact path component: {current}")
