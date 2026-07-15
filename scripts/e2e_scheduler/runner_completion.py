"""Fail-closed aggregation, history, and final scheduler metrics publication."""

from __future__ import annotations

from dataclasses import dataclass, replace

from scripts.e2e_scheduler.aggregate import AggregationError
from scripts.e2e_scheduler.adaptive import CapacityDecision
from scripts.e2e_scheduler.history import DurationHistory
from scripts.e2e_scheduler.metrics import HostResourceMetrics, RunTelemetry
from scripts.e2e_scheduler.model import RunId, RunManifest
from scripts.e2e_scheduler.resource_sampling_monitor import ResourceSamplingSnapshot
from scripts.e2e_scheduler.resources import ResourceSample
from scripts.e2e_scheduler.runner_cleanup import CleanupOutcome
from scripts.e2e_scheduler.runner_worker import (
    RunMetricsSnapshot,
    RunMetricsStatus,
    SchedulerRuntime,
    TimedJobResult,
    WorkerCrash,
    duration_results,
)


@dataclass(frozen=True, slots=True)
class CompletionContext:
    run_id: RunId
    manifest: RunManifest
    history: DurationHistory
    results: tuple[TimedJobResult, ...]
    cleanup: tuple[CleanupOutcome, ...]
    sampling: ResourceSamplingSnapshot
    final_sample: ResourceSample | None
    started_workers: int
    crash: WorkerCrash | None
    monitor_failed: bool
    interruption: KeyboardInterrupt | SystemExit | None
    capacity_decisions: tuple[CapacityDecision, ...]


def complete_run(runtime: SchedulerRuntime, context: CompletionContext) -> int:
    telemetry = _telemetry(RunTelemetry(), context.sampling)
    capacity_decisions_failed = False
    try:
        runtime.save_capacity_decisions(
            context.run_id,
            context.capacity_decisions,
        )
    except OSError as error:
        capacity_decisions_failed = True
        print(
            f"[e2e-runner] capacity decision evidence save failed: {error}",
            flush=True,
        )
    if context.interruption is not None:
        _save_metrics(runtime, context, telemetry, RunMetricsStatus.INTERRUPTED)
        raise context.interruption
    if capacity_decisions_failed or _is_partial(context):
        _save_metrics(runtime, context, telemetry, RunMetricsStatus.PARTIAL)
        return 1
    snapshot = _metrics_snapshot(
        context,
        telemetry,
        RunMetricsStatus.COMPLETE,
        process=RunTelemetry(),
    )
    try:
        runtime.publish_complete(
            context.manifest,
            tuple(item.result for item in context.results),
            snapshot,
        )
    except (KeyboardInterrupt, SystemExit):
        _save_metrics(runtime, context, telemetry, RunMetricsStatus.PARTIAL)
        raise
    except AggregationError as error:
        _save_metrics(runtime, context, telemetry, RunMetricsStatus.PARTIAL)
        print(f"[e2e-runner] {error}", flush=True)
        return 1
    try:
        runtime.save_history(
            context.history.with_results(
                duration_results(context.manifest, context.results)
            )
        )
    except OSError as error:
        message = "duration history cache save failed; run evidence remains complete"
        print(
            f"[e2e-runner] {message}: {error}",
            flush=True,
        )
    return 0


def _telemetry(
    process: RunTelemetry,
    sampling: ResourceSamplingSnapshot,
) -> RunTelemetry:
    return replace(
        process,
        host_samples=tuple(
            HostResourceMetrics(
                sample.cpu_percent,
                sample.available_memory_percent,
                sample.backend_p95_ms,
            )
            for sample in sampling.samples
        ),
        resource_sample_errors=len(sampling.errors),
    )


def _is_partial(context: CompletionContext) -> bool:
    return (
        context.crash is not None
        or context.monitor_failed
        or not context.sampling.samples
        or context.final_sample is None
        or len(context.results) != len(context.manifest.jobs)
        or not all(item.succeeded for item in context.cleanup)
    )


def _save_metrics(
    runtime: SchedulerRuntime,
    context: CompletionContext,
    telemetry: RunTelemetry,
    status: RunMetricsStatus,
) -> None:
    snapshot = _metrics_snapshot(
        context,
        telemetry,
        status,
        process=runtime.process_telemetry(),
    )
    runtime.save_run_metrics(context.run_id, snapshot)


def _metrics_snapshot(
    context: CompletionContext,
    telemetry: RunTelemetry,
    status: RunMetricsStatus,
    *,
    process: RunTelemetry,
) -> RunMetricsSnapshot:
    final_telemetry = replace(
        process,
        host_samples=telemetry.host_samples,
        artifact_aggregation_seconds=telemetry.artifact_aggregation_seconds,
        resource_sample_errors=telemetry.resource_sample_errors,
    )
    return RunMetricsSnapshot(
        results=context.results,
        cleanup=context.cleanup,
        final_sample=context.final_sample,
        status=status,
        expected_jobs=len(context.manifest.jobs),
        started_workers=context.started_workers,
        telemetry=final_telemetry,
    )
