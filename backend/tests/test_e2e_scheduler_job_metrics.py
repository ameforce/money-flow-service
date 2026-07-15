from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from scripts.e2e_scheduler.job_metrics import (
    AuthSetupMetricsFormatError,
    load_auth_setup_metrics,
    load_job_metrics,
    save_job_metrics,
)
from scripts.e2e_scheduler.metrics import AuthSetupMode, JobMetrics, SetupMetrics


def _event(mode: str, duration_ms: float, status: str) -> str:
    return json.dumps(
        {
            "version": 1,
            "kind": "auth_setup",
            "mode": mode,
            "duration_ms": duration_ms,
            "status": status,
        }
    )


def test_auth_setup_metrics_preserve_mode_counts_durations_and_failures(
    tmp_path: Path,
) -> None:
    path = tmp_path / "auth-setup.jsonl"
    _ = path.write_text(
        "\n".join(
            (
                _event("ui", 100.0, "passed"),
                _event("api", 200.0, "passed"),
                _event("api", 50.0, "failed"),
            )
        )
        + "\n",
        encoding="utf-8",
    )

    metrics = load_auth_setup_metrics(path)

    assert metrics.auth_mode is AuthSetupMode.MIXED
    assert metrics.auth_count == 3
    assert math.isclose(metrics.auth_seconds, 0.35)
    assert metrics.auth_failures == 1
    assert metrics.auth_ui_count == 1
    assert math.isclose(metrics.auth_ui_seconds, 0.1)
    assert metrics.auth_api_count == 2
    assert math.isclose(metrics.auth_api_seconds, 0.25)


def test_auth_setup_metrics_reject_malformed_or_secret_bearing_events(
    tmp_path: Path,
) -> None:
    path = tmp_path / "auth-setup.jsonl"
    _ = path.write_text(
        json.dumps(
            {
                "version": 1,
                "kind": "auth_setup",
                "mode": "api",
                "duration_ms": 1.0,
                "status": "passed",
                "email": "must-not-be-recorded@example.invalid",
            }
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(
        AuthSetupMetricsFormatError,
        match="invalid auth setup metrics",
    ) as raised:
        _ = load_auth_setup_metrics(path)
    assert raised.value.path == path
    assert raised.value.line_number == 1


def test_job_metrics_round_trip_is_atomic_and_backward_defaulted(
    tmp_path: Path,
) -> None:
    path = tmp_path / "scheduler-metrics.json"
    metrics = JobMetrics(
        setup=SetupMetrics(
            auth_mode=AuthSetupMode.API,
            auth_count=2,
            auth_seconds=0.5,
            auth_api_count=2,
            auth_api_seconds=0.5,
        )
    )

    save_job_metrics(path, metrics)
    loaded = load_job_metrics(path)

    assert loaded.setup == metrics.setup
    assert not path.with_suffix(".json.tmp").exists()
    assert load_job_metrics(tmp_path / "missing.json") == JobMetrics()
