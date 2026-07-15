from __future__ import annotations

from dataclasses import replace
import os
from pathlib import Path
from typing import final

import pytest

import scripts.run_e2e_with_orchestrator as e2e_runner
import scripts.e2e_scheduler.runner as runner_module
from backend.tests.e2e_scheduler_runner_fakes import (
    FakeRuntime,
    make_options,
    make_test,
)
from backend.tests.e2e_scheduler_runner_capsule_fake import FakeCapsule
from backend.tests.e2e_scheduler_runner_probes import (
    load_package_scripts,
    load_playwright_config,
)
from scripts.e2e_scheduler.model import RunId, WorkerId
from scripts.e2e_scheduler.metrics import RunTelemetry
from scripts.e2e_scheduler.owned_command import OwnedCommandResult
from scripts.e2e_scheduler.process_launch import ProcessLaunch
from scripts.e2e_scheduler.adaptive_worker_pool import AdaptiveWorkerPool
from scripts.e2e_scheduler.runner import run_dynamic
from scripts.e2e_scheduler.runner_options import RunnerMode, RunnerOptions
from scripts.e2e_scheduler.runner_cli import run_cli
from scripts.e2e_scheduler.runner_runtime import LocalSchedulerRuntime
from scripts.e2e_scheduler.runner_worker import (
    CapsuleWorker,
    RunMetricsStatus,
    WorkerLoopError,
)


ROOT = Path(__file__).resolve().parents[2]


def test_windows_matrix_defaults_to_dynamic_eight_workers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("E2E_RUNNER_MODE", raising=False)

    # When
    options = e2e_runner.parse_runner_options(["--project-matrix"])

    # Then
    assert options.mode is e2e_runner.RunnerMode.DYNAMIC
    assert options.scheduler_workers == 8


def test_legacy_flag_preserves_original_playwright_path() -> None:
    # When
    options = e2e_runner.parse_runner_options(
        ["--project-matrix", "--legacy-runner", "--workers=2"]
    )

    # Then
    assert options.mode is e2e_runner.RunnerMode.LEGACY
    assert options.playwright_args == ("--workers=2",)
    assert options.project_matrix


@pytest.mark.parametrize(
    ("os_name", "ci", "args"),
    [
        ("posix", None, ("--project-matrix",)),
        ("nt", "1", ("--project-matrix",)),
        ("nt", None, ()),
    ],
)
def test_non_local_matrix_defaults_to_legacy(
    monkeypatch: pytest.MonkeyPatch,
    os_name: str,
    ci: str | None,
    args: tuple[str, ...],
) -> None:
    # Given
    monkeypatch.setattr(os, "name", os_name)
    if ci is None:
        monkeypatch.delenv("CI", raising=False)
    else:
        monkeypatch.setenv("CI", ci)
    monkeypatch.delenv("E2E_RUNNER_MODE", raising=False)

    # When
    options = e2e_runner.parse_runner_options(list(args))

    # Then
    assert options.mode is e2e_runner.RunnerMode.LEGACY


def test_explicit_dynamic_rejects_inner_playwright_workers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setenv("E2E_RUNNER_MODE", "dynamic")

    # When / Then
    with pytest.raises(
        e2e_runner.RunnerOptionError,
        match="scheduler-owned",
    ):
        _ = e2e_runner.parse_runner_options(["--workers", "2"])


def test_adaptive_scheduler_workers_keep_four_to_ten_policy_bounds() -> None:
    # When / Then
    with pytest.raises(e2e_runner.RunnerOptionError, match="4..10"):
        _ = e2e_runner.parse_runner_options(
            ["--project-matrix", "--adaptive-workers", "--scheduler-workers=2"]
        )


def test_adaptive_scheduler_rejects_unsupported_non_windows_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(os, "name", "posix")
    monkeypatch.setenv("E2E_RUNNER_MODE", "dynamic")

    with pytest.raises(e2e_runner.RunnerOptionError, match="Windows"):
        _ = e2e_runner.parse_runner_options(
            ["--adaptive-workers", "--scheduler-workers=8"]
        )


