from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "deploy" / "validate_smtp_route.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("validate_smtp_route", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smtp_route = _load_module()


def _valid_prod_env(**overrides: str) -> dict[str, str]:
    env = {
        "POSTGRES_USER": "moneyflow",
        "POSTGRES_PASSWORD": "pg-secret",
        "SECRET_KEY": "app-secret",
        "ENV": "prod",
        "EMAIL_DELIVERY_MODE": "smtp",
        "AUTH_EMAIL_VERIFICATION_REQUIRED": "true",
        "AUTH_DEBUG_RETURN_VERIFY_TOKEN": "false",
        "FRONTEND_BASE_URL": "https://moneyflow.enmsoftware.com",
        "CORS_ORIGINS": "https://moneyflow.enmsoftware.com",
        "SMTP_HOST": "smtp-relay.example.net",
        "SMTP_PORT": "587",
        "SMTP_SSL": "false",
        "SMTP_STARTTLS": "true",
        "SMTP_USER": "prod-user@example.net",
        "SMTP_PASS": "super-secret",
        "SMTP_FROM_EMAIL": "no-reply@enmsoftware.com",
        "SMTP_FROM_NAME": "Money Flow Service",
        "SMTP_ACCOUNT_LABEL": "money-flow-prod",
    }
    env.update(overrides)
    return env


def test_validate_prod_direct_provider_accepts_external_starttls_route() -> None:
    result = smtp_route.validate_route(
        _valid_prod_env(),
        target_env="prod",
        source="jenkins-prod-smtp-secret",
        source_owner="Jenkins credential owner",
    )

    assert result.summary["host_classification"] == "external-provider"
    assert result.summary["tls_mode"] == "starttls"
    assert result.normalized["SMTP_ACCOUNT_LABEL"] == "money-flow-prod"


@pytest.mark.parametrize(
    "host",
    ["enm-mail-smtp", "mailpit", "localhost", "127.0.0.1", "::1", "moneyflow-smtp-local"],
)
def test_validate_prod_rejects_internal_capture_hosts(host: str) -> None:
    with pytest.raises(smtp_route.ValidationError) as excinfo:
        smtp_route.validate_route(_valid_prod_env(SMTP_HOST=host), target_env="prod")

    assert "internal-capture" in str(excinfo.value)
    assert "super-secret" not in str(excinfo.value)


def test_validate_prod_rejects_capture_port_1025() -> None:
    with pytest.raises(smtp_route.ValidationError) as excinfo:
        smtp_route.validate_route(_valid_prod_env(SMTP_PORT="1025"), target_env="prod")

    assert "SMTP_PORT" in str(excinfo.value)


