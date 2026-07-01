from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _jenkinsfile_source() -> str:
    return (ROOT / "Jenkinsfile").read_text(encoding="utf-8")


def _validate_smtp_route_source() -> str:
    return (ROOT / "scripts" / "deploy" / "validate_smtp_route.py").read_text(encoding="utf-8")


def _package_scripts() -> dict[str, str]:
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    scripts = package["scripts"]
    return {str(name): str(command) for name, command in scripts.items()}


def _stage_source(source: str, stage_name: str) -> str:
    marker = f"stage('{stage_name}')"
    stage = source[source.index(marker) :]
    next_stage_index = stage.find("\n    stage(", len(marker))
    if next_stage_index != -1:
        stage = stage[:next_stage_index]
    return stage


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


def test_quality_gate_is_deploy_blocking_pytest_only_and_fail_closed() -> None:
    source = _jenkinsfile_source()
    quality_gate_stage = _stage_source(source, "Quality Gate")

    assert "npm run ci:quality:gate" not in quality_gate_stage
    assert "npm run e2e" not in quality_gate_stage
    assert "verify_e2e_screenshots.py" not in quality_gate_stage
    assert "check_mojibake.py" not in quality_gate_stage
    assert "uv run --extra dev python -m pytest" in quality_gate_stage
    assert "RUN_DEPLOY=true" in quality_gate_stage
    assert "SKIP_QUALITY_GATE" in quality_gate_stage


def test_predeploy_live_smoke_is_on_demand_not_deploy_blocking() -> None:
    source = _jenkinsfile_source()

    assert "stage('Pre-Deploy E2E (Blocking)')" not in source
    assert "RUN_PRE_DEPLOY_E2E" in source
    assert "auth deep-link token policy: query token rejected" in source


def test_async_quality_gate_surfaces_and_evidence_markers_are_exposed() -> None:
    source = _jenkinsfile_source()
    async_stage = _stage_source(source, "Async Quality Gate (On Demand)")
    scripts = _package_scripts()

    assert "RUN_ASYNC_QUALITY_GATE" in source
    assert "RUN_PRE_DEPLOY_E2E" in source
    assert ".jenkins-async-deploy-block.json" in source
    assert "deploy-evidence.json" in source
    assert "ASYNC_FAILURE_RCA_LINK" in source
    assert '"jenkins_evidence_requirements"' in source
    assert '"baseline_runs_required": 3' in source
    assert '"post_change_runs_required": 3' in source
    assert '"target_total_blocking_minutes": 20' in source
    assert '"target_deploy_execute_minutes": 8' in source
    assert '"post_deploy_smoke": "${postDeploySmokeStatus}"' in source
    assert '"upload_limit_probe": "blocking"' in source
    assert '"remote_path": "${params.DEPLOY_PATH}/.jenkins-async-deploy-block.json"' in source
    assert "writeFile file: 'deploy-evidence.json'" in async_stage
    assert async_stage.index("writeFile file: 'deploy-evidence.json'") < async_stage.index("if (!isUnix())")
    assert async_stage.index("writeFile file: 'deploy-evidence.json'") < async_stage.index("DEPLOY_SSH_CREDENTIALS_ID")
    assert "withCredentials(credentialBindings)" in async_stage
    assert "remote_marker=\"${REMOTE_DEPLOY_PATH%/}/${ASYNC_MARKER_FILE}\"" in async_stage
    assert "persist_async_marker()" in async_stage
    assert "trap on_async_exit EXIT" in async_stage
    assert "persist_async_marker || echo" not in async_stage
    assert "if ! persist_async_marker; then" in async_stage
    assert "refusing to treat async failure as recorded" in async_stage
    assert 'write_async_marker "async_quality_setup_failed"' in async_stage
    assert 'write_async_marker "npm_missing"' in async_stage
    assert 'write_async_marker "ci_async_quality_failed"' in async_stage
    assert async_stage.index("trap on_async_exit EXIT") < async_stage.index(". ./scripts/ci/ensure-node.sh")
    assert "cat > '$remote_marker'" in async_stage
    assert "remote_marker_state=" in async_stage
    assert any("async" in name and "quality" in name for name in scripts)
    assert any("pre" in name and "deploy" in name and "e2e" in name for name in scripts)


