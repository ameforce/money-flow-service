from __future__ import annotations

import json
from pathlib import Path

from scripts import verify_issue_checkpoints as verifier


def _write_report(path: Path, checkpoints: list[dict[str, str]]) -> None:
    path.write_text(
        json.dumps(
            {
                "minimumRequired": len(checkpoints),
                "totalCheckpoints": len(checkpoints),
                "checkpoints": checkpoints,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _checkpoint(issue: str, project: str, environment: str = "desktop-auth") -> dict[str, str]:
    return {
        "id": f"issue-{issue}-{project}",
        "issue": issue,
        "environment": environment,
        "viewport": project,
        "project": project,
        "runScope": environment,
        "baseUrl": "http://127.0.0.1:4173",
        "apiBaseUrl": "http://127.0.0.1:4174",
        "frontendMode": "backend-static",
        "assertion": "scenario passed",
        "scenario": "scenario passed",
        "status": "passed",
        "outcome": "passed",
        "artifact": "output/playwright/e2e-flow/latest-run.json",
        "testReference": f"issue-{issue}-{project}",
    }


def test_verify_issue_checkpoints_rejects_generic_provenance(
    tmp_path: Path,
    capsys,
) -> None:
    report = tmp_path / "issue-checkpoints.json"
    _write_report(report, [_checkpoint("1", "playwright-project", environment="local-e2e")])

    result = verifier.main(
        [
            "--min",
            "1",
            "--require-projects",
            "desktop-chromium",
            "--min-projects-per-issue",
            "1",
            str(report),
        ]
    )

    assert result == 1
    assert "generic provenance" in capsys.readouterr().err


def test_verify_issue_checkpoints_enforces_per_issue_project_distribution(
    tmp_path: Path,
    capsys,
) -> None:
    report = tmp_path / "issue-checkpoints.json"
    _write_report(
        report,
        [
            _checkpoint("1", "desktop-chromium"),
            _checkpoint("1", "tablet-chromium", environment="tablet-auth"),
            _checkpoint("2", "desktop-chromium"),
        ],
    )

    result = verifier.main(
        [
            "--min",
            "3",
            "--require-projects",
            "desktop-chromium,tablet-chromium",
            "--min-projects-per-issue",
            "2",
            str(report),
        ]
    )

    assert result == 1
    assert "issue 2" in capsys.readouterr().err


def test_verify_issue_checkpoints_accepts_provenance_and_distribution(tmp_path: Path) -> None:
    report = tmp_path / "issue-checkpoints.json"
    _write_report(
        report,
        [
            _checkpoint("1", "desktop-chromium"),
            _checkpoint("1", "tablet-chromium", environment="tablet-auth"),
            _checkpoint("1", "mobile-chromium", environment="mobile-auth"),
        ],
    )

    result = verifier.main(
        [
            "--min",
            "3",
            "--require-projects",
            "desktop-chromium,tablet-chromium,mobile-chromium",
            "--min-projects-per-issue",
            "3",
            str(report),
        ]
    )

    assert result == 0
