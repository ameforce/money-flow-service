"""Stable discovery facade for parser and job construction contracts."""

from scripts.e2e_scheduler.discovery_parser import (
    DuplicateDiscoveredTestError,
    EmptyDiscoveryError,
    SpecPathOutsideRepositoryError,
    UnknownProjectError,
    canonical_test_id,
    discover_tests,
)
from scripts.e2e_scheduler.project_profiles import ProjectProfile
from scripts.e2e_scheduler.job_builder import (
    DiscoveredTestIdentityError,
    DuplicateTestSelectorError,
    LogicalGroupResolver,
    SpecPathOutsideTestDirectoryError,
    UnassignedLogicalGroupError,
    build_jobs,
    write_test_list,
)

__all__ = (
    "DiscoveredTestIdentityError",
    "DuplicateDiscoveredTestError",
    "DuplicateTestSelectorError",
    "EmptyDiscoveryError",
    "LogicalGroupResolver",
    "ProjectProfile",
    "SpecPathOutsideTestDirectoryError",
    "SpecPathOutsideRepositoryError",
    "UnassignedLogicalGroupError",
    "UnknownProjectError",
    "build_jobs",
    "canonical_test_id",
    "discover_tests",
    "write_test_list",
)
