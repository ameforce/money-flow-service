"""Typed benchmark records, statistics, and fail-closed acceptance."""

from __future__ import annotations

from dataclasses import dataclass
from statistics import median
from typing import Literal, override

from scripts.e2e_scheduler.evidence_expectations import SemanticEvidenceIdentity

type BenchmarkMode = Literal["legacy", "dynamic"]
type BrowserRuntimeDecision = Literal["system-chrome", "playwright-chromium"]


@dataclass(frozen=True, slots=True)
class RunInventory:
    test_ids: tuple[str, ...]
    skipped_test_ids: tuple[str, ...]
    projects: tuple[str, ...]
    browsers: tuple[str, ...]
    viewports: tuple[str, ...]
    expected_scenarios: int
    actual_scenarios: int
    expected_evidence: int
    actual_evidence: int
    passed: int
    failed: int
    skipped: int
    interrupted: int
    missing: int
    evidence_parity_ok: bool = True
    expected_evidence_fingerprint: str = ""
    actual_evidence_fingerprint: str = ""
    semantic_evidence: tuple[SemanticEvidenceIdentity, ...] = ()

    @property
    def exact(self) -> bool:
        return (
            self.expected_scenarios == self.actual_scenarios
            and self.expected_evidence == self.actual_evidence
            and self.failed == 0
            and self.interrupted == 0
            and self.missing == 0
            and self.passed + self.skipped == len(self.test_ids)
            and self.skipped == len(self.skipped_test_ids)
            and self.evidence_parity_ok
            and self.expected_evidence_fingerprint
            == self.actual_evidence_fingerprint
            and len(self.semantic_evidence) == self.expected_evidence
        )


@dataclass(frozen=True, slots=True)
class BrowserRuntimeIdentity:
    decision: BrowserRuntimeDecision
    channel: str | None
    executable_path: str
    browser_version: str


@dataclass(frozen=True, slots=True)
class CapacityDecisionRecord:
    elapsed_seconds: float
    previous: int
    capacity: int
    reason: str
    detail: str


@dataclass(frozen=True, slots=True)
class ConcurrencyMetadata:
    adaptive: bool
    initial: int | None
    minimum: int | None
    maximum: int | None
    started_workers: int | None


@dataclass(frozen=True, slots=True)
class BenchmarkRun:
    mode: BenchmarkMode
    label: str
    git_sha: str
    command: tuple[str, ...]
    started_at: str
    ended_at: str
    wall_seconds: float
    exit_code: int
    run_id: str
    worker_minutes: float
    job_durations_seconds: tuple[float, ...]
    cpu_percent_samples: tuple[float, ...]
    memory_available_percent_samples: tuple[float, ...]
    backend_latency_ms_samples: tuple[float, ...]
    inventory: RunInventory
    cleanup_ok: bool
    system_chrome_policy: str
    browser_runtime: BrowserRuntimeIdentity
    capacity_decisions: tuple[CapacityDecisionRecord, ...]
    cpu_percent_range: tuple[float, float] | None = None
    memory_available_percent_range: tuple[float, float] | None = None
    backend_latency_ms_range: tuple[float, float] | None = None
    concurrency: ConcurrencyMetadata | None = None
    execution_error: str | None = None

    @property
    def green(self) -> bool:
        return (
            self.exit_code == 0
            and self.cleanup_ok
            and self.inventory.exact
            and bool(self.cpu_percent_samples)
            and bool(self.memory_available_percent_samples)
            and bool(self.backend_latency_ms_samples)
        )


@dataclass(frozen=True, slots=True)
class BenchmarkSummary:
    legacy_median_seconds: float
    dynamic_median_seconds: float
    dynamic_worst_seconds: float
    speedup_percent: float
    accepted: bool


@dataclass(frozen=True, slots=True)
class BenchmarkDocument:
    version: Literal[3]
    label: str
    git_sha: str
    runs: tuple[BenchmarkRun, ...]
    summary: BenchmarkSummary | None


@dataclass(slots=True)
class BenchmarkAcceptanceError(RuntimeError):
    reason: str

    @override
    def __str__(self) -> str:
        return f"benchmark acceptance failed: {self.reason}"


