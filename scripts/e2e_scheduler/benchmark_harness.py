"""Sequential same-SHA benchmark execution and evidence collection."""

from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path
import subprocess
import time
from uuid import uuid4

from scripts.e2e_scheduler.benchmark import (
    BenchmarkAcceptanceError,
    BenchmarkDocument,
    BenchmarkRun,
    validate_acceptance,
)
from scripts.e2e_scheduler.benchmark_cli import BenchmarkOptions
from scripts.e2e_scheduler.benchmark_collection_dispatch import collect_run
from scripts.e2e_scheduler.benchmark_collect_models import (
    BenchmarkCollectionError,
)
from scripts.e2e_scheduler.benchmark_report import BenchmarkReportError
from scripts.e2e_scheduler.evidence_expectations import EvidenceExpectationError
from scripts.e2e_scheduler.benchmark_io import load_document, save_document
from scripts.e2e_scheduler.resources import WindowsSystemSampler
from scripts.e2e_scheduler.benchmark_process import (
    BenchmarkExecutionError,
    clean_git_sha as _clean_git_sha,
    failed_inventory as _failed_inventory,
    redact_command,
    sample_range as _range,
    stop_owned as _stop_owned,
    wait_for_interrupt_cleanup as _wait_for_interrupt_cleanup,
)
from scripts.e2e_scheduler.browser_runtime import resolve_browser_runtime_identity
from scripts.e2e_scheduler.processes import OwnedProcess, ProcessLaunch
from scripts.e2e_scheduler.subprocess_visibility import with_hidden_node_children

_CHROME_POLICY = "observe-only; never terminate unowned system Chrome"


def execute_benchmark(options: BenchmarkOptions, repository_root: Path) -> int:
    git_sha = _clean_git_sha(repository_root)
    label = options.label or git_sha[:12]
    existing = load_document(options.output)
    if existing is not None and (
        existing.git_sha != git_sha or existing.label != label
    ):
        raise BenchmarkExecutionError(
            "existing benchmark output has a different label or Git SHA"
        )
    runs = list(existing.runs if existing is not None else ())
    for _index in range(options.runs):
        completed = execute_one(options, repository_root, git_sha, label)
        runs.append(completed)
        if _clean_git_sha(repository_root) != git_sha:
            raise BenchmarkExecutionError("Git SHA or clean state changed during benchmark")
        save_document(
            options.output,
            BenchmarkDocument(3, label, git_sha, tuple(runs), None),
        )
        if completed.exit_code != 0:
            return completed.exit_code
    summary = None
    modes = {run.mode for run in runs}
    if modes == {"legacy", "dynamic"}:
        try:
            summary = validate_acceptance(tuple(runs))
        except BenchmarkAcceptanceError:
            save_document(
                options.output,
                BenchmarkDocument(3, label, git_sha, tuple(runs), None),
            )
            raise
    save_document(
        options.output,
        BenchmarkDocument(3, label, git_sha, tuple(runs), summary),
    )
    return 0


