"""Canonical Playwright project-to-browser runtime profiles."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, override

type BrowserEngine = Literal["chromium", "firefox", "webkit"]


@dataclass(frozen=True, slots=True)
class ProjectProfile:
    name: str
    browser: BrowserEngine
    viewport: tuple[int, int] | None


@dataclass(frozen=True, slots=True)
class UnknownProjectProfileError(ValueError):
    project: str

    @override
    def __str__(self) -> str:
        return f"unknown scheduler project profile: {self.project}"


PROJECT_PROFILES: Final = (
    ProjectProfile("desktop-chromium", "chromium", (1280, 720)),
    ProjectProfile("tablet-chromium", "chromium", (834, 1194)),
    ProjectProfile("mobile-chromium", "chromium", (393, 727)),
    ProjectProfile("matrix-chromium", "chromium", (1280, 720)),
    ProjectProfile("matrix-firefox", "firefox", (1280, 720)),
    ProjectProfile("matrix-webkit", "webkit", (1280, 720)),
)


def project_profile(project: str) -> ProjectProfile:
    for profile in PROJECT_PROFILES:
        if profile.name == project:
            return profile
    raise UnknownProjectProfileError(project)
