from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
from collections.abc import Sequence
from typing import Any


ISSUE_RE = re.compile(r"^#?\d+$")
PASSING_STATUSES = {"pass", "passed", "ok", "success"}
GENERIC_ENVIRONMENTS = {"e2e", "local-e2e", "unknown"}
GENERIC_PROJECTS = {"playwright-project", "unknown-project", "unknown", "unspecified"}
DEFAULT_REQUIRED_PROJECTS = "desktop-chromium,tablet-chromium,mobile-chromium"


def load_checkpoints(path: Path) -> tuple[list[dict[str, Any]], int | None]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"[issue-checkpoints] missing report: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"[issue-checkpoints] invalid json: {exc}")

    if isinstance(payload, list):
        return [entry for entry in payload if isinstance(entry, dict)], None
    if isinstance(payload, dict):
        checkpoints = payload.get("checkpoints")
        if not isinstance(checkpoints, list):
            raise SystemExit("[issue-checkpoints] report.checkpoints must be a list")
        minimum_required = payload.get("minimumRequired")
        return [entry for entry in checkpoints if isinstance(entry, dict)], (
            int(minimum_required) if minimum_required is not None else None
        )
    raise SystemExit("[issue-checkpoints] report must be an object or list")


def entry_errors(entry: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    issue = str(entry.get("issue") or "").strip()
    checkpoint_id = str(entry.get("id") or entry.get("checkpoint") or "").strip()
    assertion = str(entry.get("assertion") or entry.get("scenario") or "").strip()
    status = str(entry.get("status") or entry.get("outcome") or "").strip().lower()
    environment = str(entry.get("environment") or "").strip()
    viewport = str(entry.get("viewport") or "").strip()
    project = str(entry.get("project") or "").strip()
    base_url = str(entry.get("baseUrl") or "").strip()
    api_base_url = str(entry.get("apiBaseUrl") or "").strip()
    frontend_mode = str(entry.get("frontendMode") or "").strip()
    artifact = str(entry.get("artifact") or "").strip()
    test_reference = str(entry.get("testReference") or entry.get("test") or "").strip()

    if not checkpoint_id:
        errors.append("missing id")
    if not ISSUE_RE.match(issue):
        errors.append("invalid issue")
    if not assertion:
        errors.append("missing assertion")
    if status not in PASSING_STATUSES:
        errors.append("non-passing status")
    if not environment:
        errors.append("missing environment")
    if not viewport:
        errors.append("missing viewport")
    if not project:
        errors.append("missing project")
    if not base_url:
        errors.append("missing baseUrl")
    if not api_base_url:
        errors.append("missing apiBaseUrl")
    if not frontend_mode:
        errors.append("missing frontendMode")
    if (
        environment in GENERIC_ENVIRONMENTS
        or viewport in GENERIC_PROJECTS
        or project in GENERIC_PROJECTS
    ):
        errors.append("generic provenance")
    if not (artifact or test_reference):
        errors.append("missing artifact/testReference")
    return errors


def parse_project_list(value: str) -> list[str]:
    return [project.strip() for project in value.split(",") if project.strip()]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify issue-linked E2E checkpoint coverage.")
    parser.add_argument("report", type=Path)
    parser.add_argument("--min", type=int, default=250, dest="minimum")
    parser.add_argument(
        "--require-projects",
        default=DEFAULT_REQUIRED_PROJECTS,
        help="Comma-separated Playwright projects that must appear for every issue.",
    )
    parser.add_argument("--min-projects-per-issue", type=int, default=3)
    args = parser.parse_args(argv)

    checkpoints, declared_minimum = load_checkpoints(args.report)
    minimum = max(args.minimum, declared_minimum or 0)
    required_projects = set(parse_project_list(args.require_projects))

    invalid: list[str] = []
    issue_counts: dict[str, int] = {}
    issue_projects: dict[str, set[str]] = {}
    seen_projects: set[str] = set()
    for index, entry in enumerate(checkpoints, start=1):
        errors = entry_errors(entry)
        if errors:
            invalid.append(f"#{index} {entry.get('id') or '<missing id>'}: {', '.join(errors)}")
            continue
        issue = str(entry.get("issue")).strip()
        project = str(entry.get("project")).strip()
        issue_counts[issue] = issue_counts.get(issue, 0) + 1
        issue_projects.setdefault(issue, set()).add(project)
        seen_projects.add(project)

    valid_count = len(checkpoints) - len(invalid)
    if invalid:
        print("[issue-checkpoints] invalid checkpoint entries:", file=sys.stderr)
        for item in invalid[:25]:
            print(f"- {item}", file=sys.stderr)
        if len(invalid) > 25:
            print(f"- ... {len(invalid) - 25} more", file=sys.stderr)
        return 1

    if valid_count < minimum:
        print(
            f"[issue-checkpoints] insufficient checkpoints: valid={valid_count} required={minimum}",
            file=sys.stderr,
        )
        return 1

    if not issue_counts:
        print("[issue-checkpoints] no issue-linked checkpoints found", file=sys.stderr)
        return 1

    coverage_errors: list[str] = []
    missing_global_projects = sorted(required_projects - seen_projects)
    if missing_global_projects:
        coverage_errors.append(f"missing required projects: {', '.join(missing_global_projects)}")

    for issue, projects in sorted(issue_projects.items(), key=lambda item: int(item[0].lstrip("#"))):
        missing_projects = sorted(required_projects - projects)
        if missing_projects:
            coverage_errors.append(f"issue {issue} missing projects: {', '.join(missing_projects)}")
        if len(projects) < args.min_projects_per_issue:
            coverage_errors.append(
                f"issue {issue} has {len(projects)} projects; required {args.min_projects_per_issue}"
            )

    if coverage_errors:
        print("[issue-checkpoints] insufficient project coverage:", file=sys.stderr)
        for item in coverage_errors[:25]:
            print(f"- {item}", file=sys.stderr)
        if len(coverage_errors) > 25:
            print(f"- ... {len(coverage_errors) - 25} more", file=sys.stderr)
        return 1

    print(
        f"[issue-checkpoints] verified: {valid_count} checkpoints across {len(issue_counts)} issues "
        f"and {len(seen_projects)} projects (minimum {minimum})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
