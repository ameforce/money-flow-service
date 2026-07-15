from __future__ import annotations

import os
from pathlib import Path
import subprocess

import pytest
from pydantic import TypeAdapter


ROOT = Path(__file__).resolve().parents[2]
PATH_PAIR = TypeAdapter(tuple[str, str])


def test_mobile_evidence_uses_distinct_scheduler_job_owned_roots(
    tmp_path: Path,
) -> None:
    # Given
    first = tmp_path / "run-a" / "worker-1" / "jobs" / "job-1" / "uiux-evidence"
    second = tmp_path / "run-a" / "worker-2" / "jobs" / "job-2" / "uiux-evidence"
    script = """
import { ensureMobileEvidenceDir } from './e2e/support/helpers.js';
process.env.E2E_UIUX_EVIDENCE_ROOT = process.argv[1];
const first = ensureMobileEvidenceDir('MUI-004');
process.env.E2E_UIUX_EVIDENCE_ROOT = process.argv[2];
const second = ensureMobileEvidenceDir('MUI-004');
process.stdout.write(JSON.stringify([first, second]));
"""

    # When
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(first), str(second)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
    )
    resolved = PATH_PAIR.validate_json(completed.stdout)

    # Then
    assert resolved == (
        str(first / "mobile-uiux-v0.1.49" / "MUI-004"),
        str(second / "mobile-uiux-v0.1.49" / "MUI-004"),
    )
    assert Path(resolved[0]).is_dir()
    assert Path(resolved[1]).is_dir()
    assert Path(resolved[0]) != Path(resolved[1])


def test_mobile_evidence_keeps_legacy_root_without_scheduler_namespace(
    tmp_path: Path,
) -> None:
    # Given
    helper_url = (ROOT / "e2e" / "support" / "helpers.js").as_uri()
    script = """
const { ensureMobileEvidenceDir } = await import(process.argv[1]);
delete process.env.E2E_UIUX_EVIDENCE_ROOT;
process.stdout.write(ensureMobileEvidenceDir('MUI-006'));
    """
    env = os.environ.copy()
    _ = env.pop("E2E_UIUX_EVIDENCE_ROOT", None)

    # When
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script, helper_url],
        cwd=tmp_path,
        env=env,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
    )

    # Then
    expected = tmp_path / ".omo" / "evidence" / "mobile-uiux-v0.1.49" / "MUI-006"
    assert Path(completed.stdout) == expected
    assert expected.is_dir()


@pytest.mark.parametrize(
    "finding_id",
    ("../escaped", "nested/finding", "C:\\escaped", "", ".hidden"),
)
def test_mobile_evidence_rejects_finding_id_path_escape(
    tmp_path: Path,
    finding_id: str,
) -> None:
    # Given
    evidence_root = tmp_path / "job" / "uiux-evidence"
    helper_url = (ROOT / "e2e" / "support" / "helpers.js").as_uri()
    script = """
const { ensureMobileEvidenceDir } = await import(process.argv[1]);
process.env.E2E_UIUX_EVIDENCE_ROOT = process.argv[2];
ensureMobileEvidenceDir(process.argv[3]);
    """

    # When
    completed = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            helper_url,
            str(evidence_root),
            finding_id,
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
    )

    # Then
    assert completed.returncode != 0
    assert "invalid mobile evidence finding ID" in completed.stderr
    assert not evidence_root.exists()
