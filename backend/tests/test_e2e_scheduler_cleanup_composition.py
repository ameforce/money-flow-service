from __future__ import annotations

from typing import final

from scripts.e2e_scheduler.processes import OwnedProcessCleanupError
from scripts.e2e_scheduler.cleanup_composition import close_acquired_services


@final
class FailingCloser:
    def __init__(self, pid: int) -> None:
        self.pid = pid
        self.calls = 0

    def close(self) -> None:
        self.calls += 1
        raise OwnedProcessCleanupError(
            pid=self.pid,
            open_ports=(self.pid,),
            process_running=True,
        )


def test_composed_cleanup_attempts_every_acquired_service() -> None:
    # Given
    first = FailingCloser(7001)
    second = FailingCloser(7002)
    third = FailingCloser(7003)

    # When
    failures = close_acquired_services((first, second, third))

    # Then
    assert (first.calls, second.calls, third.calls) == (1, 1, 1)
    assert len(failures) == 3
    assert all(str(pid) in detail for pid, detail in zip((7001, 7002, 7003), failures, strict=True))
