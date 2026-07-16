"""Build the isolated Python startup environment for E2E child processes."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Final


_ROOT: Final = Path(__file__).resolve().parents[2]
_E2E_PYTHON_STARTUP: Final = _ROOT / "scripts" / "e2e_scheduler" / "python_startup"


def with_e2e_python_startup(env: dict[str, str]) -> dict[str, str]:
    """Return an isolated child environment with deterministic static MIME types."""
    configured = env.copy()
    inherited = configured.get("PYTHONPATH", "").strip()
    configured["PYTHONPATH"] = os.pathsep.join(
        part for part in (str(_E2E_PYTHON_STARTUP), inherited) if part
    )
    return configured
