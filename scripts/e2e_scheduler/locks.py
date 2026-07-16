"""Compatibility rules for coordinator-owned shared resource locks."""

from collections.abc import Set


def locks_are_compatible(active: Set[str], requested: Set[str]) -> bool:
    """Return whether a job can acquire all requested resource locks."""
    return active.isdisjoint(requested)
