"""Fail-closed Playwright argument routing for dynamic scheduling."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, override


_UNSUPPORTED_LONG: Final = frozenset(
    {
        "--browser",
        "--debug",
        "--global-timeout",
        "--help",
        "--last-failed",
        "--list",
        "--max-failures",
        "--output",
        "--repeat-each",
        "--retries",
        "--shard",
        "--test-list",
        "--test-list-invert",
        "--ui",
        "--ui-host",
        "--ui-port",
        "--workers",
    }
)
_UNSUPPORTED_SHORT: Final = frozenset({"-h", "-j", "-x"})
_DYNAMIC_SEMANTICS_UNSUPPORTED: Final = frozenset(
    {"--fully-parallel", "--headed", "--pass-with-no-tests"}
)
_DISCOVERY_VALUE: Final = frozenset({"--grep", "-g", "--grep-invert"})
_DISCOVERY_VARIADIC: Final = frozenset({"--project"})
_DISCOVERY_OPTIONAL: Final = frozenset({"--only-changed"})
_DEFAULT_CONFIG_VALUES: Final = frozenset(
    {"playwright.config.js", "./playwright.config.js", ".\\playwright.config.js"}
)
_CONFIG_VALUE: Final = frozenset({"--config", "-c"})
_SHARED_VALUE: Final = frozenset({"--tsconfig"})
_JOB_VALUE: Final = frozenset(
    {"--reporter", "--timeout", "--trace", "--update-source-method"}
)
_JOB_OPTIONAL: Final = frozenset({"--update-snapshots", "-u"})
_JOB_BOOLEAN: Final = frozenset(
    {
        "--fail-on-flaky-tests",
        "--forbid-only",
        "--ignore-snapshots",
        "--no-deps",
        "--quiet",
    }
)


@dataclass(frozen=True, slots=True)
class PlaywrightArgumentSets:
    discovery: tuple[str, ...]
    job: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PlaywrightCompatibilityError(ValueError):
    option: str
    reason: str

    @override
    def __str__(self) -> str:
        return f"dynamic mode rejects {self.option}: {self.reason}"


def classify_playwright_args(args: tuple[str, ...]) -> PlaywrightArgumentSets:
    """Route compatible arguments without reapplying discovery filters to jobs."""
    discovery: list[str] = []
    job: list[str] = []
    index = 0
    while index < len(args):
        token = args[index]
        name, separator, _inline = token.partition("=")
        if name in _DYNAMIC_SEMANTICS_UNSUPPORTED:
            raise PlaywrightCompatibilityError(
                option=name,
                reason=(
                    "per-job scheduling cannot preserve this flag; "
                    "rerun with --legacy-runner"
                ),
            )
        if _unsupported(name, token):
            raise PlaywrightCompatibilityError(
                option=name,
                reason="suite-global or scheduler-owned semantics cannot be preserved",
            )
        if not token.startswith("-") or token == "--":
            discovery.append(token)
            index += 1
            continue
        if name in _DISCOVERY_VALUE:
            index = _append_required(args, index, discovery, name, separator)
            continue
        if name in _DISCOVERY_VARIADIC:
            index = _append_variadic(args, index, discovery, name, separator)
            continue
        if name in _DISCOVERY_OPTIONAL:
            index = _append_optional(args, index, discovery, separator)
            continue
        if name in _CONFIG_VALUE:
            next_index = _required_end(args, index, name, separator)
            value = _option_value(args, index, separator)
            if value not in _DEFAULT_CONFIG_VALUES:
                raise PlaywrightCompatibilityError(
                    name,
                    "alternate config project/browser profiles are not supported",
                )
            discovery.extend(args[index:next_index])
            job.extend(args[index:next_index])
            index = next_index
            continue
        if name in _SHARED_VALUE:
            next_index = _required_end(args, index, name, separator)
            discovery.extend(args[index:next_index])
            job.extend(args[index:next_index])
            index = next_index
            continue
        if name in _JOB_VALUE:
            index = _append_required(args, index, job, name, separator)
            continue
        if name in _JOB_OPTIONAL:
            index = _append_optional(args, index, job, separator)
            continue
        if name in _JOB_BOOLEAN:
            if separator:
                raise PlaywrightCompatibilityError(name, "flag does not accept a value")
            job.append(token)
            index += 1
            continue
        raise PlaywrightCompatibilityError(name, "unknown option is not classified")
    return PlaywrightArgumentSets(tuple(discovery), tuple(job))


def _unsupported(name: str, token: str) -> bool:
    if name in _UNSUPPORTED_LONG or name in _UNSUPPORTED_SHORT:
        return True
    return token.startswith("-j") and token != "-j"


def _append_required(
    args: tuple[str, ...],
    index: int,
    output: list[str],
    name: str,
    separator: str,
) -> int:
    end = _required_end(args, index, name, separator)
    output.extend(args[index:end])
    return end


def _required_end(
    args: tuple[str, ...],
    index: int,
    name: str,
    separator: str,
) -> int:
    if separator:
        if not args[index].partition("=")[2]:
            raise PlaywrightCompatibilityError(name, "requires a value")
        return index + 1
    if index + 1 >= len(args) or args[index + 1].startswith("-"):
        raise PlaywrightCompatibilityError(name, "requires a value")
    return index + 2


def _option_value(args: tuple[str, ...], index: int, separator: str) -> str:
    if separator:
        return args[index].partition("=")[2]
    return args[index + 1]


def _append_variadic(
    args: tuple[str, ...],
    index: int,
    output: list[str],
    name: str,
    separator: str,
) -> int:
    if separator:
        return _append_required(args, index, output, name, separator)
    end = index + 1
    while end < len(args) and not args[end].startswith("-"):
        end += 1
    if end == index + 1:
        raise PlaywrightCompatibilityError(name, "requires at least one value")
    output.extend(args[index:end])
    return end


def _append_optional(
    args: tuple[str, ...],
    index: int,
    output: list[str],
    separator: str,
) -> int:
    output.append(args[index])
    if separator or index + 1 >= len(args) or args[index + 1].startswith("-"):
        return index + 1
    output.append(args[index + 1])
    return index + 2
