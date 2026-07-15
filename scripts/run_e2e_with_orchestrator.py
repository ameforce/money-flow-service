from __future__ import annotations

from datetime import UTC, datetime
import json
import os
from pathlib import Path
import sys
import time
import uuid

if __package__ in {None, ""}:
    repository_root = str(Path(__file__).resolve().parents[1])
    if repository_root not in sys.path:
        sys.path.insert(0, repository_root)

from scripts.e2e_scheduler.legacy_runtime import (  # noqa: E402
    BROWSER_UNSAFE_PORTS,
    build_frontend_for_static,
    has_workers_arg,
    is_browser_unsafe_port,
    normalize_playwright_args,
    pick_free_port,
    resolve_frontend_mode,
    split_runner_args,
    start_orchestrator,
)
from scripts.e2e_scheduler.processes import (  # noqa: E402
    OwnedProcess,
    OwnedProcessCleanupError,
    kill_process_tree,
    port_is_open,
)
from scripts.e2e_scheduler.runner_options import (  # noqa: E402
    RunnerMode,
    RunnerOptionError,
    RunnerOptions,
    parse_runner_options,
)
from scripts.e2e_scheduler.runner_cli import run_cli  # noqa: E402
from scripts.e2e_scheduler.runtime_support import (  # noqa: E402
    LOCAL_PLAYWRIGHT_LIB_DIR,
    ROOT,
    SCREENSHOT_DIR,
    SCREENSHOT_MANIFEST,
    is_up,
    urlopen,
    wait_until_up,
    with_local_playwright_runtime,
)
from scripts.e2e_scheduler.subprocess_visibility import run_hidden  # noqa: E402
from scripts.e2e_scheduler.legacy_benchmark_artifact import (  # noqa: E402
    finalize_legacy_cleanup,
)


__all__ = (
    "OwnedProcess",
    "OwnedProcessCleanupError",
    "BROWSER_UNSAFE_PORTS",
    "LOCAL_PLAYWRIGHT_LIB_DIR",
    "build_frontend_for_static",
    "has_workers_arg",
    "is_browser_unsafe_port",
    "is_up",
    "kill_process_tree",
    "normalize_playwright_args",
    "pick_free_port",
    "port_is_open",
    "resolve_frontend_mode",
    "RunnerMode",
    "RunnerOptionError",
    "RunnerOptions",
    "parse_runner_options",
    "split_runner_args",
    "start_orchestrator",
    "urlopen",
    "wait_until_up",
    "with_local_playwright_runtime",
)


