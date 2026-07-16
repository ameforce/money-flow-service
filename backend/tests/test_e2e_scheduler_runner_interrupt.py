from __future__ import annotations

from collections.abc import Iterable
from concurrent.futures import Future
from pathlib import Path
from threading import Event
from typing import NoReturn, final, override

import pytest

import scripts.e2e_scheduler.runner as runner_module
import scripts.e2e_scheduler.runner_worker as runner_worker_module
from backend.tests.e2e_scheduler_runner_capsule_fake import FakeCapsule
from backend.tests.e2e_scheduler_runner_fakes import (
    FakeRuntime,
    make_options,
    make_test,
)
from backend.tests.e2e_scheduler_runner_errors import FakeWorkerCrashError
from scripts.e2e_scheduler.model import RunId, WorkerId
from scripts.e2e_scheduler.queue import EligibleJobQueue
from scripts.e2e_scheduler.runner import run_dynamic
from scripts.e2e_scheduler.runner_worker import (
    CapsuleWorker,
    ResultLedger,
    RunMetricsStatus,
    SchedulerRuntime,
    run_worker_pool,
)


type _WorkerPoolArgument = (
    RunId
    | tuple[CapsuleWorker, ...]
    | EligibleJobQueue
    | ResultLedger
    | SchedulerRuntime
)


@final
class _BlockingStartupCapsule(FakeCapsule):
    _started: Event

    def __init__(
        self,
        worker_id: WorkerId,
        runtime: FakeRuntime,
        started: Event,
    ) -> None:
        super().__init__(worker_id, runtime.events, runtime.tmp_path)
        self._started = started

    @override
    def start(self) -> None:
        self._started.set()
        assert self.stop_event.wait(1.0)


@final
class _FailingStartupCapsule(FakeCapsule):
    _peer_started: Event

    def __init__(
        self,
        worker_id: WorkerId,
        runtime: FakeRuntime,
        peer_started: Event,
    ) -> None:
        super().__init__(worker_id, runtime.events, runtime.tmp_path)
        self._peer_started = peer_started

    @override
    def start(self) -> None:
        assert self._peer_started.wait(1.0)
        raise FakeWorkerCrashError(str(self.worker_id))


@pytest.mark.parametrize("interruption", [KeyboardInterrupt(), SystemExit(130)])
def test_coordinator_saves_fail_closed_metrics_after_interrupt_cleanup(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    interruption: KeyboardInterrupt | SystemExit,
) -> None:
    # Given
    runtime = FakeRuntime(tmp_path, (make_test(1), make_test(2)))

    def interrupt_worker_pool(*_args: _WorkerPoolArgument) -> None:
        raise interruption

    monkeypatch.setattr(runner_module, "run_worker_pool", interrupt_worker_pool)

    # When / Then
    with pytest.raises(type(interruption)):
        _ = run_dynamic(make_options(), (), runtime=runtime)

    assert all(capsule.close_calls == 1 for capsule in runtime.capsules)
    assert runtime.saved_run_metrics_status is RunMetricsStatus.INTERRUPTED
    assert runtime.saved_run_metrics_expected_jobs == 2
    assert runtime.saved_run_metrics_completed_jobs == 0
    assert runtime.events.index("metrics:interrupted") > max(
        index
        for index, event in enumerate(runtime.events)
        if event.startswith("close:")
    )
    assert runtime.aggregate_calls == 0
    assert not runtime.history_saved


def test_capacity_evidence_failure_does_not_mask_original_interrupt(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    runtime = FakeRuntime(
        tmp_path,
        (make_test(1),),
        capacity_decision_failure=True,
    )

    def interrupt_worker_pool(*_args: _WorkerPoolArgument) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(runner_module, "run_worker_pool", interrupt_worker_pool)

    with pytest.raises(KeyboardInterrupt):
        _ = run_dynamic(make_options(), (), runtime=runtime)

    assert runtime.saved_run_metrics_status is RunMetricsStatus.INTERRUPTED
    assert runtime.aggregate_calls == 0
    assert not runtime.history_saved


def test_worker_pool_interrupt_stops_active_capsules_before_executor_wait(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    runtime = FakeRuntime(tmp_path, ())
    capsule = FakeCapsule(WorkerId("worker-1"), runtime.events, tmp_path)
    started = Event()

    def blocking_worker(*_args: _WorkerPoolArgument) -> None:
        started.set()
        _ = capsule.stop_event.wait(2.0)

    def interrupt_after_worker_start(
        _futures: Iterable[Future[None]],
    ) -> NoReturn:
        assert started.wait(1.0)
        raise KeyboardInterrupt

    monkeypatch.setattr(runner_worker_module, "_worker_loop", blocking_worker)
    monkeypatch.setattr(
        runner_worker_module,
        "as_completed",
        interrupt_after_worker_start,
    )

    # When / Then
    with pytest.raises(KeyboardInterrupt):
        _ = run_worker_pool(
            RunId("run-interrupt"),
            (capsule,),
            EligibleJobQueue(()),
            ResultLedger(),
            runtime,
        )

    assert capsule.stop_requests == 1
    assert capsule.stop_event.is_set()


def test_capsule_startup_failure_stops_other_startups_before_executor_wait(
    tmp_path: Path,
) -> None:
    runtime = FakeRuntime(tmp_path, ())
    blocking_started = Event()
    blocking = _BlockingStartupCapsule(WorkerId("worker-1"), runtime, blocking_started)
    failing = _FailingStartupCapsule(WorkerId("worker-2"), runtime, blocking_started)

    crash = runner_module.start_capsules(
        RunId("run-start-failure"),
        (blocking, failing),
        runtime,
    )

    assert crash is not None
    assert crash.worker_id == WorkerId("worker-2")
    assert blocking.stop_requests == 1
    assert blocking.stop_event.is_set()


def test_capsule_startup_interrupt_stops_startups_before_executor_wait(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    runtime = FakeRuntime(tmp_path, ())
    started = Event()
    capsule = _BlockingStartupCapsule(WorkerId("worker-1"), runtime, started)

    def interrupt_after_start(
        _futures: Iterable[Future[None]],
    ) -> NoReturn:
        assert started.wait(1.0)
        raise KeyboardInterrupt

    monkeypatch.setattr(runner_module, "as_completed", interrupt_after_start)

    with pytest.raises(KeyboardInterrupt):
        _ = runner_module.start_capsules(
            RunId("run-start-interrupt"),
            (capsule,),
            runtime,
        )

    assert capsule.stop_requests == 1
    assert capsule.stop_event.is_set()
