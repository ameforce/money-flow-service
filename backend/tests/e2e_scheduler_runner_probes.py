from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import os
from pathlib import Path
import subprocess
from types import TracebackType
from typing import ClassVar, final

from pydantic import BaseModel, ConfigDict, Field, JsonValue


@dataclass(frozen=True, slots=True)
class CapturedCall:
    cmd: list[str]
    env: dict[str, str]


@final
class DummyProcess:
    def __init__(self, pid: int) -> None:
        self.pid = pid
        self.stdin = None

    def poll(self) -> int:
        return 0

    def send_signal(self, sig: int) -> None:
        _ = sig

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        return 0


@dataclass(frozen=True, slots=True)
class DummyResult:
    returncode: int = 0


@final
class DummyHealthResponse:
    def __init__(self, status: int) -> None:
        self.status: int = int(status)

    def __enter__(self) -> DummyHealthResponse:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool:
        _ = (exc_type, exc, tb)
        return False


class ScreenshotManifest(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    count: int
    files: list[str]
    playwright_args: list[str]


def not_found_response(_url: str, *, timeout: float) -> DummyHealthResponse:
    _ = timeout
    return DummyHealthResponse(404)


def ok_response(_url: str, *, timeout: float) -> DummyHealthResponse:
    _ = timeout
    return DummyHealthResponse(200)


def expected_playwright_command(
    playwright_args: list[str],
) -> tuple[list[str], list[str]]:
    command = ["npx", "playwright", "test", *playwright_args]
    manifest_args = list(playwright_args)
    if os.name == "nt":
        command.append("--workers=3")
        manifest_args.append("--workers=3")
        command = ["cmd", "/c", *command]
    return command, manifest_args


def expected_frontend_build_command() -> list[str]:
    command = ["npm", "run", "frontend:build"]
    return ["cmd", "/c", *command] if os.name == "nt" else command


class _DiscoveryModel(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="allow")


class DiscoveryTestInput(_DiscoveryModel):
    project_name: str = Field(alias="projectName")


class DiscoveryProjectInput(_DiscoveryModel):
    name: str


class DiscoveryConfigInput(_DiscoveryModel):
    root_dir: str = Field(alias="rootDir")
    projects: list[DiscoveryProjectInput]


class DiscoverySpecInput(_DiscoveryModel):
    title: str
    file: str
    line: int
    tests: list[DiscoveryTestInput]


class DiscoverySuiteInput(_DiscoveryModel):
    title: str
    file: str = ""
    line: int = 0
    specs: list[DiscoverySpecInput] = Field(default_factory=list)
    suites: list[DiscoverySuiteInput] = Field(default_factory=list)


class DiscoveryInput(_DiscoveryModel):
    config: DiscoveryConfigInput
    suites: list[DiscoverySuiteInput]


class PersistedManifestInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    run_id: str
    tests: list[JsonValue]
    jobs: list[JsonValue]


class DurationHistoryInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    version: int


class _PlaywrightConfigProbe(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    connect: str | None
    projects: str


class _PackageInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    scripts: dict[str, str]


def load_playwright_config(root: Path, endpoint: str | None) -> _PlaywrightConfigProbe:
    env = os.environ.copy()
    if endpoint is None:
        _ = env.pop("PW_TEST_CONNECT_WS_ENDPOINT", None)
    else:
        env["PW_TEST_CONNECT_WS_ENDPOINT"] = endpoint
    script = (
        "import config from './playwright.config.js';"
        "process.stdout.write(JSON.stringify({"
        "connect: config.use.connectOptions?.wsEndpoint ?? null,"
        "projects: JSON.stringify(config.projects)"
        "}));"
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        cwd=root,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return _PlaywrightConfigProbe.model_validate_json(completed.stdout)


def load_package_scripts(root: Path) -> Mapping[str, str]:
    package = _PackageInput.model_validate_json(
        (root / "package.json").read_text(encoding="utf-8")
    )
    return package.scripts
