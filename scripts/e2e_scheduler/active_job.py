"""Thread-safe ownership of the job currently running in one worker capsule."""

from __future__ import annotations

from dataclasses import dataclass
from threading import Event, Lock
from typing import final, override

from scripts.e2e_scheduler.model import RunId, WorkerId
from scripts.e2e_scheduler.processes import OwnedProcess


@dataclass(frozen=True, slots=True)
class ActiveJobOverlapError(Exception):
    run_id: RunId
    worker_id: WorkerId

    @override
    def __str__(self) -> str:
        return f"worker {self.run_id}/{self.worker_id} attempted overlapping jobs"


@final
class ActiveJobController:
    """Coordinate worker-thread job ownership with main-thread interruption."""

    __slots__ = ("_active", "_lock", "_run_id", "_stop_requested", "_worker_id")

    def __init__(self, run_id: RunId, worker_id: WorkerId) -> None:
        self._run_id = run_id
        self._worker_id = worker_id
        self._active: OwnedProcess | None = None
        self._lock = Lock()
        self._stop_requested = Event()

    def activate(self, owned: OwnedProcess) -> None:
        with self._lock:
            if self._active is not None:
                raise ActiveJobOverlapError(self._run_id, self._worker_id)
            self._active = owned
            if self._stop_requested.is_set():
                owned.request_stop()

    def deactivate(self, owned: OwnedProcess) -> None:
        with self._lock:
            if self._active is owned:
                self._active = None

    def request_stop(self) -> None:
        self._stop_requested.set()
        with self._lock:
            if self._active is not None:
                self._active.request_stop()
