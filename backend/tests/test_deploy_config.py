from __future__ import annotations

from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_dev_deploy_uses_strict_email_verification() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.dev.deploy.yml").read_text(encoding="utf-8"))

    environment = compose["services"]["app"]["environment"]

    assert environment["ENV"] == "${ENV:-dev}"
    assert environment["AUTH_EMAIL_VERIFICATION_REQUIRED"] == "${AUTH_EMAIL_VERIFICATION_REQUIRED:-true}"
    assert environment["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] == "${AUTH_DEBUG_RETURN_VERIFY_TOKEN:-false}"


def test_jenkins_dev_env_keeps_debug_tokens_disabled() -> None:
    jenkinsfile = (ROOT / "Jenkinsfile").read_text(encoding="utf-8")

    assert "AUTH_DEBUG_RETURN_VERIFY_TOKEN=false" in jenkinsfile
    assert "AUTH_DEBUG_RETURN_VERIFY_TOKEN=true" not in jenkinsfile


def test_jenkins_does_not_pipe_remote_uv_installer() -> None:
    jenkinsfile = (ROOT / "Jenkinsfile").read_text(encoding="utf-8")

    assert "astral.sh/uv/install.sh" not in jenkinsfile
    assert "uv is required on the Jenkins agent" in jenkinsfile


def test_jenkins_post_deploy_runs_deployed_browser_flows() -> None:
    jenkinsfile = (ROOT / "Jenkinsfile").read_text(encoding="utf-8")
    post_deploy = jenkinsfile.split("stage('Post-Deploy E2E Smoke')", maxsplit=1)[1]

    assert "env.SKIP_POST_DEPLOY_E2E_FOR_BRANCH = isMainBranch ? 'true' : 'false'" in jenkinsfile
    assert "e2e/specs/post-deploy-smoke.spec.js" in post_deploy
    assert 'E2E_POST_DEPLOY_EMAIL="jenkins-upload-probe-${BUILD_NUMBER:-manual}@example.com"' in post_deploy
    assert 'E2E_POST_DEPLOY_PASSWORD="UploadProbe123!"' in post_deploy
    assert "--project=desktop-chromium" in post_deploy


def test_jenkins_post_deploy_exposes_uv_to_browser_helpers() -> None:
    jenkinsfile = (ROOT / "Jenkinsfile").read_text(encoding="utf-8")
    post_deploy = jenkinsfile.split("stage('Post-Deploy E2E Smoke')", maxsplit=1)[1]

    assert "npx playwright test e2e/specs/post-deploy-smoke.spec.js" in post_deploy
    assert "uv run" not in post_deploy


def test_dev_compose_defaults_to_dev_environment() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.dev.deploy.yml").read_text(encoding="utf-8"))

    environment = compose["services"]["app"]["environment"]

    assert environment["ENV"] == "${ENV:-dev}"


def test_jenkins_dev_env_overlay_is_idempotent() -> None:
    jenkinsfile = (ROOT / "Jenkinsfile").read_text(encoding="utf-8")

    remove_existing = "grep -v -E '^(ENV|POSTGRES_DB|CORS_ORIGINS|FRONTEND_BASE_URL|DATABASE_URL|AUTH_DEBUG_RETURN_VERIFY_TOKEN|AUTH_EMAIL_VERIFICATION_REQUIRED)='"
    append_defaults = "printf '\\nENV=dev\\nPOSTGRES_DB=moneyflow_dev"

    assert remove_existing in jenkinsfile
    assert append_defaults in jenkinsfile
    assert jenkinsfile.index(remove_existing) < jenkinsfile.index(append_defaults)


def test_jenkins_upload_limit_probe_requires_authenticated_app_response() -> None:
    jenkinsfile = (ROOT / "Jenkinsfile").read_text(encoding="utf-8")
    deploy_stage = jenkinsfile.split("stage('Deploy Execute')", maxsplit=1)[1]

    assert 'if [ "$DEPLOY_TARGET_ENV" = "dev" ]; then' in deploy_stage
    assert "UPLOAD_LIMIT_PROBE_OK_APP_REACHED" in deploy_stage
    assert 'tmp_probe_cookies="$(mktemp)"' in deploy_stage
    assert '-c "$tmp_probe_cookies"' in deploy_stage
    assert '-b "$tmp_probe_cookies"' in deploy_stage
    assert 'probe_csrf_cookie_name="mf_csrf_token"' in deploy_stage
    assert '-H "x-csrf-token: ${probe_csrf_token}"' in deploy_stage
    assert "access token missing" not in deploy_stage
    assert "Authorization: Bearer" not in deploy_stage
    assert "x-debug-token-opt-in" not in deploy_stage
    assert "scripts/deploy/seed_upload_probe_user.py" in deploy_stage
    assert "400|401|403)" not in deploy_stage
    assert "dev-only probe seeding is not allowed" in deploy_stage
    assert "invalid DEPLOY_TARGET_ENV for upload-limit probe" in deploy_stage


def test_jenkins_dev_predeploy_recovery_message_is_explicit() -> None:
    jenkinsfile = (ROOT / "Jenkinsfile").read_text(encoding="utf-8")

    assert "[pre-deploy-e2e] dev recovery gate:" in jenkinsfile
