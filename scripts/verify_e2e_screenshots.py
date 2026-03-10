from __future__ import annotations

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = ROOT / "output" / "playwright" / "e2e-flow"
MANIFEST_PATH = SCREENSHOT_DIR / "latest-run.json"


def main() -> int:
    if not MANIFEST_PATH.exists():
        print(f"[e2e-screenshot-check] missing manifest: {MANIFEST_PATH}", flush=True)
        return 1

    try:
        payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[e2e-screenshot-check] invalid manifest json: {exc}", flush=True)
        return 1

    files = payload.get("files")
    if not isinstance(files, list):
        print("[e2e-screenshot-check] manifest field 'files' must be a list", flush=True)
        return 1

    listed_files = [str(name).strip() for name in files if str(name).strip()]
    listed_count = len(listed_files)
    declared_count = int(payload.get("count") or 0)
    if declared_count != listed_count:
        print(
            f"[e2e-screenshot-check] manifest count mismatch: declared={declared_count} listed={listed_count}",
            flush=True,
        )
        return 1

    missing: list[str] = []
    empty: list[str] = []
    for name in listed_files:
        path = SCREENSHOT_DIR / name
        if not path.exists():
            missing.append(name)
            continue
        if path.stat().st_size <= 0:
            empty.append(name)

    if missing or empty:
        if missing:
            print(f"[e2e-screenshot-check] missing files: {', '.join(missing)}", flush=True)
        if empty:
            print(f"[e2e-screenshot-check] empty files: {', '.join(empty)}", flush=True)
        return 1

    actual_png_count = len(list(SCREENSHOT_DIR.glob("*.png")))
    if actual_png_count != listed_count:
        print(
            f"[e2e-screenshot-check] png count mismatch: manifest={listed_count} actual={actual_png_count}",
            flush=True,
        )
        return 1

    print(f"[e2e-screenshot-check] verified: {listed_count} screenshots", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
