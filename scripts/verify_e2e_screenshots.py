from __future__ import annotations

from pathlib import Path
from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError


ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = ROOT / "output" / "playwright" / "e2e-flow"
MANIFEST_PATH = SCREENSHOT_DIR / "latest-run.json"


class _ScreenshotManifest(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(
        extra="ignore",
        frozen=True,
        strict=True,
    )

    generated_at: str
    count: int = Field(ge=0)
    files: tuple[str, ...]
    playwright_args: tuple[str, ...]


def verify_screenshot_manifest(manifest_path: Path, screenshot_dir: Path) -> int:
    """Verify legacy and scheduler-extended screenshot manifests."""
    if not manifest_path.exists():
        print(f"[e2e-screenshot-check] missing manifest: {manifest_path}", flush=True)
        return 1

    try:
        manifest = _ScreenshotManifest.model_validate_json(manifest_path.read_bytes())
    except OSError as error:
        print(f"[e2e-screenshot-check] cannot read manifest: {error}", flush=True)
        return 1
    except ValidationError as error:
        print(f"[e2e-screenshot-check] invalid manifest json: {error}", flush=True)
        return 1

    listed_files = tuple(name.strip() for name in manifest.files)
    if any(not name or Path(name).name != name for name in listed_files):
        print("[e2e-screenshot-check] screenshot names must be non-empty basenames", flush=True)
        return 1
    if len(listed_files) != len(set(listed_files)):
        print("[e2e-screenshot-check] screenshot names must be unique", flush=True)
        return 1
    listed_count = len(listed_files)
    if manifest.count != listed_count:
        print(
            f"[e2e-screenshot-check] manifest count mismatch: declared={manifest.count} listed={listed_count}",
            flush=True,
        )
        return 1

    missing: list[str] = []
    empty: list[str] = []
    for name in listed_files:
        path = screenshot_dir / name
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

    actual_png_count = len(list(screenshot_dir.glob("*.png")))
    if actual_png_count != listed_count:
        print(
            f"[e2e-screenshot-check] png count mismatch: manifest={listed_count} actual={actual_png_count}",
            flush=True,
        )
        return 1

    print(f"[e2e-screenshot-check] verified: {listed_count} screenshots", flush=True)
    return 0


def main() -> int:
    return verify_screenshot_manifest(MANIFEST_PATH, SCREENSHOT_DIR)


if __name__ == "__main__":
    raise SystemExit(main())
