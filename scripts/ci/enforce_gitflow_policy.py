#!/usr/bin/env python3
"""Fail fast when protected branch builds violate the repo's gitflow contract."""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

SEMVER_TAG_RE = re.compile(r"^v\d+\.\d+\.\d+$")
PROTECTED_BRANCHES = {"main", "develop"}


def _git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
    )


def normalize_branch(value: str) -> str:
    branch = str(value or "").strip() or "manual"
    if branch.startswith("origin/"):
        branch = branch[len("origin/") :]
    if branch.startswith("refs/heads/"):
        branch = branch[len("refs/heads/") :]
    return branch


def _head_parent_count(repo: Path) -> int:
    result = _git(repo, "rev-list", "--parents", "-n", "1", "HEAD")
    parts = result.stdout.strip().split()
    if not parts:
        return 0
    return max(0, len(parts) - 1)


def _semver_tags_at_head(repo: Path) -> list[str]:
    result = _git(repo, "tag", "--points-at", "HEAD", "--list", "v[0-9]*.[0-9]*.[0-9]*")
    return sorted(line.strip() for line in result.stdout.splitlines() if SEMVER_TAG_RE.match(line.strip()))


def enforce(repo: Path, branch: str) -> str:
    normalized_branch = normalize_branch(branch)
    if normalized_branch not in PROTECTED_BRANCHES:
        return f"gitflow policy skipped for non-protected branch {normalized_branch}"

    parent_count = _head_parent_count(repo)
    if parent_count < 2:
        raise RuntimeError(
            f"{normalized_branch} requires a no-fast-forward merge commit tip; "
            "merge feature/fix/hotfix/release branches with --no-ff instead of direct commits or fast-forward updates."
        )

    if normalized_branch == "main" and not _semver_tags_at_head(repo):
        raise RuntimeError(
            "main requires an exact vX.Y.Z tag on HEAD before prod deploy; "
            "do not deploy untagged main commits or build-count pseudo release versions."
        )

    return f"gitflow policy passed for {normalized_branch}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Enforce protected-branch gitflow release policy.")
    parser.add_argument("--repo", default=".", help="Git repository path")
    parser.add_argument("--branch", required=True, help="Branch name from Jenkins/Git")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    try:
        print(enforce(repo, args.branch))
    except Exception as exc:  # noqa: BLE001 - CLI boundary with clear stderr contract
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
