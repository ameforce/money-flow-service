from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class FakeJobPaths:
    json_report: Path
    runtime_profile: Path
    evidence_expectations: Path
    screenshots: Path
    evidence: Path
    uiux_evidence: Path
