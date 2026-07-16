"""Deterministic database and filesystem reset for one warm capsule."""

from __future__ import annotations

from pathlib import Path
import time

from scripts.e2e_scheduler.capsule_cleanup import replace_directory
from scripts.e2e_scheduler.sqlite_reset import reset_sqlite_database


type CapsuleResetMetrics = tuple[float, int, float, float]


def reset_capsule_state(
    database_path: Path,
    temporary_root: Path,
    uploads_root: Path,
    backend_upload_root: Path,
) -> CapsuleResetMetrics:
    db_started = time.monotonic()
    reset_metrics = reset_sqlite_database(database_path)
    db_reset_seconds = max(time.monotonic() - db_started, 0.0)
    filesystem_started = time.monotonic()
    replace_directory(temporary_root)
    replace_directory(uploads_root)
    replace_directory(backend_upload_root)
    return (
        db_reset_seconds,
        reset_metrics.retry_count,
        reset_metrics.locked_seconds,
        max(time.monotonic() - filesystem_started, 0.0),
    )
