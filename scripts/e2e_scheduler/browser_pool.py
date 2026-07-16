"""Lazy warm browser-engine ownership for one worker capsule."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Self, final

from scripts.e2e_scheduler.browser import BrowserServerHandle
from scripts.e2e_scheduler.processes import OwnedProcessCleanupError
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.project_profiles import BrowserEngine


@final
class BrowserServerPool:
    """Keep each acquired browser engine warm until capsule cleanup."""

    __slots__ = (
        "_handles",
        "_order",
        "_repository_root",
        "_logs_root",
        "_temporary_root",
        "_stop_requested",
        "_metrics_recorder",
    )

    def __init__(
        self,
        repository_root: Path,
        logs_root: Path,
        temporary_root: Path,
        initial_engine: BrowserEngine,
        initial: BrowserServerHandle,
        stop_requested: Callable[[], bool],
        metrics_recorder: ProcessMetricsRecorder | None,
    ) -> None:
        self._repository_root = repository_root
        self._logs_root = logs_root
        self._temporary_root = temporary_root
        self._stop_requested = stop_requested
        self._metrics_recorder = metrics_recorder
        self._handles: dict[BrowserEngine, BrowserServerHandle] = {
            initial_engine: initial
        }
        self._order: list[BrowserEngine] = [initial_engine]

    @classmethod
    def start(
        cls,
        repository_root: Path,
        logs_root: Path,
        temporary_root: Path,
        initial_engine: BrowserEngine = "chromium",
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: ProcessMetricsRecorder | None = None,
    ) -> Self:
        suffix = "" if initial_engine == "chromium" else f"-{initial_engine}"
        if initial_engine == "chromium":
            initial = BrowserServerHandle.start(
                repository_root=repository_root,
                stdout_path=logs_root / "browser.stdout.log",
                stderr_path=logs_root / "browser.stderr.log",
                endpoint_path=logs_root / "browser-endpoint.json",
                temporary_root=temporary_root / initial_engine,
                stop_requested=stop_requested,
                metrics_recorder=metrics_recorder,
            )
        else:
            initial = BrowserServerHandle.start(
                repository_root=repository_root,
                stdout_path=logs_root / f"browser{suffix}.stdout.log",
                stderr_path=logs_root / f"browser{suffix}.stderr.log",
                endpoint_path=logs_root / f"browser{suffix}-endpoint.json",
                temporary_root=temporary_root / initial_engine,
                engine=initial_engine,
                stop_requested=stop_requested,
                metrics_recorder=metrics_recorder,
            )
        return cls(
            repository_root,
            logs_root,
            temporary_root,
            initial_engine,
            initial,
            stop_requested,
            metrics_recorder,
        )

    def endpoint_for(
        self,
        engine: BrowserEngine,
        *,
        retire_others: bool = False,
    ) -> str:
        if retire_others:
            self._retire_except(engine)
        existing = self._handles.get(engine)
        if existing is not None:
            return existing.ws_endpoint
        handle = BrowserServerHandle.start(
            repository_root=self._repository_root,
            stdout_path=self._logs_root / f"browser-{engine}.stdout.log",
            stderr_path=self._logs_root / f"browser-{engine}.stderr.log",
            endpoint_path=self._logs_root / f"browser-{engine}-endpoint.json",
            temporary_root=self._temporary_root / engine,
            engine=engine,
            stop_requested=self._stop_requested,
            metrics_recorder=self._metrics_recorder,
        )
        self._handles[engine] = handle
        self._order.append(engine)
        return handle.ws_endpoint

    @property
    def engines(self) -> tuple[BrowserEngine, ...]:
        return tuple(self._order)

    def _retire_except(self, retained_engine: BrowserEngine) -> None:
        first_failure: OwnedProcessCleanupError | None = None
        for engine in tuple(reversed(self._order)):
            if engine == retained_engine:
                continue
            try:
                self._handles[engine].close()
            except OwnedProcessCleanupError as error:
                if first_failure is None:
                    first_failure = error
                continue
            del self._handles[engine]
            self._order.remove(engine)
        if first_failure is not None:
            raise first_failure

    def close(self) -> None:
        first_failure: OwnedProcessCleanupError | None = None
        for engine in tuple(reversed(self._order)):
            try:
                self._handles[engine].close()
            except OwnedProcessCleanupError as error:
                if first_failure is None:
                    first_failure = error
                continue
            del self._handles[engine]
            self._order.remove(engine)
        if first_failure is not None:
            raise first_failure
