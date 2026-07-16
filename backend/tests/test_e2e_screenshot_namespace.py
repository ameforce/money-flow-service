from __future__ import annotations

from pathlib import Path
import subprocess
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, TypeAdapter


ROOT = Path(__file__).resolve().parents[2]
PATH_PAIR = TypeAdapter(tuple[str, str])


class _JournalRecord(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1]
    kind: Literal["screenshot"]
    filename: str


class _SemanticJournalRecord(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid", frozen=True)

    version: Literal[2]
    kind: Literal["screenshot"]
    filename: str
    test_id: str
    capture_label: str


def test_screenshot_helper_keeps_two_worker_namespaces_disjoint(
    tmp_path: Path,
) -> None:
    # Given
    first = tmp_path / "worker-1" / "screenshots"
    second = tmp_path / "worker-2" / "screenshots"
    script = """
import { ensureScreenshotDir } from './e2e/support/helpers.js';
process.env.E2E_SCREENSHOT_DIR = process.argv[1];
const first = ensureScreenshotDir();
process.env.E2E_SCREENSHOT_DIR = process.argv[2];
const second = ensureScreenshotDir();
console.log(JSON.stringify([first, second]));
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
    assert resolved == (str(first.resolve()), str(second.resolve()))
    assert first.is_dir()
    assert second.is_dir()
    assert first != second


def test_capture_names_screenshot_with_run_worker_and_job_ids(tmp_path: Path) -> None:
    script = """
import { capture } from './e2e/support/helpers.js';
process.env.E2E_SCREENSHOT_DIR = process.argv[1];
process.env.E2E_RUN_ID = 'run-a';
process.env.E2E_WORKER_ID = 'worker-1';
process.env.E2E_JOB_ID = 'job-2';
const page = { screenshot: async ({ path }) => console.log(path) };
await capture(page, 'dashboard-ready');
"""

    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(tmp_path)],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    screenshot_name = Path(completed.stdout.strip()).name
    assert screenshot_name.endswith("-run-a-worker-1-job-2-dashboard-ready.png")


def test_capture_journals_expected_name_before_screenshot_attempt(tmp_path: Path) -> None:
    screenshot_dir = tmp_path / "screenshots"
    expectations = tmp_path / "evidence-expectations.jsonl"
    script = """
import fs from 'node:fs';
import { capture } from './e2e/support/helpers.js';
process.env.E2E_SCREENSHOT_DIR = process.argv[1];
process.env.E2E_EVIDENCE_EXPECTATIONS_FILE = process.argv[2];
const page = { screenshot: async () => { throw new Error('capture failed'); } };
try { await capture(page, 'failure-proof'); } catch {}
process.stdout.write(fs.readFileSync(process.argv[2], 'utf8'));
"""

    completed = subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            script,
            str(screenshot_dir),
            str(expectations),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )

    journal = _JournalRecord.model_validate_json(completed.stdout)
    assert journal.version == 1
    assert journal.kind == "screenshot"
    assert journal.filename.endswith("-failure-proof.png")
    assert not (screenshot_dir / journal.filename).exists()


def test_semantic_capture_identity_uses_active_test_and_capture_label() -> None:
    script = """
import { semanticCaptureIdentity } from './e2e/support/helpers.js';
const identity = semanticCaptureIdentity({
  project: { name: 'desktop-chromium' },
  file: `${process.cwd()}/e2e/specs/auth.spec.js`,
  line: 42,
  titlePath: ['auth.spec.js', 'authentication', 'logs in'],
}, 'login-ready');
process.stdout.write(JSON.stringify({
  version: 2,
  kind: 'screenshot',
  filename: 'unique.png',
  ...identity,
}));
"""

    completed = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
    )

    journal = _SemanticJournalRecord.model_validate_json(completed.stdout)
    assert journal.test_id == (
        "desktop-chromium::e2e/specs/auth.spec.js:42::authentication › logs in"
    )
    assert journal.capture_label == "login-ready"
