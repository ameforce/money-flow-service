from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
import multiprocessing
import os
from pathlib import Path
from typing import Protocol

import pytest

import scripts.e2e_scheduler.runner as dynamic_runner
from scripts.e2e_scheduler.run_lock import (
    LocalE2ERunBusyError,
    RunLockOwner,
    acquire_local_e2e_run_lock,
    local_e2e_run_lock_path,
    local_e2e_run_owner_path,
)
from scripts.e2e_scheduler.runner_options import RunnerMode, RunnerOptions
from scripts.e2e_scheduler.runtime_support import ROOT
import scripts.run_e2e_with_orchestrator as e2e_runner


class _EventLike(Protocol):
    def set(self) -> None: ...

    def wait(self, timeout: float | None = None) -> bool: ...


def _hold_run_lock(
    repository_root: str,
    ready: _EventLike,
    release: _EventLike,
) -> None:
    with acquire_local_e2e_run_lock(Path(repository_root), "dynamic"):
        ready.set()
        _ = release.wait(30.0)


def test_cross_process_lock_rejects_legacy_while_dynamic_owner_is_live(
    tmp_path: Path,
) -> None:
    # Given
    context = multiprocessing.get_context("spawn")
    ready = context.Event()
    release = context.Event()
    process = context.Process(
        target=_hold_run_lock,
        args=(str(tmp_path), ready, release),
    )
    process.start()
    try:
        assert ready.wait(10.0)

        # When / Then
        with pytest.raises(LocalE2ERunBusyError) as captured:
            with acquire_local_e2e_run_lock(tmp_path, "legacy"):
                raise AssertionError("contending run unexpectedly acquired the lock")
        assert captured.value.observed_owner is not None
        assert captured.value.observed_owner.pid == process.pid
        assert captured.value.observed_owner.mode == "dynamic"
    finally:
        release.set()
        process.join(timeout=10.0)
        if process.is_alive():
            process.terminate()
            process.join(timeout=10.0)
    assert process.exitcode == 0


def test_kernel_releases_lock_after_owner_process_is_terminated(
    tmp_path: Path,
) -> None:
    # Given
    context = multiprocessing.get_context("spawn")
    ready = context.Event()
    release = context.Event()
    process = context.Process(
        target=_hold_run_lock,
        args=(str(tmp_path), ready, release),
    )
    process.start()
    try:
        assert ready.wait(10.0)
        process.terminate()
        process.join(timeout=10.0)
        assert not process.is_alive()

        # When
        with acquire_local_e2e_run_lock(tmp_path, "dynamic") as owner:
            acquired_pid = owner.pid

        # Then
        assert acquired_pid == os.getpid()
    finally:
        if process.is_alive():
            process.terminate()
            process.join(timeout=10.0)


def test_stale_corrupt_owner_metadata_never_blocks_a_free_kernel_lock(
    tmp_path: Path,
) -> None:
    # Given
    owner_path = local_e2e_run_owner_path(tmp_path)
    owner_path.parent.mkdir(parents=True)
    _ = owner_path.write_text("not-json", encoding="utf-8")

    # When
    with acquire_local_e2e_run_lock(tmp_path, "dynamic") as owner:
        acquired_invocation = owner.invocation_id

    # Then
    saved = RunLockOwner.model_validate_json(owner_path.read_bytes())
    assert saved.invocation_id == acquired_invocation
    assert local_e2e_run_lock_path(tmp_path).is_file()


def test_keyboard_interrupt_releases_lock_for_the_next_run(tmp_path: Path) -> None:
    # Given / When
    with pytest.raises(KeyboardInterrupt):
        with acquire_local_e2e_run_lock(tmp_path, "dynamic"):
            raise KeyboardInterrupt

    # Then
    with acquire_local_e2e_run_lock(tmp_path, "legacy") as owner:
        assert owner.mode == "legacy"


def test_cli_uses_one_repository_lock_for_dynamic_and_legacy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    events: list[tuple[str, str]] = []

    @contextmanager
    def fake_lock(_root: Path, mode: str) -> Generator[None, None, None]:
        events.append(("lock-enter", mode))
        try:
            yield
        finally:
            events.append(("lock-exit", mode))

    def fake_legacy(_options: RunnerOptions) -> int:
        events.append(("dispatch", "legacy"))
        return 11

    def fake_dynamic(
        _options: RunnerOptions,
        _playwright_args: tuple[str, ...],
    ) -> int:
        events.append(("dispatch", "dynamic"))
        return 12

    monkeypatch.setattr(e2e_runner, "acquire_local_e2e_run_lock", fake_lock)
    monkeypatch.setattr(e2e_runner, "_run_legacy", fake_legacy)
    monkeypatch.setattr(dynamic_runner, "run_dynamic", fake_dynamic)
    monkeypatch.setenv("E2E_RUNNER_MODE", "dynamic")
    original_parse = e2e_runner.parse_runner_options
    monkeypatch.setattr(
        e2e_runner,
        "parse_runner_options",
        lambda args: original_parse(args, platform_name="nt"),
    )

    # When
    legacy_code = e2e_runner.main(["--legacy-runner"])
    dynamic_code = e2e_runner.main(["--project-matrix"])

    # Then
    assert (legacy_code, dynamic_code) == (11, 12)
    assert events == [
        ("lock-enter", "legacy"),
        ("dispatch", "legacy"),
        ("lock-exit", "legacy"),
        ("lock-enter", "dynamic"),
        ("dispatch", "dynamic"),
        ("lock-exit", "dynamic"),
    ]


def test_busy_dynamic_run_fails_closed_without_legacy_fallback(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # Given
    requested = RunLockOwner(
        pid=os.getpid(),
        mode="dynamic",
        invocation_id="requested",
        acquired_at_utc=datetime.now(UTC),
        repository_root=str(ROOT),
    )
    active = requested.model_copy(
        update={"mode": "legacy", "invocation_id": "active"}
    )
    busy = LocalE2ERunBusyError(
        local_e2e_run_lock_path(ROOT),
        requested,
        active,
    )

    def fail_lock(_root: Path, _mode: str) -> None:
        raise busy

    def fail_legacy(_options: RunnerOptions) -> int:
        raise AssertionError("busy dynamic run must not fall back to legacy")

    def fail_dynamic(
        _options: RunnerOptions,
        _playwright_args: tuple[str, ...],
    ) -> int:
        raise AssertionError("busy dynamic run must not start")

    monkeypatch.setattr(e2e_runner, "acquire_local_e2e_run_lock", fail_lock)
    monkeypatch.setattr(e2e_runner, "_run_legacy", fail_legacy)
    monkeypatch.setattr(dynamic_runner, "run_dynamic", fail_dynamic)
    monkeypatch.setenv("E2E_RUNNER_MODE", RunnerMode.DYNAMIC.value)
    original_parse = e2e_runner.parse_runner_options
    monkeypatch.setattr(
        e2e_runner,
        "parse_runner_options",
        lambda args: original_parse(args, platform_name="nt"),
    )

    # When
    return_code = e2e_runner.main(["--project-matrix"])

    # Then
    assert return_code == 1
    assert "local E2E run already active" in capsys.readouterr().out


def test_invalid_options_fail_before_lock_acquisition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    def fail_lock(_root: Path, _mode: str) -> None:
        raise AssertionError("invalid options must not acquire the run lock")

    monkeypatch.setattr(e2e_runner, "acquire_local_e2e_run_lock", fail_lock)

    # When
    return_code = e2e_runner.main(["--scheduler-workers=3"])

    # Then
    assert return_code == 2
