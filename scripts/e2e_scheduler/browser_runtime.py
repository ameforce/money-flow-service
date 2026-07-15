"""Typed adapter for the shared browser runtime resolver."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, ClassVar, Literal, override

from pydantic import BaseModel, ConfigDict, Field, RootModel, ValidationError

from scripts.e2e_scheduler.benchmark import BrowserRuntimeIdentity
from scripts.e2e_scheduler.subprocess_visibility import run_hidden


class _RuntimeIdentityBase(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1]
    executable_path: str = Field(min_length=1)
    browser_version: str = Field(min_length=1)


class _SystemChromeInput(_RuntimeIdentityBase):
    decision: Literal["system-chrome"]
    channel: Literal["chrome"]


class _PlaywrightChromiumInput(_RuntimeIdentityBase):
    decision: Literal["playwright-chromium"]
    channel: None


type _RuntimeIdentityInput = Annotated[
    _SystemChromeInput | _PlaywrightChromiumInput,
    Field(discriminator="decision"),
]


class _RuntimeIdentityRoot(RootModel[_RuntimeIdentityInput]):
    pass


@dataclass(frozen=True, slots=True)
class BrowserRuntimeResolutionError(RuntimeError):
    reason: str

    @override
    def __str__(self) -> str:
        return self.reason


def resolve_browser_runtime_identity(
    repository_root: Path,
    environment: Mapping[str, str],
) -> BrowserRuntimeIdentity:
    try:
        completed = run_hidden(
            ["node", "scripts/e2e_scheduler/browser_runtime_identity.mjs"],
            cwd=repository_root,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="strict",
        )
        if completed.returncode != 0:
            raise BrowserRuntimeResolutionError(str(completed.stderr))
        parsed = _RuntimeIdentityRoot.model_validate_json(completed.stdout).root
    except (OSError, UnicodeError) as error:
        raise BrowserRuntimeResolutionError(str(error)) from error
    except ValidationError as error:
        raise BrowserRuntimeResolutionError(
            f"invalid browser runtime identity: {error}"
        ) from error
    return BrowserRuntimeIdentity(
        decision=parsed.decision,
        channel=parsed.channel,
        executable_path=parsed.executable_path,
        browser_version=parsed.browser_version,
    )
