from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import final

import pytest

from scripts.e2e_scheduler.browser import BrowserServerHandle
from scripts.e2e_scheduler.browser_pool import BrowserServerPool
from scripts.e2e_scheduler.processes import OwnedProcessCleanupError
from scripts.e2e_scheduler.project_profiles import BrowserEngine


@final
class _Handle:
    def __init__(
        self,
        engine: BrowserEngine,
        closed: list[BrowserEngine],
        cleanup_fails: bool = False,
    ) -> None:
        self.ws_endpoint = f"ws://127.0.0.1/{engine}"
        self._engine: BrowserEngine = engine
        self._closed = closed
        self._cleanup_fails = cleanup_fails

    def close(self) -> None:
        self._closed.append(self._engine)
        if self._cleanup_fails:
            raise OwnedProcessCleanupError(9001, (), True)


def test_pool_starts_cross_browser_engines_lazily_and_reuses_them(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    starts: list[tuple[BrowserEngine, Path, Path, Path, Path]] = []
    closed: list[BrowserEngine] = []

    def fake_start(
        *,
        repository_root: Path,
        stdout_path: Path,
        stderr_path: Path,
        endpoint_path: Path,
        temporary_root: Path,
        engine: BrowserEngine = "chromium",
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: object | None = None,
    ) -> _Handle:
        _ = (repository_root, stop_requested, metrics_recorder)
        starts.append((engine, stdout_path, stderr_path, endpoint_path, temporary_root))
        return _Handle(engine, closed)

    monkeypatch.setattr(BrowserServerHandle, "start", fake_start)

    # When
    pool = BrowserServerPool.start(tmp_path, tmp_path / "logs", tmp_path / "browser")
    chromium = pool.endpoint_for("chromium")
    firefox_first = pool.endpoint_for("firefox")
    firefox_second = pool.endpoint_for("firefox")
    webkit = pool.endpoint_for("webkit")
    pool.close()

    # Then
    assert (chromium, firefox_first, firefox_second, webkit) == (
        "ws://127.0.0.1/chromium",
        "ws://127.0.0.1/firefox",
        "ws://127.0.0.1/firefox",
        "ws://127.0.0.1/webkit",
    )
    assert [item[0] for item in starts] == ["chromium", "firefox", "webkit"]
    assert starts[0][1:] == (
        tmp_path / "logs/browser.stdout.log",
        tmp_path / "logs/browser.stderr.log",
        tmp_path / "logs/browser-endpoint.json",
        tmp_path / "browser/chromium",
    )
    assert starts[1][1:] == (
        tmp_path / "logs/browser-firefox.stdout.log",
        tmp_path / "logs/browser-firefox.stderr.log",
        tmp_path / "logs/browser-firefox-endpoint.json",
        tmp_path / "browser/firefox",
    )
    assert starts[2][4] == tmp_path / "browser/webkit"
    assert closed == ["webkit", "firefox", "chromium"]


def test_pool_closes_every_engine_before_reporting_cleanup_failure(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Given
    closed: list[BrowserEngine] = []

    def fake_start(
        *,
        repository_root: Path,
        stdout_path: Path,
        stderr_path: Path,
        endpoint_path: Path,
        temporary_root: Path,
        engine: BrowserEngine = "chromium",
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: object | None = None,
    ) -> _Handle:
        _ = (
            repository_root,
            stdout_path,
            stderr_path,
            endpoint_path,
            temporary_root,
            stop_requested,
            metrics_recorder,
        )
        return _Handle(engine, closed, cleanup_fails=engine == "firefox")

    monkeypatch.setattr(BrowserServerHandle, "start", fake_start)
    pool = BrowserServerPool.start(tmp_path, tmp_path / "logs", tmp_path / "browser")
    _ = pool.endpoint_for("firefox")
    _ = pool.endpoint_for("webkit")

    # When / Then
    with pytest.raises(OwnedProcessCleanupError):
        pool.close()

    assert closed == ["webkit", "firefox", "chromium"]


def test_pool_can_start_with_firefox_without_acquiring_chromium(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    starts: list[BrowserEngine] = []
    closed: list[BrowserEngine] = []

    def fake_start(
        *,
        repository_root: Path,
        stdout_path: Path,
        stderr_path: Path,
        endpoint_path: Path,
        temporary_root: Path,
        engine: BrowserEngine = "chromium",
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: object | None = None,
    ) -> _Handle:
        _ = (
            repository_root,
            stdout_path,
            stderr_path,
            endpoint_path,
            temporary_root,
            stop_requested,
            metrics_recorder,
        )
        starts.append(engine)
        return _Handle(engine, closed)

    monkeypatch.setattr(BrowserServerHandle, "start", fake_start)

    pool = BrowserServerPool.start(
        tmp_path,
        tmp_path / "logs",
        tmp_path / "browser",
        initial_engine="firefox",
    )
    assert pool.endpoint_for("firefox") == "ws://127.0.0.1/firefox"
    assert starts == ["firefox"]

    assert pool.endpoint_for("webkit") == "ws://127.0.0.1/webkit"
    assert starts == ["firefox", "webkit"]
    pool.close()
    assert closed == ["webkit", "firefox"]


def test_pool_retires_cross_browser_engines_before_chromium_tail(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    starts: list[BrowserEngine] = []
    closed: list[BrowserEngine] = []

    def fake_start(
        *,
        repository_root: Path,
        stdout_path: Path,
        stderr_path: Path,
        endpoint_path: Path,
        temporary_root: Path,
        engine: BrowserEngine = "chromium",
        stop_requested: Callable[[], bool] = lambda: False,
        metrics_recorder: object | None = None,
    ) -> _Handle:
        _ = (repository_root, stdout_path, stderr_path, endpoint_path, temporary_root, stop_requested, metrics_recorder)
        starts.append(engine)
        return _Handle(engine, closed)

    monkeypatch.setattr(BrowserServerHandle, "start", fake_start)
    pool = BrowserServerPool.start(
        tmp_path,
        tmp_path / "logs",
        tmp_path / "browser",
        initial_engine="firefox",
    )
    _ = pool.endpoint_for("webkit")

    assert pool.endpoint_for("chromium", retire_others=True) == "ws://127.0.0.1/chromium"
    assert starts == ["firefox", "webkit", "chromium"]
    assert closed == ["webkit", "firefox"]
    pool.close()
    assert closed == ["webkit", "firefox", "chromium"]
