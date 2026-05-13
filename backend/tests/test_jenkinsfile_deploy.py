from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _jenkinsfile_source() -> str:
    return (ROOT / "Jenkinsfile").read_text(encoding="utf-8")


def _extract_prod_env_python_block(source: str) -> str:
    marker = "python3 - \"$ENV_FILE_PATH\" <<'PY'\n"
    start = source.index(marker) + len(marker)
    end = source.index("\nPY", start)
    return source[start:end]


def _groovy_triple_single_quoted_render(source: str) -> str:
    return source.replace("\\n", "\n")


def _required_tuple_values(python_source: str) -> tuple[str, ...]:
    module = ast.parse(python_source)
    for node in ast.walk(module):
        if isinstance(node, ast.Assign):
            names = [target.id for target in node.targets if isinstance(target, ast.Name)]
            if "required" in names and isinstance(node.value, ast.Tuple):
                return tuple(
                    value.value
                    for value in node.value.elts
                    if isinstance(value, ast.Constant) and isinstance(value.value, str)
                )
    raise AssertionError("prod env required tuple not found")


def test_prod_env_python_heredoc_survives_groovy_rendering() -> None:
    source = _jenkinsfile_source()
    python_block = _extract_prod_env_python_block(source)
    rendered_python_block = _groovy_triple_single_quoted_render(python_block)

    compile(rendered_python_block, "Jenkinsfile prod env heredoc", "exec")


def test_prod_env_is_validated_before_remote_env_replacement() -> None:
    source = _jenkinsfile_source()
    python_block = _extract_prod_env_python_block(source)
    required = set(_required_tuple_values(python_block))

    assert {
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
        "SECRET_KEY",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_SSL",
        "SMTP_STARTTLS",
        "SMTP_FROM_EMAIL",
        "SMTP_ACCOUNT_LABEL",
    }.issubset(required)
    assert "INCOMING_ENV_FILE_PATH" in source
    assert "Server-local prod SMTP settings fill Jenkins' legacy prod env file." in source
    assert "SMTP_HOST SMTP_PORT SMTP_SSL SMTP_STARTTLS SMTP_USER SMTP_PASS" in source
    assert 'INCOMING_ENV_FILE_PATH="${ENV_FILE_PATH}.incoming.${APP_VERSION}.${BUILD_NUMBER:-manual}"' in source
    assert 'run_ssh "prepare-env-upload"' in source
    assert "rm -f '$INCOMING_ENV_FILE_PATH'" in source
    assert 'chmod u+w "$validated_env_path"' in source
    assert "mv \"$validated_env_path\" \"$ENV_FILE_PATH\"" in source


def test_deploy_execute_checks_frontend_asset_version_after_remote_deploy() -> None:
    source = _jenkinsfile_source()

    assert "assert_frontend_asset_version" in source
    assert "expected_frontend_version=\"${expected_app_version#v}\"" in source
    assert "frontend asset version mismatch" in source


def test_deploy_execute_shell_avoids_groovy_invalid_backslash_escapes() -> None:
    source = _jenkinsfile_source()
    deploy_stage = source[source.index("stage('Deploy Execute')") :]
    next_stage_index = deploy_stage.find("\n    stage(", len("stage('Deploy Execute')"))
    if next_stage_index != -1:
        deploy_stage = deploy_stage[:next_stage_index]

    assert "\\(" not in deploy_stage
    assert "\\/" not in deploy_stage
