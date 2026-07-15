"""Versioned per-test duration history for scheduler estimates."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Final, override

from scripts.e2e_scheduler.history_schema import (
    SAMPLE_LIMIT,
    BrowserOverheadPayload,
    HistoryPayloadValidationError,
    HistoryRecordPayload,
    HistoryVersion,
    parse_history_json,
    render_history_json,
)
from scripts.e2e_scheduler.model import TestId

DEFAULT_ESTIMATED_SECONDS: Final = 30.0
HISTORY_VERSION: Final = 2


@dataclass(frozen=True, slots=True)
class DurationHistoryFormatError(Exception):
    path: Path
    detail: str

    @override
    def __str__(self) -> str:
        return f"invalid duration history {self.path}: {self.detail}"


@dataclass(frozen=True, slots=True)
class InvalidDurationError(Exception):
    test_id: TestId
    seconds: float

    @override
    def __str__(self) -> str:
        return f"duration for {self.test_id} must be positive, got {self.seconds}"


@dataclass(frozen=True, slots=True)
class InvalidBoundaryDurationError(Exception):
    browser: str
    seconds: float

    @override
    def __str__(self) -> str:
        return (
            f"job boundary for {self.browser} must be non-negative, got {self.seconds}"
        )


@dataclass(frozen=True, slots=True)
class DurationRecord:
    test_id: TestId
    spec_path: Path
    seconds: float
    samples_seconds: tuple[float, ...] = ()


@dataclass(frozen=True, slots=True)
class BrowserOverheadRecord:
    browser: str
    samples_seconds: tuple[float, ...]


@dataclass(frozen=True, slots=True)
class DurationResult:
    test_id: TestId
    spec_path: Path
    seconds: float
    complete: bool
    browser: str | None = None
    job_boundary_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class DurationHistory:
    records: tuple[DurationRecord, ...]
    browser_overheads: tuple[BrowserOverheadRecord, ...] = ()
    version: HistoryVersion = HISTORY_VERSION

    @classmethod
    def empty(cls) -> DurationHistory:
        return cls(records=())

    @classmethod
    def load(cls, path: Path) -> DurationHistory:
        if not path.exists():
            return cls.empty()
        try:
            loaded = parse_history_json(path.read_bytes())
        except HistoryPayloadValidationError as error:
            raise DurationHistoryFormatError(path=path, detail=str(error)) from error
        history = cls(
            records=tuple(
                DurationRecord(
                    TestId(record.test_id),
                    Path(record.spec_path),
                    record.seconds,
                    record.samples_seconds,
                )
                for record in loaded.records
            ),
            browser_overheads=tuple(
                BrowserOverheadRecord(record.browser, record.samples_seconds)
                for record in loaded.browser_overheads
            ),
            version=loaded.version,
        )
        history._verify_unique(path)
        return history

    def estimate(self, test_id: TestId, spec_path: Path) -> float:
        exact = next(
            (record.seconds for record in self.records if record.test_id == test_id),
            None,
        )
        if exact is not None:
            return exact
        spec_durations = [
            record.seconds for record in self.records if record.spec_path == spec_path
        ]
        return (
            float(median(spec_durations))
            if spec_durations
            else DEFAULT_ESTIMATED_SECONDS
        )

    def browser_overhead(self, browser: str) -> float:
        samples = next(
            (
                record.samples_seconds
                for record in self.browser_overheads
                if record.browser == browser
            ),
            (),
        )
        return float(median(samples)) if samples else 0.0

    def with_results(self, results: tuple[DurationResult, ...]) -> DurationHistory:
        complete = tuple(result for result in results if result.complete)
        if not complete:
            return self
        # V1 records are equal-share estimates, not measured test samples.  They
        # remain useful for the run that loaded them, but only tests measured by
        # the first complete green run may cross the v2 actual-duration boundary.
        merged = (
            {record.test_id: record for record in self.records}
            if self.version == 2
            else {}
        )
        overheads_by_browser: dict[str, list[float]] = {}
        for result in complete:
            if result.seconds <= 0:
                raise InvalidDurationError(result.test_id, result.seconds)
            previous = merged.get(result.test_id)
            previous_samples = (
                previous.samples_seconds
                if previous is not None and self.version == 2
                else ()
            )
            samples = _append_sample(previous_samples, result.seconds)
            merged[result.test_id] = DurationRecord(
                result.test_id,
                result.spec_path,
                float(median(samples)),
                samples,
            )
            if result.job_boundary_seconds is not None:
                browser = result.browser or "unknown"
                if result.job_boundary_seconds < 0:
                    raise InvalidBoundaryDurationError(
                        browser, result.job_boundary_seconds
                    )
                overheads_by_browser.setdefault(browser, []).append(
                    result.job_boundary_seconds
                )
        overheads = {record.browser: record for record in self.browser_overheads}
        for browser, run_values in overheads_by_browser.items():
            previous = overheads.get(browser)
            samples = _append_sample(
                previous.samples_seconds if previous else (),
                float(median(run_values)),
            )
            overheads[browser] = BrowserOverheadRecord(browser, samples)
        return DurationHistory(
            records=tuple(sorted(merged.values(), key=lambda item: str(item.test_id))),
            browser_overheads=tuple(
                sorted(overheads.values(), key=lambda item: item.browser)
            ),
            version=2,
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(f"{path.suffix}.tmp")
        _ = temporary.write_text(
            render_history_json(
                self.version,
                tuple(
                    HistoryRecordPayload(
                        str(record.test_id),
                        record.spec_path.as_posix(),
                        record.seconds,
                        record.samples_seconds,
                    )
                    for record in self.records
                ),
                tuple(
                    BrowserOverheadPayload(record.browser, record.samples_seconds)
                    for record in self.browser_overheads
                ),
            ),
            encoding="utf-8",
        )
        _ = temporary.replace(path)

    def _verify_unique(self, path: Path) -> None:
        if len({record.test_id for record in self.records}) != len(self.records):
            raise DurationHistoryFormatError(path=path, detail="duplicate test_id")
        if len({record.browser for record in self.browser_overheads}) != len(
            self.browser_overheads
        ):
            raise DurationHistoryFormatError(path=path, detail="duplicate browser")


def _append_sample(samples: tuple[float, ...], value: float) -> tuple[float, ...]:
    return (*samples, value)[-SAMPLE_LIMIT:]
