"""Canonical Playwright reporter resolution for dynamic E2E jobs."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final, override

SUPPORTED_REPORTERS: Final = frozenset(
    {"list", "line", "dot", "json", "junit", "null", "github", "html", "blob"}
)


@dataclass(frozen=True, slots=True)
class ReporterOptionError(ValueError):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


@dataclass(frozen=True, slots=True)
class ResolvedReporters:
    forwarded_args: tuple[str, ...]
    playwright_args: tuple[str, ...]
    reporters: tuple[str, ...]

    def environment(self, html_output_dir: Path) -> Mapping[str, str]:
        if "html" not in self.reporters:
            return {}
        return {
            "PLAYWRIGHT_HTML_OUTPUT_DIR": str(html_output_dir),
            "PLAYWRIGHT_HTML_OPEN": "never",
        }

    def with_internal_reporter(self, reporter_path: Path) -> tuple[str, ...]:
        canonical = self.playwright_args[-1]
        reporters = canonical.removeprefix("--reporter=")
        internal = reporter_path.resolve().as_posix()
        return (
            *self.playwright_args[:-1],
            f"--reporter={reporters},{internal}",
        )


def resolve_reporters(
    playwright_args: tuple[str, ...],
    *,
    include_html: bool,
) -> ResolvedReporters:
    """Remove reporter flags and append one supported canonical reporter option."""
    forwarded: list[str] = []
    reporters: list[str] = []
    index = 0
    while index < len(playwright_args):
        arg = playwright_args[index]
        if arg.startswith("--reporter="):
            _append_reporters(reporters, arg.partition("=")[2])
        elif arg == "--reporter":
            index += 1
            if index >= len(playwright_args):
                raise ReporterOptionError("--reporter requires a reporter value")
            _append_reporters(reporters, playwright_args[index])
        else:
            forwarded.append(arg)
        index += 1

    _append_once(reporters, "json")
    if include_html:
        _append_once(reporters, "html")
    canonical = f"--reporter={','.join(reporters)}"
    return ResolvedReporters(
        forwarded_args=tuple(forwarded),
        playwright_args=(*forwarded, canonical),
        reporters=tuple(reporters),
    )


def _append_reporters(reporters: list[str], raw: str) -> None:
    requested = tuple(part.strip() for part in raw.split(","))
    if not requested or any(not reporter for reporter in requested):
        raise ReporterOptionError("--reporter requires non-empty reporter values")
    unsupported = tuple(
        reporter for reporter in requested if reporter not in SUPPORTED_REPORTERS
    )
    if unsupported:
        reason = "unsupported custom reporter for dynamic canonical list: " + (
            ", ".join(unsupported)
        )
        raise ReporterOptionError(reason)
    for reporter in requested:
        _append_once(reporters, reporter)


def _append_once(reporters: list[str], reporter: str) -> None:
    if reporter not in reporters:
        reporters.append(reporter)
