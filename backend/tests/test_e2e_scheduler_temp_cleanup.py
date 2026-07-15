from __future__ import annotations

import json
from pathlib import Path
import shutil

import pytest
from pydantic import JsonValue, TypeAdapter

from scripts.e2e_scheduler.capsule import WorkerCapsule
from scripts.e2e_scheduler.model import RunId, WorkerId
from scripts.e2e_scheduler.run_metrics import (
    RunMetricsConfiguration,
    save_run_metrics,
)
from scripts.e2e_scheduler.runner_worker import (
    RunMetricsSnapshot,
    RunMetricsStatus,
    close_capsules,
)


_JSON_OBJECT = TypeAdapter(dict[str, JsonValue])


def test_temp_removal_failure_marks_cleanup_and_run_metrics_failed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    capsule = WorkerCapsule(
        root=tmp_path,
        run_id=RunId("run-temp-cleanup"),
        worker_id=WorkerId("worker-1"),
    )
    capsule.temporary_root.mkdir(parents=True)
    original_rmtree = shutil.rmtree

    def fail_worker_temp(path: Path) -> None:
        if Path(path) == capsule.temporary_root:
            raise OSError("worker temporary root remains locked")
        original_rmtree(path)

    monkeypatch.setattr(shutil, "rmtree", fail_worker_temp)

    # When
    cleanup = close_capsules((capsule,))
    metrics_path = tmp_path / "run-metrics.json"
    save_run_metrics(
        metrics_path,
        RunMetricsSnapshot(
            results=(),
            cleanup=cleanup,
            final_sample=None,
            status=RunMetricsStatus.COMPLETE,
            expected_jobs=0,
        ),
        RunMetricsConfiguration(
            benchmark_invocation_id="benchmark-temp-cleanup",
            adaptive=False,
            initial_workers=1,
            started_workers=1,
        ),
    )

    # Then
    assert cleanup[0].succeeded is False
    payload = _JSON_OBJECT.validate_python(
        json.loads(metrics_path.read_text(encoding="utf-8"))
    )
    cleanup_payload = payload["cleanup"]
    assert isinstance(cleanup_payload, list)
    first_cleanup = cleanup_payload[0]
    assert isinstance(first_cleanup, dict)
    assert first_cleanup["succeeded"] is False
