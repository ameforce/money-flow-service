from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
from typing import final

import pytest

import scripts.e2e_scheduler.processes as process_module
from scripts.e2e_scheduler.owned_command import run_owned_command
from scripts.e2e_scheduler.process_metrics import (
    ProcessMetricsRecorder,
    ProcessResourceUsage,
    ProcessRoleCount,
)
from scripts.e2e_scheduler.runner_process_telemetry import snapshot_run_telemetry
type JobQueryResult = dict[str, int] | dict[str, dict[str, int]] | tuple[int, ...]


def test_run_telemetry_counts_actual_frontend_build_spawns() -> None:
    recorder = ProcessMetricsRecorder()
    frontend_build = recorder.record_spawn("frontend-build")
    discovery = recorder.record_spawn("discovery")
    recorder.record_close(frontend_build, None)
    recorder.record_close(discovery, None)

    telemetry = snapshot_run_telemetry(recorder)

    assert telemetry.frontend_build_count == 1
    assert telemetry.resources.active_process_count == 0


def test_run_telemetry_does_not_assume_frontend_build() -> None:
    telemetry = snapshot_run_telemetry(ProcessMetricsRecorder())

    assert telemetry.frontend_build_count == 0


def test_owned_command_captures_output_and_process_accounting() -> None:
    recorder = ProcessMetricsRecorder()
    result = run_owned_command(
        process_module.ProcessLaunch(
            (sys.executable, "-c", "import sys;print('ok');print('note',file=sys.stderr)"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            role="command-probe",
            metrics_recorder=recorder,
            windows_spawn_mode=(
                process_module.WindowsSpawnMode.DIRECT
                if os.name == "nt"
                else process_module.WindowsSpawnMode.BOOTSTRAP
            ),
        )
    )

    snapshot = recorder.snapshot()
    assert result.returncode == 0
    assert result.stdout.strip() == b"ok"
    assert result.stderr.strip() == b"note"
    assert snapshot.spawn_counts == (ProcessRoleCount("command-probe", 1),)
    assert snapshot.active_launch_count == 0
    if os.name == "nt":
        assert snapshot.total_process_count >= 1


@final
class FakeProcess:
    pid = 7101
    stdin = None

    def poll(self) -> int:
        return 0

    def send_signal(self, _sig: int) -> None:
        return None

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        return 0


@final
class FakeMeasuredOwnership:
    __slots__ = ("close_calls", "usage")

    def __init__(self, usage: ProcessResourceUsage) -> None:
        self.usage = usage
        self.close_calls = 0

    def active_processes(self) -> int:
        return 0

    def terminate(self) -> None:
        return None

    def wait_until_empty(self, timeout_seconds: float) -> int:
        _ = timeout_seconds
        return 0

    def resource_usage(self) -> ProcessResourceUsage:
        return self.usage

    def close(self) -> None:
        self.close_calls += 1


def test_process_metrics_recorder_aggregates_roles_and_usage_once() -> None:
    # Given
    recorder = ProcessMetricsRecorder()
    backend_id = recorder.record_spawn("backend")
    browser_id = recorder.record_spawn("browser")
    backend_usage = ProcessResourceUsage(
        cpu_seconds=1.25,
        read_bytes=100,
        write_bytes=200,
        peak_working_set_bytes=300,
        active_process_count=2,
        peak_process_count=3,
        total_process_count=4,
    )
    browser_usage = ProcessResourceUsage(
        cpu_seconds=0.75,
        read_bytes=10,
        write_bytes=20,
        peak_working_set_bytes=500,
        active_process_count=1,
        peak_process_count=2,
        total_process_count=2,
    )

    # When
    recorder.record_close(backend_id, backend_usage)
    recorder.record_close(browser_id, browser_usage)
    recorder.record_close(browser_id, browser_usage)
    snapshot = recorder.snapshot()

    # Then
    assert snapshot.spawn_counts == (
        ProcessRoleCount("backend", 1),
        ProcessRoleCount("browser", 1),
    )
    assert snapshot.cpu_seconds == 2.0
    assert snapshot.read_bytes == 110
    assert snapshot.write_bytes == 220
    assert snapshot.peak_working_set_bytes == 500
    assert snapshot.peak_process_count == 3
    assert snapshot.total_process_count == 6
    assert snapshot.active_launch_count == 0
    assert snapshot.peak_launch_count == 2


def test_process_metrics_recorder_samples_concurrent_children_and_parent_peak() -> None:
    parent = ProcessResourceUsage(
        cpu_seconds=1.0,
        read_bytes=10,
        write_bytes=20,
        current_working_set_bytes=100,
        active_process_count=1,
    )
    backend = ProcessResourceUsage(
        current_working_set_bytes=300,
        active_process_count=2,
    )
    browser = ProcessResourceUsage(
        current_working_set_bytes=500,
        active_process_count=1,
    )
    recorder = ProcessMetricsRecorder(lambda: parent)
    backend_id = recorder.record_spawn("backend", lambda: backend)
    browser_id = recorder.record_spawn("browser", lambda: browser)

    recorder.sample_active_resources()
    recorder.record_close(backend_id, ProcessResourceUsage())
    recorder.record_close(browser_id, ProcessResourceUsage())
    snapshot = recorder.snapshot()

    assert snapshot.peak_working_set_bytes == 900
    assert snapshot.peak_process_count == 4
    assert snapshot.total_process_count == 1


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object accounting")
def test_owned_process_records_windows_job_usage_before_close_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    usage = ProcessResourceUsage(
        cpu_seconds=2.5,
        read_bytes=1000,
        write_bytes=2000,
        peak_working_set_bytes=4096,
        active_process_count=0,
        peak_process_count=4,
        total_process_count=5,
    )
    process = FakeProcess()
    ownership = FakeMeasuredOwnership(usage)
    recorder = ProcessMetricsRecorder()

    def spawn_in_job(
        _launch: process_module.ProcessLaunch,
    ) -> tuple[FakeProcess, FakeMeasuredOwnership]:
        return process, ownership

    monkeypatch.setattr(
        "scripts.e2e_scheduler.windows_process_spawn.spawn_in_job",
        spawn_in_job,
    )
    owned = process_module.OwnedProcess.spawn(
        process_module.ProcessLaunch(
            ("python", "worker.py"),
            role="playwright",
            metrics_recorder=recorder,
        )
    )

    # When
    owned.close()
    owned.close()
    snapshot = recorder.snapshot()

    # Then
    assert ownership.close_calls == 2
    assert snapshot.spawn_counts == (
        ProcessRoleCount("playwright", 1),
    )
    assert snapshot.cpu_seconds == 2.5
    assert snapshot.total_process_count == 5
    assert snapshot.active_launch_count == 0


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object accounting")
def test_windows_job_converts_accounting_units_and_retains_observed_peak(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    import win32job

    from scripts.e2e_scheduler.windows_job import (
        JOB_OBJECT_BASIC_AND_IO_ACCOUNTING_INFORMATION,
        JOB_OBJECT_BASIC_PROCESS_ID_LIST,
        WindowsJob,
    )

    basic_queries = iter(
        (
            {
                "TotalUserTime": 0,
                "TotalKernelTime": 0,
                "TotalProcesses": 3,
                "ActiveProcesses": 3,
                "TotalTerminatedProcesses": 0,
            },
            {
                "TotalUserTime": 12_500_000,
                "TotalKernelTime": 7_500_000,
                "TotalProcesses": 5,
                "ActiveProcesses": 1,
                "TotalTerminatedProcesses": 4,
            },
        )
    )

    def query_information(
        _handle: int,
        info_class: int,
    ) -> JobQueryResult:
        if info_class == win32job.JobObjectBasicAccountingInformation:
            return next(basic_queries)
        if info_class == JOB_OBJECT_BASIC_AND_IO_ACCOUNTING_INFORMATION:
            return {
                "BasicInfo": next(basic_queries),
                "IoInfo": {
                    "ReadTransferCount": 8192,
                    "WriteTransferCount": 4096,
                },
            }
        if info_class == JOB_OBJECT_BASIC_PROCESS_ID_LIST:
            return ()
        assert info_class == win32job.JobObjectExtendedLimitInformation
        return {"PeakJobMemoryUsed": 65_536, "PeakProcessMemoryUsed": 32_768}

    monkeypatch.setattr(
        "scripts.e2e_scheduler.windows_job.win32job.QueryInformationJobObject",
        query_information,
    )
    job = WindowsJob(101)
    assert job.active_processes() == 3

    # When
    usage = job.resource_usage()

    # Then
    assert usage.cpu_seconds == 2.0
    assert usage.read_bytes == 8192
    assert usage.write_bytes == 4096
    assert usage.peak_working_set_bytes == 65_536
    assert usage.active_process_count == 1
    assert usage.peak_process_count == 3
    assert usage.total_process_count == 5


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object accounting")
def test_windows_job_reports_invalid_accounting_as_cleanup_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given
    from scripts.e2e_scheduler.windows_job import (
        JOB_OBJECT_BASIC_AND_IO_ACCOUNTING_INFORMATION,
        JOB_OBJECT_BASIC_PROCESS_ID_LIST,
        WindowsJob,
    )

    def query_information(_handle: int, info_class: int) -> JobQueryResult:
        if info_class == JOB_OBJECT_BASIC_AND_IO_ACCOUNTING_INFORMATION:
            return {"BasicInfo": {}, "IoInfo": {}}
        if info_class == JOB_OBJECT_BASIC_PROCESS_ID_LIST:
            return ()
        return {"PeakJobMemoryUsed": 0}

    monkeypatch.setattr(
        "scripts.e2e_scheduler.windows_job.win32job.QueryInformationJobObject",
        query_information,
    )
    job = WindowsJob(101)

    # When / Then
    with pytest.raises(OSError, match="accounting payload"):
        _ = job.resource_usage()


def test_process_launch_metrics_fields_are_backward_compatible() -> None:
    # Given / When
    launch = process_module.ProcessLaunch(("python", "worker.py"))

    # Then
    assert launch.role == "process"
    assert launch.metrics_recorder is None
    assert launch.creationflags == 0
    assert launch.start_new_session is False


@pytest.mark.skipif(os.name != "nt", reason="Windows Job Object accounting")
def test_windows_owned_process_reports_real_job_accounting(tmp_path: Path) -> None:
    # Given
    output_path = tmp_path / "job-io.bin"
    worker = (
        "import pathlib,sys;"
        "pathlib.Path(sys.argv[1]).write_bytes(b'x'*65536);"
        "print(sum(index*index for index in range(1000000)))"
    )
    recorder = ProcessMetricsRecorder()
    owned = process_module.OwnedProcess.spawn(
        process_module.ProcessLaunch(
            (sys.executable, "-c", worker, str(output_path)),
            role="accounting-probe",
            metrics_recorder=recorder,
        )
    )

    try:
        # When
        assert owned.process.wait(timeout=15.0) == 0
        owned.close()
        snapshot = recorder.snapshot()

        # Then
        assert snapshot.cpu_seconds > 0.0
        assert snapshot.write_bytes >= output_path.stat().st_size
        assert snapshot.peak_working_set_bytes > 0
        assert snapshot.peak_process_count >= 1
        assert snapshot.total_process_count >= 1
        assert snapshot.active_launch_count == 0
    finally:
        if owned.process.poll() is None:
            owned.close()
