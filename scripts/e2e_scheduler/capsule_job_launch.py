"""Build one isolated Playwright job command and environment."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from scripts.e2e_scheduler.capsule_paths import JobPaths
from scripts.e2e_scheduler.capsule_settings import CapsuleSettings
from scripts.e2e_scheduler.model import JobSpec, RunId, WorkerId
from scripts.e2e_scheduler.reporters import resolve_reporters
from scripts.e2e_scheduler.runtime_support import with_local_playwright_runtime


@dataclass(frozen=True, slots=True)
class JobLaunchRequest:
    repository_root: Path
    run_id: RunId
    worker_id: WorkerId
    settings: CapsuleSettings
    job: JobSpec
    paths: JobPaths
    backend_port: int
    frontend_origin: str
    browser_endpoint: str


@dataclass(frozen=True, slots=True)
class JobLaunch:
    command: tuple[str, ...]
    environment: Mapping[str, str]


def build_job_launch(request: JobLaunchRequest) -> JobLaunch:
    reporting = resolve_reporters(
        request.settings.playwright_args,
        include_html=request.settings.html_report,
    )
    env = with_local_playwright_runtime()
    env.update(request.settings.environment())
    env.update(reporting.environment(request.paths.output / "html-report"))
    env.update(
        {
            "E2E_BASE_URL": request.frontend_origin,
            "E2E_API_BASE_URL": f"http://127.0.0.1:{request.backend_port}",
            "E2E_API_REQUEST_ORIGIN": request.frontend_origin,
            "E2E_AUTH_SETUP_MODE": "api",
            "E2E_AUTH_SETUP_METRICS_FILE": str(
                request.paths.root / "auth-setup.jsonl"
            ),
            "E2E_SECRET_KEY": "test-secret-key-for-e2e-toss-import-1234567890",
            "PW_TEST_CONNECT_WS_ENDPOINT": request.browser_endpoint,
            "PLAYWRIGHT_JSON_OUTPUT_FILE": str(request.paths.json_report),
            "E2E_RUNTIME_PROFILE_FILE": str(request.paths.runtime_profile),
            "E2E_EVIDENCE_EXPECTATIONS_FILE": str(request.paths.evidence_expectations),
            "E2E_SCREENSHOT_DIR": str(request.paths.screenshots),
            "E2E_EVIDENCE_DIR": str(request.paths.evidence),
            "E2E_UIUX_EVIDENCE_ROOT": str(request.paths.uiux_evidence),
            "TMP": str(request.paths.temporary),
            "TEMP": str(request.paths.temporary),
            "TMPDIR": str(request.paths.temporary),
            "E2E_RUN_ID": str(request.run_id),
            "E2E_WORKER_ID": str(request.worker_id),
            "E2E_JOB_ID": str(request.job.job_id),
        }
    )
    playwright_cli = (
        request.repository_root / "node_modules" / "@playwright" / "test" / "cli.js"
    )
    command = (
        "node",
        str(playwright_cli),
        "test",
        *reporting.with_internal_reporter(
            request.repository_root
            / "scripts"
            / "e2e_scheduler"
            / "runtime_profile_reporter.mjs"
        ),
        f"--project={request.job.project}",
        "--workers=1",
        f"--test-list={request.paths.test_list}",
        f"--output={request.paths.output}",
    )
    return JobLaunch(command=command, environment=env)
