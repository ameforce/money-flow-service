"""Dynamic job wall-time, backend latency, and cleanup evidence."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import json
from pathlib import Path

from scripts.e2e_scheduler.runner_worker import RunMetricsSnapshot


@dataclass(frozen=True, slots=True)
class RunMetricsConfiguration:
    benchmark_invocation_id: str
    adaptive: bool
    initial_workers: int
    started_workers: int


def save_run_metrics(
    path: Path,
    snapshot: RunMetricsSnapshot,
    configuration: RunMetricsConfiguration,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    _ = temporary.write_text(
        json.dumps(
            {
                "version": 2,
                "jobs": [
                    {
                        "job_id": str(result.result.job_id),
                        "worker_id": str(result.result.worker_id),
                        "wall_seconds": result.seconds,
                        "metrics": asdict(result.metrics),
                    }
                    for result in snapshot.results
                ],
                "status": snapshot.status.value,
                "expected_jobs": snapshot.expected_jobs,
                "completed_jobs": len(snapshot.results),
                "partial": len(snapshot.results) != snapshot.expected_jobs,
                "worker_minutes": (
                    sum(result.seconds for result in snapshot.results) / 60.0
                ),
                "backend_latency_ms_samples": [
                    sample.backend_p95_ms
                    for sample in snapshot.telemetry.host_samples
                ]
                or (
                    [snapshot.final_sample.backend_p95_ms]
                    if snapshot.final_sample is not None
                    else []
                ),
                "cleanup": [
                    {
                        "worker_id": str(outcome.worker_id),
                        "succeeded": outcome.succeeded,
                    }
                    for outcome in snapshot.cleanup
                ],
                "benchmark_invocation_id": configuration.benchmark_invocation_id,
                "telemetry": asdict(snapshot.telemetry),
                "concurrency": {
                    "adaptive": configuration.adaptive,
                    "initial": configuration.initial_workers,
                    "minimum": (
                        4
                        if configuration.adaptive
                        else configuration.initial_workers
                    ),
                    "maximum": (
                        10
                        if configuration.adaptive
                        else configuration.initial_workers
                    ),
                    "started_workers": configuration.started_workers,
                },
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    _ = temporary.replace(path)
