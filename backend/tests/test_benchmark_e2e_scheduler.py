from __future__ import annotations

from dataclasses import replace
from typing import Literal

import pytest

from scripts.e2e_scheduler.benchmark import (
    BenchmarkAcceptanceError,
    BenchmarkRun,
    BrowserRuntimeIdentity,
    ConcurrencyMetadata,
    RunInventory,
    summarize,
    validate_acceptance,
)
from scripts.e2e_scheduler.evidence_expectations import SemanticEvidenceIdentity


def _inventory() -> RunInventory:
    return RunInventory(
        test_ids=("desktop::e2e/specs/auth.spec.js:10::auth",),
        skipped_test_ids=(),
        projects=("desktop",),
        browsers=("chromium",),
        viewports=("1280x720",),
        expected_scenarios=1,
        actual_scenarios=1,
        expected_evidence=1,
        actual_evidence=1,
        passed=1,
        failed=0,
        skipped=0,
        interrupted=0,
        missing=0,
        semantic_evidence=(
            SemanticEvidenceIdentity(
                "desktop::e2e/specs/auth.spec.js:10::auth",
                "ready",
            ),
        ),
    )


def _browser_runtime() -> BrowserRuntimeIdentity:
    return BrowserRuntimeIdentity(
        decision="system-chrome",
        channel="chrome",
        executable_path="C:/Program Files/Google/Chrome/Application/chrome.exe",
        browser_version="Google Chrome 140.0.0.0",
    )


def _run(
    mode: Literal["legacy", "dynamic"],
    seconds: float,
    index: int,
) -> BenchmarkRun:
    return BenchmarkRun(
        mode=mode,
        label="same-sha",
        git_sha="a" * 40,
        command=("npm", "run", "e2e:matrix"),
        started_at=f"2026-07-12T00:00:0{index}+00:00",
        ended_at=f"2026-07-12T00:20:0{index}+00:00",
        wall_seconds=seconds,
        exit_code=0,
        run_id=f"run-{mode}-{index}",
        worker_minutes=seconds / 60,
        job_durations_seconds=(seconds,),
        cpu_percent_samples=(50.0,),
        memory_available_percent_samples=(50.0,),
        backend_latency_ms_samples=(100.0,),
        inventory=_inventory(),
        cleanup_ok=True,
        system_chrome_policy="observe-only; never terminate unowned Chrome",
        browser_runtime=_browser_runtime(),
        capacity_decisions=(),
        concurrency=(
            ConcurrencyMetadata(False, None, None, None, None)
            if mode == "legacy"
            else ConcurrencyMetadata(False, 8, 8, 8, 8)
        ),
    )


def test_benchmark_summary_uses_median_worst_and_speedup() -> None:
    summary = summarize(
        legacy_seconds=(3600, 3540, 3660),
        dynamic_seconds=(1320, 1380, 1260),
    )

    assert summary.legacy_median_seconds == 3600
    assert summary.dynamic_median_seconds == 1320
    assert summary.dynamic_worst_seconds == 1380
    assert abs(summary.speedup_percent - 63.3333) < 0.01


def test_acceptance_fails_closed_on_mixed_sha() -> None:
    runs = tuple(_run("legacy", 3600, index) for index in range(3)) + tuple(
        _run("dynamic", 1200, index + 3) for index in range(3)
    )

    with pytest.raises(BenchmarkAcceptanceError, match="Git SHA"):
        _ = validate_acceptance((*runs[:-1], replace(runs[-1], git_sha="b" * 40)))


def test_acceptance_rejects_duplicate_run_ids() -> None:
    runs = tuple(_run("legacy", 3600, index) for index in range(3)) + tuple(
        _run("dynamic", 1200, index + 3) for index in range(3)
    )

    with pytest.raises(BenchmarkAcceptanceError, match="run ID"):
        _ = validate_acceptance(
            (*runs[:-1], replace(runs[-1], run_id=runs[0].run_id))
        )


