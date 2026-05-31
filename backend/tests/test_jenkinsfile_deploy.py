from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _jenkinsfile_source() -> str:
    return (ROOT / "Jenkinsfile").read_text(encoding="utf-8")


def _validate_smtp_route_source() -> str:
    return (ROOT / "scripts" / "deploy" / "validate_smtp_route.py").read_text(encoding="utf-8")


def test_prod_env_validation_script_compiles_and_is_invoked_by_jenkins() -> None:
    source = _jenkinsfile_source()
    validator_source = _validate_smtp_route_source()

    compile(validator_source, "scripts/deploy/validate_smtp_route.py", "exec")
    assert "scripts/deploy/validate_smtp_route.py" in source
    assert "--env prod" in source
    assert "--source jenkins-prod-smtp-secret" in source
    assert "--write-normalized" in source


def test_prod_env_is_validated_before_remote_env_replacement() -> None:
    source = _jenkinsfile_source()

    assert "INCOMING_ENV_FILE_PATH" in source
    assert "INCOMING_PROD_SMTP_ENV_FILE_PATH" in source
    assert "Server-local prod SMTP settings fill Jenkins' legacy prod env file." not in source
    assert "append_missing_env_keys_from_fallback \"$validated_env_path\" \"$ENV_FILE_PATH.previous\" SMTP_HOST" not in source
    assert 'INCOMING_ENV_FILE_PATH="${ENV_FILE_PATH}.incoming.${APP_VERSION}.${BUILD_NUMBER:-manual}"' in source
    assert 'INCOMING_PROD_SMTP_ENV_FILE_PATH="${ENV_FILE_PATH}.prod-smtp.${APP_VERSION}.${BUILD_NUMBER:-manual}"' in source
    assert 'run_ssh "prepare-env-upload"' in source
    assert "rm -f '$INCOMING_ENV_FILE_PATH'" in source
    assert "'$INCOMING_PROD_SMTP_ENV_FILE_PATH'" in source
    assert 'chmod u+w "$validated_env_path"' in source
    assert "mv \"$validated_env_path\" \"$ENV_FILE_PATH\"" in source
    validation_call = "validate_smtp_route.py"
    assert validation_call in source
    assert source.index(validation_call) < source.index('mv "$validated_env_path" "$ENV_FILE_PATH"')
    assert source.index(validation_call) < source.index('docker compose -p "$COMPOSE_PROJECT"')


def test_prod_deploy_requires_dedicated_prod_smtp_credential_source() -> None:
    source = _jenkinsfile_source()

    assert "PROD_SMTP_ENV_FILE_CREDENTIALS_ID" in source
    assert "moneyflow-prod-smtp-env-file" in source
    assert "PROD_SMTP_ENV_FILE" in source
    assert "jenkins-prod-smtp-secret" in source
    assert "PROD_SMTP_CREDENTIAL_OWNER" in source


def test_prod_route_summary_contract_is_secret_safe() -> None:
    validator_source = _validate_smtp_route_source()

    assert "SMTP_PASS" in validator_source
    assert "SECRET_KEYS" in validator_source
    assert "route_summary" in validator_source
    assert "host_classification" in validator_source
    assert "tls_mode" in validator_source
    assert "source" in validator_source
    assert "DATABASE_URL" in validator_source


def test_deploy_execute_checks_frontend_asset_version_after_remote_deploy() -> None:
    source = _jenkinsfile_source()

    assert "assert_frontend_asset_version" in source
    assert "expected_frontend_version=\"${expected_app_version#v}\"" in source
    assert "frontend asset version mismatch" in source
    assert "waiting for frontend asset version" in source
    assert 'while [ "$asset_attempt" -le "$HEALTH_RETRY_MAX" ]; do' in source
    assert 'grep -Fq "$expected_frontend_version" <<<"$asset_body"' in source
    assert 'printf \'%s\' "$asset_body" | grep -Fq "$expected_frontend_version"' not in source


def test_deploy_execute_shell_avoids_groovy_invalid_backslash_escapes() -> None:
    source = _jenkinsfile_source()
    deploy_stage = source[source.index("stage('Deploy Execute')") :]
    next_stage_index = deploy_stage.find("\n    stage(", len("stage('Deploy Execute')"))
    if next_stage_index != -1:
        deploy_stage = deploy_stage[:next_stage_index]

    assert "\\(" not in deploy_stage
    assert "\\/" not in deploy_stage


