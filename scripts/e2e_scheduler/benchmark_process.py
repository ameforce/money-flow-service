"""Benchmark Git-state, process cleanup, and redaction helpers."""

from __future__ import annotations

from pathlib import Path
from dataclasses import dataclass
import re
import subprocess
from typing import Final, override

from scripts.e2e_scheduler.benchmark import RunInventory
from scripts.e2e_scheduler.processes import OwnedProcess, OwnedProcessCleanupError
from scripts.e2e_scheduler.subprocess_visibility import run_hidden

_SECRET_PATTERN: Final = re.compile(
    r"(?i)(authorization|cookie|password|passwd|secret|token|api[-_]?key)"
)
INTERRUPT_GRACE_SECONDS: Final = 15.0


@dataclass(slots=True)
class BenchmarkExecutionError(RuntimeError):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


def clean_git_sha(repository_root: Path) -> str:
    status = run_hidden(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=repository_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if status.returncode != 0:
        raise BenchmarkExecutionError("failed to read Git worktree status")
    if str(status.stdout).strip():
        raise BenchmarkExecutionError("benchmark requires a clean Git worktree")
    completed = run_hidden(
        ["git", "rev-parse", "HEAD"],
        cwd=repository_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if completed.returncode != 0:
        raise BenchmarkExecutionError("failed to resolve Git HEAD")
    return str(completed.stdout).strip()


def redact_command(command: tuple[str, ...]) -> tuple[str, ...]:
    redacted: list[str] = []
    hide_next = False
    for token in command:
        if hide_next:
            redacted.append("[REDACTED]")
            hide_next = False
        elif _SECRET_PATTERN.search(token):
            if "=" in token:
                redacted.append(f"{token.partition('=')[0]}=[REDACTED]")
            else:
                redacted.append(token)
                hide_next = True
        else:
            redacted.append(token)
    return tuple(redacted)


def stop_owned(process: OwnedProcess) -> bool:
    try:
        process.close()
    except (OSError, OwnedProcessCleanupError, subprocess.TimeoutExpired):
        return False
    return process.process.poll() is not None


def wait_for_interrupt_cleanup(process: OwnedProcess) -> bool:
    """Wait for graceful child cleanup without replacing forced ownership cleanup."""
    try:
        if process.ownership is not None:
            return process.ownership.wait_until_empty(INTERRUPT_GRACE_SECONDS) == 0
        _ = process.process.wait(timeout=INTERRUPT_GRACE_SECONDS)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return True


def failed_inventory(interrupted: bool) -> RunInventory:
    return RunInventory((), (), (), (), (), 1, 0, 1, 0, 0, 1, 0, int(interrupted), 1)


def sample_range(
    values: list[float] | tuple[float, ...],
) -> tuple[float, float] | None:
    return (min(values), max(values)) if values else None
