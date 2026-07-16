"""Benchmark runtime-profile validation against scheduler projects."""

from __future__ import annotations

from scripts.e2e_scheduler.benchmark_collect_models import (
    BenchmarkCollectionError,
    Profile,
)
from scripts.e2e_scheduler.project_profiles import (
    UnknownProjectProfileError,
    project_profile,
)


def validate_runtime_profiles(
    projects: tuple[str, ...],
    profiles: tuple[Profile, ...],
) -> None:
    expected: dict[str, tuple[str, str]] = {}
    try:
        for project in projects:
            profile = project_profile(project)
            expected[project] = (
                profile.browser,
                viewport_label(profile.viewport),
            )
    except UnknownProjectProfileError as error:
        raise BenchmarkCollectionError(
            f"unknown benchmark project: {error.project}"
        ) from error
    actual = {
        profile.name: (profile.browser, viewport_label(profile.viewport))
        for profile in profiles
    }
    if actual != expected:
        raise BenchmarkCollectionError(
            f"legacy runtime profile mismatch: expected={expected}, actual={actual}"
        )


def viewport_label(viewport: tuple[int, int] | None) -> str:
    return "native" if viewport is None else f"{viewport[0]}x{viewport[1]}"
