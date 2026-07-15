"""Semantic evidence collection shared by legacy and dynamic benchmarks."""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path

from scripts.e2e_scheduler.benchmark_collect_models import (
    BenchmarkCollectionError,
    DynamicJob,
)
from scripts.e2e_scheduler.benchmark_report import PlaywrightInventory
from scripts.e2e_scheduler.evidence_expectations import (
    SemanticEvidenceIdentity,
    parse_evidence_expectations,
    parse_semantic_evidence_expectations,
)


def collect_legacy_semantic_evidence(
    journal: Path,
    test_ids: tuple[str, ...],
) -> tuple[SemanticEvidenceIdentity, ...]:
    identities = tuple(sorted(parse_semantic_evidence_expectations(journal)))
    _validate_test_ids(identities, test_ids)
    return identities


def collect_dynamic_semantic_evidence(
    run_root: Path,
    jobs: tuple[DynamicJob, ...],
    reports_by_job: dict[str, PlaywrightInventory],
) -> tuple[SemanticEvidenceIdentity, ...]:
    identities: list[SemanticEvidenceIdentity] = []
    for job in jobs:
        journal = (
            run_root
            / "workers"
            / job.worker_id
            / "jobs"
            / job.job_id
            / "evidence-expectations.jsonl"
        )
        names = parse_evidence_expectations(journal)
        if tuple(sorted(names)) != tuple(sorted(job.expected_evidence_files)):
            raise BenchmarkCollectionError(
                "dynamic job evidence journal differs from publication"
            )
        job_identities = parse_semantic_evidence_expectations(journal)
        report = reports_by_job.get(job.job_id)
        if report is None:
            raise BenchmarkCollectionError(
                f"dynamic job report is missing for {job.job_id}"
            )
        _validate_test_ids(job_identities, report.test_ids)
        identities.extend(job_identities)
    return tuple(sorted(identities))


def semantic_evidence_fingerprint(
    identities: tuple[SemanticEvidenceIdentity, ...],
) -> str:
    payload = "\0".join(
        f"{identity.test_id}\0{identity.capture_label}"
        for identity in sorted(identities)
    )
    return sha256(payload.encode()).hexdigest()


def _validate_test_ids(
    identities: tuple[SemanticEvidenceIdentity, ...],
    test_ids: tuple[str, ...],
) -> None:
    foreign = sorted(
        {identity.test_id for identity in identities}.difference(test_ids)
    )
    if foreign:
        raise BenchmarkCollectionError(
            f"semantic evidence references unknown tests: {foreign}"
        )
