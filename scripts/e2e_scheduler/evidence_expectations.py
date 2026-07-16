"""Fail-closed parser for evidence expectations recorded before capture."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePath
from typing import Annotated, ClassVar, Literal, override

from pydantic import BaseModel, ConfigDict, Field, RootModel, ValidationError


@dataclass(frozen=True, order=True, slots=True)
class SemanticEvidenceIdentity:
    test_id: str
    capture_label: str


class _EvidenceExpectationV1(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1]
    kind: Literal["screenshot"]
    filename: str = Field(min_length=5, pattern=r"^[^/\\]+\.png$")

    def semantic_identity(self) -> None:
        return None


class _EvidenceExpectationV2(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    version: Literal[2]
    kind: Literal["screenshot"]
    filename: str = Field(min_length=5, pattern=r"^[^/\\]+\.png$")
    test_id: str = Field(min_length=1)
    capture_label: str = Field(min_length=1)

    def semantic_identity(self) -> SemanticEvidenceIdentity:
        return SemanticEvidenceIdentity(self.test_id, self.capture_label)


type _EvidenceExpectation = Annotated[
    _EvidenceExpectationV1 | _EvidenceExpectationV2,
    Field(discriminator="version"),
]


class _EvidenceExpectationRoot(RootModel[_EvidenceExpectation]):
    pass


@dataclass(slots=True)
class EvidenceExpectationError(Exception):
    path: Path
    reason: str

    @override
    def __str__(self) -> str:
        return f"invalid evidence expectation journal {self.path}: {self.reason}"


def _parse_line(path: Path, line: str, line_number: int) -> _EvidenceExpectation:
    try:
        parsed = _EvidenceExpectationRoot.model_validate_json(line).root
    except ValidationError as error:
        raise EvidenceExpectationError(
            path=path,
            reason=f"line {line_number}: {error}",
        ) from error
    if PurePath(parsed.filename).name != parsed.filename:
        raise EvidenceExpectationError(
            path=path,
            reason=f"line {line_number}: filename must be a basename",
        )
    return parsed


def _parse_journal(path: Path) -> tuple[_EvidenceExpectation, ...]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise EvidenceExpectationError(path=path, reason=str(error)) from error

    records: list[_EvidenceExpectation] = []
    seen: set[str] = set()
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            raise EvidenceExpectationError(
                path=path,
                reason=f"line {line_number}: blank records are not allowed",
            )
        parsed = _parse_line(path, line, line_number)
        if parsed.filename in seen:
            raise EvidenceExpectationError(
                path=path,
                reason=f"line {line_number}: duplicate filename {parsed.filename!r}",
            )
        seen.add(parsed.filename)
        records.append(parsed)
    return tuple(records)


def parse_evidence_expectations(path: Path) -> tuple[str, ...]:
    return tuple(record.filename for record in _parse_journal(path))


def parse_semantic_evidence_expectations(
    path: Path,
) -> tuple[SemanticEvidenceIdentity, ...]:
    identities: list[SemanticEvidenceIdentity] = []
    for record in _parse_journal(path):
        identity = record.semantic_identity()
        if identity is None:
            raise EvidenceExpectationError(
                path=path,
                reason="semantic identity is unavailable for legacy record",
            )
        identities.append(identity)
    return tuple(identities)