def run_playwright(
    frontend_port: int,
    backend_port: int,
    playwright_args: list[str] | None = None,
    *,
    cap_windows_workers: bool = True,
    html_report: bool = False,
    project_matrix: bool = False,
    include_slow: bool = False,
) -> int:
    resolved_playwright_args = normalize_playwright_args(
        list(playwright_args or []),
        cap_windows_workers=cap_windows_workers,
    )
    env = with_local_playwright_runtime()
    env["E2E_BASE_URL"] = f"http://127.0.0.1:{frontend_port}"
    env["E2E_API_BASE_URL"] = f"http://127.0.0.1:{backend_port}"
    env["E2E_AUTH_SETUP_MODE"] = "ui"
    if html_report:
        env["E2E_HTML_REPORT"] = "1"
    if project_matrix:
        env["E2E_PROJECT_MATRIX"] = "1"
    if include_slow:
        env["E2E_INCLUDE_SLOW"] = "1"
    env["E2E_SECRET_KEY"] = "test-secret-key-for-e2e-toss-import-1234567890"
    benchmark_report = str(
        os.environ.get("E2E_BENCHMARK_PLAYWRIGHT_JSON_FILE") or ""
    ).strip()
    benchmark_expectations = str(
        os.environ.get("E2E_BENCHMARK_EVIDENCE_EXPECTATIONS_FILE") or ""
    ).strip()
    benchmark_profile = str(os.environ.get("E2E_BENCHMARK_PROFILE_FILE") or "").strip()
    if benchmark_report:
        reporter = "json"
        if benchmark_profile:
            reporter_path = (
                (ROOT / "scripts" / "e2e_scheduler" / "benchmark_profile_reporter.mjs")
                .resolve()
                .as_posix()
            )
            reporter = f"{reporter},{reporter_path}"
            env["E2E_BENCHMARK_PROFILE_FILE"] = benchmark_profile
        resolved_playwright_args.append(f"--reporter={reporter}")
        env["PLAYWRIGHT_JSON_OUTPUT_FILE"] = benchmark_report
    if benchmark_expectations:
        expectation_path = Path(benchmark_expectations)
        expectation_path.parent.mkdir(parents=True, exist_ok=True)
        _ = expectation_path.write_text("", encoding="utf-8")
        env["E2E_EVIDENCE_EXPECTATIONS_FILE"] = benchmark_expectations
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    for path in SCREENSHOT_DIR.glob("*.png"):
        path.unlink(missing_ok=True)
    SCREENSHOT_MANIFEST.unlink(missing_ok=True)

    playwright_command = ["npx", "playwright", "test", *resolved_playwright_args]
    if os.name == "nt":
        playwright_command = [
            "cmd",
            "/c",
            "npx",
            "playwright",
            "test",
            *resolved_playwright_args,
        ]
    result = run_hidden(playwright_command, cwd=ROOT, env=env)
    if int(result.returncode) != 0:
        if benchmark_report:
            screenshots = list(SCREENSHOT_DIR.glob("*.png"))
            _ = SCREENSHOT_MANIFEST.write_text(
                json.dumps(
                    {
                        "generated_at": datetime.now(UTC).isoformat(),
                        "count": len(screenshots),
                        "files": sorted(path.name for path in screenshots),
                        "playwright_args": resolved_playwright_args,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
        return int(result.returncode)

    screenshots = list(SCREENSHOT_DIR.glob("*.png"))
    if not screenshots:
        print(
            "[e2e-runner] screenshot capture missing: output/playwright/e2e-flow/*.png",
            flush=True,
        )
        return 1
    _ = SCREENSHOT_MANIFEST.write_text(
        json.dumps(
            {
                "generated_at": datetime.now(UTC).isoformat(),
                "count": len(screenshots),
                "files": sorted(path.name for path in screenshots),
                "playwright_args": resolved_playwright_args,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"[e2e-runner] screenshot capture: {len(screenshots)} files", flush=True)
    return 0


def _run_legacy(options: RunnerOptions) -> int:
    playwright_args = list(options.playwright_args)
    frontend_mode = resolve_frontend_mode(playwright_args)
    backend_port = pick_free_port()
    frontend_port = backend_port if frontend_mode == "static" else pick_free_port()
    backend_health = f"http://127.0.0.1:{backend_port}/healthz"
    frontend_health = f"http://127.0.0.1:{frontend_port}"
    ephemeral_db_path = ROOT / "e2e" / f"e2e_run_{uuid.uuid4().hex}.db"
    db_url = f"sqlite:///./e2e/{ephemeral_db_path.name}"
    backend_latency_ms_samples: list[float] = []

    print(
        (
            "[e2e-runner] isolated run -> "
            f"backend:{backend_port}, frontend:{frontend_port}, mode:{frontend_mode}, db:{ephemeral_db_path.name}"
        ),
        flush=True,
    )
    if frontend_mode == "static":
        build_code = build_frontend_for_static(backend_port)
        if build_code != 0:
            return build_code
    orchestrator = start_orchestrator(
        db_url,
        backend_port,
        frontend_port,
        skip_frontend=frontend_mode == "static",
    )
    try:
        if not wait_until_up(backend_health, frontend_health, timeout_sec=180):
            print("[e2e-runner] service startup timed out", flush=True)
            return 1
        health_started = time.monotonic()
        if not is_up(backend_health):
            return 1
        backend_latency_ms_samples.append(
            max((time.monotonic() - health_started) * 1000.0, 0.001)
        )
        return run_playwright(
            frontend_port,
            backend_port,
            playwright_args,
            cap_windows_workers=True,
            html_report=options.html_report,
            project_matrix=options.project_matrix,
            include_slow=options.include_slow,
        )
    finally:
        print("[e2e-runner] stop orchestrator", flush=True)
        artifact = str(os.environ.get("E2E_BENCHMARK_RUN_ARTIFACT") or "").strip()
        finalize_legacy_cleanup(
            orchestrator,
            ephemeral_db_path,
            backend_port,
            frontend_port,
            tuple(backend_latency_ms_samples),
            Path(artifact) if artifact else None,
        )


def main(argv: list[str] | None = None) -> int:
    return run_cli(
        list(argv if argv is not None else sys.argv[1:]),
        _run_legacy,
    )


if __name__ == "__main__":
    raise SystemExit(main())
