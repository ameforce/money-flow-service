"""Typed Playwright JSON discovery parser."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, override

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from scripts.e2e_scheduler.model import DiscoveredTest, TestId
from scripts.e2e_scheduler.project_profiles import ProjectProfile


@dataclass(slots=True)
class DuplicateDiscoveredTestError(Exception):
    test_id: TestId

    @override
    def __str__(self) -> str:
        return f"duplicate discovered test: {self.test_id}"


@dataclass(slots=True)
class UnknownProjectError(Exception):
    project: str

    @override
    def __str__(self) -> str:
        return f"unknown Playwright project: {self.project}"


@dataclass(slots=True)
class EmptyDiscoveryError(Exception):
    @override
    def __str__(self) -> str:
        return "Playwright discovery returned zero tests"


@dataclass(slots=True)
class SpecPathOutsideRepositoryError(Exception):
    path: Path

    @override
    def __str__(self) -> str:
        return f"discovered spec path is outside the repository: {self.path}"


class _ProjectInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    name: str


class _ConfigInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    root_dir: str = Field(validation_alias=AliasChoices("rootDir", "root_dir"))
    projects: tuple[_ProjectInput, ...]


class _TestInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    project_name: str = Field(
        validation_alias=AliasChoices("projectName", "project_name")
    )


class _SpecInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    title: str
    file: str
    line: int = Field(gt=0)
    tests: tuple[_TestInput, ...]


class _SuiteInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    title: str
    file: str = ""
    line: int = 0
    specs: tuple[_SpecInput, ...] = ()
    suites: tuple[_SuiteInput, ...] = ()


class _DiscoveryInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    config: _ConfigInput
    suites: tuple[_SuiteInput, ...]


def canonical_test_id(
    project: str,
    spec_path: Path,
    line: int,
    title_path: tuple[str, ...],
) -> TestId:
    title = " › ".join(title_path)
    return TestId(f"{project}::{spec_path.as_posix()}:{line}::{title}")


def discover_tests(
    raw_json: str | bytes,
    repository_root: Path,
    projects: tuple[ProjectProfile, ...],
) -> tuple[DiscoveredTest, ...]:
    parsed = _DiscoveryInput.model_validate_json(raw_json)
    profiles = {profile.name: profile for profile in projects}
    for configured in parsed.config.projects:
        if configured.name not in profiles:
            raise UnknownProjectError(project=configured.name)

    root_dir = Path(parsed.config.root_dir)
    if not root_dir.is_absolute():
        root_dir = repository_root / root_dir
    discovered: list[DiscoveredTest] = []
    for suite in parsed.suites:
        _collect_suite_tests(
            suite=suite,
            parent_titles=(),
            include_suite_title=False,
            root_dir=root_dir,
            repository_root=repository_root,
            profiles=profiles,
            discovered=discovered,
        )
    if not discovered:
        raise EmptyDiscoveryError()
    seen: set[TestId] = set()
    for test in discovered:
        if test.test_id in seen:
            raise DuplicateDiscoveredTestError(test_id=test.test_id)
        seen.add(test.test_id)
    return tuple(sorted(discovered, key=_test_sort_key))


def _collect_suite_tests(
    *,
    suite: _SuiteInput,
    parent_titles: tuple[str, ...],
    include_suite_title: bool,
    root_dir: Path,
    repository_root: Path,
    profiles: Mapping[str, ProjectProfile],
    discovered: list[DiscoveredTest],
) -> None:
    titles = parent_titles + ((suite.title,) if include_suite_title else ())
    for spec in suite.specs:
        spec_path = _repository_relative_path(root_dir / spec.file, repository_root)
        title_path = titles + (spec.title,)
        for playwright_test in spec.tests:
            profile = profiles.get(playwright_test.project_name)
            if profile is None:
                raise UnknownProjectError(project=playwright_test.project_name)
            discovered.append(
                DiscoveredTest(
                    test_id=canonical_test_id(
                        profile.name,
                        spec_path,
                        spec.line,
                        title_path,
                    ),
                    project=profile.name,
                    spec_path=spec_path,
                    line=spec.line,
                    title_path=title_path,
                    browser=profile.browser,
                    viewport=profile.viewport,
                    estimated_seconds=30.0,
                )
            )
    for child in suite.suites:
        _collect_suite_tests(
            suite=child,
            parent_titles=titles,
            include_suite_title=True,
            root_dir=root_dir,
            repository_root=repository_root,
            profiles=profiles,
            discovered=discovered,
        )


def _repository_relative_path(path: Path, repository_root: Path) -> Path:
    resolved_root = repository_root.resolve()
    resolved_path = path.resolve()
    try:
        return resolved_path.relative_to(resolved_root)
    except ValueError as error:
        raise SpecPathOutsideRepositoryError(path=resolved_path) from error


def _test_sort_key(test: DiscoveredTest) -> tuple[str, str, int, tuple[str, ...]]:
    return (test.project, test.spec_path.as_posix(), test.line, test.title_path)