def execute_one(
    options: BenchmarkOptions,
    repository_root: Path,
    git_sha: str,
    label: str,
) -> BenchmarkRun:
    benchmark_id = f"benchmark-{datetime.now(UTC).strftime('%Y%m%dT%H%M%S')}-{uuid4().hex[:8]}"
    raw_root = options.output.parent / ".benchmark-raw" / benchmark_id
    raw_root.mkdir(parents=True, exist_ok=False)
    playwright_report = raw_root / "playwright.json"
    evidence_expectations = raw_root / "evidence-expectations.jsonl"
    profile_artifact = raw_root / "profiles.json"
    cleanup_artifact = raw_root / "cleanup.json"
    env = with_hidden_node_children(os.environ.copy())
    if options.mode == "legacy":
        env["E2E_BENCHMARK_PLAYWRIGHT_JSON_FILE"] = str(playwright_report)
        env["E2E_BENCHMARK_EVIDENCE_EXPECTATIONS_FILE"] = str(evidence_expectations)
        env["E2E_BENCHMARK_PROFILE_FILE"] = str(profile_artifact)
        env["E2E_BENCHMARK_RUN_ARTIFACT"] = str(cleanup_artifact)
    else:
        env["E2E_BENCHMARK_INVOCATION_ID"] = benchmark_id
    browser_runtime = resolve_browser_runtime_identity(repository_root, env)
    command = list(options.command)
    launched = ["cmd", "/c", *command] if os.name == "nt" else command
    started_at = datetime.now(UTC)
    _ = (raw_root / "invocation.json").write_text(
        json.dumps(
            {
                "version": 1,
                "invocation_id": benchmark_id,
                "started_at": started_at.isoformat(),
            },
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    started = time.monotonic()
    cpu: list[float] = []
    memory: list[float] = []
    deadline = started + options.timeout_seconds
    interrupted = False
    timed_out = False
    cleanup_after_interrupt = True
    execution_error: str | None = None
    forced_exit_code: int | None = None
    owned_process = OwnedProcess.spawn(
        ProcessLaunch(tuple(launched), cwd=repository_root, env=env)
    )
    process = owned_process.process
    try:
        try:
            sampler = WindowsSystemSampler() if os.name == "nt" else None
            while process.poll() is None:
                if time.monotonic() >= deadline:
                    timed_out = True
                    forced_exit_code = 124
                    break
                if sampler is not None:
                    sample = sampler.sample()
                    cpu.append(sample.cpu_percent)
                    memory.append(sample.available_memory_percent)
                try:
                    _ = process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    continue
        except BaseException as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
            execution_error = f"{type(error).__name__}: {error}"
            if isinstance(error, KeyboardInterrupt):
                interrupted = True
                forced_exit_code = 130
            else:
                forced_exit_code = 125
    finally:
        if interrupted:
            try:
                _ = _wait_for_interrupt_cleanup(owned_process)
            except BaseException as grace_error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
                grace_detail = (
                    "interrupt grace "
                    f"{type(grace_error).__name__}: {grace_error}"
                )
                execution_error = (
                    f"{execution_error}; {grace_detail}"
                    if execution_error is not None
                    else grace_detail
                )
        try:
            cleanup_after_interrupt = _stop_owned(owned_process)
        except BaseException as cleanup_error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
            cleanup_after_interrupt = False
            cleanup_detail = (
                f"cleanup {type(cleanup_error).__name__}: {cleanup_error}"
            )
            execution_error = (
                f"{execution_error}; {cleanup_detail}"
                if execution_error is not None
                else cleanup_detail
            )
        if not cleanup_after_interrupt and forced_exit_code is None:
            forced_exit_code = 125
    process_exit_code = process.poll()
    exit_code = (
        forced_exit_code
        if forced_exit_code is not None
        else process_exit_code if process_exit_code is not None else 125
    )
    wall_seconds = max(time.monotonic() - started, 0.001)
    ended_at = datetime.now(UTC)
    collected = None
    if exit_code == 0 or options.mode == "legacy":
        try:
            collected = collect_run(
                options,
                repository_root,
                benchmark_id,
                playwright_report,
                evidence_expectations,
                profile_artifact,
                cleanup_artifact,
                started_at,
            )
        except (
            BenchmarkCollectionError,
            BenchmarkReportError,
            EvidenceExpectationError,
        ):
            if exit_code == 0:
                raise
    if collected is not None:
        inventory = collected.inventory
        run_id = collected.run_id
        worker_minutes = collected.worker_minutes
        durations = collected.job_durations_seconds
        cleanup_ok = collected.cleanup_ok and cleanup_after_interrupt
        backend_latency = collected.backend_latency_ms_samples
        capacity_decisions = collected.capacity_decisions
        concurrency = collected.concurrency
    else:
        inventory = _failed_inventory(interrupted or timed_out)
        run_id = benchmark_id
        worker_minutes = 0.0
        durations = ()
        cleanup_ok = False
        backend_latency = ()
        capacity_decisions = ()
        concurrency = None
    return BenchmarkRun(
        mode=options.mode,
        label=label,
        git_sha=git_sha,
        command=redact_command(options.command),
        started_at=started_at.isoformat(),
        ended_at=ended_at.isoformat(),
        wall_seconds=wall_seconds,
        exit_code=exit_code,
        run_id=run_id,
        worker_minutes=worker_minutes,
        job_durations_seconds=durations,
        cpu_percent_samples=tuple(cpu),
        memory_available_percent_samples=tuple(memory),
        backend_latency_ms_samples=backend_latency,
        inventory=inventory,
        cleanup_ok=cleanup_ok,
        system_chrome_policy=_CHROME_POLICY,
        browser_runtime=browser_runtime,
        capacity_decisions=capacity_decisions,
        cpu_percent_range=_range(cpu),
        memory_available_percent_range=_range(memory),
        backend_latency_ms_range=_range(backend_latency),
        concurrency=concurrency,
        execution_error=execution_error,
    )
