from __future__ import annotations

from dataclasses import dataclass
from typing import override

from scripts.e2e_scheduler.model import WorkerId


@dataclass(frozen=True, slots=True)
class FakeWorkerCrashError(RuntimeError):
    spec_name: str

    @override
    def __str__(self) -> str:
        return f"crash {self.spec_name}"


@dataclass(frozen=True, slots=True)
class FakeCleanupError(RuntimeError):
    worker_id: WorkerId

    @override
    def __str__(self) -> str:
        return f"cleanup failed for {self.worker_id}"
