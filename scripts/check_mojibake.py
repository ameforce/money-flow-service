from __future__ import annotations

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
SCAN_DIRS = [
    ROOT / "frontend" / "src",
    ROOT / "backend" / "app",
    ROOT / "backend" / "tests",
    ROOT / "e2e",
    ROOT / "scripts",
    ROOT / "docs",
]
ALLOWED_SUFFIXES = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".css",
    ".json",
    ".md",
    ".yml",
    ".yaml",
    ".toml",
    ".ini",
    ".txt",
}
SUSPECT_LATIN1_PATTERN = re.compile(r"[\u00C0-\u00FF\uFFFD]")
SUSPECT_HANGUL_HAN_MIX_PATTERN = re.compile(r"(?=.*[가-힣])(?=.*[\u4E00-\u9FFF])")


def should_scan(path: Path) -> bool:
    if path.suffix.lower() not in ALLOWED_SUFFIXES:
        return False
    lowered = str(path).lower()
    ignored_tokens = ("node_modules", ".venv", ".git", "playwright-report", "test-results")
    return not any(token in lowered for token in ignored_tokens)


def detect_mojibake_reason(line: str) -> str | None:
    if SUSPECT_LATIN1_PATTERN.search(line):
        return "latin1_or_replacement_char"
    if SUSPECT_HANGUL_HAN_MIX_PATTERN.search(line):
        return "hangul_han_mixed_text"
    return None


def scan_file(path: Path) -> list[str]:
    findings: list[str] = []
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        findings.append(f"{path}: UTF-8 decode failed")
        return findings

    for idx, line in enumerate(text.splitlines(), start=1):
        reason = detect_mojibake_reason(line)
        if reason is not None:
            findings.append(f"{path}:{idx}: [{reason}] {line.strip()[:140]}")
    return findings


def main() -> int:
    def safe_print(text: str) -> None:
        try:
            print(text)
        except UnicodeEncodeError:
            encoded = text.encode(sys.stdout.encoding or "utf-8", errors="replace")
            sys.stdout.buffer.write(encoded + b"\n")

    findings: list[str] = []
    for scan_dir in SCAN_DIRS:
        if not scan_dir.exists():
            continue
        for path in scan_dir.rglob("*"):
            if path.is_file() and should_scan(path):
                findings.extend(scan_file(path))

    if findings:
        safe_print("[mojibake-check] suspicious text detected:")
        for item in findings:
            safe_print(item)
        return 1

    safe_print("[mojibake-check] no suspicious mojibake patterns found.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
