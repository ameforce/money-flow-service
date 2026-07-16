"""Parse runner-only options without changing Playwright's CLI contract."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import os
from typing import override

from scripts.e2e_scheduler.playwright_compat import (
    PlaywrightCompatibilityError,
    classify_playwright_args,
)
from scripts.e2e_scheduler.reporters import ReporterOptionError, resolve_reporters


class RunnerMode(StrEnum):
    DYNAMIC = "dynamic"
    LEGACY = "legacy"


@dataclass(slots=True)
class RunnerOptionError(ValueError):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


@dataclass(frozen=True, slots=True)
class RunnerOptions:
    mode: RunnerMode
    scheduler_workers: int
    adaptive_workers: bool
    benchmark_label: str | None
    html_report: bool
    project_matrix: bool
    include_slow: bool
    playwright_args: tuple[str, ...]
    discovery_args: tuple[str, ...] = ()
    job_args: tuple[str, ...] = ()
    scheduler_smoke_workers: int | None = None


def parse_runner_options(
    args: list[str],
    *,
    platform_name: str | None = None,
) -> RunnerOptions:
    """Separate runner flags and select the local execution mode."""
    host_platform = os.name if platform_name is None else platform_name
    playwright_args: list[str] = []
    legacy_runner = False
    scheduler_workers = 8
    scheduler_workers_explicit = False
    scheduler_smoke_workers: int | None = None
    adaptive_workers = False
    benchmark_label: str | None = None
    html_report = False
    project_matrix = False
    include_slow = False
    npm_separator_consumed = False
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--" and not npm_separator_consumed:
            npm_separator_consumed = True
        elif arg == "--legacy-runner":
            legacy_runner = True
        elif arg == "--adaptive-workers":
            adaptive_workers = True
        elif arg == "--html-report":
            html_report = True
        elif arg == "--project-matrix":
            project_matrix = True
        elif arg == "--include-slow":
            include_slow = True
        elif arg.startswith("--scheduler-workers="):
            scheduler_workers = _parse_worker_count(arg.partition("=")[2])
            scheduler_workers_explicit = True
        elif arg == "--scheduler-workers":
            index += 1
            if index >= len(args):
                raise RunnerOptionError("--scheduler-workers requires a value")
            scheduler_workers = _parse_worker_count(args[index])
            scheduler_workers_explicit = True
        elif arg.startswith("--scheduler-smoke-workers="):
            scheduler_smoke_workers = _parse_smoke_worker_count(
                arg.partition("=")[2]
            )
        elif arg == "--scheduler-smoke-workers":
            index += 1
            if index >= len(args):
                raise RunnerOptionError(
                    "--scheduler-smoke-workers requires a value"
                )
            scheduler_smoke_workers = _parse_smoke_worker_count(args[index])
        elif arg.startswith("--benchmark-label="):
            benchmark_label = _parse_benchmark_label(arg.partition("=")[2])
        elif arg == "--benchmark-label":
            index += 1
            if index >= len(args):
                raise RunnerOptionError("--benchmark-label requires a value")
            benchmark_label = _parse_benchmark_label(args[index])
        else:
            playwright_args.append(arg)
        index += 1

    mode = _resolve_mode(legacy_runner, project_matrix, host_platform)
    if scheduler_workers_explicit and scheduler_smoke_workers is not None:
        raise RunnerOptionError(
            "--scheduler-workers and --scheduler-smoke-workers cannot be combined"
        )
    if scheduler_smoke_workers is not None:
        scheduler_workers = scheduler_smoke_workers
    if mode is RunnerMode.DYNAMIC and adaptive_workers and scheduler_workers < 4:
        raise RunnerOptionError(
            "--adaptive-workers requires --scheduler-workers in 4..10"
        )
    if mode is RunnerMode.DYNAMIC and adaptive_workers and host_platform != "nt":
        raise RunnerOptionError(
            "--adaptive-workers requires the Windows resource sampler"
        )
    discovery_args = tuple(playwright_args)
    job_args = tuple(playwright_args)
    if mode is RunnerMode.DYNAMIC:
        try:
            classified = classify_playwright_args(tuple(playwright_args))
            reporting = resolve_reporters(
                tuple(playwright_args),
                include_html=html_report,
            )
            job_reporting = resolve_reporters(
                classified.job,
                include_html=html_report,
            )
        except (PlaywrightCompatibilityError, ReporterOptionError) as error:
            raise RunnerOptionError(str(error)) from error
        playwright_args = list(reporting.playwright_args)
        discovery_args = classified.discovery
        job_args = job_reporting.playwright_args
        if host_platform != "nt":
            message = (
                "dynamic local E2E requires Windows; "
                "use --legacy-runner on non-Windows hosts"
            )
            raise RunnerOptionError(message)
    return RunnerOptions(
        mode=mode,
        scheduler_workers=scheduler_workers,
        adaptive_workers=adaptive_workers,
        benchmark_label=benchmark_label,
        html_report=html_report,
        project_matrix=project_matrix,
        include_slow=include_slow,
        playwright_args=tuple(playwright_args),
        discovery_args=discovery_args,
        job_args=job_args,
        scheduler_smoke_workers=scheduler_smoke_workers,
    )


def _resolve_mode(
    legacy_runner: bool,
    project_matrix: bool,
    platform_name: str,
) -> RunnerMode:
    if legacy_runner:
        return RunnerMode.LEGACY
    explicit = os.environ.get("E2E_RUNNER_MODE", "").strip().lower()
    if explicit not in {"", RunnerMode.DYNAMIC, RunnerMode.LEGACY}:
        raise RunnerOptionError(
            f"E2E_RUNNER_MODE must be dynamic or legacy, got {explicit!r}"
        )
    if explicit:
        return RunnerMode(explicit)
    if platform_name == "nt" and not os.environ.get("CI") and project_matrix:
        return RunnerMode.DYNAMIC
    return RunnerMode.LEGACY


def _parse_worker_count(raw: str) -> int:
    try:
        workers = int(raw)
    except ValueError as error:
        raise RunnerOptionError(
            f"--scheduler-workers requires an integer in 4..10, got {raw!r}"
        ) from error
    if not 4 <= workers <= 10:
        raise RunnerOptionError(
            f"--scheduler-workers must be in 4..10, got {workers}"
        )
    return workers


def _parse_smoke_worker_count(raw: str) -> int:
    try:
        workers = int(raw)
    except ValueError as error:
        raise RunnerOptionError(
            f"--scheduler-smoke-workers requires an integer in 1..3, got {raw!r}"
        ) from error
    if not 1 <= workers <= 3:
        raise RunnerOptionError(
            f"--scheduler-smoke-workers must be in 1..3, got {workers}"
        )
    return workers


def _parse_benchmark_label(raw: str) -> str:
    label = raw.strip()
    if not label:
        raise RunnerOptionError("--benchmark-label requires non-empty text")
    return label
