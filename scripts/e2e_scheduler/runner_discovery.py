"""Accounted Playwright discovery for the local dynamic scheduler."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
import os
import subprocess
from typing import override

from scripts.e2e_scheduler.discovery import discover_tests
from scripts.e2e_scheduler.model import DiscoveredTest
from scripts.e2e_scheduler.owned_command import run_owned_command
from scripts.e2e_scheduler.process_launch import (
    ProcessLaunch,
    resolve_dynamic_windows_spawn_mode,
)
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.project_profiles import PROJECT_PROFILES
from scripts.e2e_scheduler.reporters import resolve_reporters
from scripts.e2e_scheduler.subprocess_visibility import with_hidden_node_children


@dataclass(frozen=True, slots=True)
class DiscoveryProcessError(Exception):
    return_code: int
    stderr: str

    @override
    def __str__(self) -> str:
        return f"Playwright discovery exited {self.return_code}: {self.stderr}"


def discover_local_tests(
    playwright_args: tuple[str, ...],
    repository_root: Path,
    project_matrix: bool,
    environment: Mapping[str, str],
    recorder: ProcessMetricsRecorder,
) -> tuple[DiscoveredTest, ...]:
    discovery_args = resolve_reporters(
        playwright_args,
        include_html=False,
    ).forwarded_args
    command = [
        "npx",
        "playwright",
        "test",
        *discovery_args,
        "--list",
        "--reporter=json",
    ]
    if os.name == "nt":
        command = ["cmd", "/c", *command]
    completed = run_owned_command(
        ProcessLaunch(
            tuple(command),
            cwd=repository_root,
            env=with_hidden_node_children(environment),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            role="discovery",
            metrics_recorder=recorder,
            windows_spawn_mode=resolve_dynamic_windows_spawn_mode(),
        )
    )
    if completed.returncode != 0:
        raise DiscoveryProcessError(
            return_code=completed.returncode,
            stderr=completed.stderr.decode("utf-8", errors="replace").strip(),
        )
    profiles = PROJECT_PROFILES if project_matrix else PROJECT_PROFILES[:1]
    return discover_tests(
        completed.stdout.decode("utf-8", errors="replace"),
        repository_root,
        profiles,
    )
