"""Select the authoritative collector for one benchmark mode."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from scripts.e2e_scheduler.benchmark_cli import BenchmarkOptions
from scripts.e2e_scheduler.benchmark_collect import collect_dynamic, collect_legacy
from scripts.e2e_scheduler.benchmark_collect_models import CollectedRun


def collect_run(
    options: BenchmarkOptions,
    repository_root: Path,
    benchmark_id: str,
    playwright_report: Path,
    evidence_expectations: Path,
    profile_artifact: Path,
    cleanup_artifact: Path,
    started_at: datetime,
) -> CollectedRun:
    screenshot_manifest = (
        repository_root / "output" / "playwright" / "e2e-flow" / "latest-run.json"
    )
    if options.mode == "legacy":
        return collect_legacy(
            run_id=benchmark_id,
            playwright_report=playwright_report,
            evidence_expectations=evidence_expectations,
            profile_artifact=profile_artifact,
            cleanup_artifact=cleanup_artifact,
            screenshot_manifest=screenshot_manifest,
            repository_root=repository_root,
        )
    return collect_dynamic(
        screenshot_manifest=screenshot_manifest,
        scheduler_root=repository_root / "output" / "playwright" / "e2e-scheduler",
        repository_root=repository_root,
        expected_invocation_id=benchmark_id,
        started_at=started_at,
    )