def test_remote_deploy_wrapper_avoids_nounset_status_capture() -> None:
    source = _jenkinsfile_source()
    deploy_stage = source[source.index("stage('Deploy Execute')") :]
    next_stage_index = deploy_stage.find("\n    stage(", len("stage('Deploy Execute')"))
    if next_stage_index != -1:
        deploy_stage = deploy_stage[:next_stage_index]

    assert 'run_ssh "remote-deploy"' in deploy_stage
    assert "status=\\$?" not in deploy_stage
    assert "set +e;" not in deploy_stage
    assert "if REMOTE_DEPLOY_PATH=" in deploy_stage
    assert "then rm -f '$remote_script_name'; else exit 1; fi" in deploy_stage


def test_main_prod_deploy_requires_explicit_allow_flag() -> None:
    source = _jenkinsfile_source()

    assert "ALLOW_PROD_DEPLOY" in source
    assert "prod deploy is disabled unless ALLOW_PROD_DEPLOY=true" in source


def test_jenkins_does_not_pipe_remote_uv_installer() -> None:
    source = _jenkinsfile_source()

    assert "astral.sh/uv/install.sh" not in source
    assert "uv is required on the Jenkins agent" in source


def test_predeploy_recovery_skip_is_dev_only() -> None:
    source = _jenkinsfile_source()
    predeploy_stage = source[source.index("stage('Pre-Deploy E2E (Blocking)')") :]
    next_stage_index = predeploy_stage.find("\n    stage(", len("stage('Pre-Deploy E2E (Blocking)')"))
    if next_stage_index != -1:
        predeploy_stage = predeploy_stage[:next_stage_index]

    assert "DEPLOY_TARGET_ENV=${env.DEPLOY_TARGET_ENV}" in predeploy_stage
    assert "[pre-deploy-e2e] dev recovery gate:" in predeploy_stage
    assert "current dev health is not ready" in predeploy_stage


def test_dev_deploy_keeps_debug_tokens_disabled_in_strict_dev() -> None:
    compose = (ROOT / "docker-compose.dev.deploy.yml").read_text(encoding="utf-8")
    source = _jenkinsfile_source()

    assert "AUTH_DEBUG_RETURN_VERIFY_TOKEN: ${AUTH_DEBUG_RETURN_VERIFY_TOKEN:-false}" in compose
    assert "AUTH_DEBUG_RETURN_VERIFY_TOKEN=false" in source
    assert "AUTH_DEBUG_RETURN_VERIFY_TOKEN=true" not in source


def test_upload_limit_probe_requires_authenticated_app_response() -> None:
    source = _jenkinsfile_source()
    deploy_stage = source[source.index("stage('Deploy Execute')") :]

    assert "UPLOAD_LIMIT_PROBE_OK_APP_REACHED" in deploy_stage
    assert "scripts/deploy/seed_upload_probe_user.py" in deploy_stage
    assert ":/tmp/seed_upload_probe_user.py:ro" in deploy_stage
    assert "seed-upload-probe-user" in deploy_stage
    assert "/api/v1/auth/login" in deploy_stage
    assert "debug_verification_token" not in deploy_stage
    assert "/api/v1/auth/verify-email" not in deploy_stage
    assert "x-debug-token-opt-in" not in deploy_stage
    assert 'tmp_probe_cookies="$(mktemp)"' in deploy_stage
    assert '-c "$tmp_probe_cookies"' in deploy_stage
    assert '-b "$tmp_probe_cookies"' in deploy_stage
    assert 'probe_csrf_cookie_name="mf_csrf_token"' in deploy_stage
    assert '-H "x-csrf-token: ${probe_csrf_token}"' in deploy_stage
    assert "upload-limit probe passed with HTTP $probe_status" not in deploy_stage
    assert "400|401|403)" not in deploy_stage


def test_post_deploy_smoke_runs_representative_browser_flows() -> None:
    source = _jenkinsfile_source()
    post_deploy_stage = source[source.index("stage('Post-Deploy E2E Smoke')") :]

    assert "e2e/specs/deeplink.spec.js" in post_deploy_stage
    assert "e2e/specs/transactions.spec.js" in post_deploy_stage
    assert "e2e/specs/holdings.spec.js" in post_deploy_stage
    assert "e2e/specs/import.spec.js" in post_deploy_stage
    assert "--project=desktop-chromium" in post_deploy_stage