def test_acceptance_rejects_non_default_fixed_dynamic_concurrency() -> None:
    runs = tuple(_run("legacy", 3600, index) for index in range(3)) + tuple(
        _run("dynamic", 1200, index + 3) for index in range(3)
    )
    invalid = replace(
        runs[-1],
        concurrency=ConcurrencyMetadata(False, 4, 4, 4, 4),
    )

    with pytest.raises(BenchmarkAcceptanceError, match="fixed dynamic"):
        _ = validate_acceptance((*runs[:-1], invalid))


@pytest.mark.parametrize(
    "field",
    ["cleanup", "inventory", "skips", "evidence_names"],
)
def test_acceptance_fails_when_any_run_has_parity_or_cleanup_error(field: str) -> None:
    runs = list(tuple(_run("legacy", 3600, index) for index in range(3)))
    runs.extend(_run("dynamic", 1200, index + 3) for index in range(3))
    target = runs[-1]
    if field == "cleanup":
        runs[-1] = replace(target, cleanup_ok=False)
    elif field == "inventory":
        runs[-1] = replace(
            target,
            inventory=replace(target.inventory, test_ids=("different",)),
        )
    elif field == "skips":
        runs[-1] = replace(
            target,
            inventory=replace(
                target.inventory,
                skipped=1,
                skipped_test_ids=(target.inventory.test_ids[0],),
            ),
        )
    else:
        runs[-1] = replace(
            target,
            inventory=replace(
                target.inventory,
                expected_evidence_fingerprint="expected-name",
                actual_evidence_fingerprint="different-actual-name",
            ),
        )

    with pytest.raises(BenchmarkAcceptanceError):
        _ = validate_acceptance(tuple(runs))


def test_acceptance_requires_three_runs_per_mode() -> None:
    runs = tuple(_run("legacy", 3600, index) for index in range(3)) + tuple(
        _run("dynamic", 1200, index + 3) for index in range(2)
    )

    with pytest.raises(BenchmarkAcceptanceError, match="three"):
        _ = validate_acceptance(runs)


def test_acceptance_passes_exact_green_parity_and_targets() -> None:
    runs = tuple(_run("legacy", 3600, index) for index in range(3)) + tuple(
        _run("dynamic", seconds, index + 3)
        for index, seconds in enumerate((1200, 1260, 1320))
    )

    summary = validate_acceptance(runs)

    assert summary.accepted
    assert summary.dynamic_worst_seconds == 1320


def test_acceptance_checks_first_run_when_dynamic_runs_are_recorded_first() -> None:
    dynamic = list(_run("dynamic", 1200, index) for index in range(3))
    dynamic[0] = replace(
        dynamic[0],
        inventory=replace(dynamic[0].inventory, projects=("different",)),
    )
    legacy = tuple(_run("legacy", 3600, index + 3) for index in range(3))

    with pytest.raises(BenchmarkAcceptanceError, match="inventory differs"):
        _ = validate_acceptance((*dynamic, *legacy))


def test_acceptance_rejects_different_semantic_evidence_across_runs() -> None:
    runs = tuple(_run("legacy", 3600, index) for index in range(3)) + tuple(
        _run("dynamic", seconds, index + 3)
        for index, seconds in enumerate((1200, 1260, 1320))
    )
    mismatched = replace(
        runs[-1],
        inventory=replace(
            runs[-1].inventory,
            semantic_evidence=(
                SemanticEvidenceIdentity(
                    "desktop::e2e/specs/auth.spec.js:10::auth",
                    "different-label",
                ),
            ),
        ),
    )

    with pytest.raises(BenchmarkAcceptanceError, match="inventory differs"):
        _ = validate_acceptance((*runs[:-1], mismatched))


def test_acceptance_rejects_different_browser_runtime_across_runs() -> None:
    runs = tuple(_run("legacy", 3600, index) for index in range(3)) + tuple(
        _run("dynamic", seconds, index + 3)
        for index, seconds in enumerate((1200, 1260, 1320))
    )
    mismatched = replace(
        runs[-1],
        browser_runtime=replace(
            runs[-1].browser_runtime,
            browser_version="Google Chrome 141.0.0.0",
        ),
    )

    with pytest.raises(BenchmarkAcceptanceError, match="browser runtime"):
        _ = validate_acceptance((*runs[:-1], mismatched))