def test_dynamic_runner_rejects_unsupported_custom_reporter() -> None:
    # When / Then
    with pytest.raises(e2e_runner.RunnerOptionError, match="custom reporter"):
        _ = e2e_runner.parse_runner_options(
            ["--project-matrix", "--reporter=./custom-reporter.js"]
        )


def test_legacy_runner_preserves_custom_reporter_path() -> None:
    # When
    options = e2e_runner.parse_runner_options(
        ["--project-matrix", "--legacy-runner", "--reporter=./custom-reporter.js"]
    )

    # Then
    assert options.playwright_args == ("--reporter=./custom-reporter.js",)


def test_coordinator_persists_manifest_before_workers_and_updates_history(
    tmp_path: Path,
) -> None:
    # Given
    runtime = FakeRuntime(tmp_path, (make_test(1), make_test(2)))

    # When
    return_code = run_dynamic(make_options(), (), runtime=runtime)

    # Then
    assert return_code == 0
    assert runtime.events[0:2] == ["build", "discover"]
    assert runtime.manifest_path(RunId("run-test")).is_file()
    assert len(runtime.capsules) == 4
    assert all(capsule.close_calls == 1 for capsule in runtime.capsules)
    assert runtime.events.index("aggregate") > max(
        index
        for index, event in enumerate(runtime.events)
        if event.startswith("close:")
    )
    assert runtime.events[-2:] == ["history", "metrics:complete"]
    assert runtime.history_saved
    assert runtime.saved_run_metrics_status is RunMetricsStatus.COMPLETE
    assert runtime.saved_run_metrics_expected_jobs == 2
    assert runtime.saved_run_metrics_completed_jobs == 2


