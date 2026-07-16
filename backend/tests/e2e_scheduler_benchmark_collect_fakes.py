from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path

from pydantic import JsonValue

from scripts.e2e_scheduler.discovery import canonical_test_id


def write_json(path: Path, payload: Mapping[str, JsonValue]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _ = path.write_text(json.dumps(payload), encoding="utf-8")


def report(root: Path) -> tuple[Mapping[str, JsonValue], str]:
    test_id = str(
        canonical_test_id(
            "desktop-chromium",
            Path("e2e/specs/auth.spec.js"),
            10,
            ("flow", "logs in"),
        )
    )
    return (
        {
            "config": {
                "rootDir": str(root / "e2e" / "specs"),
                "projects": [{"name": "desktop-chromium", "retries": 0}],
            },
            "suites": [
                {
                    "title": "auth.spec.js",
                    "suites": [
                        {
                            "title": "flow",
                            "specs": [
                                {
                                    "title": "logs in",
                                    "file": "auth.spec.js",
                                    "line": 10,
                                    "tests": [
                                        {
                                            "projectName": "desktop-chromium",
                                            "expectedStatus": "passed",
                                            "status": "expected",
                                            "results": [
                                                {
                                                    "status": "passed",
                                                    "duration": 60000,
                                                    "retry": 0,
                                                }
                                            ],
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ],
            "errors": [],
        },
        test_id,
    )
