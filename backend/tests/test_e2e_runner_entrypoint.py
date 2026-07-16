from __future__ import annotations

from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[2]
ENTRYPOINT = ROOT / "scripts" / "run_e2e_with_orchestrator.py"


def test_direct_script_entrypoint_imports_scheduler_from_repository_root() -> None:
    # Given
    probe = (
        "import runpy, sys; "
        f"sys.path[0] = {str(ENTRYPOINT.parent)!r}; "
        f"runpy.run_path({str(ENTRYPOINT)!r}, run_name='entrypoint_probe')"
    )

    # When
    completed = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    # Then
    assert completed.returncode == 0, completed.stderr
