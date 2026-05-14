#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Mapping, NamedTuple
from urllib.parse import quote


PROD_BASE_URL = "https://moneyflow.enmsoftware.com"
DEV_BASE_URL = "https://dev.moneyflow.enmsoftware.com"
PROD_ACCOUNT_LABEL = "money-flow-prod"
PROD_SOURCE_LABEL = "jenkins-prod-smtp-secret"
PROD_SMTP_KEYS = (
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SSL",
    "SMTP_STARTTLS",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM_EMAIL",
    "SMTP_FROM_NAME",
    "SMTP_ACCOUNT_LABEL",
)
PROD_BASE_REQUIRED = ("POSTGRES_USER", "POSTGRES_PASSWORD", "SECRET_KEY")
DEV_SMTP_REQUIRED = ("SMTP_HOST", "SMTP_PORT", "SMTP_SSL", "SMTP_STARTTLS", "SMTP_FROM_EMAIL", "SMTP_ACCOUNT_LABEL")
SECRET_KEYS = {
    "DATABASE_URL",
    "POSTGRES_PASSWORD",
    "SECRET_KEY",
    "SMTP_USER",
    "SMTP_PASS",
}
BLOCKED_PROD_HOSTS = {
    "mailpit",
    "enm-mail-smtp",
    "moneyflow-smtp-local",
    "localhost",
    "127.0.0.1",
    "::1",
}
CAPTURE_PORTS = {1025}


class ValidationError(RuntimeError):
    pass


class ValidationResult(NamedTuple):
    normalized: dict[str, str]
    summary: dict[str, object]


