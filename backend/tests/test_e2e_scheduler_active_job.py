from __future__ import annotations

from typing import final

from scripts.e2e_scheduler.active_job import ActiveJobController
from scripts.e2e_scheduler.model import RunId, WorkerId
from scripts.e2e_scheduler.processes import OwnedProcess


@final
class FakeProcess:
    pid = 7101
    stdin = None

    def poll(self) -> int | None:
        return None

    def send_signal(self, _signal: int) -> None:
        return None

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        return 0


@final
class FakeOwnership:
    def __init__(self) -> None:
        self.terminate_calls = 0

    def active_processes(self) -> int:
        return 1

    def terminate(self) -> None:
        self.terminate_calls += 1

    def wait_until_empty(self, _timeout_seconds: float) -> int:
        return 0

    def close(self) -> None:
        return None


def test_stop_request_terminates_current_owned_job() -> None:
    # Given
    ownership = FakeOwnership()
    owned = OwnedProcess(FakeProcess(), ownership=ownership)
    controller = ActiveJobController(RunId("run-a"), WorkerId("worker-1"))
    controller.activate(owned)

    # When
    controller.request_stop()

    # Then
    assert ownership.terminate_calls == 1


def test_stop_request_before_activation_terminates_late_owned_job() -> None:
    # Given
    ownership = FakeOwnership()
    owned = OwnedProcess(FakeProcess(), ownership=ownership)
    controller = ActiveJobController(RunId("run-a"), WorkerId("worker-1"))
    controller.request_stop()

    # When
    controller.activate(owned)

    # Then
    assert ownership.terminate_calls == 1
