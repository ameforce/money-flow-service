from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.run_e2e_with_orchestrator import with_local_playwright_runtime


def main(argv: list[str] | None = None) -> int:
    args = list(argv or sys.argv[1:])
    env = with_local_playwright_runtime()
    command = ["npx", "playwright", "test", *args]
    if os.name == "nt":
        command = ["cmd", "/c", "npx", "playwright", "test", *args]
    return int(subprocess.run(command, cwd=ROOT, env=env).returncode)


if __name__ == "__main__":
    raise SystemExit(main())
