from __future__ import annotations

from pathlib import Path

import pytest

from backend.tests.e2e_scheduler_runner_fakes import (
    FakeRuntime,
    make_options,
    make_test,
)
from scripts.e2e_scheduler.model import WorkerId
from scripts.e2e_scheduler.runner import run_dynamic


def test_idle_worker_cleanup_failure_never_publishes_global_results(
    tmp_path: Path,
) -> None:
    runtime = FakeRuntime(
        tmp_path,
        (make_test(1), make_test(2)),
        cleanup_failing_workers=frozenset({WorkerId("worker-4")}),
    )

    return_code = run_dynamic(make_options(), (), runtime=runtime)

    assert return_code == 1
    assert runtime.aggregate_calls == 0
    assert not runtime.history_saved


def test_all_resource_samples_failing_never_publishes_complete_run(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    runtime = FakeRuntime(tmp_path, (make_test(1), make_test(2)))

    class FailingSampler:
        def sample(self) -> None:
            raise OSError("resource counters unavailable")

    monkeypatch.setattr(
        runtime,
        "create_resource_sampler",
        lambda _capsules: FailingSampler(),
    )

    return_code = run_dynamic(make_options(), (), runtime=runtime)

    assert return_code == 1
    assert runtime.aggregate_calls == 0
    assert not runtime.history_saved
    assert runtime.saved_run_metrics_status is not None
    assert runtime.saved_run_metrics_status.value == "partial"
