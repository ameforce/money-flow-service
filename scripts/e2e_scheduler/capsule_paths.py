"""Filesystem namespaces for one isolated scheduler job."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from scripts.e2e_scheduler.model import JobId


@dataclass(frozen=True, slots=True)
class JobPaths:
    root: Path
    test_list: Path
    output: Path
    json_report: Path
    runtime_profile: Path
    evidence_expectations: Path
    screenshots: Path
    evidence: Path
    uiux_evidence: Path
    temporary: Path
    uploads: Path
    stdout: Path
    stderr: Path


def build_job_paths(worker_root: Path, job_id: JobId) -> JobPaths:
    job_root = worker_root / "jobs" / str(job_id)
    return JobPaths(
        job_root,
        job_root / "test-list.txt",
        job_root / "playwright-output",
        job_root / "result.json",
        job_root / "runtime-profile.json",
        job_root / "evidence-expectations.jsonl",
        job_root / "screenshots",
        job_root / "evidence",
        job_root / "uiux-evidence",
        temporary=worker_root / "temporary" / str(job_id),
        uploads=worker_root / "uploads" / str(job_id),
        stdout=job_root / "stdout.log",
        stderr=job_root / "stderr.log",
    )
