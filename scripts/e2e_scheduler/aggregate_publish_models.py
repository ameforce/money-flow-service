"""Typed publication records shared by aggregation and legacy output."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

from scripts.e2e_scheduler.model import TestId


@dataclass(frozen=True, slots=True)
class PublicationJob:
    job_id: str
    worker_id: str
    project: str
    expected_browser: str
    actual_browser: str
    expected_viewport: tuple[int, int] | None
    actual_viewport: tuple[int, int] | None
    expected_tests: int
    expected_scenario_ids: tuple[TestId, ...]
    actual_test_ids: tuple[TestId, ...]
    skipped_test_ids: tuple[TestId, ...]
    expected_evidence_names: tuple[str, ...]
    actual_evidence_names: tuple[str, ...]
    actual_evidence_count: int
    return_code: int
    cleanup_succeeded: bool
    screenshots: tuple[Path, ...]


class ProjectSummary(TypedDict):
    name: str
    browser: str
    viewport: list[int] | None
    expected_browser: str
    actual_browser: str
    expected_viewport: list[int] | None
    actual_viewport: list[int] | None
    expected_tests: int
    actual_tests: int
    passed: int
    skipped: int
    expected_scenarios: int
    actual_scenarios: int
    expected_evidence_count: int
    actual_evidence_count: int


class JobSummary(TypedDict):
    job_id: str
    worker_id: str
    project: str
    expected_browser: str
    actual_browser: str
    expected_viewport: list[int] | None
    actual_viewport: list[int] | None
    expected_tests: int
    actual_tests: int
    expected_scenarios: int
    actual_scenarios: int
    expected_scenario_ids: list[str]
    actual_scenario_ids: list[str]
    skipped_scenario_ids: list[str]
    expected_evidence_count: int
    actual_evidence_count: int
    expected_evidence_files: list[str]
    actual_evidence_files: list[str]
    return_code: int
    cleanup_succeeded: bool
