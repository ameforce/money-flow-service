"""Redacted owned-resource cleanup evidence for benchmarked legacy runs."""

from __future__ import annotations

import json
from pathlib import Path
from dataclasses import dataclass
from typing import override

from scripts.e2e_scheduler.processes import (
    OwnedProcess,
    OwnedProcessCleanupError,
    port_is_open,
)


@dataclass(frozen=True, slots=True)
class LegacyCleanupError(RuntimeError):
    failures: tuple[str, ...]

    @override
    def __str__(self) -> str:
        return f"legacy cleanup failed: {'; '.join(self.failures)}"


def write_legacy_cleanup_artifact(
    path: Path,
    *,
    orchestrator_pid: int,
    backend_port: int,
    frontend_port: int,
    process_exited: bool,
    backend_port_closed: bool,
    frontend_port_closed: bool,
    database_removed: bool,
    backend_latency_ms_samples: tuple[float, ...],
    failures: tuple[str, ...],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    _ = temporary.write_text(
        json.dumps(
            {
                "version": 1,
                "owned_orchestrator_pid": orchestrator_pid,
                "owned_backend_port": backend_port,
                "owned_frontend_port": frontend_port,
                "process_exited": process_exited,
                "backend_port_closed": backend_port_closed,
                "frontend_port_closed": frontend_port_closed,
                "database_removed": database_removed,
                "backend_latency_ms_samples": list(backend_latency_ms_samples),
                "failures": list(failures),
                "concurrency": {
                    "adaptive": False,
                    "initial": None,
                    "minimum": None,
                    "maximum": None,
                    "started_workers": None,
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


def finalize_legacy_cleanup(
    orchestrator: OwnedProcess,
    database_path: Path,
    backend_port: int,
    frontend_port: int,
    backend_latency_ms_samples: tuple[float, ...],
    artifact_path: Path | None,
) -> None:
    failures: list[str] = []
    try:
        orchestrator.close()
    except (OSError, OwnedProcessCleanupError) as error:
        failures.append(str(error))
    try:
        database_path.unlink(missing_ok=True)
    except OSError as error:
        failures.append(f"remove ephemeral database: {error}")
    process_exited = orchestrator.process.poll() is not None
    backend_closed = not port_is_open(backend_port)
    frontend_closed = not port_is_open(frontend_port)
    database_removed = not database_path.exists()
    if artifact_path is not None:
        write_legacy_cleanup_artifact(
            artifact_path,
            orchestrator_pid=orchestrator.process.pid,
            backend_port=backend_port,
            frontend_port=frontend_port,
            process_exited=process_exited,
            backend_port_closed=backend_closed,
            frontend_port_closed=frontend_closed,
            database_removed=database_removed,
            backend_latency_ms_samples=backend_latency_ms_samples,
            failures=tuple(failures),
        )
    if failures or not (
        process_exited and backend_closed and frontend_closed and database_removed
    ):
        if not failures:
            failures.append("owned resource remained after cleanup")
        raise LegacyCleanupError(tuple(failures))
