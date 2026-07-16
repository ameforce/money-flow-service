from __future__ import annotations

from scripts.e2e_scheduler.benchmark_collect_models import Profile
from scripts.e2e_scheduler.benchmark_profiles import validate_runtime_profiles


def test_legacy_benchmark_accepts_the_six_project_runtime_inventory() -> None:
    # Given
    profiles = (
        Profile(name="desktop-chromium", browser="chromium", viewport=(1280, 720)),
        Profile(name="tablet-chromium", browser="chromium", viewport=(834, 1194)),
        Profile(name="mobile-chromium", browser="chromium", viewport=(393, 727)),
        Profile(name="matrix-chromium", browser="chromium", viewport=(1280, 720)),
        Profile(name="matrix-firefox", browser="firefox", viewport=(1280, 720)),
        Profile(name="matrix-webkit", browser="webkit", viewport=(1280, 720)),
    )

    # When
    validate_runtime_profiles(tuple(profile.name for profile in profiles), profiles)

    # Then
    assert {profile.browser for profile in profiles} == {
        "chromium",
        "firefox",
        "webkit",
    }
