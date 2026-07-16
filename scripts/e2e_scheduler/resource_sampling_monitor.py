"""Periodic synchronized host/backend sampling for fixed and adaptive runs."""

from __future__ import annotations

from dataclasses import dataclass
from threading import Event, Lock, Thread
from typing import Protocol, final, override

from scripts.e2e_scheduler.resources import ResourceSample


class ResourceSampler(Protocol):
    def sample(self) -> ResourceSample: ...


@dataclass(frozen=True, slots=True)
class ResourceSamplingSnapshot:
    samples: tuple[ResourceSample, ...]
    errors: tuple[str, ...]


@dataclass(slots=True)
class ResourceSamplingMonitorAlreadyStartedError(RuntimeError):
    @override
    def __str__(self) -> str:
        return "resource sampling monitor already started"


@dataclass(slots=True)
class ResourceSamplingMonitorStopTimeoutError(RuntimeError):
    timeout_seconds: float

    @override
    def __str__(self) -> str:
        return (
            "resource sampling monitor failed to stop within "
            f"{self.timeout_seconds:.3f}s"
        )


@final
class SynchronizedResourceSampler:
    """Serialize system counters and backend probes across all consumers."""

    def __init__(self, sampler: ResourceSampler) -> None:
        self._sampler = sampler
        self._lock = Lock()

    def sample(self) -> ResourceSample:
        with self._lock:
            return self._sampler.sample()


@final
class ResourceSamplingMonitor:
    """Collect resource samples without blocking worker assignment."""

    def __init__(
        self,
        sampler: ResourceSampler,
        *,
        interval_seconds: float = 5.0,
    ) -> None:
        self._sampler = sampler
        self._interval_seconds = max(0.0, interval_seconds)
        self._stop = Event()
        self._lock = Lock()
        self._samples: list[ResourceSample] = []
        self._errors: list[str] = []
        self._thread: Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            raise ResourceSamplingMonitorAlreadyStartedError
        self._thread = Thread(
            target=self._run,
            name="e2e-resource-sampler",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> ResourceSamplingSnapshot:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            timeout_seconds = max(5.0, self._interval_seconds + 1.0)
            thread.join(timeout=timeout_seconds)
            if thread.is_alive():
                raise ResourceSamplingMonitorStopTimeoutError(timeout_seconds)
        with self._lock:
            return ResourceSamplingSnapshot(
                samples=tuple(self._samples),
                errors=tuple(self._errors),
            )

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                sample = self._sampler.sample()
            except Exception as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
                with self._lock:
                    self._errors.append(str(error))
            else:
                with self._lock:
                    self._samples.append(sample)
            if self._stop.wait(self._interval_seconds):
                return
