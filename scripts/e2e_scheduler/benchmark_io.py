"""Versioned benchmark JSON persistence."""

from __future__ import annotations

from pathlib import Path
from dataclasses import dataclass
from typing import Final, override

from pydantic import TypeAdapter, ValidationError

from scripts.e2e_scheduler.benchmark import BenchmarkDocument

_ADAPTER: Final = TypeAdapter(BenchmarkDocument)


@dataclass(frozen=True, slots=True)
class BenchmarkDocumentError(ValueError):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


def load_document(path: Path) -> BenchmarkDocument | None:
    if not path.exists():
        return None
    try:
        return _ADAPTER.validate_json(path.read_bytes())
    except OSError as error:
        raise BenchmarkDocumentError(f"cannot read {path}: {error}") from error
    except ValidationError as error:
        raise BenchmarkDocumentError(f"invalid benchmark document {path}: {error}") from error


def save_document(path: Path, document: BenchmarkDocument) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    try:
        _ = temporary.write_bytes(_ADAPTER.dump_json(document, indent=2) + b"\n")
        _ = temporary.replace(path)
    except OSError as error:
        raise BenchmarkDocumentError(f"cannot write {path}: {error}") from error
