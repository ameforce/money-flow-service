"""Run-scoped accounting for scheduler-owned process trees."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from threading import Lock
from typing import NewType, final


ProcessRecordingId = NewType("ProcessRecordingId", int)


@dataclass(frozen=True, slots=True)
class ProcessResourceUsage:
    cpu_seconds: float = 0.0
    read_bytes: int = 0
    write_bytes: int = 0
    current_working_set_bytes: int = 0
    peak_working_set_bytes: int = 0
    active_process_count: int = 0
    peak_process_count: int = 0
    total_process_count: int = 0


@dataclass(frozen=True, slots=True)
class ProcessRoleCount:
    role: str
    count: int


@dataclass(frozen=True, slots=True)
class ProcessMetricsSnapshot:
    spawn_counts: tuple[ProcessRoleCount, ...] = ()
    cpu_seconds: float = 0.0
    read_bytes: int = 0
    write_bytes: int = 0
    peak_working_set_bytes: int = 0
    peak_process_count: int = 0
    total_process_count: int = 0
    active_launch_count: int = 0
    peak_launch_count: int = 0


@final
class ProcessMetricsRecorder:
    """Thread-safe mutable accumulator scoped to one scheduler run."""

    __slots__ = (
        "_active",
        "_cpu_seconds",
        "_lock",
        "_next_recording_id",
        "_peak_launch_count",
        "_peak_process_count",
        "_peak_working_set_bytes",
        "_parent_baseline",
        "_parent_latest",
        "_parent_usage_reader",
        "_read_bytes",
        "_spawn_counts",
        "_total_process_count",
        "_write_bytes",
    )

    def __init__(
        self,
        parent_usage_reader: Callable[[], ProcessResourceUsage] | None = None,
    ) -> None:
        self._active: dict[
            ProcessRecordingId,
            tuple[str, Callable[[], ProcessResourceUsage] | None],
        ] = {}
        self._cpu_seconds = 0.0
        self._lock = Lock()
        self._next_recording_id = 1
        self._peak_launch_count = 0
        self._peak_process_count = 0
        self._peak_working_set_bytes = 0
        self._parent_usage_reader = parent_usage_reader
        self._parent_baseline = _read_usage(parent_usage_reader)
        self._parent_latest = self._parent_baseline
        self._read_bytes = 0
        self._spawn_counts: dict[str, int] = {}
        self._total_process_count = 0
        self._write_bytes = 0

    def record_spawn(
        self,
        role: str,
        resource_usage_reader: Callable[[], ProcessResourceUsage] | None = None,
    ) -> ProcessRecordingId:
        with self._lock:
            recording_id = ProcessRecordingId(self._next_recording_id)
            self._next_recording_id += 1
            self._active[recording_id] = (role, resource_usage_reader)
            self._spawn_counts[role] = self._spawn_counts.get(role, 0) + 1
            self._peak_launch_count = max(
                self._peak_launch_count,
                len(self._active),
            )
            return recording_id

    def sample_active_resources(self) -> None:
        """Capture the run-wide concurrent child and scheduler-parent peak."""
        with self._lock:
            readers = tuple(
                reader for _role, reader in self._active.values() if reader is not None
            )
            parent_reader = self._parent_usage_reader
        usages = tuple(
            usage
            for reader in readers
            if (usage := _read_usage(reader)) is not None
        )
        parent = _read_usage(parent_reader)
        concurrent_working_set = sum(
            usage.current_working_set_bytes for usage in usages
        )
        concurrent_processes = sum(usage.active_process_count for usage in usages)
        if parent is not None:
            concurrent_working_set += parent.current_working_set_bytes
            concurrent_processes += parent.active_process_count
        with self._lock:
            if parent is not None:
                self._parent_latest = parent
            self._peak_working_set_bytes = max(
                self._peak_working_set_bytes,
                concurrent_working_set,
            )
            self._peak_process_count = max(
                self._peak_process_count,
                concurrent_processes,
            )

    def record_close(
        self,
        recording_id: ProcessRecordingId,
        usage: ProcessResourceUsage | None,
    ) -> None:
        with self._lock:
            removed = self._active.pop(recording_id, None)
            if removed is None:
                return
            if usage is None:
                return
            self._cpu_seconds += usage.cpu_seconds
            self._read_bytes += usage.read_bytes
            self._write_bytes += usage.write_bytes
            self._peak_working_set_bytes = max(
                self._peak_working_set_bytes,
                usage.peak_working_set_bytes,
            )
            self._peak_process_count = max(
                self._peak_process_count,
                usage.peak_process_count,
            )
            self._total_process_count += usage.total_process_count

    def snapshot(self) -> ProcessMetricsSnapshot:
        self.sample_active_resources()
        with self._lock:
            parent = _usage_delta(self._parent_baseline, self._parent_latest)
            return ProcessMetricsSnapshot(
                spawn_counts=tuple(
                    ProcessRoleCount(role, count)
                    for role, count in sorted(self._spawn_counts.items())
                ),
                cpu_seconds=self._cpu_seconds + parent.cpu_seconds,
                read_bytes=self._read_bytes + parent.read_bytes,
                write_bytes=self._write_bytes + parent.write_bytes,
                peak_working_set_bytes=self._peak_working_set_bytes,
                peak_process_count=self._peak_process_count,
                total_process_count=(
                    self._total_process_count
                    + (1 if self._parent_latest is not None else 0)
                ),
                active_launch_count=len(self._active),
                peak_launch_count=self._peak_launch_count,
            )


def _read_usage(
    reader: Callable[[], ProcessResourceUsage] | None,
) -> ProcessResourceUsage | None:
    if reader is None:
        return None
    try:
        return reader()
    except OSError:
        return None


def _usage_delta(
    baseline: ProcessResourceUsage | None,
    latest: ProcessResourceUsage | None,
) -> ProcessResourceUsage:
    if baseline is None or latest is None:
        return ProcessResourceUsage()
    return ProcessResourceUsage(
        cpu_seconds=max(latest.cpu_seconds - baseline.cpu_seconds, 0.0),
        read_bytes=max(latest.read_bytes - baseline.read_bytes, 0),
        write_bytes=max(latest.write_bytes - baseline.write_bytes, 0),
    )
