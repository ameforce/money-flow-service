"""Per-job phase and authentication metrics artifact boundary."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Literal, override

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from scripts.e2e_scheduler.metrics import (
    AuthSetupMode,
    BrowserMetrics,
    ExecutionMetrics,
    JobMetrics,
    SetupMetrics,
)


@dataclass(slots=True)
class AuthSetupMetricsFormatError(Exception):
    path: Path
    line_number: int
    detail: str

    @override
    def __str__(self) -> str:
        return (
            f"invalid auth setup metrics {self.path}:{self.line_number}: {self.detail}"
        )


class _StrictInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(
        extra="forbid",
        frozen=True,
        strict=True,
    )


class _AuthSetupEvent(_StrictInput):
    version: Literal[1]
    kind: Literal["auth_setup"]
    mode: Literal["ui", "api"]
    duration_ms: float = Field(ge=0)
    status: Literal["passed", "failed"]


class _PersistedAuth(_StrictInput):
    mode: Literal["none", "ui", "api", "mixed"]
    count: int = Field(ge=0)
    duration_seconds: float = Field(ge=0)
    failed: int = Field(ge=0)
    ui_count: int = Field(ge=0)
    ui_seconds: float = Field(ge=0)
    api_count: int = Field(ge=0)
    api_seconds: float = Field(ge=0)


class _PersistedJobMetrics(_StrictInput):
    version: Literal[1]
    auth: _PersistedAuth
    db_reset_seconds: float = Field(ge=0)
    db_reset_retry_count: int = Field(default=0, ge=0)
    db_reset_locked_seconds: float = Field(default=0.0, ge=0)
    filesystem_cleanup_seconds: float = Field(ge=0)
    browser_acquire_seconds: float = Field(ge=0)
    browser_switch_seconds: float = Field(ge=0)
    playwright_boundary_seconds: float = Field(ge=0)
    actual_test_seconds: float = Field(ge=0)
    duration_inventory_complete: bool


def load_auth_setup_metrics(path: Path) -> SetupMetrics:
    if not path.exists():
        return SetupMetrics()
    events: list[_AuthSetupEvent] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line:
            continue
        try:
            events.append(_AuthSetupEvent.model_validate_json(line))
        except ValidationError as error:
            raise AuthSetupMetricsFormatError(
                path=path,
                line_number=line_number,
                detail=str(error),
            ) from error
    if not events:
        return SetupMetrics()
    counts = Counter(event.mode for event in events)
    durations: dict[str, float] = defaultdict(float)
    for event in events:
        durations[event.mode] += event.duration_ms / 1000.0
    modes = frozenset(counts)
    mode = AuthSetupMode.MIXED if len(modes) > 1 else AuthSetupMode(next(iter(modes)))
    return SetupMetrics(
        auth_mode=mode,
        auth_count=len(events),
        auth_seconds=sum(durations.values()),
        auth_failures=sum(event.status == "failed" for event in events),
        auth_ui_count=counts["ui"],
        auth_ui_seconds=durations["ui"],
        auth_api_count=counts["api"],
        auth_api_seconds=durations["api"],
    )


def save_job_metrics(path: Path, metrics: JobMetrics) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    payload = {
        "version": 1,
        "auth": {
            "mode": metrics.setup.auth_mode.value,
            "count": metrics.setup.auth_count,
            "duration_seconds": metrics.setup.auth_seconds,
            "failed": metrics.setup.auth_failures,
            "ui_count": metrics.setup.auth_ui_count,
            "ui_seconds": metrics.setup.auth_ui_seconds,
            "api_count": metrics.setup.auth_api_count,
            "api_seconds": metrics.setup.auth_api_seconds,
        },
        "db_reset_seconds": metrics.setup.db_reset_seconds,
        "db_reset_retry_count": metrics.setup.db_reset_retry_count,
        "db_reset_locked_seconds": metrics.setup.db_reset_locked_seconds,
        "filesystem_cleanup_seconds": metrics.setup.filesystem_cleanup_seconds,
        "browser_acquire_seconds": metrics.browser.acquire_seconds,
        "browser_switch_seconds": metrics.browser.switch_seconds,
        "playwright_boundary_seconds": (
            metrics.execution.playwright_cli_startup_seconds
        ),
        "actual_test_seconds": metrics.execution.actual_test_seconds,
        "duration_inventory_complete": (metrics.execution.duration_inventory_complete),
    }
    _ = temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    _ = temporary.replace(path)


def load_job_metrics(path: Path) -> JobMetrics:
    if not path.exists():
        return JobMetrics()
    payload = _PersistedJobMetrics.model_validate_json(path.read_bytes())
    auth = payload.auth
    return JobMetrics(
        browser=BrowserMetrics(
            acquire_seconds=payload.browser_acquire_seconds,
            switch_seconds=payload.browser_switch_seconds,
        ),
        execution=ExecutionMetrics(
            playwright_cli_startup_seconds=payload.playwright_boundary_seconds,
            actual_test_seconds=payload.actual_test_seconds,
            duration_inventory_complete=payload.duration_inventory_complete,
        ),
        setup=SetupMetrics(
            auth_mode=AuthSetupMode(auth.mode),
            auth_count=auth.count,
            auth_seconds=auth.duration_seconds,
            auth_failures=auth.failed,
            auth_ui_count=auth.ui_count,
            auth_ui_seconds=auth.ui_seconds,
            auth_api_count=auth.api_count,
            auth_api_seconds=auth.api_seconds,
            db_reset_seconds=payload.db_reset_seconds,
            db_reset_retry_count=payload.db_reset_retry_count,
            db_reset_locked_seconds=payload.db_reset_locked_seconds,
            filesystem_cleanup_seconds=payload.filesystem_cleanup_seconds,
        ),
    )
