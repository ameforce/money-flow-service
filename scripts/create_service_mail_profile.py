from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "infra" / "mail" / "profiles"


@dataclass(frozen=True)
class SmtpPreset:
    host: str
    port: int
    starttls: bool
    ssl: bool


SMTP_PRESETS: dict[str, SmtpPreset] = {
    "ses": SmtpPreset(host="email-smtp.ap-northeast-2.amazonaws.com", port=587, starttls=True, ssl=False),
    "gmail": SmtpPreset(host="smtp.gmail.com", port=587, starttls=True, ssl=False),
    "naver": SmtpPreset(host="smtp.naver.com", port=465, starttls=False, ssl=True),
    "custom": SmtpPreset(host="smtp.example.com", port=587, starttls=True, ssl=False),
}


def sanitize_service_name(raw: str) -> str:
    text = re.sub(r"[^a-z0-9-]+", "-", str(raw or "").strip().lower()).strip("-")
    if not text:
        raise ValueError("service name must contain at least one alphanumeric character")
    return text


def infer_email(service_name: str, domain: str) -> str:
    normalized_domain = str(domain or "").strip().lower()
    if not normalized_domain:
        raise ValueError("domain must not be empty")
    return f"{service_name}@{normalized_domain}"


def validate_email_like(value: str, field_name: str) -> str:
    text = str(value or "").strip().lower()
    if not text or "@" not in text:
        raise ValueError(f"{field_name} must be a valid email-like value")
    return text


def validate_smtp_user(value: str, provider: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("smtp-user must not be empty")
    normalized_provider = str(provider or "").strip().lower()
    if normalized_provider in {"gmail", "naver"} and "@" not in text:
        raise ValueError("smtp-user must be an email-like value for gmail/naver providers")
    return text


def resolve_smtp_preset(provider: str, ses_region: str) -> SmtpPreset:
    normalized_provider = str(provider or "").strip().lower()
    if normalized_provider != "ses":
        return SMTP_PRESETS[normalized_provider]
    region = str(ses_region or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9-]+", region):
        raise ValueError("ses-region must contain only lowercase letters, digits, and hyphens")
    return SmtpPreset(host=f"email-smtp.{region}.amazonaws.com", port=587, starttls=True, ssl=False)


def render_profile_content(
    *,
    service_name: str,
    provider: str,
    smtp_preset: SmtpPreset,
    smtp_user: str,
    from_email: str,
    from_name: str,
    account_label: str,
) -> str:
    starttls = "true" if smtp_preset.starttls else "false"
    ssl = "true" if smtp_preset.ssl else "false"
    return (
        "# Service mail profile template\n"
        f"# service={service_name}\n"
        f"# provider={provider}\n"
        "# Copy this file to a secret-only .env path and fill SMTP_PASS.\n"
        "# Do not commit real credentials.\n"
        "EMAIL_DELIVERY_MODE=smtp\n"
        f"SMTP_HOST={smtp_preset.host}\n"
        f"SMTP_PORT={smtp_preset.port}\n"
        f"SMTP_USER={smtp_user}\n"
        "SMTP_PASS=change_me\n"
        f"SMTP_STARTTLS={starttls}\n"
        f"SMTP_SSL={ssl}\n"
        f"SMTP_FROM_EMAIL={from_email}\n"
        f"SMTP_FROM_NAME={from_name}\n"
        f"SMTP_ACCOUNT_LABEL={account_label}\n"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a service-specific SMTP profile template for multi-service deployments."
    )
    parser.add_argument("--service", required=True, help="service slug (e.g. money-flow, crm-api)")
    parser.add_argument(
        "--provider",
        default="ses",
        choices=sorted(SMTP_PRESETS.keys()),
        help="smtp provider preset",
    )
    parser.add_argument(
        "--ses-region",
        default="ap-northeast-2",
        help="AWS SES region for --provider ses (e.g. ap-northeast-2, us-east-1)",
    )
    parser.add_argument(
        "--domain",
        default="enmsoftware.com",
        help="mail domain used to build default SMTP_USER/SMTP_FROM_EMAIL",
    )
    parser.add_argument(
        "--from-email",
        default="",
        help="override SMTP_FROM_EMAIL value; defaults to <service>@<domain>",
    )
    parser.add_argument(
        "--smtp-user",
        default="",
        help="override SMTP_USER(login id) value; defaults to from-email",
    )
    parser.add_argument(
        "--from-name",
        default="",
        help="override SMTP_FROM_NAME value; defaults to service slug",
    )
    parser.add_argument(
        "--account-label",
        default="",
        help="override SMTP_ACCOUNT_LABEL value; defaults to service slug",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="directory to place generated profile template",
    )
    parser.add_argument("--force", action="store_true", help="overwrite existing template")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    service_name = sanitize_service_name(args.service)
    provider = str(args.provider or "ses").strip().lower()
    smtp_preset = resolve_smtp_preset(provider=provider, ses_region=str(args.ses_region or ""))
    inferred_email = infer_email(service_name, str(args.domain or ""))
    from_email = validate_email_like(args.from_email or inferred_email, "from-email")
    smtp_user = validate_smtp_user(args.smtp_user or from_email, provider)
    from_name = str(args.from_name or service_name).strip()
    account_label = str(args.account_label or service_name).strip()
    if not from_name:
        raise ValueError("from-name must not be empty")
    if not account_label:
        raise ValueError("account-label must not be empty")

    output_dir = Path(str(args.output_dir or "")).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{service_name}.env.example"

    if output_path.exists() and not args.force:
        raise RuntimeError(
            f"profile already exists: {output_path}. Use --force to overwrite."
        )

    content = render_profile_content(
        service_name=service_name,
        provider=provider,
        smtp_preset=smtp_preset,
        smtp_user=smtp_user,
        from_email=from_email,
        from_name=from_name,
        account_label=account_label,
    )
    output_path.write_text(content, encoding="utf-8")

    print(f"[mail-profile] generated: {output_path}")
    print("[mail-profile] next steps:")
    print("1) Copy template to an untracked secret file (.env.local or deployment secret).")
    print("2) Set SMTP_PASS to provider SMTP credential/app password.")
    print("3) Run mail preflight: cmd /c npm run e2e:mail:live")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
