from __future__ import annotations

from datetime import UTC, datetime, timedelta
import json
from pathlib import Path

import pytest

from scripts.e2e_scheduler.benchmark_collect import collect_dynamic
from scripts.e2e_scheduler.benchmark_collect_models import BenchmarkCollectionError


def test_collect_dynamic_rejects_stale_invocation_marker(tmp_path: Path) -> None:
    started = datetime.now(UTC)
    latest = tmp_path / "latest.json"
    _ = latest.write_text(
        json.dumps(
            {
                "generated_at": (started - timedelta(seconds=1)).isoformat(),
                "run_id": "run-stale",
                "benchmark_invocation_id": "old-invocation",
                "cleanup_status": "complete",
                "count": 1,
                "files": ["run-stale-worker-1-job-1-shot.png"],
                "totals": {
                    "expected_tests": 1,
                    "actual_tests": 1,
                    "expected_scenarios": 1,
                    "actual_scenarios": 1,
                    "expected_evidence_count": 1,
                    "actual_evidence_count": 1,
                },
                "scenario_ids": {"expected": ["one"], "actual": ["one"]},
                "projects": [
                    {
                        "name": "desktop-chromium",
                        "browser": "chromium",
                        "viewport": [1280, 720],
                    }
                ],
                "jobs": [
                    {
                        "job_id": "job-1",
                        "worker_id": "worker-1",
                        "expected_evidence_files": ["shot.png"],
                        "actual_evidence_files": ["shot.png"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(BenchmarkCollectionError, match="invocation|stale"):
        _ = collect_dynamic(
            screenshot_manifest=latest,
            scheduler_root=tmp_path / "scheduler",
            repository_root=tmp_path,
            expected_invocation_id="new-invocation",
            started_at=started,
        )