def parse_env_text(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in str(text or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            continue
        values[key] = value.strip().strip("'").strip('"')
    return values


def parse_env_file(path: Path | str) -> dict[str, str]:
    return parse_env_text(Path(path).read_text(encoding="utf-8"))


def write_env_file(path: Path | str, values: Mapping[str, str]) -> None:
    ordered_keys = sorted(values)
    content = "".join(f"{key}={values[key]}\n" for key in ordered_keys)
    Path(path).write_text(content, encoding="utf-8")


def merge_env_files(base: Mapping[str, str], smtp: Mapping[str, str], *, source_label: str) -> dict[str, str]:
    merged = {str(key): str(value) for key, value in base.items() if str(key) not in PROD_SMTP_KEYS}
    for key in PROD_SMTP_KEYS:
        if key in smtp:
            merged[key] = str(smtp[key])
    merged["SMTP_ROUTE_SOURCE"] = source_label
    return merged


def _bool_value(values: Mapping[str, str], key: str, errors: list[str]) -> bool:
    raw = str(values.get(key, "")).strip().lower()
    if raw not in {"true", "false"}:
        errors.append(key)
        return False
    return raw == "true"


def _masked_email(address: str) -> str:
    text = str(address or "").strip()
    if "@" not in text:
        return "***"
    local, domain = text.split("@", 1)
    if len(local) <= 2:
        masked_local = "*" * len(local)
    else:
        masked_local = f"{local[:2]}{'*' * (len(local) - 2)}"
    return f"{masked_local}@{domain}"


def _host_key(host: str) -> str:
    text = str(host or "").strip().lower().strip("[]")
    if text == "::1":
        return text
    if text.count(":") > 1:
        return text
    return text.split(":", 1)[0]


def _classify_host(host: str, *, target_env: str) -> str:
    key = _host_key(host)
    if key in {"enm-mail-smtp", "moneyflow-smtp-local"}:
        return "internal-relay"
    if key in {"mailpit", "localhost", "127.0.0.1", "::1"}:
        return "internal-capture"
    if target_env == "prod" and key in BLOCKED_PROD_HOSTS:
        return "internal-capture"
    return "external-provider"


def _require_present(values: Mapping[str, str], keys: tuple[str, ...], *, label: str) -> None:
    missing = [key for key in keys if not str(values.get(key, "")).strip()]
    if missing:
        raise ValidationError(f"missing {label} env: {' '.join(missing)}")


def _require_if_present(values: Mapping[str, str], key: str, expected: str, errors: list[str]) -> None:
    current = str(values.get(key, "")).strip()
    if current and current != expected:
        errors.append(key)


def _tls_mode(*, ssl_enabled: bool, starttls_enabled: bool) -> str:
    if ssl_enabled:
        return "ssl"
    if starttls_enabled:
        return "starttls"
    return "plaintext"


def validate_route(
    values: Mapping[str, str],
    *,
    target_env: str = "prod",
    source: str = PROD_SOURCE_LABEL,
    source_owner: str = "Jenkins credential owner",
) -> ValidationResult:
    target = str(target_env or "prod").strip().lower()
    if target not in {"prod", "production", "dev"}:
        raise ValidationError(f"unsupported target env: {target_env}")
    is_prod = target in {"prod", "production"}
    normalized: dict[str, str] = {str(key): str(value) for key, value in values.items()}

    if is_prod:
        _require_present(normalized, PROD_BASE_REQUIRED + PROD_SMTP_KEYS, label="prod")
    else:
        _require_present(normalized, DEV_SMTP_REQUIRED, label="dev SMTP")

    errors: list[str] = []
    delivery_mode = str(normalized.get("EMAIL_DELIVERY_MODE", "smtp") or "smtp").strip().lower()
    if delivery_mode != "smtp":
        errors.append("EMAIL_DELIVERY_MODE")

    if is_prod:
        _require_if_present(normalized, "ENV", "prod", errors)
        _require_if_present(normalized, "FRONTEND_BASE_URL", PROD_BASE_URL, errors)
        _require_if_present(normalized, "CORS_ORIGINS", PROD_BASE_URL, errors)
        _require_if_present(normalized, "AUTH_EMAIL_VERIFICATION_REQUIRED", "true", errors)
        _require_if_present(normalized, "AUTH_DEBUG_RETURN_VERIFY_TOKEN", "false", errors)
        if str(normalized.get("SMTP_ACCOUNT_LABEL", "")).strip() != PROD_ACCOUNT_LABEL:
            errors.append("SMTP_ACCOUNT_LABEL")
    else:
        if not str(normalized.get("SMTP_ACCOUNT_LABEL", "")).strip():
            errors.append("SMTP_ACCOUNT_LABEL")

    host = str(normalized.get("SMTP_HOST", "")).strip()
    host_classification = _classify_host(host, target_env="prod" if is_prod else "dev")
    port_text = str(normalized.get("SMTP_PORT", "")).strip()
    try:
        port = int(port_text)
    except ValueError:
        port = 0
        errors.append("SMTP_PORT")
    if port < 1 or port > 65535:
        if "SMTP_PORT" not in errors:
            errors.append("SMTP_PORT")
    if "@" not in str(normalized.get("SMTP_FROM_EMAIL", "")):
        errors.append("SMTP_FROM_EMAIL")

    ssl_enabled = _bool_value(normalized, "SMTP_SSL", errors)
    starttls_enabled = _bool_value(normalized, "SMTP_STARTTLS", errors)
    if ssl_enabled and starttls_enabled:
        errors.extend(["SMTP_SSL", "SMTP_STARTTLS"])

    auth_configured = bool(str(normalized.get("SMTP_USER", "")).strip() or str(normalized.get("SMTP_PASS", "")).strip())
    if is_prod and not auth_configured:
        errors.extend(["SMTP_USER", "SMTP_PASS"])
    if auth_configured and not (ssl_enabled or starttls_enabled):
        errors.append("TLS")
    if is_prod and not (ssl_enabled or starttls_enabled):
        errors.append("TLS")
    if is_prod and port in CAPTURE_PORTS:
        errors.append("SMTP_PORT")
    if is_prod and (_host_key(host) in BLOCKED_PROD_HOSTS or host_classification != "external-provider"):
        errors.append("internal-capture SMTP_HOST")
    if is_prod and str(normalized.get("SMTP_ROUTE_MODE", "direct-provider") or "direct-provider").strip() != "direct-provider":
        errors.append("SMTP_ROUTE_MODE")

    if errors:
        unique = []
        for item in errors:
            if item not in unique:
                unique.append(item)
        raise ValidationError("invalid SMTP route: " + " ".join(unique))

    if is_prod:
        normalized.update(
            {
                "ENV": "prod",
                "POSTGRES_DB": "moneyflow",
                "DATABASE_URL": (
                    "postgresql+psycopg://"
                    f"{quote(normalized['POSTGRES_USER'], safe='')}:"
                    f"{quote(normalized['POSTGRES_PASSWORD'], safe='')}"
                    "@postgres:5432/moneyflow"
                ),
                "CORS_ORIGINS": PROD_BASE_URL,
                "FRONTEND_BASE_URL": PROD_BASE_URL,
                "AUTH_COOKIE_SECURE": "true",
                "AUTH_DEBUG_RETURN_VERIFY_TOKEN": "false",
                "AUTH_EMAIL_VERIFICATION_REQUIRED": "true",
                "FORWARDED_ALLOW_IPS": "172.30.0.0/24,127.0.0.1,::1",
                "EMAIL_DELIVERY_MODE": "smtp",
                "SMTP_ACCOUNT_LABEL": PROD_ACCOUNT_LABEL,
            }
        )

    summary = {
        "environment": "prod" if is_prod else "dev",
        "source": source,
        "source_owner": source_owner,
        "host": host,
        "host_classification": host_classification,
        "port": port,
        "tls_mode": _tls_mode(ssl_enabled=ssl_enabled, starttls_enabled=starttls_enabled),
        "from_email": _masked_email(str(normalized.get("SMTP_FROM_EMAIL", ""))),
        "account_label": str(normalized.get("SMTP_ACCOUNT_LABEL", "")),
        "auth_present": auth_configured,
    }
    return ValidationResult(normalized=normalized, summary=summary)


def route_summary(summary: Mapping[str, object]) -> str:
    return render_summary(summary)


def render_summary(summary: Mapping[str, object]) -> str:
    secret_strings = {key.lower() for key in SECRET_KEYS}
    safe_summary: dict[str, object] = {}
    for key, value in summary.items():
        if str(key).lower() in secret_strings:
            continue
        safe_summary[str(key)] = value
    return json.dumps(safe_summary, ensure_ascii=False, sort_keys=True)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate deployed SMTP route shape without printing secrets.")
    parser.add_argument("env_file", help="base deployment .env file")
    parser.add_argument("--smtp-env-file", default="", help="dedicated SMTP secret file to overlay before validation")
    parser.add_argument("--env", default="prod", choices=("prod", "production", "dev"), help="target environment")
    parser.add_argument("--source", default=PROD_SOURCE_LABEL, help="non-secret source label for route summary")
    parser.add_argument("--source-owner", default="Jenkins credential owner", help="non-secret owner/approver label")
    parser.add_argument("--write-normalized", action="store_true", help="write normalized safe deployment env back to env_file")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    env_file = Path(args.env_file)
    values = parse_env_file(env_file)
    if args.smtp_env_file:
        values = merge_env_files(values, parse_env_file(args.smtp_env_file), source_label=str(args.source))

    try:
        result = validate_route(
            values,
            target_env=str(args.env),
            source=str(args.source),
            source_owner=str(args.source_owner),
        )
    except ValidationError as exc:
        raise SystemExit(f"[deploy] SMTP route validation failed: {exc}") from exc

    if args.write_normalized:
        write_env_file(env_file, result.normalized)
    print("[deploy] smtp route summary: " + render_summary(result.summary), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
