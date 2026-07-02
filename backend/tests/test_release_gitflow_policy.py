from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RESOLVER = ROOT / "scripts" / "ci" / "resolve_app_version.py"
POLICY = ROOT / "scripts" / "ci" / "enforce_gitflow_policy.py"
JENKINSFILE = ROOT / "Jenkinsfile"


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return result.stdout.strip()


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "ci@example.com")
    _git(repo, "config", "user.name", "CI")
    (repo / "README.md").write_text("base\n", encoding="utf-8")
    _git(repo, "add", "README.md")
    _git(repo, "commit", "-m", "chore: base")
    return repo


def _run_python(script: Path, repo: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script), "--repo", str(repo), *args],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def test_main_version_resolution_requires_exact_head_tag(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _git(repo, "tag", "v0.1.0")
    (repo / "README.md").write_text("base\nuntagged\n", encoding="utf-8")
    _git(repo, "commit", "-am", "fix: untagged main change")

    result = _run_python(RESOLVER, repo, "--branch", "main")

    assert result.returncode != 0
    assert "main requires an exact vX.Y.Z tag on HEAD" in result.stderr
    assert "v0.1.0.1" not in result.stdout


def test_main_version_resolution_uses_exact_tag_without_build_suffix(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _git(repo, "tag", "v0.1.0")
    (repo / "README.md").write_text("base\nrelease\n", encoding="utf-8")
    _git(repo, "commit", "-am", "fix: release change")
    _git(repo, "tag", "v0.1.1")

    result = _run_python(RESOLVER, repo, "--branch", "main")

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "v0.1.1"


def test_main_version_resolution_normalizes_remote_branch_names(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _git(repo, "tag", "v0.1.0")
    (repo / "README.md").write_text("base\nrelease\n", encoding="utf-8")
    _git(repo, "commit", "-am", "fix: release change")
    _git(repo, "tag", "v0.1.1")

    for branch in ("origin/main", "refs/heads/main"):
        result = _run_python(RESOLVER, repo, "--branch", branch)

        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "v0.1.1"


def test_non_main_version_resolution_keeps_build_count_suffix(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _git(repo, "tag", "v0.1.0")
    for index in range(2):
        (repo / "README.md").write_text(f"base\nfeature {index}\n", encoding="utf-8")
        _git(repo, "commit", "-am", f"fix: feature {index}")

    result = _run_python(RESOLVER, repo, "--branch", "hotfix/example")

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "v0.1.0.2"


def test_protected_branches_require_no_ff_merge_tip(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)

    direct = _run_python(POLICY, repo, "--branch", "develop")
    assert direct.returncode != 0
    assert "develop requires a no-fast-forward merge commit tip" in direct.stderr

    _git(repo, "checkout", "-b", "feature/no-ff")
    (repo / "feature.txt").write_text("feature\n", encoding="utf-8")
    _git(repo, "add", "feature.txt")
    _git(repo, "commit", "-m", "feat: feature work")
    _git(repo, "checkout", "-b", "develop", "main")
    _git(repo, "merge", "--no-ff", "feature/no-ff", "-m", "Merge branch 'feature/no-ff' into develop")

    merged = _run_python(POLICY, repo, "--branch", "develop")
    assert merged.returncode == 0, merged.stderr
    assert "gitflow policy passed" in merged.stdout


def test_main_policy_requires_exact_tag_and_merge_commit(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _git(repo, "tag", "v0.1.0")

    direct = _run_python(POLICY, repo, "--branch", "main")
    assert direct.returncode != 0
    assert "main requires a no-fast-forward merge commit tip" in direct.stderr

    _git(repo, "checkout", "-b", "hotfix/v0.1.1")
    (repo / "hotfix.txt").write_text("hotfix\n", encoding="utf-8")
    _git(repo, "add", "hotfix.txt")
    _git(repo, "commit", "-m", "fix: hotfix work")
    _git(repo, "checkout", "main")
    _git(repo, "merge", "--no-ff", "hotfix/v0.1.1", "-m", "Merge branch 'hotfix/v0.1.1'")

    untagged_merge = _run_python(POLICY, repo, "--branch", "main")
    assert untagged_merge.returncode != 0
    assert "main requires an exact vX.Y.Z tag on HEAD" in untagged_merge.stderr

    _git(repo, "tag", "v0.1.1")
    tagged_merge = _run_python(POLICY, repo, "--branch", "main")
    assert tagged_merge.returncode == 0, tagged_merge.stderr


def test_jenkinsfile_uses_gitflow_policy_and_version_resolver() -> None:
    source = JENKINSFILE.read_text(encoding="utf-8")

    assert "scripts/ci/enforce_gitflow_policy.py" in source
    assert "scripts/ci/resolve_app_version.py" in source
    assert "main requires an exact vX.Y.Z tag on HEAD" not in source
