"""Atomic adaptive capacity decision evidence writer."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.e2e_scheduler.adaptive import CapacityDecision


def save_capacity_decisions(
    path: Path,
    decisions: tuple[CapacityDecision, ...],
) -> None:
    payload = [
        {
            "elapsed_seconds": decision.elapsed_seconds,
            "previous": decision.previous,
            "capacity": decision.capacity,
            "reason": decision.reason,
            "detail": decision.detail,
            "sample": (
                {
                    "cpu_percent": decision.sample.cpu_percent,
                    "available_memory_percent": decision.sample.available_memory_percent,
                    "backend_p95_ms": decision.sample.backend_p95_ms,
                    "recent_worker_crashes": decision.sample.recent_worker_crashes,
                    "recent_unexpected_failures": (
                        decision.sample.recent_unexpected_failures
                    ),
                }
                if decision.sample is not None
                else None
            ),
        }
        for decision in decisions
    ]
    temporary = path.with_suffix(".json.tmp")
    _ = temporary.write_text(
        json.dumps(
            {"version": 1, "decisions": payload},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    _ = temporary.replace(path)