def summarize(
    legacy_seconds: tuple[float, ...],
    dynamic_seconds: tuple[float, ...],
) -> BenchmarkSummary:
    if not legacy_seconds or not dynamic_seconds:
        raise BenchmarkAcceptanceError("both modes require measured durations")
    legacy_median = float(median(legacy_seconds))
    dynamic_median = float(median(dynamic_seconds))
    if legacy_median <= 0:
        raise BenchmarkAcceptanceError("legacy median must be positive")
    speedup = 100.0 * (legacy_median - dynamic_median) / legacy_median
    return BenchmarkSummary(
        legacy_median_seconds=legacy_median,
        dynamic_median_seconds=dynamic_median,
        dynamic_worst_seconds=max(dynamic_seconds),
        speedup_percent=speedup,
        accepted=False,
    )


def validate_acceptance(runs: tuple[BenchmarkRun, ...]) -> BenchmarkSummary:
    legacy = tuple(run for run in runs if run.mode == "legacy")
    dynamic = tuple(run for run in runs if run.mode == "dynamic")
    if len(legacy) < 3 or len(dynamic) < 3:
        raise BenchmarkAcceptanceError("at least three runs per mode are required")
    shas = {run.git_sha for run in runs}
    if len(shas) != 1:
        raise BenchmarkAcceptanceError("all runs must use the same Git SHA")
    if len({run.run_id for run in runs}) != len(runs):
        raise BenchmarkAcceptanceError("every benchmark run ID must be unique")
    if any(not run.green for run in runs):
        raise BenchmarkAcceptanceError("every run must be green with exact cleanup/parity")
    reference = legacy[0].inventory
    if any(run.inventory != reference for run in runs):
        raise BenchmarkAcceptanceError("test, skip, profile, or evidence inventory differs")
    browser_runtime = runs[0].browser_runtime
    if any(run.browser_runtime != browser_runtime for run in runs):
        raise BenchmarkAcceptanceError("browser runtime differs across benchmark runs")
    for run in legacy:
        if run.concurrency != ConcurrencyMetadata(False, None, None, None, None):
            raise BenchmarkAcceptanceError("legacy concurrency metadata is invalid")
    for run in dynamic:
        _validate_dynamic_concurrency(run.concurrency)
    summary = summarize(
        tuple(run.wall_seconds for run in legacy),
        tuple(run.wall_seconds for run in dynamic),
    )
    if summary.dynamic_median_seconds > 1500:
        raise BenchmarkAcceptanceError("dynamic median exceeds 25 minutes")
    if summary.dynamic_worst_seconds > 1800:
        raise BenchmarkAcceptanceError("dynamic worst run exceeds 30 minutes")
    if summary.speedup_percent < 50:
        raise BenchmarkAcceptanceError("dynamic median speedup is below 50 percent")
    consecutive = max(
        (length for length in _green_streaks(dynamic)),
        default=0,
    )
    if consecutive < 2:
        raise BenchmarkAcceptanceError("two consecutive dynamic green runs are required")
    return BenchmarkSummary(
        legacy_median_seconds=summary.legacy_median_seconds,
        dynamic_median_seconds=summary.dynamic_median_seconds,
        dynamic_worst_seconds=summary.dynamic_worst_seconds,
        speedup_percent=summary.speedup_percent,
        accepted=True,
    )


def _validate_dynamic_concurrency(
    concurrency: ConcurrencyMetadata | None,
) -> None:
    if concurrency is None:
        raise BenchmarkAcceptanceError("dynamic concurrency metadata is missing")
    if concurrency.adaptive:
        initial = concurrency.initial
        minimum = concurrency.minimum
        maximum = concurrency.maximum
        started = concurrency.started_workers
        if (
            initial is None
            or minimum is None
            or maximum is None
            or started is None
        ):
            raise BenchmarkAcceptanceError("adaptive concurrency bounds are missing")
        if not 4 <= minimum <= initial <= maximum <= min(10, started):
            raise BenchmarkAcceptanceError("adaptive concurrency must remain within 4..10")
        return
    if concurrency != ConcurrencyMetadata(False, 8, 8, 8, 8):
        raise BenchmarkAcceptanceError("fixed dynamic benchmark must use 8 workers")


def _green_streaks(runs: tuple[BenchmarkRun, ...]) -> tuple[int, ...]:
    streaks: list[int] = []
    current = 0
    for run in runs:
        if run.green:
            current += 1
        else:
            if current:
                streaks.append(current)
            current = 0
    if current:
        streaks.append(current)
    return tuple(streaks)
