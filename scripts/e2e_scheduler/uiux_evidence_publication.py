"""Transactional publication of job-owned mobile UI/UX evidence."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath, PureWindowsPath
import shutil
from typing import ClassVar, Final, override

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from scripts.e2e_scheduler.publication_transaction import (
    PreparedPublication,
    PublicationTransactionError,
    commit_publications,
    discard_publication,
    prepare_publication,
)


EVIDENCE_VERSION: Final = "mobile-uiux-v0.1.49"
_TARGET_PARENT: Final = Path(".omo") / "evidence"


@dataclass(frozen=True, slots=True)
class UiuxEvidencePublicationError(Exception):
    """Fail-closed UI/UX evidence validation or publication failure."""

    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


class _ArtifactMetadata(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True, extra="allow")

    artifact: str = Field(min_length=1)


@dataclass(frozen=True, slots=True)
class _EvidenceFile:
    source: Path
    relative_path: Path


def publish_uiux_evidence(
    job_roots: tuple[Path, ...],
    repository_root: Path,
) -> tuple[str, ...]:
    """Publish validated job-owned evidence into the repository evidence tree."""
    prepared = prepare_uiux_evidence(job_roots, repository_root)
    if prepared is None:
        return ()
    try:
        commit_publications((prepared,))
    except PublicationTransactionError as error:
        discard_publication(prepared)
        raise UiuxEvidencePublicationError(str(error)) from error
    return prepared.published_files


def prepare_uiux_evidence(
    job_roots: tuple[Path, ...],
    repository_root: Path,
) -> PreparedPublication | None:
    """Validate and stage job-owned evidence without swapping its target."""
    try:
        evidence_files = _collect_evidence(job_roots)
    except OSError as error:
        raise UiuxEvidencePublicationError(
            f"evidence discovery failed: {error}"
        ) from error
    if not evidence_files:
        return None

    output_root = repository_root / _TARGET_PARENT / EVIDENCE_VERSION
    if output_root.exists() and not output_root.is_dir():
        raise UiuxEvidencePublicationError(
            f"publication target is not a directory: {output_root}"
        )
    names = tuple(file.relative_path.as_posix() for file in evidence_files)
    try:
        prepared = prepare_publication(repository_root, output_root, names)
    except (OSError, PublicationTransactionError) as error:
        raise UiuxEvidencePublicationError(f"publication failed: {error}") from error
    try:
        for evidence_file in evidence_files:
            destination = prepared.stage / evidence_file.relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            _ = shutil.copyfile(evidence_file.source, destination)
    except OSError as error:
        discard_publication(prepared)
        raise UiuxEvidencePublicationError(f"publication failed: {error}") from error
    return prepared


def _collect_evidence(job_roots: tuple[Path, ...]) -> tuple[_EvidenceFile, ...]:
    files_by_destination: dict[str, _EvidenceFile] = {}
    metadata_files: list[_EvidenceFile] = []
    png_destinations: set[str] = set()
    for job_root in job_roots:
        if job_root.is_symlink() or job_root.is_junction():
            raise UiuxEvidencePublicationError(
                f"evidence job root cannot be a link: {job_root}"
            )
        version_root = job_root / EVIDENCE_VERSION
        if not version_root.exists():
            continue
        if version_root.is_symlink() or version_root.is_junction():
            raise UiuxEvidencePublicationError(
                f"evidence version root cannot be a link: {version_root}"
            )
        if not version_root.is_dir():
            raise UiuxEvidencePublicationError(
                f"evidence version root is not a directory: {version_root}"
            )
        for source in sorted(version_root.rglob("*")):
            if source.is_symlink() or source.is_junction():
                raise UiuxEvidencePublicationError(
                    f"linked evidence path is forbidden: {source}"
                )
            _ensure_contained(source, version_root)
            if source.is_dir():
                continue
            relative_path = source.relative_to(version_root)
            _validate_file_shape(source, relative_path)
            destination = relative_path.as_posix()
            if destination in files_by_destination:
                raise UiuxEvidencePublicationError(
                    f"evidence filename collision: {destination}"
                )
            evidence_file = _EvidenceFile(source, relative_path)
            files_by_destination[destination] = evidence_file
            if source.suffix == ".json":
                metadata_files.append(evidence_file)
            else:
                png_destinations.add(destination)

    referenced_pngs: set[str] = set()
    for metadata_file in metadata_files:
        artifact = _parse_artifact(metadata_file.source)
        referenced = metadata_file.relative_path.parent / artifact
        referenced_name = referenced.as_posix()
        png_source = metadata_file.source.parent / artifact
        if not png_source.is_file():
            raise UiuxEvidencePublicationError(
                f"metadata references missing PNG: {metadata_file.relative_path}"
            )
        if png_source.stat().st_size == 0:
            raise UiuxEvidencePublicationError(f"empty evidence file: {png_source}")
        if referenced_name in referenced_pngs:
            raise UiuxEvidencePublicationError(
                f"multiple metadata files reference PNG: {referenced_name}"
            )
        referenced_pngs.add(referenced_name)
    orphaned = sorted(png_destinations - referenced_pngs)
    if orphaned:
        raise UiuxEvidencePublicationError(
            f"unreferenced PNG evidence: {', '.join(orphaned)}"
        )
    return tuple(files_by_destination[name] for name in sorted(files_by_destination))


def _ensure_contained(source: Path, version_root: Path) -> None:
    try:
        _ = source.resolve().relative_to(version_root.resolve())
    except ValueError as error:
        raise UiuxEvidencePublicationError(
            f"evidence path escaped its job root: {source}"
        ) from error


def _validate_file_shape(source: Path, relative_path: Path) -> None:
    if source.is_symlink():
        raise UiuxEvidencePublicationError(f"symlink evidence is forbidden: {source}")
    if len(relative_path.parts) != 2:
        raise UiuxEvidencePublicationError(
            f"evidence file must be finding/file: {relative_path.as_posix()}"
        )
    if source.suffix not in {".json", ".png"}:
        raise UiuxEvidencePublicationError(
            f"unsupported evidence file: {relative_path.as_posix()}"
        )
    if source.stat().st_size == 0:
        raise UiuxEvidencePublicationError(f"empty evidence file: {source}")


def _parse_artifact(metadata_path: Path) -> str:
    try:
        metadata = _ArtifactMetadata.model_validate_json(metadata_path.read_bytes())
    except ValidationError as error:
        raise UiuxEvidencePublicationError(
            f"invalid evidence metadata: {metadata_path}: {error}"
        ) from error
    artifact = metadata.artifact
    posix_path = PurePosixPath(artifact)
    windows_path = PureWindowsPath(artifact)
    valid_filename = (
        len(posix_path.parts) == 1
        and len(windows_path.parts) == 1
        and not posix_path.is_absolute()
        and not windows_path.is_absolute()
        and artifact not in {".", ".."}
    )
    if not valid_filename:
        raise UiuxEvidencePublicationError(
            f"artifact must be a same-directory PNG filename: {artifact}"
        )
    if Path(artifact).suffix != ".png":
        raise UiuxEvidencePublicationError(
            f"artifact must be a PNG filename: {artifact}"
        )
    return artifact
