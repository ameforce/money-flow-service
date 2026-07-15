from __future__ import annotations

import os
from pathlib import Path
import signal
import subprocess
from typing import final

import pytest

import scripts.e2e_scheduler.browser as browser_module
import scripts.e2e_scheduler.processes as process_module
from scripts.e2e_scheduler.project_profiles import BrowserEngine


@final
class FakeProcess:
    def __init__(self) -> None:
        self.pid: int = 7101
        self.returncode: int | None = None
        self.signals: list[int] = []
        self.stdin: None = None

    def poll(self) -> int | None:
        return self.returncode

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        self.returncode = 0
        return 0


@pytest.mark.parametrize(
    ("expected_creationflags", "expected_new_session"),
    [
        (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200), False),
        (0, True),
    ],
    ids=("nt", "posix"),
)
@pytest.mark.parametrize("engine", ["chromium", "firefox", "webkit"])
def test_browser_endpoint_publication_is_bounded_on_each_platform(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    expected_creationflags: int,
    expected_new_session: bool,
    engine: BrowserEngine,
) -> None:
    # Given
    process = FakeProcess()
    endpoint_path = tmp_path / "browser-endpoint.json"
    temporary_root = tmp_path / "browser-temp"
    captured: list[process_module.ProcessLaunch] = []

    def fake_spawn(
        _cls: type[process_module.OwnedProcess],
        launch: process_module.ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> process_module.OwnedProcess:
        captured.append(launch)
        assert launch.stdout is not None
        assert launch.stderr is not None
        assert launch.env is not None
        assert launch.env["E2E_BROWSER_ENDPOINT_FILE"] == str(endpoint_path)
        assert launch.env["E2E_BROWSER_ENGINE"] == engine
        assert launch.env["TMP"] == str(temporary_root)
        assert launch.env["TEMP"] == str(temporary_root)
        assert launch.env["TMPDIR"] == str(temporary_root)
        _ = endpoint_path.write_text(
            '{"wsEndpoint":"ws://127.0.0.1:9222/browser/test"}\n',
            encoding="utf-8",
        )
        return process_module.OwnedProcess(process=process, ports=ports)

    monkeypatch.setattr(
        browser_module,
        "_process_group_options",
        lambda: (expected_creationflags, expected_new_session),
    )
    monkeypatch.setattr(
        process_module.OwnedProcess,
        "spawn",
        classmethod(fake_spawn),
    )

    def fake_port_is_open(_port: int) -> bool:
        return False

    monkeypatch.setattr(process_module, "port_is_open", fake_port_is_open)

    # When
    handle = browser_module.BrowserServerHandle.start(
        repository_root=Path.cwd(),
        stdout_path=tmp_path / "browser.stdout.log",
        stderr_path=tmp_path / "browser.stderr.log",
        endpoint_path=endpoint_path,
        temporary_root=temporary_root,
        engine=engine,
    )
    process.returncode = 0
    handle.close()

    # Then
    assert len(captured) == 1
    assert captured[0].creationflags == expected_creationflags
    assert captured[0].start_new_session is expected_new_session
    assert (
        captured[0].windows_spawn_mode
        is process_module.WindowsSpawnMode.DIRECT
    )
    assert handle.ws_endpoint == "ws://127.0.0.1:9222/browser/test"


def test_browser_endpoint_timeout_closes_only_owned_process(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    process = FakeProcess()
    monkeypatch.setattr(os, "name", "nt")

    def fake_spawn(
        _cls: type[process_module.OwnedProcess],
        launch: process_module.ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> process_module.OwnedProcess:
        _ = launch
        return process_module.OwnedProcess(process=process, ports=ports)

    def fake_port_is_open(_port: int) -> bool:
        return False

    monkeypatch.setattr(
        process_module.OwnedProcess,
        "spawn",
        classmethod(fake_spawn),
    )
    monkeypatch.setattr(process_module, "port_is_open", fake_port_is_open)

    # When / Then
    with pytest.raises(browser_module.BrowserServerStartError, match="endpoint"):
        _ = browser_module.BrowserServerHandle.start(
            repository_root=Path.cwd(),
            stdout_path=tmp_path / "browser.stdout.log",
            stderr_path=tmp_path / "browser.stderr.log",
            endpoint_path=tmp_path / "browser-endpoint.json",
            temporary_root=tmp_path / "browser-temp",
            endpoint_timeout_seconds=0,
        )

    assert process.signals == [signal.CTRL_BREAK_EVENT]
    assert process.returncode == 0


def test_browser_endpoint_transient_permission_error_is_retried(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    process = FakeProcess()
    endpoint_path = tmp_path / "browser-endpoint.json"
    original_read_text = Path.read_text
    read_attempts = 0

    def fake_spawn(
        _cls: type[process_module.OwnedProcess],
        launch: process_module.ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> process_module.OwnedProcess:
        _ = launch
        _ = endpoint_path.write_text(
            '{"wsEndpoint":"ws://127.0.0.1:9222/browser/test"}\n',
            encoding="utf-8",
        )
        return process_module.OwnedProcess(process=process, ports=ports)

    def transient_read_text(
        path: Path,
        encoding: str | None = None,
        errors: str | None = None,
    ) -> str:
        nonlocal read_attempts
        if path == endpoint_path:
            read_attempts += 1
            if read_attempts == 1:
                raise PermissionError(13, "transient endpoint sharing violation")
        return original_read_text(path, encoding=encoding, errors=errors)

    def port_closed(_port: int) -> bool:
        return False

    monkeypatch.setattr(
        process_module.OwnedProcess,
        "spawn",
        classmethod(fake_spawn),
    )
    monkeypatch.setattr(Path, "read_text", transient_read_text)
    monkeypatch.setattr(process_module, "port_is_open", port_closed)

    handle = browser_module.BrowserServerHandle.start(
        repository_root=Path.cwd(),
        stdout_path=tmp_path / "browser.stdout.log",
        stderr_path=tmp_path / "browser.stderr.log",
        endpoint_path=endpoint_path,
        temporary_root=tmp_path / "browser-temp",
    )
    process.returncode = 0
    handle.close()

    assert read_attempts == 2
    assert handle.ws_endpoint == "ws://127.0.0.1:9222/browser/test"


def test_browser_endpoint_cancellation_closes_owned_process(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    process = FakeProcess()
    monkeypatch.setattr(os, "name", "nt")

    def fake_spawn(
        _cls: type[process_module.OwnedProcess],
        launch: process_module.ProcessLaunch,
        ports: tuple[int, ...] = (),
    ) -> process_module.OwnedProcess:
        _ = launch
        return process_module.OwnedProcess(process=process, ports=ports)

    def port_closed(_port: int) -> bool:
        return False

    monkeypatch.setattr(
        process_module.OwnedProcess,
        "spawn",
        classmethod(fake_spawn),
    )
    monkeypatch.setattr(process_module, "port_is_open", port_closed)

    with pytest.raises(browser_module.BrowserServerStartError, match="cancelled"):
        _ = browser_module.BrowserServerHandle.start(
            repository_root=Path.cwd(),
            stdout_path=tmp_path / "browser.stdout.log",
            stderr_path=tmp_path / "browser.stderr.log",
            endpoint_path=tmp_path / "browser-endpoint.json",
            temporary_root=tmp_path / "browser-temp",
            stop_requested=lambda: True,
        )

    assert process.signals == [signal.CTRL_BREAK_EVENT]
    assert process.returncode == 0
