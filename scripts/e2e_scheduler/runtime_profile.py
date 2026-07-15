"""Typed parser for an independently reported Playwright runtime profile."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Literal, override

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class _ViewportInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    width: int = Field(gt=0)
    height: int = Field(gt=0)


class _RuntimeProfileInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1]
    project: str = Field(min_length=1)
    browser: str = Field(min_length=1)
    viewport: _ViewportInput | None


@dataclass(frozen=True, slots=True)
class RuntimeProfile:
    project: str
    browser: str
    viewport: tuple[int, int] | None


@dataclass(slots=True)
class RuntimeProfileError(Exception):
    path: Path
    reason: str

    @override
    def __str__(self) -> str:
        return f"invalid runtime profile {self.path}: {self.reason}"


def parse_runtime_profile(path: Path) -> RuntimeProfile:
    try:
        parsed = _RuntimeProfileInput.model_validate_json(
            path.read_text(encoding="utf-8")
        )
    except OSError as error:
        raise RuntimeProfileError(path=path, reason=str(error)) from error
    except ValidationError as error:
        raise RuntimeProfileError(path=path, reason=str(error)) from error
    viewport = parsed.viewport
    return RuntimeProfile(
        project=parsed.project,
        browser=parsed.browser,
        viewport=(viewport.width, viewport.height) if viewport is not None else None,
    )
