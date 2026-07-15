from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
import subprocess
from typing import final

import pytest

import scripts.e2e_scheduler.benchmark_harness as benchmark_harness
from scripts.e2e_scheduler.benchmark import BenchmarkRun, BrowserRuntimeIdentity
from scripts.e2e_scheduler.benchmark_cli import BenchmarkOptions
from scripts.e2e_scheduler.benchmark_harness import execute_one
from scripts.e2e_scheduler.benchmark_process import INTERRUPT_GRACE_SECONDS
from scripts.e2e_scheduler.processes import (
    OwnedProcess,
    ProcessLaunch,
    ProcessOwnership,
)


@final
class _LiveProcess:
    pid: int = 5678
    stdin: None = None

    def __init__(self) -> None:
        self.running = True
        self.returncode: int | None = None

    def poll(self) -> int | None:
        return None if self.running else self.returncode

    def send_signal(self, sig: int) -> None:
        _ = sig

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        if self.running:
            raise subprocess.TimeoutExpired("benchmark-child", 1)
        return int(self.returncode or 0)


@final
class _FailingSampler:
    def sample(self) -> None:
        raise OSError("system counter failed")


@final
class _InterruptingSampler:
    def sample(self) -> None:
        raise KeyboardInterrupt


@final
class _GracefulInterruptProcess:
    pid: int = 5678
    stdin: None = None

    def __init__(self) -> None:
        self.running = True
        self.returncode: int | None = None
        self.waits: list[float | None] = []

    def poll(self) -> int | None:
        return None if self.running else self.returncode

    def send_signal(self, sig: int) -> None:
        _ = sig

    def wait(self, timeout: float | None = None) -> int:
        self.waits.append(timeout)
        self.running = False
        self.returncode = 130
        return 130


@final
class _GracefulOwnership:
    def __init__(self, process: _GracefulInterruptProcess) -> None:
        self.process = process
        self.waits: list[float] = []

    def active_processes(self) -> int:
        return int(self.process.running)

    def terminate(self) -> None:
        self.process.running = False
        self.process.returncode = 130

    def wait_until_empty(self, timeout_seconds: float) -> int:
        self.waits.append(timeout_seconds)
        self.process.running = False
        self.process.returncode = 130
        return 0

    def close(self) -> None:
        pass


@final
class _SecondInterruptOwnership:
    def active_processes(self) -> int:
        return 1

    def terminate(self) -> None:
        pass

    def wait_until_empty(self, timeout_seconds: float) -> int:
        _ = timeout_seconds
        raise KeyboardInterrupt

    def close(self) -> None:
        pass


def _browser_runtime(
    _root: Path,
    _env: Mapping[str, str],
) -> BrowserRuntimeIdentity:
    return BrowserRuntimeIdentity(
        "playwright-chromium",
        None,
        "C:/chromium.exe",
        "Chromium 140",
    )


def _run_interrupted(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    process: _LiveProcess | _GracefulInterruptProcess,
    ownership: ProcessOwnership | None,
    label: str,
) -> tuple[BenchmarkRun, list[tuple[int, bool]]]:
    stopped: list[tuple[int, bool]] = []

    def fake_spawn(
        _cls: type[OwnedProcess],
        launch: ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> OwnedProcess:
        _ = launch
        return OwnedProcess(process, ports, ownership)

    def stop_owned(child: OwnedProcess) -> bool:
        stopped.append((child.pid, process.running))
        process.running = False
        process.returncode = 130
        return True

    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(fake_spawn))
    monkeypatch.setattr(
        benchmark_harness,
        "WindowsSystemSampler",
        _InterruptingSampler,
    )
    monkeypatch.setattr(benchmark_harness, "_stop_owned", stop_owned)
    monkeypatch.setattr(
        benchmark_harness,
        "resolve_browser_runtime_identity",
        _browser_runtime,
    )
    options = BenchmarkOptions(
        mode="dynamic",
        runs=1,
        label=label,
        output=tmp_path / "benchmark.json",
        command=("child",),
        timeout_seconds=5,
    )
    run = execute_one(options, tmp_path, "a" * 40, label)
    return run, stopped


def test_sampler_error_stops_live_owned_child_and_records_original_error(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    process = _LiveProcess()
    stopped: list[int] = []

    def fake_spawn(
        _cls: type[OwnedProcess],
        launch: ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> OwnedProcess:
        _ = launch
        return OwnedProcess(process, ports)

    def stop_owned(child: OwnedProcess) -> bool:
        stopped.append(child.pid)
        process.running = False
        process.returncode = 125
        return True

    monkeypatch.setattr(OwnedProcess, "spawn", classmethod(fake_spawn))
    monkeypatch.setattr(benchmark_harness, "WindowsSystemSampler", _FailingSampler)
    monkeypatch.setattr(benchmark_harness, "_stop_owned", stop_owned)
    monkeypatch.setattr(
        benchmark_harness,
        "resolve_browser_runtime_identity",
        _browser_runtime,
    )
    options = BenchmarkOptions(
        mode="dynamic",
        runs=1,
        label="sampler-failure",
        output=tmp_path / "benchmark.json",
        command=("child",),
        timeout_seconds=5,
    )

    run = execute_one(options, tmp_path, "a" * 40, "sampler-failure")

    assert stopped == [5678]
    assert run.exit_code == 125
    assert run.execution_error == "OSError: system counter failed"
    assert not run.cleanup_ok


def test_keyboard_interrupt_gives_child_bounded_grace_before_job_cleanup(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    process = _GracefulInterruptProcess()
    ownership = _GracefulOwnership(process)
    run, stopped = _run_interrupted(
        monkeypatch,
        tmp_path,
        process,
        ownership,
        "interrupt-cleanup",
    )

    assert process.waits == []
    assert ownership.waits == [INTERRUPT_GRACE_SECONDS]
    assert stopped == [(5678, False)]
    assert run.exit_code == 130
    assert run.execution_error == "KeyboardInterrupt: "
    assert not run.cleanup_ok


def test_keyboard_interrupt_uses_popen_fallback_without_job_ownership(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    process = _GracefulInterruptProcess()

    run, stopped = _run_interrupted(
        monkeypatch,
        tmp_path,
        process,
        None,
        "interrupt-popen-fallback",
    )

    assert process.waits == [INTERRUPT_GRACE_SECONDS]
    assert stopped == [(5678, False)]
    assert run.exit_code == 130
    assert not run.cleanup_ok


def test_second_keyboard_interrupt_cannot_skip_job_cleanup(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    process = _LiveProcess()
    run, stopped = _run_interrupted(
        monkeypatch,
        tmp_path,
        process,
        _SecondInterruptOwnership(),
        "second-interrupt-cleanup",
    )

    assert stopped == [(5678, True)]
    assert run.exit_code == 130
    assert run.execution_error == (
        "KeyboardInterrupt: ; interrupt grace KeyboardInterrupt: "
    )
    assert not run.cleanup_ok