def test_process_telemetry_is_snapshotted_after_aggregation_and_history(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    runtime = FakeRuntime(tmp_path, (make_test(1), make_test(2)))
    observations: list[tuple[int, bool]] = []

    def process_telemetry() -> RunTelemetry:
        observations.append((runtime.aggregate_calls, runtime.history_saved))
        return RunTelemetry()

    monkeypatch.setattr(runtime, "process_telemetry", process_telemetry)

    return_code = run_dynamic(make_options(), (), runtime=runtime)

    assert return_code == 0
    assert observations == [(1, True)]


def test_coordinator_records_worker_crash_once_and_stops_new_assignments(
    tmp_path: Path,
) -> None:
    # Given
    tests = tuple(make_test(index) for index in range(6))
    runtime = FakeRuntime(
        tmp_path,
        tests,
        crashing_specs=frozenset({"flow-0.spec.js", "flow-1.spec.js"}),
    )

    # When
    return_code = run_dynamic(make_options(), (), runtime=runtime)

    # Then
    assert return_code == 1
    assert len(runtime.worker_crashes) == 1
    assert "flow-4.spec.js" not in runtime.executed_specs
    assert "flow-5.spec.js" not in runtime.executed_specs
    assert runtime.aggregate_calls == 0
    assert not runtime.history_saved
    assert all(capsule.close_calls == 1 for capsule in runtime.capsules)
    assert runtime.saved_run_metrics_status is RunMetricsStatus.PARTIAL
    assert runtime.saved_run_metrics_expected_jobs == 6
    assert (
        runtime.saved_run_metrics_completed_jobs is not None
        and runtime.saved_run_metrics_completed_jobs < 6
    )


def test_coordinator_records_capsule_startup_crash_as_partial_run(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    runtime = FakeRuntime(
        tmp_path,
        (make_test(1), make_test(2)),
        startup_failing_workers=frozenset({WorkerId("worker-2")}),
    )

    class FailingSampler:
        def sample(self) -> None:
            raise AssertionError("startup-failed capsule must not be sampled")

    def create_failing_sampler(
        _capsules: tuple[CapsuleWorker, ...],
    ) -> FailingSampler:
        return FailingSampler()

    monkeypatch.setattr(
        runtime,
        "create_resource_sampler",
        create_failing_sampler,
    )

    # When
    return_code = run_dynamic(make_options(), (), runtime=runtime)

    # Then
    assert return_code == 1
    assert runtime.executed_specs == []
    assert len(runtime.worker_crashes) == 1
    crash = runtime.worker_crashes[0]
    assert crash.worker_id == WorkerId("worker-2")
    assert crash.job_id is None
    assert crash.error_type == "FakeWorkerCrashError"
    assert all(capsule.close_calls == 1 for capsule in runtime.capsules)
    assert runtime.aggregate_calls == 0
    assert not runtime.history_saved
    assert runtime.saved_run_metrics_status is RunMetricsStatus.PARTIAL
    assert runtime.saved_run_metrics_expected_jobs == 2
    assert runtime.saved_run_metrics_completed_jobs == 0


def test_coordinator_does_not_update_history_when_aggregation_fails(
    tmp_path: Path,
) -> None:
    # Given
    runtime = FakeRuntime(
        tmp_path,
        (make_test(1), make_test(2)),
        aggregate_failure=True,
    )

    # When
    return_code = run_dynamic(make_options(), (), runtime=runtime)

    # Then
    assert return_code == 1
    assert runtime.aggregate_calls == 1
    assert not runtime.history_saved
    assert all(capsule.close_calls == 1 for capsule in runtime.capsules)


def test_coordinator_builds_frontend_once_before_creating_capsules(
    tmp_path: Path,
) -> None:
    # Given
    runtime = FakeRuntime(tmp_path, (make_test(1),), build_code=7)

    # When
    return_code = run_dynamic(make_options(), (), runtime=runtime)

    # Then
    assert return_code == 7
    assert runtime.events == ["build"]
    assert runtime.capsules == []


def test_adaptive_mode_connects_sampler_and_persists_decision_history(
    tmp_path: Path,
) -> None:
    runtime = FakeRuntime(tmp_path, (make_test(1), make_test(2)))
    options = replace(make_options(), adaptive_workers=True)

    return_code = run_dynamic(options, (), runtime=runtime)

    assert return_code == 0
    assert runtime.resource_sampler_calls == 1
    assert runtime.saved_capacity_decisions is not None
    assert runtime.saved_capacity_decisions[0].reason == "initial"


def test_adaptive_mode_starts_eight_warm_capsules_and_keeps_two_cold(
    tmp_path: Path,
) -> None:
    runtime = FakeRuntime(tmp_path, tuple(make_test(index) for index in range(12)))
    options = replace(make_options(workers=8), adaptive_workers=True)

    return_code = run_dynamic(options, (), runtime=runtime)

    assert return_code == 0
    assert len(runtime.capsules) == 10
    started_workers = {
        event.partition(":")[2]
        for event in runtime.events
        if event.startswith("start:")
    }
    assert started_workers == {f"worker-{index}" for index in range(1, 9)}
    assert all(capsule.close_calls == 1 for capsule in runtime.capsules)


@final
class _DesiredCapacity:
    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self.crashes = 0
        self.failures = 0

    def assignment_capacity(self) -> int:
        return self.capacity

    def wait_timeout_seconds(self) -> float:
        return 0.05

    def record_worker_crash(self) -> None:
        self.crashes += 1

    def record_unexpected_failure(self) -> None:
        self.failures += 1


def test_adaptive_reserve_is_not_assignable_until_start_completes(
    tmp_path: Path,
) -> None:
    events: list[str] = []
    workers = tuple(WorkerId(f"worker-{index}") for index in range(1, 11))
    controller = _DesiredCapacity(9)
    pool = AdaptiveWorkerPool(
        RunId("run-test"),
        controller,
        warm_worker_ids=workers[:8],
        reserve_capsules=(
            FakeCapsule(workers[8], events, tmp_path),
            FakeCapsule(workers[9], events, tmp_path),
        ),
        capacity_order=(workers[7], *workers[:7], *workers[8:]),
    )

    capacity = pool.assignment_capacity()

    assert capacity == 9
    assert events == ["start:worker-9"]
    assert pool.worker_is_enabled(WorkerId("worker-9"), capacity)
    assert not pool.worker_is_enabled(WorkerId("worker-10"), capacity)


def test_adaptive_reserve_start_failure_fails_closed_without_exposing_slot(
    tmp_path: Path,
) -> None:
    events: list[str] = []
    workers = tuple(WorkerId(f"worker-{index}") for index in range(1, 11))
    controller = _DesiredCapacity(9)
    pool = AdaptiveWorkerPool(
        RunId("run-test"),
        controller,
        warm_worker_ids=workers[:8],
        reserve_capsules=(
            FakeCapsule(workers[8], events, tmp_path, fail_start=True),
            FakeCapsule(workers[9], events, tmp_path),
        ),
        capacity_order=(workers[7], *workers[:7], *workers[8:]),
    )

    with pytest.raises(WorkerLoopError) as error:
        _ = pool.assignment_capacity()

    assert error.value.crash.worker_id == WorkerId("worker-9")
    assert not pool.worker_is_enabled(WorkerId("worker-9"), 9)


def test_cli_dispatches_dynamic_mode_without_calling_legacy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    monkeypatch.setattr(os, "name", "nt")
    monkeypatch.delenv("CI", raising=False)
    monkeypatch.delenv("E2E_RUNNER_MODE", raising=False)
    calls: list[tuple[RunnerMode, tuple[str, ...]]] = []

    def fake_dynamic(
        options: RunnerOptions,
        playwright_args: tuple[str, ...],
    ) -> int:
        calls.append((options.mode, playwright_args))
        return 17

    def fail_legacy(_options: RunnerOptions) -> int:
        raise AssertionError("legacy runner must not be called")

    monkeypatch.setattr(runner_module, "run_dynamic", fake_dynamic)

    # When
    return_code = run_cli(
        ["--project-matrix", "--grep", "auth"],
        fail_legacy,
    )

    # Then
    assert return_code == 17
    assert calls == [
        (RunnerMode.DYNAMIC, ("--grep", "auth", "--reporter=json"))
    ]


def test_local_runtime_discovers_matrix_with_preserved_playwright_args(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    fixture = ROOT / "backend" / "tests" / "fixtures" / "e2e-playwright-list.json"
    captured: list[tuple[list[str], dict[str, str]]] = []

    def fake_run(launch: ProcessLaunch) -> OwnedCommandResult:
        assert launch.env is not None
        captured.append((list(launch.command), dict(launch.env)))
        return OwnedCommandResult(
            0,
            fixture.read_bytes(),
            b"",
        )

    monkeypatch.setattr(
        "scripts.e2e_scheduler.runner_discovery.run_owned_command",
        fake_run,
    )
    options = replace(make_options(), html_report=True, include_slow=True)
    runtime = LocalSchedulerRuntime(
        options,
        repository_root=ROOT,
        scheduler_root=tmp_path / "scheduler",
        publication_root=tmp_path / "published",
        history_path=tmp_path / "history.json",
    )

    # When
    discovered = runtime.discover(("--grep", "auth", "--reporter=line"))

    # Then
    command, env = captured[0]
    assert command[-4:] == ["--grep", "auth", "--list", "--reporter=json"]
    assert tuple(arg for arg in command if arg.startswith("--reporter")) == (
        "--reporter=json",
    )
    assert env["E2E_PROJECT_MATRIX"] == "1"
    assert env["E2E_HTML_REPORT"] == "1"
    assert env["E2E_INCLUDE_SLOW"] == "1"
    assert len(discovered) == 6


def test_playwright_remote_endpoint_keeps_project_launch_selection() -> None:
    # Given / When
    local = load_playwright_config(ROOT, None)
    remote = load_playwright_config(ROOT, "ws://127.0.0.1:9222/browser/test")

    # Then
    assert remote.connect == "ws://127.0.0.1:9222/browser/test"
    assert remote.projects == local.projects


def test_ci_scripts_select_legacy_runner_explicitly() -> None:
    # Given / When
    scripts = load_package_scripts(ROOT)

    # Then
    assert scripts["ci:e2e"].endswith("--legacy-runner")
    assert scripts["ci:e2e:matrix"].endswith(
        "--project-matrix --legacy-runner"
    )
