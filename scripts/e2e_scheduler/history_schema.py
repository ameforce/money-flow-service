"""Versioned JSON boundary for scheduler duration history."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from statistics import median
from types import MappingProxyType
from typing import (
    Annotated,
    ClassVar,
    Final,
    Literal,
    TypedDict,
    override,
)

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

SAMPLE_LIMIT: Final = 5
type HistoryVersion = Literal[1, 2]
type _PositiveSeconds = Annotated[float, Field(gt=0)]
type _NonnegativeSeconds = Annotated[float, Field(ge=0)]


@dataclass(frozen=True, slots=True)
class HistoryPayloadValidationError(Exception):
    detail: str

    @override
    def __str__(self) -> str:
        return self.detail


@dataclass(frozen=True, slots=True)
class ParsedDurationRecord:
    test_id: str
    spec_path: str
    seconds: float
    samples_seconds: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class ParsedBrowserOverhead:
    browser: str
    samples_seconds: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class ParsedHistory:
    records: tuple[ParsedDurationRecord, ...]
    browser_overheads: tuple[ParsedBrowserOverhead, ...]
    version: HistoryVersion


@dataclass(frozen=True, slots=True)
class HistoryRecordPayload:
    test_id: str
    spec_path: str
    seconds: float
    samples_seconds: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class BrowserOverheadPayload:
    browser: str
    samples_seconds: tuple[float, ...]


class _StrictSchema(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)


class _DurationRecordInputV1(_StrictSchema):
    test_id: str = Field(min_length=1)
    spec_path: str = Field(min_length=1)
    seconds: float = Field(gt=0)


class _DurationHistoryInputV1(_StrictSchema):
    version: Literal[1]
    records: tuple[_DurationRecordInputV1, ...]

    def parsed(self) -> ParsedHistory:
        return ParsedHistory(
            records=tuple(
                ParsedDurationRecord(
                    item.test_id,
                    item.spec_path,
                    item.seconds,
                    (),
                )
                for item in self.records
            ),
            browser_overheads=(),
            version=1,
        )


class _DurationRecordInputV2(_StrictSchema):
    test_id: str = Field(min_length=1)
    spec_path: str = Field(min_length=1)
    samples_seconds: tuple[_PositiveSeconds, ...] = Field(
        min_length=1,
        max_length=SAMPLE_LIMIT,
    )


class _BrowserOverheadInputV2(_StrictSchema):
    browser: str = Field(min_length=1)
    samples_seconds: tuple[_NonnegativeSeconds, ...] = Field(
        min_length=1,
        max_length=SAMPLE_LIMIT,
    )


class _DurationHistoryInputV2(_StrictSchema):
    version: Literal[2]
    records: tuple[_DurationRecordInputV2, ...]
    browser_overheads: tuple[_BrowserOverheadInputV2, ...]

    def parsed(self) -> ParsedHistory:
        return ParsedHistory(
            records=tuple(
                ParsedDurationRecord(
                    item.test_id,
                    item.spec_path,
                    float(median(item.samples_seconds)),
                    item.samples_seconds,
                )
                for item in self.records
            ),
            browser_overheads=tuple(
                ParsedBrowserOverhead(item.browser, item.samples_seconds)
                for item in self.browser_overheads
            ),
            version=2,
        )


class _DurationRecordOutputV1(TypedDict):
    test_id: str
    spec_path: str
    seconds: float


class _DurationHistoryOutputV1(TypedDict):
    version: Literal[1]
    records: list[_DurationRecordOutputV1]


class _DurationRecordOutputV2(TypedDict):
    test_id: str
    spec_path: str
    samples_seconds: list[float]


class _BrowserOverheadOutputV2(TypedDict):
    browser: str
    samples_seconds: list[float]


class _DurationHistoryOutputV2(TypedDict):
    version: Literal[2]
    records: list[_DurationRecordOutputV2]
    browser_overheads: list[_BrowserOverheadOutputV2]


type _DurationHistoryOutput = _DurationHistoryOutputV1 | _DurationHistoryOutputV2
type _HistoryRenderer = Callable[
    [tuple[HistoryRecordPayload, ...], tuple[BrowserOverheadPayload, ...]],
    _DurationHistoryOutput,
]


_HISTORY_INPUT: Final[
    TypeAdapter[_DurationHistoryInputV1 | _DurationHistoryInputV2]
] = TypeAdapter(_DurationHistoryInputV1 | _DurationHistoryInputV2)


def parse_history_json(content: bytes) -> ParsedHistory:
    try:
        parsed = _HISTORY_INPUT.validate_json(content)
    except ValidationError as error:
        raise HistoryPayloadValidationError(detail=str(error)) from error
    return parsed.parsed()


def _render_v1(
    records: tuple[HistoryRecordPayload, ...],
    _browser_overheads: tuple[BrowserOverheadPayload, ...],
) -> _DurationHistoryOutput:
    return {
        "version": 1,
        "records": [
            {
                "test_id": record.test_id,
                "spec_path": record.spec_path,
                "seconds": record.seconds,
            }
            for record in records
        ],
    }


def _render_v2(
    records: tuple[HistoryRecordPayload, ...],
    browser_overheads: tuple[BrowserOverheadPayload, ...],
) -> _DurationHistoryOutput:
    return {
        "version": 2,
        "records": [
            {
                "test_id": record.test_id,
                "spec_path": record.spec_path,
                "samples_seconds": list(record.samples_seconds or (record.seconds,)),
            }
            for record in records
        ],
        "browser_overheads": [
            {
                "browser": record.browser,
                "samples_seconds": list(record.samples_seconds),
            }
            for record in browser_overheads
        ],
    }


_HISTORY_RENDERERS: Final[Mapping[HistoryVersion, _HistoryRenderer]] = MappingProxyType(
    {1: _render_v1, 2: _render_v2}
)


def render_history_json(
    version: HistoryVersion,
    records: tuple[HistoryRecordPayload, ...],
    browser_overheads: tuple[BrowserOverheadPayload, ...],
) -> str:
    payload = _HISTORY_RENDERERS[version](records, browser_overheads)
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
