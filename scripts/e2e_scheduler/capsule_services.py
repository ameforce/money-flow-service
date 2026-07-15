"""Own the same-origin backend and warm browser for one capsule."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import override

from scripts.e2e_scheduler.browser_pool import BrowserServerPool
from scripts.e2e_scheduler.cleanup_composition import close_acquired_services
from scripts.e2e_scheduler.legacy_runtime import pick_free_port, start_orchestrator
from scripts.e2e_scheduler.processes import OwnedProcess, OwnedProcessCleanupError
from scripts.e2e_scheduler.process_metrics import ProcessMetricsRecorder
from scripts.e2e_scheduler.project_profiles import BrowserEngine
from scripts.e2e_scheduler.runtime_support import wait_until_up


_MAX_PORT_START_ATTEMPTS = 3


@dataclass(frozen=True, slots=True)
class CapsuleServiceStartError(Exception):
    reason: str

    @override
    def __str__(self) -> str:
        return f"failed to start capsule services: {self.reason}"


@dataclass(frozen=True, slots=True)
class CapsuleServices:
    backend_port: int
    browser: BrowserServerPool
    orchestrator: OwnedProcess

    @property
    def origin(self) -> str:
        return f"http://127.0.0.1:{self.backend_port}"

    @classmethod
    def start(
        cls,
        *,
        repository_root: Path,
        worker_root: Path,
        database_path: Path,
        logs_root: Path,
        initial_browser_engine: BrowserEngine = "chromium",
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: ProcessMetricsRecorder | None = None,
    ) -> CapsuleServices:
        if stop_requested():
            raise CapsuleServiceStartError(reason="service startup cancelled")
        browser = BrowserServerPool.start(
            repository_root,
            logs_root,
            worker_root / "browser",
            initial_browser_engine,
            stop_requested,
            metrics_recorder,
        )
        if stop_requested():
            failures = close_acquired_services((browser,))
            raise CapsuleServiceStartError(
                reason=_startup_failure_detail("service startup cancelled", failures)
            )
        db_url = f"sqlite:///{database_path.as_posix()}"
        for attempt in range(_MAX_PORT_START_ATTEMPTS):
            if stop_requested():
                failures = close_acquired_services((browser,))
                raise CapsuleServiceStartError(
                    reason=_startup_failure_detail(
                        "service startup cancelled", failures
                    )
                )
            backend_port = pick_free_port()
            try:
                orchestrator = start_orchestrator(
                    db_url,
                    backend_port,
                    backend_port,
                    skip_frontend=True,
                    project_root=worker_root,
                    import_allowed_root=repository_root / "legacy",
                    stdout_path=logs_root / "orchestrator.stdout.log",
                    stderr_path=logs_root / "orchestrator.stderr.log",
                    defer_port_ownership=True,
                    metrics_recorder=metrics_recorder,
                )
            except (OSError, OwnedProcessCleanupError) as error:
                failures = close_acquired_services((browser,))
                detail = _startup_failure_detail(str(error), failures)
                raise CapsuleServiceStartError(reason=detail) from error
            if stop_requested():
                failures = close_acquired_services((orchestrator, browser))
                raise CapsuleServiceStartError(
                    reason=_startup_failure_detail(
                        "service startup cancelled", failures
                    )
                )
            backend_health = f"http://127.0.0.1:{backend_port}/healthz"
            origin = f"http://127.0.0.1:{backend_port}"
            ready = wait_until_up(
                backend_health,
                origin,
                timeout_sec=180,
                stop_if=lambda: (
                    orchestrator.process.poll() is not None
                    or stop_requested()
                ),
            )
            if ready and orchestrator.process.poll() is None:
                return cls(
                    backend_port,
                    browser,
                    orchestrator.with_ports((backend_port,)),
                )
            process_exited = orchestrator.process.poll() is not None
            failures = close_acquired_services((orchestrator,))
            if stop_requested():
                failures += close_acquired_services((browser,))
                raise CapsuleServiceStartError(
                    reason=_startup_failure_detail(
                        "service startup cancelled", failures
                    )
                )
            if (
                process_exited
                and not failures
                and attempt + 1 < _MAX_PORT_START_ATTEMPTS
            ):
                continue
            failures += close_acquired_services((browser,))
            detail = _startup_failure_detail("service startup timed out", failures)
            raise CapsuleServiceStartError(reason=detail)
        raise AssertionError("unreachable capsule startup attempt exhaustion")

    def close(self) -> tuple[str, ...]:
        return close_acquired_services((self.browser, self.orchestrator))


def _startup_failure_detail(reason: str, failures: tuple[str, ...]) -> str:
    if not failures:
        return reason
    return f"{reason}; cleanup failed: {'; '.join(failures)}"