def test_jenkins_docs_match_deploy_blocking_async_contract() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    feature_matrix = (ROOT / "e2e" / "feature-matrix.md").read_text(encoding="utf-8")
    mail_docs = (ROOT / "docs" / "mail-delivery-troubleshooting-and-setup.md").read_text(
        encoding="utf-8"
    )

    assert "RUN_POST_DEPLOY_E2E" not in readme
    assert "deploy-blocking Quality Gate" in readme
    assert "RUN_ASYNC_QUALITY_GATE=false" in readme
    assert "RUN_PRE_DEPLOY_E2E=false" in readme
    assert "deploy-evidence.json" in readme
    assert "원격 `DEPLOY_PATH`" in readme
    assert "baseline 3회 + 변경 후 3회" in readme
    assert "pre-deploy Jenkins gates" not in feature_matrix
    assert "async/on-demand Jenkins quality gates" in feature_matrix
    assert "post-deploy-smoke.spec.js --project=desktop-chromium --workers=1" in mail_docs
    assert "There is no `RUN_POST_DEPLOY_E2E` skip switch" in mail_docs


def test_dev_deploy_keeps_debug_tokens_disabled_in_strict_dev() -> None:
    compose = (ROOT / "docker-compose.dev.deploy.yml").read_text(encoding="utf-8")
    source = _jenkinsfile_source()

    assert "AUTH_DEBUG_RETURN_VERIFY_TOKEN: ${AUTH_DEBUG_RETURN_VERIFY_TOKEN:-false}" in compose
    assert "AUTH_DEBUG_RETURN_VERIFY_TOKEN=false" in source
    assert "AUTH_DEBUG_RETURN_VERIFY_TOKEN=true" not in source


def test_upload_limit_probe_requires_authenticated_app_response() -> None:
    source = _jenkinsfile_source()
    deploy_stage = _stage_source(source, "Deploy Execute")

    assert 'if [ "$DEPLOY_TARGET_ENV" = "dev" ]; then' in deploy_stage
    assert "UPLOAD_LIMIT_PROBE_OK_APP_REACHED" in deploy_stage
    assert "scripts/deploy/seed_upload_probe_user.py" in deploy_stage
    assert ":/tmp/seed_upload_probe_user.py:ro" in deploy_stage
    assert "seed-upload-probe-user" in deploy_stage
    assert "/api/v1/auth/login" in deploy_stage
    assert "debug_verification_token" not in deploy_stage
    assert "/api/v1/auth/verify-email" not in deploy_stage
    assert "x-debug-token-opt-in" not in deploy_stage
    assert 'probe_email="jenkins-upload-probe-${BUILD_NUMBER:-manual}@example.com"' in deploy_stage
    assert 'tmp_probe_cookies="$(mktemp)"' in deploy_stage
    assert '-c "$tmp_probe_cookies"' in deploy_stage
    assert '-b "$tmp_probe_cookies"' in deploy_stage
    assert 'probe_csrf_cookie_name="mf_csrf_token"' in deploy_stage
    assert '-H "x-csrf-token: ${probe_csrf_token}"' in deploy_stage
    assert "upload-limit probe passed with HTTP $probe_status" not in deploy_stage
    assert "400|401|403)" not in deploy_stage
    assert "dev-only probe seeding is not allowed" in deploy_stage
    assert "invalid DEPLOY_TARGET_ENV for upload-limit probe" in deploy_stage


def test_post_deploy_smoke_runs_representative_browser_flows() -> None:
    source = _jenkinsfile_source()
    post_deploy_stage = _stage_source(source, "Post-Deploy E2E Smoke")

    assert "RUN_POST_DEPLOY_E2E" not in post_deploy_stage
    assert "SKIP_POST_DEPLOY_E2E_FOR_BRANCH" not in post_deploy_stage
    assert "e2e/specs/post-deploy-smoke.spec.js" in post_deploy_stage
    assert 'E2E_POST_DEPLOY_EMAIL="jenkins-upload-probe-${BUILD_NUMBER:-manual}@example.com"' in post_deploy_stage
    assert 'E2E_POST_DEPLOY_PASSWORD="UploadProbe123!"' in post_deploy_stage
    assert "debug_verification_token" not in post_deploy_stage
    assert "x-debug-token-opt-in" not in post_deploy_stage
    assert "--project=desktop-chromium" in post_deploy_stage
    assert "exit 1" in post_deploy_stage
