"""Attempt every owned cleanup and preserve all fail-closed details."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from scripts.e2e_scheduler.processes import OwnedProcessCleanupError


class ClosableService(Protocol):
    def close(self) -> None: ...


def close_acquired_services(
    services: Sequence[ClosableService],
) -> tuple[str, ...]:
    failures: list[str] = []
    for service in services:
        try:
            service.close()
        except OwnedProcessCleanupError as error:
            failures.append(str(error))
    return tuple(failures)
