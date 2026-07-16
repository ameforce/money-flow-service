"""Minimal CLI dispatch between dynamic and compatibility runners."""

from __future__ import annotations

from collections.abc import Callable
from scripts.e2e_scheduler.runner_options import (
    RunnerMode,
    RunnerOptionError,
    RunnerOptions,
    parse_runner_options,
)

type LegacyRunner = Callable[[RunnerOptions], int]


def run_cli(args: list[str], legacy_runner: LegacyRunner) -> int:
    try:
        options = parse_runner_options(args)
    except RunnerOptionError as error:
        print(f"[e2e-runner] {error}", flush=True)
        return 2
    if options.mode is RunnerMode.LEGACY:
        return legacy_runner(options)
    from scripts.e2e_scheduler.runner import run_dynamic

    return run_dynamic(options, options.playwright_args)