@pytest.mark.parametrize("missing_key", ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_EMAIL"])
def test_validate_prod_rejects_missing_required_smtp_keys(missing_key: str) -> None:
    env = _valid_prod_env()
    env[missing_key] = ""

    with pytest.raises(smtp_route.ValidationError) as excinfo:
        smtp_route.validate_route(env, target_env="prod")

    assert missing_key in str(excinfo.value)


def test_validate_prod_rejects_authenticated_smtp_without_tls() -> None:
    with pytest.raises(smtp_route.ValidationError) as excinfo:
        smtp_route.validate_route(_valid_prod_env(SMTP_SSL="false", SMTP_STARTTLS="false"), target_env="prod")

    assert "TLS" in str(excinfo.value)


def test_validate_prod_rejects_ssl_and_starttls_together() -> None:
    with pytest.raises(smtp_route.ValidationError) as excinfo:
        smtp_route.validate_route(_valid_prod_env(SMTP_SSL="true", SMTP_STARTTLS="true"), target_env="prod")

    assert "SMTP_SSL" in str(excinfo.value)
    assert "SMTP_STARTTLS" in str(excinfo.value)


def test_validate_prod_rejects_wrong_account_label() -> None:
    with pytest.raises(smtp_route.ValidationError) as excinfo:
        smtp_route.validate_route(_valid_prod_env(SMTP_ACCOUNT_LABEL="money-flow-dev"), target_env="prod")

    assert "SMTP_ACCOUNT_LABEL" in str(excinfo.value)


def test_validate_prod_rejects_log_delivery_mode() -> None:
    with pytest.raises(smtp_route.ValidationError) as excinfo:
        smtp_route.validate_route(_valid_prod_env(EMAIL_DELIVERY_MODE="log"), target_env="prod")

    assert "EMAIL_DELIVERY_MODE" in str(excinfo.value)


def test_validate_prod_rejects_non_prod_frontend_base_url() -> None:
    with pytest.raises(smtp_route.ValidationError) as excinfo:
        smtp_route.validate_route(
            _valid_prod_env(FRONTEND_BASE_URL="https://dev.moneyflow.enmsoftware.com"),
            target_env="prod",
        )

    assert "FRONTEND_BASE_URL" in str(excinfo.value)


def test_validate_dev_allows_dev_account_label_but_still_requires_smtp() -> None:
    env = _valid_prod_env(
        ENV="dev",
        FRONTEND_BASE_URL="https://dev.moneyflow.enmsoftware.com",
        CORS_ORIGINS="https://dev.moneyflow.enmsoftware.com",
        SMTP_HOST="enm-mail-smtp",
        SMTP_ACCOUNT_LABEL="money-flow-dev",
    )

    result = smtp_route.validate_route(env, target_env="dev", source="server-local-dev-smtp")

    assert result.summary["host_classification"] == "internal-relay"
    assert result.summary["account_label"] == "money-flow-dev"


def test_route_summary_classifies_external_provider_without_printing_secrets() -> None:
    env = _valid_prod_env(
        SMTP_USER="raw-user@example.net",
        SMTP_PASS="raw-password",
        DATABASE_URL="postgresql://user:pass@db/moneyflow",
        SECRET_KEY="raw-secret-key",
    )

    result = smtp_route.validate_route(env, target_env="prod", source="jenkins-prod-smtp-secret")
    rendered = smtp_route.render_summary(result.summary)

    assert "external-provider" in rendered
    assert "starttls" in rendered
    assert "money-flow-prod" in rendered
    assert "raw-user" not in rendered
    assert "raw-password" not in rendered
    assert "postgresql://" not in rendered
    assert "raw-secret-key" not in rendered


def test_route_summary_masks_private_email_local_part() -> None:
    result = smtp_route.validate_route(
        _valid_prod_env(SMTP_FROM_EMAIL="private-sender@enmsoftware.com"),
        target_env="prod",
    )

    assert result.summary["from_email"] == "pr************@enmsoftware.com"


def test_env_previous_is_not_loaded_as_prod_smtp_source(tmp_path: Path) -> None:
    base = tmp_path / ".env"
    previous = tmp_path / ".env.previous"
    smtp_secret = tmp_path / ".env.prod.smtp"
    base.write_text("\n".join(f"{k}={v}" for k, v in _valid_prod_env().items() if not k.startswith("SMTP_")), encoding="utf-8")
    previous.write_text("SMTP_HOST=mailpit\nSMTP_PORT=1025\n", encoding="utf-8")
    smtp_secret.write_text(
        "SMTP_HOST=smtp-relay.example.net\n"
        "SMTP_PORT=587\n"
        "SMTP_SSL=false\n"
        "SMTP_STARTTLS=true\n"
        "SMTP_USER=prod-user@example.net\n"
        "SMTP_PASS=super-secret\n"
        "SMTP_FROM_EMAIL=no-reply@enmsoftware.com\n"
        "SMTP_FROM_NAME=Money Flow Service\n"
        "SMTP_ACCOUNT_LABEL=money-flow-prod\n",
        encoding="utf-8",
    )

    merged = smtp_route.merge_env_files(
        smtp_route.parse_env_file(base),
        smtp_route.parse_env_file(smtp_secret),
        source_label="jenkins-prod-smtp-secret",
    )
    result = smtp_route.validate_route(merged, target_env="prod")

    assert result.normalized["SMTP_HOST"] == "smtp-relay.example.net"
    assert "mailpit" not in smtp_route.render_summary(result.summary)
    assert previous.read_text(encoding="utf-8") == "SMTP_HOST=mailpit\nSMTP_PORT=1025\n"
