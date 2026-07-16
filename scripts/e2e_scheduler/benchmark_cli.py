"""Small typed CLI parser for the benchmark harness."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Final, assert_never, override

from pydantic import TypeAdapter, ValidationError

from scripts.e2e_scheduler.benchmark import BenchmarkMode

_MODE_ADAPTER: Final[TypeAdapter[BenchmarkMode]] = TypeAdapter(BenchmarkMode)


@dataclass(frozen=True, slots=True)
class BenchmarkOptions:
    mode: BenchmarkMode
    runs: int
    label: str | None
    output: Path
    command: tuple[str, ...]
    timeout_seconds: float


@dataclass(slots=True)
class BenchmarkOptionError(ValueError):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


def parse_benchmark_options(args: list[str]) -> BenchmarkOptions:
    try:
        separator = args.index("--")
    except ValueError as error:
        raise BenchmarkOptionError("benchmark command must follow --") from error
    options = args[:separator]
    command = tuple(args[separator + 1 :])
    if not command:
        raise BenchmarkOptionError("benchmark command cannot be empty")
    mode: BenchmarkMode | None = None
    runs = 3
    label: str | None = None
    output = Path("output/playwright/e2e-scheduler-benchmark.json")
    timeout_seconds = 14400.0
    index = 0
    while index < len(options):
        name, separator_text, inline = options[index].partition("=")
        if name not in {
            "--mode",
            "--runs",
            "--label",
            "--output",
            "--timeout-seconds",
        }:
            raise BenchmarkOptionError(f"unknown benchmark option: {name}")
        if separator_text:
            value = inline
        else:
            index += 1
            if index >= len(options):
                raise BenchmarkOptionError(f"{name} requires a value")
            value = options[index]
        if name == "--mode":
            mode = _parse_mode(value)
        elif name == "--runs":
            try:
                runs = int(value)
            except ValueError as error:
                raise BenchmarkOptionError("--runs must be an integer") from error
        elif name == "--label":
            label = value
        elif name == "--output":
            output = Path(value)
        else:
            try:
                timeout_seconds = float(value)
            except ValueError as error:
                raise BenchmarkOptionError(
                    "--timeout-seconds must be numeric"
                ) from error
        index += 1
    if mode is None:
        raise BenchmarkOptionError("--mode is required")
    if runs < 1:
        raise BenchmarkOptionError("--runs must be positive")
    if timeout_seconds <= 0:
        raise BenchmarkOptionError("--timeout-seconds must be positive")
    return BenchmarkOptions(mode, runs, label, output, command, timeout_seconds)


def _parse_mode(value: str) -> BenchmarkMode:
    try:
        parsed_mode = _MODE_ADAPTER.validate_python(value)
    except ValidationError as error:
        raise BenchmarkOptionError("--mode must be legacy or dynamic") from error
    match parsed_mode:  # noqa: F841  # noqa: MATCH_OK
        case "legacy":
            return "legacy"
        case "dynamic":
            return "dynamic"
    assert_never(parsed_mode)
