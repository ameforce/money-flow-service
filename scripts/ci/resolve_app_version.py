#!/usr/bin/env python3
"""Resolve the deployable app version for Jenkins/Gitflow builds.

Policy:
- main/prod must be an exact vX.Y.Z tag on HEAD. The deployed APP_VERSION is
  the tag itself, never a build-count suffix.
- non-main branches keep the historical CI build-count suffix from the newest
  semver tag so dev builds remain traceable without pretending to be releases.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

SEMVER_TAG_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)$")
FALLBACK_VERSION = "v0.1.1.0"


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
    branch = str(value or "").strip() or "main"
    if branch.startswith("origin/"):
        branch = branch[len("origin/") :]
    if branch.startswith("refs/heads/"):
        branch = branch[len("refs/heads/") :]
    return branch


def _semver_key(tag: str) -> tuple[int, int, int]:
    match = SEMVER_TAG_RE.match(tag.strip())
    if not match:
        raise ValueError(f"not a semver tag: {tag}")
    return tuple(int(part) for part in match.groups())


def _semver_tags(repo: Path, *, points_at_head: bool = False) -> list[str]:
    args = ["tag", "--list", "v[0-9]*.[0-9]*.[0-9]*"]
    if points_at_head:
        args.extend(["--points-at", "HEAD"])
    result = _git(repo, *args)
    tags = [line.strip() for line in result.stdout.splitlines() if SEMVER_TAG_RE.match(line.strip())]
    return sorted(tags, key=_semver_key, reverse=True)


def _count_since(repo: Path, tag: str) -> int:
    result = _git(repo, "rev-list", "--count", f"{tag}..HEAD")
    return int(result.stdout.strip() or "0")


def resolve_app_version(repo: Path, branch: str) -> str:
    normalized_branch = normalize_branch(branch)
    if normalized_branch == "main":
        head_tags = _semver_tags(repo, points_at_head=True)
        if not head_tags:
            raise RuntimeError(
                "main requires an exact vX.Y.Z tag on HEAD before prod deploy; "
                "create the gitflow release/hotfix merge commit, tag that commit, "
                "and push branch+tag together instead of deploying a build-count version."
            )
        return head_tags[0]

    tags = _semver_tags(repo)
    if tags:
        latest_tag = tags[0]
        return f"{latest_tag}.{_count_since(repo, latest_tag)}"

    branch_tail = normalized_branch.split("/")[-1]
    tail_match = re.match(r"^v?(\d+\.\d+\.\d+)$", branch_tail)
    if tail_match:
        return f"v{tail_match.group(1)}.0"
    return FALLBACK_VERSION


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resolve money-flow APP_VERSION under gitflow release rules.")
    parser.add_argument("--repo", default=".", help="Git repository path")
    parser.add_argument("--branch", required=True, help="Branch name from Jenkins/Git")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    try:
        version = resolve_app_version(repo, args.branch)
    except Exception as exc:  # noqa: BLE001 - CLI boundary with clear stderr contract
        print(str(exc), file=sys.stderr)
        return 2
    if version == "v0.0.0.0" or re.match(r"^v0\.0\.0\.\d+$", version):
        version = FALLBACK_VERSION
    print(version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
