from __future__ import annotations

from threading import Event, Lock
from typing import final

import pytest

from scripts.e2e_scheduler.resource_sampling_monitor import (
    ResourceSamplingMonitor,
    ResourceSamplingMonitorAlreadyStartedError,
    ResourceSamplingMonitorStopTimeoutError,
    SynchronizedResourceSampler,
)
from scripts.e2e_scheduler.resources import ResourceSample


@final
class _Sampler:
    def __init__(self) -> None:
        self.calls = 0
        self.concurrent = 0
        self.peak_concurrent = 0
        self.entered = Event()
        self.release = Event()
        self._lock = Lock()

    def sample(self) -> ResourceSample:
        with self._lock:
            self.calls += 1
            self.concurrent += 1
            self.peak_concurrent = max(self.peak_concurrent, self.concurrent)
        self.entered.set()
        _ = self.release.wait(timeout=1)
        with self._lock:
            self.concurrent -= 1
        return ResourceSample(70.0, 40.0, 200.0, 0, 0)


def test_monitor_collects_host_samples_and_stops_cleanly() -> None:
    sampler = _Sampler()
    sampler.release.set()
    monitor = ResourceSamplingMonitor(sampler, interval_seconds=0.01)

    monitor.start()
    assert sampler.entered.wait(timeout=1)
    snapshot = monitor.stop()

    assert snapshot.samples
    assert snapshot.errors == ()


def test_synchronized_sampler_serializes_monitor_and_adaptive_reads() -> None:
    sampler = _Sampler()
    synchronized = SynchronizedResourceSampler(sampler)
    monitor = ResourceSamplingMonitor(synchronized, interval_seconds=60)

    monitor.start()
    assert sampler.entered.wait(timeout=1)
    sampler.release.set()
    _ = synchronized.sample()
    snapshot = monitor.stop()

    assert len(snapshot.samples) == 1
    assert sampler.calls == 2
    assert sampler.peak_concurrent == 1


def test_monitor_records_sampler_errors_without_losing_prior_samples() -> None:
    finished = Event()
    samples: list[ResourceSample | OSError] = [
        ResourceSample(60.0, 50.0, 100.0, 0, 0),
        OSError("counter unavailable"),
    ]

    class SequenceSampler:
        def sample(self) -> ResourceSample:
            value = samples.pop(0)
            if isinstance(value, OSError):
                finished.set()
                raise value
            return value

    monitor = ResourceSamplingMonitor(SequenceSampler(), interval_seconds=0.01)
    monitor.start()
    assert finished.wait(timeout=1)
    snapshot = monitor.stop()

    assert len(snapshot.samples) == 1
    assert snapshot.errors == ("counter unavailable",)


def test_monitor_rejects_second_start_with_typed_error() -> None:
    # Given
    sampler = _Sampler()
    sampler.release.set()
    monitor = ResourceSamplingMonitor(sampler, interval_seconds=60)
    monitor.start()

    try:
        # When / Then
        with pytest.raises(ResourceSamplingMonitorAlreadyStartedError):
            monitor.start()
    finally:
        _ = monitor.stop()


def test_stop_timeout_error_reports_the_join_budget() -> None:
    # Given / When
    error = ResourceSamplingMonitorStopTimeoutError(timeout_seconds=6.0)

    # Then
    assert isinstance(error, RuntimeError)
    assert str(error) == "resource sampling monitor failed to stop within 6.000s"
