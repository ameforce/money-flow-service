from __future__ import annotations

from typing import final

from scripts.e2e_scheduler.project_profiles import BrowserEngine


@final
class FakeProcess:
    def __init__(self, *, returncode: int | None = None) -> None:
        self.pid = 7001
        self.returncode = returncode
        self.signals: list[int] = []
        self.wait_calls = 0
        self.stdin = None

    def poll(self) -> int | None:
        return self.returncode

    def send_signal(self, sig: int) -> None:
        self.signals.append(sig)

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        self.wait_calls += 1
        self.returncode = 0
        return 0


@final
class FakeBrowserHandle:
    def __init__(self, engine: BrowserEngine = "chromium") -> None:
        self.ws_endpoint = (
            "ws://127.0.0.1:9222/browser/test"
            if engine == "chromium"
            else f"ws://127.0.0.1:9222/browser/{engine}"
        )
        self.close_calls = 0

    def endpoint_for(
        self,
        engine: BrowserEngine,
        *,
        retire_others: bool = False,
    ) -> str:
        _ = retire_others
        return f"ws://127.0.0.1:9222/browser/{engine}"

    def close(self) -> None:
        self.close_calls += 1
