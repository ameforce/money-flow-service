from __future__ import annotations

from pathlib import Path
from typing import Literal
import socket
from urllib.parse import urlparse

from pydantic import Field
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_DEFAULT_SECRET_KEY = "change-this-secret-key-please-at-least-32-bytes"


def _get_local_ips() -> list[str]:
    try:
        hostname = socket.gethostname()
        return socket.gethostbyname_ex(hostname)[2]
    except Exception:
        return []


def _normalize_origin(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "money-flow"
    env: str = "dev"
    api_prefix: str = "/api/v1"
    secret_key: str = Field(min_length=32)
    access_token_minutes: int = 60 * 24
    refresh_token_days: int = 14
    auth_access_cookie_name: str = "mf_access_token"
    auth_refresh_cookie_name: str = "mf_refresh_token"
    auth_csrf_cookie_name: str = "mf_csrf_token"
    auth_csrf_header_name: str = "x-csrf-token"
    auth_cookie_samesite: str = "lax"
    auth_cookie_secure: bool = True
    forwarded_allow_ips: str = "127.0.0.1,::1"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Safer local default. Production should always inject DATABASE_URL explicitly.
    database_url: str = "sqlite:///./dev.db"

    # Market cache
    price_cache_seconds: int = 300
    fx_cache_seconds: int = 300
    price_refresh_concurrency: int = 6
    price_provider_timeout_seconds: float = 4.0
    price_refresh_stale_seconds: int = 120

    # Bootstrap
    default_household_name: str = "찌댕가계"
    default_base_currency: str = "KRW"

    # Workbook defaults
    legacy_workbook_glob: str = "legacy/*.xlsx"
    project_root: str = str(Path(__file__).resolve().parents[3])
    import_allowed_root: str = str(Path(project_root) / "legacy")
    import_max_upload_bytes: int = 20 * 1024 * 1024
    import_max_uncompressed_bytes: int = 120 * 1024 * 1024
    import_max_zip_entries: int = 20000
    import_lock_timeout_seconds: int = 600
    import_max_sheets: int = 64
    import_max_rows_per_sheet: int = 5000
    import_max_columns_per_sheet: int = 64
    import_read_only_mode: bool = True

    # Collaboration / auth hardening
    register_rate_limit_window_seconds: int = 300
    register_rate_limit_max_attempts: int = 10
    register_unverified_ttl_hours: int = 24
    auth_email_verification_required: bool = True
    auth_verification_token_minutes: int = 30
    auth_verification_resend_cooldown_seconds: int = 60
    auth_debug_return_verify_token: bool = False
    household_invitation_token_hours: int = 72
    household_invitation_rate_limit_window_seconds: int = 600
    household_invitation_rate_limit_max_attempts: int = 20
    ws_membership_recheck_seconds: float = 1.0
    frontend_base_url: str = "http://127.0.0.1:5173"

    # Email delivery
    email_delivery_mode: Literal["log", "smtp"] = "log"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_starttls: bool = True
    smtp_ssl: bool = False
    smtp_from_email: str = ""
    smtp_from_name: str = "money-flow"
    smtp_account_label: str = "money-flow-default"

    @property
    def allowed_origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @model_validator(mode="after")
    def validate_secret_key(self) -> "Settings":
        secret_key_trimmed = str(self.secret_key or "").strip()
        if len(secret_key_trimmed) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters after trimming whitespace.")
        self.secret_key = secret_key_trimmed
        normalized = secret_key_trimmed.lower()
        if normalized == INSECURE_DEFAULT_SECRET_KEY:
            raise ValueError("SECRET_KEY must not use the insecure default value.")
        weak_markers = (
            "replace-this-secret-key",
            "change-this-secret",
            "change-this-to-a-random-secret",
            "change_me",
            "your-secret",
        )
        if any(marker in normalized for marker in weak_markers):
            raise ValueError("SECRET_KEY must be set to a strong runtime secret.")
        samesite = str(self.auth_cookie_samesite or "").strip().lower()
        if samesite not in {"lax", "strict", "none"}:
            raise ValueError("AUTH_COOKIE_SAMESITE must be one of: lax, strict, none.")
        self.auth_cookie_samesite = samesite
        if samesite == "none" and not self.auth_cookie_secure:
            raise ValueError("AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAMESITE=none.")
        csrf_header = str(self.auth_csrf_header_name or "").strip().lower()
        if not csrf_header:
            raise ValueError("AUTH_CSRF_HEADER_NAME must not be empty.")
        self.auth_csrf_header_name = csrf_header
        csrf_cookie = str(self.auth_csrf_cookie_name or "").strip()
        if not csrf_cookie:
            raise ValueError("AUTH_CSRF_COOKIE_NAME must not be empty.")
        self.auth_csrf_cookie_name = csrf_cookie
        mode = str(self.email_delivery_mode or "").strip().lower()
        if mode not in {"log", "smtp"}:
            raise ValueError("EMAIL_DELIVERY_MODE must be one of: log, smtp.")
        self.email_delivery_mode = mode
        if mode == "smtp":
            smtp_host = str(self.smtp_host or "").strip()
            if not smtp_host:
                raise ValueError("SMTP_HOST must be set when EMAIL_DELIVERY_MODE=smtp.")
            smtp_from_email = str(self.smtp_from_email or "").strip()
            if not smtp_from_email:
                raise ValueError("SMTP_FROM_EMAIL must be set when EMAIL_DELIVERY_MODE=smtp.")
            smtp_account_label = str(self.smtp_account_label or "").strip()
            if not smtp_account_label:
                raise ValueError("SMTP_ACCOUNT_LABEL must be set when EMAIL_DELIVERY_MODE=smtp.")
            smtp_port = int(self.smtp_port or 0)
            if smtp_port <= 0 or smtp_port > 65535:
                raise ValueError("SMTP_PORT must be a valid TCP port when EMAIL_DELIVERY_MODE=smtp.")
            if self.smtp_ssl and self.smtp_starttls:
                raise ValueError("SMTP_SSL and SMTP_STARTTLS cannot both be true.")
            self.smtp_host = smtp_host
            self.smtp_from_email = smtp_from_email
            self.smtp_port = smtp_port
            self.smtp_account_label = smtp_account_label

        env_name = str(self.env or "").strip().lower()
        is_prod = env_name in {"prod", "production"}

        origins = [_normalize_origin(item) for item in self.allowed_origins]

        if not is_prod:
            local_ips = _get_local_ips()
            allow_ips = [ip.strip() for ip in str(self.forwarded_allow_ips or "").split(",") if ip.strip()]
            for local_ip in local_ips:
                local_origin = f"http://{local_ip}:5173"
                if local_origin not in origins:
                    origins.append(local_origin)
                if local_ip not in allow_ips:
                    allow_ips.append(local_ip)
            self.forwarded_allow_ips = ",".join(allow_ips)

        if not origins or any(not item for item in origins):
            raise ValueError("CORS_ORIGINS must contain valid origin URLs.")
        self.cors_origins = ",".join(origins)
        frontend_origin = _normalize_origin(self.frontend_base_url)
        if not frontend_origin:
            raise ValueError("FRONTEND_BASE_URL must be a valid origin URL.")
        self.frontend_base_url = frontend_origin
        forwarded_allow_ips = ",".join(
            item.strip() for item in str(self.forwarded_allow_ips or "").split(",") if item.strip()
        )
        if not forwarded_allow_ips:
            raise ValueError("FORWARDED_ALLOW_IPS must not be empty.")
        self.forwarded_allow_ips = forwarded_allow_ips
        forwarded_allow_ip_entries = {
            item.strip().lower() for item in forwarded_allow_ips.split(",") if item.strip()
        }
        if is_prod:
            database_url = str(self.database_url or "").strip()
            if not database_url:
                raise ValueError("DATABASE_URL must be explicitly set in production.")
            database_url_lower = database_url.lower()
            if database_url_lower.startswith("sqlite"):
                raise ValueError("DATABASE_URL must not use sqlite in production.")
            if not database_url_lower.startswith("postgresql"):
                raise ValueError("DATABASE_URL must use a postgresql URL in production.")
            if self.auth_debug_return_verify_token:
                raise ValueError("AUTH_DEBUG_RETURN_VERIFY_TOKEN must be false in production.")
            if not self.auth_cookie_secure:
                raise ValueError("AUTH_COOKIE_SECURE must be true in production.")
            if "*" in forwarded_allow_ip_entries:
                raise ValueError("FORWARDED_ALLOW_IPS must not include '*' in production.")
            overly_broad_ranges = {
                "0.0.0.0",
                "0.0.0.0/0",
                "0/0",
                "::",
                "::/0",
                "10.0.0.0/8",
                "172.16.0.0/12",
                "192.168.0.0/16",
                "fc00::/7",
            }
            if forwarded_allow_ip_entries & overly_broad_ranges:
                raise ValueError(
                    "FORWARDED_ALLOW_IPS must not include wildcard/global or overly broad private CIDR ranges "
                    "in production."
                )
            if self.email_delivery_mode == "log":
                raise ValueError("EMAIL_DELIVERY_MODE=log is not allowed in production.")
            if frontend_origin not in origins:
                raise ValueError("FRONTEND_BASE_URL must be included in CORS_ORIGINS in production.")
            blocked_hosts = {"localhost", "127.0.0.1"}
            for origin in origins:
                parsed = urlparse(origin)
                host = str(parsed.hostname or "").lower()
                if host in blocked_hosts:
                    raise ValueError("CORS_ORIGINS must not include localhost/127.0.0.1 in production.")
                if parsed.scheme != "https":
                    raise ValueError("CORS_ORIGINS must use https origins in production.")
            if urlparse(frontend_origin).scheme != "https":
                raise ValueError("FRONTEND_BASE_URL must use https in production.")
        recheck_seconds = float(self.ws_membership_recheck_seconds or 0.0)
        if recheck_seconds <= 0:
            raise ValueError("WS_MEMBERSHIP_RECHECK_SECONDS must be > 0.")
        self.ws_membership_recheck_seconds = max(0.2, recheck_seconds)
        return self


settings = Settings()
