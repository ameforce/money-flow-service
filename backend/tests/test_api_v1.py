from __future__ import annotations

import asyncio
import io
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
import os
from pathlib import Path
import threading
import time
from typing import Any
import uuid

from fastapi.testclient import TestClient as FastAPITestClient
from openpyxl import load_workbook
from pydantic import ValidationError
import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.requests import Request
from starlette.websockets import WebSocketDisconnect


TEST_DB_PATH: Path | None = None
test_database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
if test_database_url:
    os.environ["DATABASE_URL"] = test_database_url
else:
    TEST_DB_PATH = Path(__file__).resolve().parent / f"test_{uuid.uuid4().hex}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-key-should-be-long-enough-1234567890")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("AUTH_DEBUG_RETURN_VERIFY_TOKEN", "true")
os.environ.setdefault("AUTH_COOKIE_SECURE", "false")


class TestClient(FastAPITestClient):
    def request(self, method: str, url: str, **kwargs):  # type: ignore[override]
        return super().request(method, url, **kwargs)


TEST_REQUEST_ORIGIN = "http://127.0.0.1:5173"


def _base_test_headers(*, include_debug_opt_in: bool = True) -> dict[str, str]:
    headers = {"origin": TEST_REQUEST_ORIGIN}
    if include_debug_opt_in:
        headers["x-debug-token-opt-in"] = "true"
    return headers

import app.main as app_main  # noqa: E402
from app.main import app  # noqa: E402
from app.api.routes import auth as auth_route  # noqa: E402
from app.api.routes import household as household_route  # noqa: E402
from app.api.routes import imports as imports_route  # noqa: E402
from app.core.config import INSECURE_DEFAULT_SECRET_KEY, Settings, settings  # noqa: E402
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    hash_opaque_token,
)  # noqa: E402
from app.db.models import (
    AssetType,
    Category,
    EmailVerificationToken,
    FlowType,
    FxRate,
    Holding,
    Household,
    HouseholdInvitation,
    HouseholdMember,
    ImportExecutionLock,
    InvitationStatus,
    MemberRole,
    PriceRefreshStatus,
    PriceSnapshot,
    RevokedToken,
    Transaction,
    User,
)  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.services.email_service import email_service  # noqa: E402
from app.services.importer import ParsedHolding, WorkbookImporter  # noqa: E402
from app.services.runtime import dashboard_service, price_service  # noqa: E402


def _issued_access_token(client: TestClient, payload: dict[str, Any]) -> str:
    token = str(payload.get("access_token") or "").strip()
    if token:
        return token
    cookie_token = str(client.cookies.get(settings.auth_access_cookie_name) or "").strip()
    assert cookie_token
    return cookie_token


def _auth(client: TestClient, email: str, password: str, display_name: str) -> str:
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "display_name": display_name},
        headers=_base_test_headers(),
    )
    assert response.status_code in (200, 201, 409)
    if response.status_code == 409:
        response = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
            headers=_base_test_headers(),
        )
        assert response.status_code == 200
        return _issued_access_token(client, response.json())
    payload = response.json()
    if payload.get("status") == "verification_required":
        token = str(payload.get("debug_verification_token") or "").strip()
        if token:
            verified = client.post(
                "/api/v1/auth/verify-email",
                json={
                    "token": token,
                    "password": password,
                    "display_name": display_name,
                    "remember_me": True,
                },
                headers=_base_test_headers(),
            )
            assert verified.status_code == 200
            return _issued_access_token(client, verified.json())
        logged_in = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
            headers=_base_test_headers(),
        )
        assert logged_in.status_code == 200
        return _issued_access_token(client, logged_in.json())
    return _issued_access_token(client, payload)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", **_base_test_headers()}


def _csrf_headers(client: TestClient) -> dict[str, str]:
    token = str(client.cookies.get(settings.auth_csrf_cookie_name) or "").strip()
    if not token:
        return {}
    return {settings.auth_csrf_header_name: token, **_base_test_headers(include_debug_opt_in=False)}


def _reset_auth_throttle_rows() -> None:
    with SessionLocal() as db:
        db.execute(delete(auth_route.LoginThrottle))
        db.execute(delete(auth_route.RegisterThrottle))
        db.commit()


def teardown_module() -> None:
    engine.dispose()
    if TEST_DB_PATH is not None and TEST_DB_PATH.exists():
        for _ in range(20):
            try:
                TEST_DB_PATH.unlink()
                break
            except PermissionError:
                time.sleep(0.1)


def test_settings_secret_key_fail_fast() -> None:
    previous = os.environ.pop("SECRET_KEY", None)
    try:
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["SECRET_KEY"] = INSECURE_DEFAULT_SECRET_KEY
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["SECRET_KEY"] = "change-this-to-a-random-secret-with-32-plus-bytes"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["SECRET_KEY"] = " " * 64
        with pytest.raises(ValidationError):
            Settings(_env_file=None)
    finally:
        if previous is None:
            os.environ.pop("SECRET_KEY", None)
        else:
            os.environ["SECRET_KEY"] = previous


def test_settings_prod_requires_secure_cookie_and_disables_debug_tokens() -> None:
    tracked_keys = [
        "SECRET_KEY",
        "ENV",
        "AUTH_COOKIE_SECURE",
        "AUTH_DEBUG_RETURN_VERIFY_TOKEN",
    ]
    previous = {key: os.environ.get(key) for key in tracked_keys}
    try:
        os.environ["SECRET_KEY"] = "prod-secret-key-should-be-long-enough-1234567890"
        os.environ["ENV"] = "prod"
        os.environ["AUTH_COOKIE_SECURE"] = "false"
        os.environ["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] = "false"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["AUTH_COOKIE_SECURE"] = "true"
        os.environ["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] = "true"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_settings_prod_disallows_email_log_mode() -> None:
    tracked_keys = [
        "SECRET_KEY",
        "ENV",
        "AUTH_COOKIE_SECURE",
        "AUTH_DEBUG_RETURN_VERIFY_TOKEN",
        "EMAIL_DELIVERY_MODE",
    ]
    previous = {key: os.environ.get(key) for key in tracked_keys}
    try:
        os.environ["SECRET_KEY"] = "prod-secret-key-should-be-long-enough-1234567890"
        os.environ["ENV"] = "prod"
        os.environ["AUTH_COOKIE_SECURE"] = "true"
        os.environ["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] = "false"
        os.environ["EMAIL_DELIVERY_MODE"] = "log"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_settings_prod_disallows_localhost_origins_and_requires_https_frontend() -> None:
    tracked_keys = [
        "SECRET_KEY",
        "ENV",
        "AUTH_COOKIE_SECURE",
        "AUTH_DEBUG_RETURN_VERIFY_TOKEN",
        "EMAIL_DELIVERY_MODE",
        "SMTP_HOST",
        "SMTP_FROM_EMAIL",
        "CORS_ORIGINS",
        "FRONTEND_BASE_URL",
    ]
    previous = {key: os.environ.get(key) for key in tracked_keys}
    try:
        os.environ["SECRET_KEY"] = "prod-secret-key-should-be-long-enough-1234567890"
        os.environ["ENV"] = "prod"
        os.environ["AUTH_COOKIE_SECURE"] = "true"
        os.environ["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] = "false"
        os.environ["EMAIL_DELIVERY_MODE"] = "smtp"
        os.environ["SMTP_HOST"] = "smtp.example.com"
        os.environ["SMTP_FROM_EMAIL"] = "noreply@example.com"
        os.environ["CORS_ORIGINS"] = "http://localhost,http://127.0.0.1"
        os.environ["FRONTEND_BASE_URL"] = "http://localhost"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_settings_prod_requires_explicit_non_sqlite_database_url() -> None:
    tracked_keys = [
        "SECRET_KEY",
        "ENV",
        "AUTH_COOKIE_SECURE",
        "AUTH_DEBUG_RETURN_VERIFY_TOKEN",
        "EMAIL_DELIVERY_MODE",
        "SMTP_HOST",
        "SMTP_FROM_EMAIL",
        "CORS_ORIGINS",
        "FRONTEND_BASE_URL",
        "DATABASE_URL",
    ]
    previous = {key: os.environ.get(key) for key in tracked_keys}
    try:
        os.environ["SECRET_KEY"] = "prod-secret-key-should-be-long-enough-1234567890"
        os.environ["ENV"] = "prod"
        os.environ["AUTH_COOKIE_SECURE"] = "true"
        os.environ["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] = "false"
        os.environ["EMAIL_DELIVERY_MODE"] = "smtp"
        os.environ["SMTP_HOST"] = "smtp.example.com"
        os.environ["SMTP_FROM_EMAIL"] = "noreply@example.com"
        os.environ["CORS_ORIGINS"] = "https://app.example.com"
        os.environ["FRONTEND_BASE_URL"] = "https://app.example.com"

        os.environ.pop("DATABASE_URL", None)
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["DATABASE_URL"] = "sqlite:///./dev.db"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["DATABASE_URL"] = "postgresql+psycopg://user:pass@db:5432/moneyflow"
        Settings(_env_file=None)
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_settings_prod_disallows_wildcard_forwarded_allow_ips() -> None:
    tracked_keys = [
        "SECRET_KEY",
        "ENV",
        "AUTH_COOKIE_SECURE",
        "AUTH_DEBUG_RETURN_VERIFY_TOKEN",
        "EMAIL_DELIVERY_MODE",
        "SMTP_HOST",
        "SMTP_FROM_EMAIL",
        "CORS_ORIGINS",
        "FRONTEND_BASE_URL",
        "DATABASE_URL",
        "FORWARDED_ALLOW_IPS",
    ]
    previous = {key: os.environ.get(key) for key in tracked_keys}
    try:
        os.environ["SECRET_KEY"] = "prod-secret-key-should-be-long-enough-1234567890"
        os.environ["ENV"] = "prod"
        os.environ["AUTH_COOKIE_SECURE"] = "true"
        os.environ["AUTH_DEBUG_RETURN_VERIFY_TOKEN"] = "false"
        os.environ["EMAIL_DELIVERY_MODE"] = "smtp"
        os.environ["SMTP_HOST"] = "smtp.example.com"
        os.environ["SMTP_FROM_EMAIL"] = "noreply@example.com"
        os.environ["CORS_ORIGINS"] = "https://app.example.com"
        os.environ["FRONTEND_BASE_URL"] = "https://app.example.com"
        os.environ["DATABASE_URL"] = "postgresql+psycopg://user:pass@db:5432/moneyflow"

        os.environ["FORWARDED_ALLOW_IPS"] = "*"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["FORWARDED_ALLOW_IPS"] = "0.0.0.0/0,127.0.0.1"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["FORWARDED_ALLOW_IPS"] = "172.30.0.0/24,127.0.0.1,::1"
        Settings(_env_file=None)
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_settings_smtp_mode_requires_host_from_and_valid_port() -> None:
    tracked_keys = [
        "SECRET_KEY",
        "EMAIL_DELIVERY_MODE",
        "SMTP_HOST",
        "SMTP_FROM_EMAIL",
        "SMTP_PORT",
    ]
    previous = {key: os.environ.get(key) for key in tracked_keys}
    try:
        os.environ["SECRET_KEY"] = "dev-secret-key-should-be-long-enough-1234567890"
        os.environ["EMAIL_DELIVERY_MODE"] = "smtp"
        os.environ.pop("SMTP_HOST", None)
        os.environ["SMTP_FROM_EMAIL"] = "noreply@example.com"
        os.environ["SMTP_PORT"] = "587"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["SMTP_HOST"] = "smtp.example.com"
        os.environ.pop("SMTP_FROM_EMAIL", None)
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["SMTP_FROM_EMAIL"] = "noreply@example.com"
        os.environ["SMTP_PORT"] = "70000"
        with pytest.raises(ValidationError):
            Settings(_env_file=None)

        os.environ["SMTP_PORT"] = "587"
        Settings(_env_file=None)
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_email_log_mode_redacts_body(caplog: pytest.LogCaptureFixture) -> None:
    previous_mode = settings.email_delivery_mode
    try:
        settings.email_delivery_mode = "log"
        caplog.clear()
        caplog.set_level("INFO")
        sent = email_service.send_email(
            to_email="mask@example.com",
            subject="mask",
            body_text="https://example.com/#verify_token=sensitive-token",
        )
        assert sent is True
        messages = "\n".join(record.getMessage() for record in caplog.records)
        assert "sensitive-token" not in messages
        assert "verify_token" not in messages
        assert "body_redacted=true" in messages
    finally:
        settings.email_delivery_mode = previous_mode


def test_email_smtp_starttls_uses_explicit_tls_context(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_mode = settings.email_delivery_mode
    previous_host = settings.smtp_host
    previous_port = settings.smtp_port
    previous_ssl = settings.smtp_ssl
    previous_starttls = settings.smtp_starttls
    previous_user = settings.smtp_user
    previous_pass = settings.smtp_pass
    sentinel_context = object()
    captured: dict[str, Any] = {}

    class DummySMTP:
        def __init__(self, host: str, port: int, timeout: int) -> None:
            captured["host"] = host
            captured["port"] = int(port)
            captured["timeout"] = int(timeout)

        def starttls(self, *, context: object | None = None) -> None:
            captured["starttls_context"] = context

        def login(self, user: str, password: str) -> None:
            captured["login_user"] = user
            captured["login_password"] = password

        def send_message(self, _message: Any) -> None:
            captured["sent"] = True

        def quit(self) -> None:
            captured["quit"] = True

    monkeypatch.setattr("app.services.email_service.ssl.create_default_context", lambda: sentinel_context)
    monkeypatch.setattr("app.services.email_service.smtplib.SMTP", DummySMTP)

    try:
        settings.email_delivery_mode = "smtp"
        settings.smtp_host = "smtp.example.com"
        settings.smtp_port = 587
        settings.smtp_ssl = False
        settings.smtp_starttls = True
        settings.smtp_user = "sender@example.com"
        settings.smtp_pass = "app-password"

        sent = email_service.send_email(to_email="receiver@example.com", subject="hello", body_text="world")
        assert sent is True
        assert captured.get("starttls_context") is sentinel_context
    finally:
        settings.email_delivery_mode = previous_mode
        settings.smtp_host = previous_host
        settings.smtp_port = previous_port
        settings.smtp_ssl = previous_ssl
        settings.smtp_starttls = previous_starttls
        settings.smtp_user = previous_user
        settings.smtp_pass = previous_pass


def test_email_smtp_ssl_uses_explicit_tls_context(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_mode = settings.email_delivery_mode
    previous_host = settings.smtp_host
    previous_port = settings.smtp_port
    previous_ssl = settings.smtp_ssl
    previous_starttls = settings.smtp_starttls
    previous_user = settings.smtp_user
    previous_pass = settings.smtp_pass
    sentinel_context = object()
    captured: dict[str, Any] = {}

    class DummySMTPSSL:
        def __init__(self, host: str, port: int, timeout: int, context: object | None = None) -> None:
            captured["host"] = host
            captured["port"] = int(port)
            captured["timeout"] = int(timeout)
            captured["ssl_context"] = context

        def starttls(self, *, context: object | None = None) -> None:
            captured["starttls_context"] = context

        def login(self, user: str, password: str) -> None:
            captured["login_user"] = user
            captured["login_password"] = password

        def send_message(self, _message: Any) -> None:
            captured["sent"] = True

        def quit(self) -> None:
            captured["quit"] = True

    monkeypatch.setattr("app.services.email_service.ssl.create_default_context", lambda: sentinel_context)
    monkeypatch.setattr("app.services.email_service.smtplib.SMTP_SSL", DummySMTPSSL)

    try:
        settings.email_delivery_mode = "smtp"
        settings.smtp_host = "smtp.example.com"
        settings.smtp_port = 465
        settings.smtp_ssl = True
        settings.smtp_starttls = False
        settings.smtp_user = "sender@example.com"
        settings.smtp_pass = "app-password"

        sent = email_service.send_email(to_email="receiver@example.com", subject="hello", body_text="world")
        assert sent is True
        assert captured.get("ssl_context") is sentinel_context
        assert "starttls_context" not in captured
    finally:
        settings.email_delivery_mode = previous_mode
        settings.smtp_host = previous_host
        settings.smtp_port = previous_port
        settings.smtp_ssl = previous_ssl
        settings.smtp_starttls = previous_starttls
        settings.smtp_user = previous_user
        settings.smtp_pass = previous_pass


def test_auth_register_creates_isolated_household() -> None:
    with TestClient(app) as client:
        token_a = _auth(client, "one@example.com", "Password1234", "One")
        token_b = _auth(client, "two@example.com", "Password1234", "Two")

        household_a = client.get("/api/v1/household/current", headers=_headers(token_a))
        household_b = client.get("/api/v1/household/current", headers=_headers(token_b))
        assert household_a.status_code == 200
        assert household_b.status_code == 200

        payload_a = household_a.json()
        payload_b = household_b.json()
        assert payload_a["household"]["id"] != payload_b["household"]["id"]
        assert payload_a["role"] == "owner"
        assert payload_b["role"] == "owner"


def test_auth_register_rejects_blank_display_name() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/register",
            json={
                "email": f"blank-display-{uuid.uuid4().hex}@example.com",
                "password": "Password1234",
                "display_name": "   ",
            },
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "REQUEST_VALIDATION_FAILED"


def test_auth_register_max_display_name_keeps_household_name_within_column_limit() -> None:
    email = f"long-display-{uuid.uuid4().hex}@example.com"
    display_name = "가" * 120
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "Password1234",
                "display_name": display_name,
            },
            headers=_base_test_headers(),
        )
        assert response.status_code == 201

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        assert user.active_household_id
        household = db.get(Household, user.active_household_id)
        assert household is not None
        assert len(household.name) <= 120
        assert household.name.endswith("의 가계부")


def test_auth_verify_email_rejects_blank_display_name() -> None:
    previous_required = settings.auth_email_verification_required
    settings.auth_email_verification_required = True
    try:
        with TestClient(app) as client:
            email = f"blank-verify-display-{uuid.uuid4().hex}@example.com"
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": "Password1234",
                    "display_name": "Verifier",
                },
                headers=_base_test_headers(),
            )
            assert registered.status_code == 201
            verify_token = str(registered.json().get("debug_verification_token") or "").strip()
            assert verify_token

            verified = client.post(
                "/api/v1/auth/verify-email",
                json={
                    "token": verify_token,
                    "password": "Password1234",
                    "display_name": "   ",
                    "remember_me": True,
                },
            )
            assert verified.status_code == 400
            assert verified.json()["error"]["code"] == "REQUEST_VALIDATION_FAILED"
    finally:
        settings.auth_email_verification_required = previous_required


def test_auth_login_with_malformed_password_hash_returns_invalid_credentials() -> None:
    email = f"malformed-hash-{uuid.uuid4().hex}@example.com"
    with TestClient(app) as client:
        _auth(client, email, "Password1234", "MalformedHash")
        with SessionLocal() as db:
            db.execute(
                update(User)
                .where(func.lower(User.email) == email.lower())
                .values(password_hash="scrypt$zz$0011")
                .execution_options(synchronize_session=False)
            )
            db.commit()
        response = client.post(
            "/api/v1/auth/login",
            json={
                "email": email,
                "password": "Password1234",
                "remember_me": True,
            },
            headers=_base_test_headers(),
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"


def test_auth_token_reserved_claims_cannot_be_overridden_by_extra() -> None:
    access = create_access_token(
        "user-access",
        extra={
            "sub": "tampered-sub",
            "typ": "refresh",
            "jti": "tampered-jti",
            "iat": 0,
            "exp": 0,
            "scope": "dashboard:read",
        },
    )
    access_payload = decode_access_token(access)
    assert access_payload["sub"] == "user-access"
    assert access_payload["typ"] == "access"
    assert str(access_payload.get("jti") or "").strip()
    assert int(access_payload["exp"]) > int(access_payload["iat"])
    assert access_payload["scope"] == "dashboard:read"

    refresh = create_refresh_token(
        "user-refresh",
        extra={
            "sub": "tampered-sub",
            "typ": "access",
            "jti": "tampered-jti",
            "iat": 0,
            "exp": 0,
            "scope": "session:rotate",
        },
    )
    refresh_payload = decode_refresh_token(refresh)
    assert refresh_payload["sub"] == "user-refresh"
    assert refresh_payload["typ"] == "refresh"
    assert str(refresh_payload.get("jti") or "").strip()
    assert int(refresh_payload["exp"]) > int(refresh_payload["iat"])
    assert refresh_payload["scope"] == "session:rotate"


def test_auth_register_persists_verification_token_before_email_send(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_required = settings.auth_email_verification_required
    settings.auth_email_verification_required = True
    email = f"verify-order-register-{uuid.uuid4().hex}@example.com"
    observed = {"persisted": False}

    def _fake_send(*, to_email: str, token: str, expires_minutes: int) -> bool:
        assert to_email == email
        assert token
        assert int(expires_minutes) > 0
        with SessionLocal() as check_db:
            user = check_db.scalar(select(User).where(func.lower(User.email) == email.lower()))
            assert user is not None
            pending_token = check_db.scalar(
                select(EmailVerificationToken).where(
                    EmailVerificationToken.user_id == user.id,
                    EmailVerificationToken.consumed_at.is_(None),
                )
            )
            observed["persisted"] = pending_token is not None
        return True

    monkeypatch.setattr(auth_route.email_service, "send_verification_email", _fake_send)
    try:
        with TestClient(app) as client:
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": "Password1234",
                    "display_name": "VerifyOrder",
                },
            )
            assert registered.status_code == 201
            assert registered.json()["status"] == "verification_required"
        assert observed["persisted"] is True
    finally:
        settings.auth_email_verification_required = previous_required


def test_auth_resend_persists_verification_token_before_email_send(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_required = settings.auth_email_verification_required
    previous_cooldown = settings.auth_verification_resend_cooldown_seconds
    settings.auth_email_verification_required = True
    settings.auth_verification_resend_cooldown_seconds = 0
    email = f"verify-order-resend-{uuid.uuid4().hex}@example.com"
    observed = {"persisted": False}

    def _fake_send(*, to_email: str, token: str, expires_minutes: int) -> bool:
        assert to_email == email
        assert token
        assert int(expires_minutes) > 0
        with SessionLocal() as check_db:
            user = check_db.scalar(select(User).where(func.lower(User.email) == email.lower()))
            assert user is not None
            pending_token = check_db.scalar(
                select(EmailVerificationToken).where(
                    EmailVerificationToken.user_id == user.id,
                    EmailVerificationToken.consumed_at.is_(None),
                )
            )
            observed["persisted"] = pending_token is not None
        return True

    try:
        with TestClient(app) as client:
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": "Password1234",
                    "display_name": "VerifyResendOrder",
                },
            )
            assert registered.status_code == 201
            monkeypatch.setattr(auth_route.email_service, "send_verification_email", _fake_send)
            resent = client.post(
                "/api/v1/auth/resend-verification",
                json={"email": email},
                headers=_base_test_headers(),
            )
            assert resent.status_code == 200
            assert resent.json()["status"] == "verification_required"
        assert observed["persisted"] is True
    finally:
        settings.auth_email_verification_required = previous_required
        settings.auth_verification_resend_cooldown_seconds = previous_cooldown


def test_auth_resend_smtp_failure_does_not_block_immediate_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_required = settings.auth_email_verification_required
    previous_mode = settings.email_delivery_mode
    previous_cooldown = settings.auth_verification_resend_cooldown_seconds
    settings.auth_email_verification_required = True
    settings.email_delivery_mode = "log"
    settings.auth_verification_resend_cooldown_seconds = 600
    email = f"verify-resend-smtp-retry-{uuid.uuid4().hex}@example.com"
    call_count = {"send": 0}

    def _flaky_send(*, to_email: str, token: str, expires_minutes: int) -> bool:
        assert to_email == email
        assert token
        assert int(expires_minutes) > 0
        call_count["send"] += 1
        return call_count["send"] >= 2

    try:
        with TestClient(app) as client:
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": "Password1234",
                    "display_name": "ResendSmtpRetry",
                },
            )
            assert registered.status_code == 201

            with SessionLocal() as db:
                user = db.scalar(select(User).where(func.lower(User.email) == email.lower()))
                assert user is not None
                db.query(EmailVerificationToken).filter(
                    EmailVerificationToken.user_id == user.id,
                    EmailVerificationToken.consumed_at.is_(None),
                ).update({"consumed_at": datetime.now(UTC)}, synchronize_session=False)
                db.commit()

            settings.email_delivery_mode = "smtp"
            monkeypatch.setattr(auth_route.email_service, "send_verification_email", _flaky_send)

            first = client.post(
                "/api/v1/auth/resend-verification",
                json={"email": email},
                headers=_base_test_headers(),
            )
            assert first.status_code == 503
            assert first.json()["error"]["code"] == "AUTH_EMAIL_DELIVERY_FAILED"

            second = client.post(
                "/api/v1/auth/resend-verification",
                json={"email": email},
                headers=_base_test_headers(),
            )
            assert second.status_code == 200
            assert second.json()["status"] == "verification_required"
            assert int(call_count["send"]) >= 2
    finally:
        settings.auth_email_verification_required = previous_required
        settings.email_delivery_mode = previous_mode
        settings.auth_verification_resend_cooldown_seconds = previous_cooldown


def test_auth_resend_verification_rate_limit_blocks_repeated_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_required = settings.auth_email_verification_required
    previous_cooldown = settings.auth_verification_resend_cooldown_seconds
    settings.auth_email_verification_required = True
    settings.auth_verification_resend_cooldown_seconds = 0
    monkeypatch.setattr(auth_route, "_RESEND_VERIFICATION_MAX_ATTEMPTS", 2)
    try:
        with TestClient(app) as client:
            email = f"resend-rate-limit-{uuid.uuid4().hex}@example.com"
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": "Password1234",
                    "display_name": "ResendRateLimit",
                },
                headers=_base_test_headers(),
            )
            assert registered.status_code == 201
            assert registered.json()["status"] == "verification_required"

            for _ in range(2):
                accepted = client.post(
                    "/api/v1/auth/resend-verification",
                    json={"email": email},
                    headers=_base_test_headers(),
                )
                assert accepted.status_code == 200

            blocked = client.post(
                "/api/v1/auth/resend-verification",
                json={"email": email},
                headers=_base_test_headers(),
            )
            assert blocked.status_code == 429
            assert blocked.json()["error"]["code"] == "AUTH_RESEND_RATE_LIMITED"
    finally:
        settings.auth_email_verification_required = previous_required
        settings.auth_verification_resend_cooldown_seconds = previous_cooldown


def test_auth_resend_verification_ip_global_rate_limit_blocks_multi_email_flood(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    previous_env = settings.env
    previous_required = settings.auth_email_verification_required
    previous_cooldown = settings.auth_verification_resend_cooldown_seconds
    settings.env = "prod"
    settings.auth_email_verification_required = True
    settings.auth_verification_resend_cooldown_seconds = 0
    monkeypatch.setattr(auth_route, "_resend_ip_max_attempts", lambda: 2)
    _reset_auth_throttle_rows()
    try:
        with TestClient(app) as client:
            for idx in range(2):
                email = f"resend-ip-flood-{idx}-{uuid.uuid4().hex}@example.com"
                registered = client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": email,
                        "password": "Password1234",
                        "display_name": "ResendIpLimit",
                    },
                    headers=_base_test_headers(),
                )
                assert registered.status_code == 201
                accepted = client.post(
                    "/api/v1/auth/resend-verification",
                    json={"email": email},
                    headers=_base_test_headers(),
                )
                assert accepted.status_code == 200

            blocked = client.post(
                "/api/v1/auth/resend-verification",
                json={"email": f"resend-ip-flood-final-{uuid.uuid4().hex}@example.com"},
                headers=_base_test_headers(),
            )
            assert blocked.status_code == 429
            assert blocked.json()["error"]["code"] == "AUTH_RESEND_RATE_LIMITED"
    finally:
        _reset_auth_throttle_rows()
        settings.env = previous_env
        settings.auth_email_verification_required = previous_required
        settings.auth_verification_resend_cooldown_seconds = previous_cooldown


def test_auth_register_retries_when_verification_token_hash_conflicts(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_required = settings.auth_email_verification_required
    settings.auth_email_verification_required = True
    collision_token = "collision-token"
    token_sequence = iter(["bootstrap-secret", collision_token, "fresh-token"])
    monkeypatch.setattr(auth_route, "generate_opaque_token", lambda: next(token_sequence))
    monkeypatch.setattr(auth_route.email_service, "send_verification_email", lambda **_: True)

    with SessionLocal() as db:
        seed_user = User(
            email=f"collision-seed-{uuid.uuid4().hex}@example.com",
            password_hash="seed",
            display_name="Seed",
            email_verified=False,
        )
        db.add(seed_user)
        db.flush()
        db.add(
            EmailVerificationToken(
                user_id=seed_user.id,
                token_hash=hash_opaque_token(collision_token),
                sent_to=seed_user.email,
                expires_at=datetime.now(UTC) + timedelta(minutes=10),
            )
        )
        db.commit()

    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"collision-register-{uuid.uuid4().hex}@example.com",
                    "password": "Password1234",
                    "display_name": "CollisionRetry",
                },
                headers=_base_test_headers(),
            )
            assert response.status_code == 201
            assert response.json()["status"] == "verification_required"
            assert response.json().get("debug_verification_token") == "fresh-token"
    finally:
        settings.auth_email_verification_required = previous_required


def test_auth_register_flush_integrity_error_maps_to_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    original_flush = Session.flush
    state = {"raised": False}

    def _flush_once_with_email_conflict(self: Session, *args: Any, **kwargs: Any):
        if not state["raised"] and any(isinstance(entity, User) for entity in self.new):
            state["raised"] = True
            raise IntegrityError(
                statement="INSERT INTO users (email) VALUES (:email)",
                params={"email": "collision@example.com"},
                orig=Exception("UNIQUE constraint failed: users.email"),
            )
        return original_flush(self, *args, **kwargs)

    monkeypatch.setattr(Session, "flush", _flush_once_with_email_conflict)

    with TestClient(app) as client:
        response = client.post(
            "/api/v1/auth/register",
            json={
                "email": f"flush-race-{uuid.uuid4().hex}@example.com",
                "password": "Password1234",
                "display_name": "FlushRace",
            },
            headers=_base_test_headers(),
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "AUTH_EMAIL_ALREADY_EXISTS"


def test_auth_register_returns_503_when_smtp_send_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_required = settings.auth_email_verification_required
    previous_mode = settings.email_delivery_mode
    settings.auth_email_verification_required = True
    settings.email_delivery_mode = "smtp"
    monkeypatch.setattr(auth_route.email_service, "send_verification_email", lambda **_: False)
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"smtp-fail-register-{uuid.uuid4().hex}@example.com",
                    "password": "Password1234",
                    "display_name": "SmtpFailRegister",
                },
            )
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "AUTH_EMAIL_DELIVERY_FAILED"
    finally:
        settings.auth_email_verification_required = previous_required
        settings.email_delivery_mode = previous_mode


def test_auth_register_smtp_failure_cleans_up_new_unverified_user(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_required = settings.auth_email_verification_required
    previous_mode = settings.email_delivery_mode
    settings.auth_email_verification_required = True
    settings.email_delivery_mode = "smtp"
    email = f"smtp-cleanup-{uuid.uuid4().hex}@example.com"
    monkeypatch.setattr(auth_route.email_service, "send_verification_email", lambda **_: False)
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": "Password1234",
                    "display_name": "SmtpCleanup",
                },
                headers=_base_test_headers(),
            )
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "AUTH_EMAIL_DELIVERY_FAILED"
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.email == email))
            assert user is None
    finally:
        settings.auth_email_verification_required = previous_required
        settings.email_delivery_mode = previous_mode


def test_auth_login_rate_limited_after_repeated_failures() -> None:
    with TestClient(app) as client:
        email = f"rate-limit-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        _auth(client, email, password, "RateLimit")

        for _ in range(5):
            failed = client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": "wrong-password"},
                headers=_base_test_headers(),
            )
            assert failed.status_code == 401

        limited = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "wrong-password"},
            headers=_base_test_headers(),
        )
        assert limited.status_code == 429
        error_payload = limited.json()["error"]
        assert error_payload["code"] == "AUTH_RATE_LIMITED"


def test_auth_login_ip_global_rate_limit_blocks_multi_email_stuffing(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_env = settings.env
    settings.env = "prod"
    monkeypatch.setattr(auth_route, "_LOGIN_IP_MAX_ATTEMPTS", 2)
    _reset_auth_throttle_rows()
    try:
        with TestClient(app) as client:
            for idx in range(2):
                failed = client.post(
                    "/api/v1/auth/login",
                    json={"email": f"ip-stuffing-{idx}-{uuid.uuid4().hex}@example.com", "password": "WrongPassword1234"},
                    headers=_base_test_headers(),
                )
                assert failed.status_code == 401

            blocked = client.post(
                "/api/v1/auth/login",
                json={"email": f"ip-stuffing-final-{uuid.uuid4().hex}@example.com", "password": "WrongPassword1234"},
                headers=_base_test_headers(),
            )
            assert blocked.status_code == 429
            assert blocked.json()["error"]["code"] == "AUTH_RATE_LIMITED"
    finally:
        _reset_auth_throttle_rows()
        settings.env = previous_env


def test_auth_client_config_exposes_runtime_csrf_names() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/auth/client-config")
        assert response.status_code == 200
        payload = response.json()
        assert payload["csrf_cookie_name"] == settings.auth_csrf_cookie_name
        assert payload["csrf_header_name"] == settings.auth_csrf_header_name
        assert payload["household_header_name"] == "x-household-id"


def test_auth_register_rate_limit_enforced_under_parallel_attempts() -> None:
    previous_max = settings.register_rate_limit_max_attempts
    previous_window = settings.register_rate_limit_window_seconds
    settings.register_rate_limit_max_attempts = 1
    settings.register_rate_limit_window_seconds = 300
    try:
        email = f"parallel-register-{uuid.uuid4().hex}@example.com"
        payload = {
            "email": email,
            "password": "Password1234",
            "display_name": "ParallelRegister",
            "remember_me": True,
        }
        start_barrier = threading.Barrier(2)

        def _register_once() -> int:
            with TestClient(app) as worker:
                start_barrier.wait(timeout=3)
                response = worker.post("/api/v1/auth/register", json=payload)
                return int(response.status_code)

        with ThreadPoolExecutor(max_workers=2) as pool:
            future_a = pool.submit(_register_once)
            future_b = pool.submit(_register_once)
            status_codes = sorted([future_a.result(), future_b.result()])

        assert status_codes.count(429) >= 1
        assert status_codes.count(201) <= 1
    finally:
        settings.register_rate_limit_max_attempts = previous_max
        settings.register_rate_limit_window_seconds = previous_window


def test_auth_register_ip_global_rate_limit_blocks_multi_email_signup_flood(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_env = settings.env
    settings.env = "prod"
    monkeypatch.setattr(auth_route, "_register_ip_max_attempts", lambda: 2)
    _reset_auth_throttle_rows()
    try:
        with TestClient(app) as client:
            for idx in range(2):
                accepted = client.post(
                    "/api/v1/auth/register",
                    json={
                        "email": f"ip-register-{idx}-{uuid.uuid4().hex}@example.com",
                        "password": "Password1234",
                        "display_name": "IpRegister",
                    },
                    headers=_base_test_headers(),
                )
                assert accepted.status_code == 201

            blocked = client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"ip-register-final-{uuid.uuid4().hex}@example.com",
                    "password": "Password1234",
                    "display_name": "IpRegister",
                },
                headers=_base_test_headers(),
            )
            assert blocked.status_code == 429
            assert blocked.json()["error"]["code"] == "AUTH_REGISTER_RATE_LIMITED"
    finally:
        _reset_auth_throttle_rows()
        settings.env = previous_env


def test_auth_logout_revokes_access_token() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"logout-{uuid.uuid4().hex}@example.com", "Password1234", "Logout")
        before = client.get("/api/v1/auth/me", headers=_headers(token))
        assert before.status_code == 200

        logout_resp = client.post("/api/v1/auth/logout", headers=_headers(token))
        assert logout_resp.status_code == 200

        after = client.get("/api/v1/auth/me", headers=_headers(token))
        assert after.status_code == 401
        assert after.json()["error"]["code"] == "AUTH_TOKEN_INVALID"


def test_auth_revoked_access_token_rejected_even_with_expired_revoked_row() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"logout-expired-row-{uuid.uuid4().hex}@example.com", "Password1234", "LogoutExpired")
        logout_resp = client.post("/api/v1/auth/logout", headers=_headers(token))
        assert logout_resp.status_code == 200

        jti = str(decode_access_token(token).get("jti") or "").strip()
        assert jti

        with SessionLocal() as db:
            row = db.get(RevokedToken, jti)
            assert row is not None
            row.expires_at = datetime.now(UTC) - timedelta(minutes=5)
            db.commit()

        after = client.get("/api/v1/auth/me", headers=_headers(token))
        assert after.status_code == 401
        assert after.json()["error"]["code"] == "AUTH_TOKEN_INVALID"


def test_auth_cookie_refresh_flow_and_logout_clears_session() -> None:
    with TestClient(app) as client:
        email = f"cookie-refresh-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        registered = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": password,
                "display_name": "Cookie",
                "remember_me": True,
            },
            headers=_base_test_headers(),
        )
        assert registered.status_code == 201
        register_payload = registered.json()
        assert register_payload["status"] == "verification_required"
        verify_token = str(register_payload.get("debug_verification_token") or "")
        assert verify_token

        verified = client.post(
            "/api/v1/auth/verify-email",
            json={
                "token": verify_token,
                "password": password,
                "display_name": "Cookie",
                "remember_me": True,
            },
        )
        assert verified.status_code == 200
        assert settings.auth_access_cookie_name in verified.cookies
        assert settings.auth_refresh_cookie_name in verified.cookies

        me = client.get("/api/v1/auth/me")
        assert me.status_code == 200

        refresh = client.post("/api/v1/auth/refresh", headers=_csrf_headers(client))
        assert refresh.status_code == 200
        set_cookie_values = refresh.headers.get_list("set-cookie")
        assert any(settings.auth_access_cookie_name in item for item in set_cookie_values)
        assert any(settings.auth_refresh_cookie_name in item for item in set_cookie_values)
        me_after_refresh = client.get("/api/v1/auth/me")
        assert me_after_refresh.status_code == 200

        logout_resp = client.post("/api/v1/auth/logout", headers=_csrf_headers(client))
        assert logout_resp.status_code == 200
        assert not client.cookies.get(settings.auth_access_cookie_name)
        assert not client.cookies.get(settings.auth_refresh_cookie_name)
        me_after_logout = client.get("/api/v1/auth/me")
        assert me_after_logout.status_code == 401


def test_auth_login_body_token_requires_opt_in_header() -> None:
    with TestClient(app) as client:
        email = f"login-token-mode-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        _auth(client, email, password, "LoginTokenMode")

        hidden = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
            headers=_base_test_headers(include_debug_opt_in=False),
        )
        assert hidden.status_code == 200
        hidden_payload = hidden.json()
        assert not hidden_payload.get("access_token")
        assert not hidden_payload.get("token_type")

        exposed = client.post(
            "/api/v1/auth/login",
            headers={**_base_test_headers(include_debug_opt_in=False), "x-auth-token-mode": "body"},
            json={"email": email, "password": password},
        )
        assert exposed.status_code == 200
        exposed_payload = exposed.json()
        assert exposed_payload.get("token_type") == "bearer"
        assert exposed_payload.get("access_token")


def test_auth_refresh_body_token_requires_opt_in_header() -> None:
    with TestClient(app) as client:
        _auth(client, f"refresh-token-mode-{uuid.uuid4().hex}@example.com", "Password1234", "RefreshTokenMode")

        hidden = client.post("/api/v1/auth/refresh", headers=_csrf_headers(client))
        assert hidden.status_code == 200
        hidden_payload = hidden.json()
        assert not hidden_payload.get("access_token")
        assert not hidden_payload.get("token_type")

        exposed_headers = {**_csrf_headers(client), "x-auth-token-mode": "body"}
        exposed = client.post("/api/v1/auth/refresh", headers=exposed_headers)
        assert exposed.status_code == 200
        exposed_payload = exposed.json()
        assert exposed_payload.get("token_type") == "bearer"
        assert exposed_payload.get("access_token")


def test_auth_refresh_revokes_previous_access_token() -> None:
    with TestClient(app) as client:
        old_access = _auth(client, f"refresh-revoke-{uuid.uuid4().hex}@example.com", "Password1234", "RefreshRevoke")
        refresh_headers = {**_csrf_headers(client), "x-auth-token-mode": "body"}
        refreshed = client.post("/api/v1/auth/refresh", headers=refresh_headers)
        assert refreshed.status_code == 200
        refreshed_payload = refreshed.json()
        new_access = str(refreshed_payload.get("access_token") or "").strip()
        assert new_access
        assert new_access != old_access

        old_me = client.get("/api/v1/auth/me", headers=_headers(old_access))
        assert old_me.status_code == 401
        assert old_me.json()["error"]["code"] == "AUTH_TOKEN_INVALID"

        new_me = client.get("/api/v1/auth/me", headers=_headers(new_access))
        assert new_me.status_code == 200


def test_auth_body_token_mode_is_blocked_in_prod() -> None:
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/auth/login",
        "headers": [(b"x-auth-token-mode", b"body")],
    }
    request = Request(scope)
    previous_env = settings.env
    try:
        settings.env = "prod"
        assert auth_route._should_include_body_token(request) is False
        settings.env = "dev"
        assert auth_route._should_include_body_token(request) is False
        settings.env = "test"
        assert auth_route._should_include_body_token(request) is True
    finally:
        settings.env = previous_env


def test_auth_refresh_requires_csrf_for_cookie_session() -> None:
    with TestClient(app) as client:
        _auth(client, f"csrf-refresh-{uuid.uuid4().hex}@example.com", "Password1234", "CsrfRefresh")
        denied = client.post("/api/v1/auth/refresh")
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "AUTH_CSRF_INVALID"

        allowed = client.post("/api/v1/auth/refresh", headers=_csrf_headers(client))
        assert allowed.status_code == 200


def test_auth_logout_requires_csrf_even_without_session_cookie() -> None:
    with TestClient(app) as client:
        denied = client.post("/api/v1/auth/logout")
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "AUTH_CSRF_INVALID"


def test_auth_refresh_rejects_disallowed_origin() -> None:
    with TestClient(app) as client:
        _auth(client, f"csrf-origin-{uuid.uuid4().hex}@example.com", "Password1234", "CsrfOrigin")
        headers = {**_csrf_headers(client), "origin": "https://evil.example"}
        blocked = client.post("/api/v1/auth/refresh", headers=headers)
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "AUTH_CSRF_ORIGIN_FORBIDDEN"


def test_auth_login_rejects_disallowed_origin() -> None:
    with TestClient(app) as client:
        email = f"login-origin-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        _auth(client, email, password, "LoginOrigin")
        blocked = client.post(
            "/api/v1/auth/login",
            headers={"origin": "https://evil.example"},
            json={"email": email, "password": password},
        )
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "AUTH_CSRF_ORIGIN_FORBIDDEN"


def test_auth_login_requires_origin_or_referer() -> None:
    with TestClient(app) as client:
        email = f"login-origin-missing-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        _auth(client, email, password, "LoginOriginMissing")
        blocked = client.post(
            "/api/v1/auth/login",
            headers={"origin": ""},
            json={"email": email, "password": password},
        )
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "AUTH_CSRF_ORIGIN_REQUIRED"


def test_cookie_auth_write_routes_require_csrf_headers() -> None:
    with TestClient(app) as client:
        email = f"cookie-write-csrf-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        registered = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": password,
                "display_name": "CookieWriteCsrf",
                "remember_me": True,
            },
            headers=_base_test_headers(),
        )
        assert registered.status_code == 201
        verify_token = str(registered.json().get("debug_verification_token") or "")
        assert verify_token
        verified = client.post(
            "/api/v1/auth/verify-email",
            json={
                "token": verify_token,
                "password": password,
                "display_name": "CookieWriteCsrf",
                "remember_me": True,
            },
        )
        assert verified.status_code == 200

        tx_payload = {
            "occurred_on": str(datetime.now(UTC).date()),
            "flow_type": "expense",
            "amount": 1234,
            "currency": "KRW",
            "memo": "csrf-route",
        }
        blocked_tx = client.post("/api/v1/transactions", json=tx_payload)
        assert blocked_tx.status_code == 403
        assert blocked_tx.json()["error"]["code"] == "AUTH_CSRF_INVALID"
        allowed_tx = client.post("/api/v1/transactions", headers=_csrf_headers(client), json=tx_payload)
        assert allowed_tx.status_code == 201

        shared_symbol = f"CSRF-HOLDING-{uuid.uuid4().hex[:8].upper()}"
        holding_payload = {
            "asset_type": "cash",
            "symbol": shared_symbol,
            "market_symbol": shared_symbol,
            "name": "Csrf Holding",
            "category": "현금성",
            "quantity": 1,
            "average_cost": 1,
            "currency": "KRW",
        }
        blocked_holding = client.post("/api/v1/holdings", json=holding_payload)
        assert blocked_holding.status_code == 403
        assert blocked_holding.json()["error"]["code"] == "AUTH_CSRF_INVALID"
        allowed_holding = client.post("/api/v1/holdings", headers=_csrf_headers(client), json=holding_payload)
        assert allowed_holding.status_code == 201

        invite_payload = {"email": f"cookie-csrf-invite-{uuid.uuid4().hex}@example.com", "role": "viewer"}
        blocked_invite = client.post("/api/v1/household/invitations", json=invite_payload)
        assert blocked_invite.status_code == 403
        assert blocked_invite.json()["error"]["code"] == "AUTH_CSRF_INVALID"
        allowed_invite = client.post("/api/v1/household/invitations", headers=_csrf_headers(client), json=invite_payload)
        assert allowed_invite.status_code == 201

        workbook_path = str(next((Path(__file__).resolve().parents[2] / "legacy").glob("*.xlsx")))
        blocked_import = client.post(
            "/api/v1/imports/workbook",
            json={"mode": "dry_run", "workbook_path": workbook_path},
        )
        assert blocked_import.status_code == 403
        assert blocked_import.json()["error"]["code"] == "AUTH_CSRF_INVALID"
        allowed_import = client.post(
            "/api/v1/imports/workbook",
            headers=_csrf_headers(client),
            json={"mode": "dry_run", "workbook_path": workbook_path},
        )
        assert allowed_import.status_code == 200


def test_auth_refresh_single_use_under_parallel_requests() -> None:
    with TestClient(app) as seed_client:
        _auth(seed_client, f"parallel-refresh-{uuid.uuid4().hex}@example.com", "Password1234", "ParallelRefresh")
        refresh_cookie = str(seed_client.cookies.get(settings.auth_refresh_cookie_name) or "").strip()
        csrf_cookie = str(seed_client.cookies.get(settings.auth_csrf_cookie_name) or "").strip()
        assert refresh_cookie
        assert csrf_cookie

    start_barrier = threading.Barrier(2)

    def _refresh_once() -> dict[str, Any]:
        with TestClient(app) as worker:
            worker.cookies.set(settings.auth_refresh_cookie_name, refresh_cookie, path="/")
            worker.cookies.set(settings.auth_csrf_cookie_name, csrf_cookie, path="/")
            start_barrier.wait(timeout=3)
            response = worker.post(
                "/api/v1/auth/refresh",
                headers={settings.auth_csrf_header_name: csrf_cookie},
            )
            me_status = worker.get("/api/v1/auth/me").status_code
            return {
                "status": int(response.status_code),
                "me_status": int(me_status),
                "set_cookie": response.headers.get_list("set-cookie"),
            }

    with ThreadPoolExecutor(max_workers=2) as pool:
        future_a = pool.submit(_refresh_once)
        future_b = pool.submit(_refresh_once)
        results = [future_a.result(), future_b.result()]

    status_codes = sorted(int(item["status"]) for item in results)
    assert sorted(status_codes) == [200, 401]
    success = next(item for item in results if int(item["status"]) == 200)
    failed = next(item for item in results if int(item["status"]) == 401)
    assert int(success["me_status"]) == 200
    failed_headers = " ".join(str(value) for value in failed["set_cookie"]).lower()
    assert settings.auth_access_cookie_name.lower() not in failed_headers
    assert settings.auth_refresh_cookie_name.lower() not in failed_headers
    assert settings.auth_csrf_cookie_name.lower() not in failed_headers


def test_auth_refresh_invalid_token_clears_auth_cookies() -> None:
    with TestClient(app) as client:
        _auth(client, f"refresh-invalid-{uuid.uuid4().hex}@example.com", "Password1234", "RefreshInvalid")
        csrf_token = str(client.cookies.get(settings.auth_csrf_cookie_name) or "").strip()
        assert csrf_token
        client.cookies.set(settings.auth_refresh_cookie_name, "invalid-refresh-token", path="/")

        failed = client.post(
            "/api/v1/auth/refresh",
            headers={settings.auth_csrf_header_name: csrf_token},
        )
        assert failed.status_code == 401
        assert failed.json()["error"]["code"] == "AUTH_TOKEN_INVALID"

        set_cookie_values = failed.headers.get_list("set-cookie")
        joined = " ".join(set_cookie_values).lower()
        assert settings.auth_access_cookie_name.lower() in joined
        assert settings.auth_refresh_cookie_name.lower() in joined
        assert settings.auth_csrf_cookie_name.lower() in joined
        assert "max-age=0" in joined or "expires=" in joined
        assert any(
            str(value).lower().startswith(f"{settings.auth_access_cookie_name.lower()}=") and "max-age=0" in str(value).lower()
            for value in set_cookie_values
        )
        assert any(
            str(value).lower().startswith(f"{settings.auth_refresh_cookie_name.lower()}=") and "max-age=0" in str(value).lower()
            for value in set_cookie_values
        )
        assert any(
            str(value).lower().startswith(f"{settings.auth_csrf_cookie_name.lower()}=") and "max-age=0" in str(value).lower()
            for value in set_cookie_values
        )


def test_auth_register_unverified_credentials_finalized_at_verify_step() -> None:
    with TestClient(app) as client:
        email = f"register-reuse-{uuid.uuid4().hex}@example.com"
        first_password = "Password1234"
        second_password = "ChangedPassword5678"
        verified_password = "VerifiedPassword9012"
        first = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": first_password,
                "display_name": "OriginalName",
            },
            headers=_base_test_headers(),
        )
        assert first.status_code == 201
        first_payload = first.json()
        assert first_payload["status"] == "verification_required"
        first_token = str(first_payload.get("debug_verification_token") or "").strip()
        assert first_token

        second = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": second_password,
                "display_name": "OverwrittenName",
            },
            headers=_base_test_headers(),
        )
        assert second.status_code == 201
        second_payload = second.json()
        assert second_payload["status"] == "verification_required"
        verify_token = str(second_payload.get("debug_verification_token") or "").strip() or first_token

        verified = client.post(
            "/api/v1/auth/verify-email",
            json={
                "token": verify_token,
                "password": verified_password,
                "display_name": "VerifiedName",
                "remember_me": True,
            },
            headers=_base_test_headers(),
        )
        assert verified.status_code == 200

        login_old = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": first_password},
            headers=_base_test_headers(),
        )
        assert login_old.status_code == 401

        login_new = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": second_password},
            headers=_base_test_headers(),
        )
        assert login_new.status_code == 401

        login_verified = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": verified_password},
            headers=_base_test_headers(),
        )
        assert login_verified.status_code == 200

        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.email == email))
            assert user is not None
            assert user.display_name == "VerifiedName"


def test_auth_register_existing_unverified_parallel_bootstrap_creates_single_household(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = f"register-bootstrap-race-{uuid.uuid4().hex}@example.com"
    password = "Password1234"
    display_name = f"BootstrapRace-{uuid.uuid4().hex[:8]}"
    with TestClient(app) as client:
        first = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": password,
                "display_name": display_name,
            },
            headers=_base_test_headers(),
        )
        assert first.status_code == 201

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        memberships = db.scalars(select(HouseholdMember).where(HouseholdMember.user_id == user.id)).all()
        household_ids = [str(item.household_id or "").strip() for item in memberships if str(item.household_id or "").strip()]
        for item in memberships:
            db.delete(item)
        for household_id in household_ids:
            household = db.get(Household, household_id)
            if household is not None:
                db.delete(household)
        user.active_household_id = None
        db.commit()

    original_create_household = auth_route._create_household_for_user
    create_calls = 0
    create_lock = threading.Lock()
    start_barrier = threading.Barrier(2)

    def slow_create_household(db: Session, user: User) -> Household:
        nonlocal create_calls
        with create_lock:
            create_calls += 1
        time.sleep(0.1)
        return original_create_household(db, user)

    monkeypatch.setattr(auth_route, "_create_household_for_user", slow_create_household)

    def _register_once() -> int:
        with TestClient(app) as worker:
            start_barrier.wait(timeout=3)
            response = worker.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": password,
                    "display_name": display_name,
                },
                headers=_base_test_headers(),
            )
            return int(response.status_code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        future_a = pool.submit(_register_once)
        future_b = pool.submit(_register_once)
        statuses = sorted([future_a.result(), future_b.result()])

    assert statuses == [201, 201]
    assert create_calls >= 1

    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        assert user is not None
        members = db.scalars(select(HouseholdMember).where(HouseholdMember.user_id == user.id)).all()
        assert len(members) == 1
        assert str(user.active_household_id or "").strip() == str(members[0].household_id or "").strip()
        expected_household_name = f"{display_name}{auth_route._HOUSEHOLD_NAME_SUFFIX}"
        created_households = db.scalars(select(Household).where(Household.name == expected_household_name)).all()
        assert len(created_households) == 1


def test_auth_register_without_verification_rehashes_existing_unverified_password() -> None:
    previous_required = settings.auth_email_verification_required
    settings.auth_email_verification_required = True
    try:
        with TestClient(app) as client:
            email = f"register-rehash-{uuid.uuid4().hex}@example.com"
            first_password = "FirstPassword1234"
            second_password = "SecondPassword5678"

            first = client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": first_password,
                    "display_name": "BeforeToggle",
                },
                headers=_base_test_headers(),
            )
            assert first.status_code == 201
            assert first.json()["status"] == "verification_required"

            settings.auth_email_verification_required = False
            second = client.post(
                "/api/v1/auth/register",
                json={
                    "email": email,
                    "password": second_password,
                    "display_name": "AfterToggle",
                },
                headers=_base_test_headers(),
            )
            assert second.status_code == 201
            second_payload = second.json()
            assert second_payload["status"] == "registered"
            assert second_payload["user"]["display_name"] == "AfterToggle"

            logout = client.post("/api/v1/auth/logout", headers=_csrf_headers(client))
            assert logout.status_code == 200

            old_login = client.post(
                "/api/v1/auth/login",
                json={
                    "email": email,
                    "password": first_password,
                    "remember_me": True,
                },
                headers=_base_test_headers(),
            )
            assert old_login.status_code == 401

            new_login = client.post(
                "/api/v1/auth/login",
                json={
                    "email": email,
                    "password": second_password,
                    "remember_me": True,
                },
                headers=_base_test_headers(),
            )
            assert new_login.status_code == 200
            assert new_login.json()["user"]["display_name"] == "AfterToggle"
    finally:
        settings.auth_email_verification_required = previous_required


def test_auth_verify_email_single_use_under_parallel_requests() -> None:
    with TestClient(app) as client:
        email = f"verify-race-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        registered = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": password,
                "display_name": "VerifyRace",
            },
            headers=_base_test_headers(),
        )
        assert registered.status_code == 201
        token = str(registered.json().get("debug_verification_token") or "").strip()
        assert token

    start_barrier = threading.Barrier(2)

    def _verify_once() -> tuple[int, str]:
        with TestClient(app) as worker:
            start_barrier.wait(timeout=3)
            response = worker.post(
                "/api/v1/auth/verify-email",
                json={
                    "token": token,
                    "password": password,
                    "display_name": "VerifyRace",
                    "remember_me": True,
                },
                headers=_base_test_headers(),
            )
            payload = response.json()
            code = str(payload.get("error", {}).get("code") or "")
            return int(response.status_code), code

    with ThreadPoolExecutor(max_workers=2) as pool:
        future_a = pool.submit(_verify_once)
        future_b = pool.submit(_verify_once)
        results = [future_a.result(), future_b.result()]

    status_codes = sorted(item[0] for item in results)
    assert status_codes == [200, 400]
    invalid_result = next(item for item in results if item[0] == 400)
    assert invalid_result[1] == "AUTH_VERIFICATION_TOKEN_INVALID"


def test_auth_register_existing_verified_returns_generic_ack() -> None:
    with TestClient(app) as client:
        email = f"register-enum-{uuid.uuid4().hex}@example.com"
        _auth(client, email, "Password1234", "RegisterEnum")

        repeated = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "Password1234",
                "display_name": "RegisterEnum",
            },
        )
        assert repeated.status_code == 201
        payload = repeated.json()
        assert payload["status"] == "verification_required"
        assert "가입된 계정이 있으면 인증 메일을 발송" in payload["message"]
        assert not payload.get("access_token")
        assert not payload.get("user")


def test_auth_register_expired_unverified_cleanup_removes_orphan_household() -> None:
    with TestClient(app) as client:
        email = f"register-cleanup-{uuid.uuid4().hex}@example.com"
        first = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "Password1234",
                "display_name": "CleanupOne",
            },
        )
        assert first.status_code == 201

        with SessionLocal() as db:
            stale_user = db.scalar(select(User).where(User.email == email))
            assert stale_user is not None
            old_user_id = stale_user.id
            old_household_id = str(stale_user.active_household_id or "").strip()
            assert old_household_id
            stale_user.created_at = datetime.now(UTC) - timedelta(
                hours=max(1, int(settings.register_unverified_ttl_hours)) + 1
            )
            db.commit()

        second = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": "Password1234",
                "display_name": "CleanupTwo",
            },
        )
        assert second.status_code == 201

        with SessionLocal() as db:
            removed_user = db.get(User, old_user_id)
            assert removed_user is None
            removed_household = db.get(Household, old_household_id)
            assert removed_household is None


def test_auth_login_requires_verified_email() -> None:
    with TestClient(app) as client:
        email = f"needs-verify-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        registered = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": password,
                "display_name": "VerifyRequired",
            },
            headers=_base_test_headers(),
        )
        assert registered.status_code == 201
        register_payload = registered.json()
        assert register_payload["status"] == "verification_required"
        verify_token = str(register_payload.get("debug_verification_token") or "")
        assert verify_token

        before_verify_login = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
            headers=_base_test_headers(),
        )
        assert before_verify_login.status_code == 401
        assert before_verify_login.json()["error"]["code"] == "AUTH_INVALID_CREDENTIALS"

        verified = client.post(
            "/api/v1/auth/verify-email",
            json={
                "token": verify_token,
                "password": password,
                "display_name": "VerifyRequired",
                "remember_me": True,
            },
            headers=_base_test_headers(),
        )
        assert verified.status_code == 200

        after_verify_login = client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
            headers=_base_test_headers(),
        )
        assert after_verify_login.status_code == 200


def test_auth_resend_verification_cooldown() -> None:
    with TestClient(app) as client:
        email = f"resend-cooldown-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        registered = client.post(
            "/api/v1/auth/register",
            json={
                "email": email,
                "password": password,
                "display_name": "ResendCooldown",
            },
        )
        assert registered.status_code == 201
        assert registered.json()["status"] == "verification_required"

        throttled = client.post(
            "/api/v1/auth/resend-verification",
            json={"email": email},
            headers=_base_test_headers(),
        )
        assert throttled.status_code == 200
        throttled_payload = throttled.json()
        assert throttled_payload["status"] == "verification_required"
        assert not throttled_payload.get("debug_verification_token")

        previous = settings.auth_verification_resend_cooldown_seconds
        settings.auth_verification_resend_cooldown_seconds = 0
        try:
            resent = client.post(
                "/api/v1/auth/resend-verification",
                json={"email": email},
                headers=_base_test_headers(),
            )
            assert resent.status_code == 200
            payload = resent.json()
            assert payload["status"] == "verification_required"
            assert payload["debug_verification_token"]
        finally:
            settings.auth_verification_resend_cooldown_seconds = previous


def test_auth_register_hides_debug_token_when_disabled() -> None:
    with TestClient(app) as client:
        previous = settings.auth_debug_return_verify_token
        settings.auth_debug_return_verify_token = False
        try:
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"register-nodebug-{uuid.uuid4().hex}@example.com",
                    "password": "Password1234",
                    "display_name": "NoDebug",
                },
            )
            assert registered.status_code == 201
            payload = registered.json()
            assert payload["status"] == "verification_required"
            assert not payload.get("debug_verification_token")
        finally:
            settings.auth_debug_return_verify_token = previous


def test_auth_register_debug_token_requires_opt_in_header_in_dev() -> None:
    with TestClient(app) as client:
        previous_debug = settings.auth_debug_return_verify_token
        previous_env = settings.env
        settings.auth_debug_return_verify_token = True
        settings.env = "dev"
        try:
            email = f"register-optin-{uuid.uuid4().hex}@example.com"
            payload = {
                "email": email,
                "password": "Password1234",
                "display_name": "DebugOptIn",
            }
            no_header = client.post(
                "/api/v1/auth/register",
                json=payload,
                headers={"x-debug-token-opt-in": "false"},
            )
            assert no_header.status_code == 201
            assert no_header.json()["status"] == "verification_required"
            assert not no_header.json().get("debug_verification_token")

            with_header = client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"register-optin-header-{uuid.uuid4().hex}@example.com",
                    "password": "Password1234",
                    "display_name": "DebugOptInHeader",
                },
                headers={"x-debug-token-opt-in": "true"},
            )
            assert with_header.status_code == 201
            assert with_header.json()["status"] == "verification_required"
            assert with_header.json().get("debug_verification_token")
        finally:
            settings.auth_debug_return_verify_token = previous_debug
            settings.env = previous_env


def test_auth_cookie_flags_include_secure_when_enabled() -> None:
    with TestClient(app) as client:
        previous_secure = settings.auth_cookie_secure
        settings.auth_cookie_secure = True
        try:
            registered = client.post(
                "/api/v1/auth/register",
                json={
                    "email": f"cookie-flags-{uuid.uuid4().hex}@example.com",
                    "password": "Password1234",
                    "display_name": "CookieFlags",
                    "remember_me": True,
                },
                headers=_base_test_headers(),
            )
            assert registered.status_code == 201
            verify_token = str(registered.json().get("debug_verification_token") or "")
            assert verify_token

            verified = client.post(
                "/api/v1/auth/verify-email",
                json={
                    "token": verify_token,
                    "password": "Password1234",
                    "display_name": "CookieFlags",
                    "remember_me": True,
                },
            )
            assert verified.status_code == 200
            set_cookie_values = verified.headers.get_list("set-cookie")
            joined = " ".join(set_cookie_values).lower()
            assert "httponly" in joined
            assert "secure" in joined
            assert "samesite=lax" in joined
            csrf_cookie = next(
                str(value).lower()
                for value in set_cookie_values
                if str(value).lower().startswith(f"{settings.auth_csrf_cookie_name.lower()}=")
            )
            assert "max-age=" in csrf_cookie
        finally:
            settings.auth_cookie_secure = previous_secure


def test_auth_remember_me_false_uses_session_access_cookie() -> None:
    with TestClient(app) as client:
        registered = client.post(
            "/api/v1/auth/register",
            json={
                "email": f"cookie-session-{uuid.uuid4().hex}@example.com",
                "password": "Password1234",
                "display_name": "CookieSession",
                "remember_me": False,
            },
            headers=_base_test_headers(),
        )
        assert registered.status_code == 201
        verify_token = str(registered.json().get("debug_verification_token") or "").strip()
        assert verify_token

        verified = client.post(
            "/api/v1/auth/verify-email",
            json={
                "token": verify_token,
                "password": "Password1234",
                "display_name": "CookieSession",
                "remember_me": False,
            },
        )
        assert verified.status_code == 200
        set_cookie_values = verified.headers.get_list("set-cookie")
        lower_values = [str(item).lower() for item in set_cookie_values]
        access_cookie = next(
            item for item in lower_values if item.startswith(f"{settings.auth_access_cookie_name.lower()}=")
        )
        refresh_cookie = next(
            item for item in lower_values if item.startswith(f"{settings.auth_refresh_cookie_name.lower()}=")
        )
        assert "max-age=" not in access_cookie
        assert "expires=" not in access_cookie
        assert "max-age=" not in refresh_cookie


def test_household_invitation_accept_and_switch_household() -> None:
    with TestClient(app) as client:
        owner_email = f"owner-{uuid.uuid4().hex}@example.com"
        guest_email = f"guest-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "Owner")
        token_guest = _auth(client, guest_email, "Password1234", "Guest")

        owner_household = client.get("/api/v1/household/current", headers=_headers(token_owner))
        assert owner_household.status_code == 200
        owner_household_id = owner_household.json()["household"]["id"]

        invite_resp = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invite_resp.status_code == 201
        invite_payload = invite_resp.json()
        invite_token = str(invite_payload.get("debug_invite_token") or "")
        assert invite_token

        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_guest),
            json={"token": invite_token},
        )
        assert accepted.status_code == 200
        assert accepted.json()["status"] == "accepted"

        listed = client.get("/api/v1/household/list", headers=_headers(token_guest))
        assert listed.status_code == 200
        households = listed.json()["households"]
        assert len(households) >= 2
        assert any(item["household"]["id"] == owner_household_id for item in households)

        switched = client.post(
            "/api/v1/household/select",
            headers=_headers(token_guest),
            json={"household_id": owner_household_id},
        )
        assert switched.status_code == 200
        assert switched.json()["role"] == "viewer"

        members = client.get("/api/v1/household/members", headers=_headers(token_guest))
        assert members.status_code == 200
        assert len(members.json()) >= 2


def test_household_invitation_accept_single_use_under_parallel_requests() -> None:
    with TestClient(app) as client:
        owner_email = f"owner-race-{uuid.uuid4().hex}@example.com"
        guest_email = f"guest-race-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "OwnerRace")
        token_guest = _auth(client, guest_email, "Password1234", "GuestRace")
        invite_resp = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invite_resp.status_code == 201
        invite_token = str(invite_resp.json().get("debug_invite_token") or "").strip()
        assert invite_token

    start_barrier = threading.Barrier(2)

    def _accept_once() -> tuple[int, str]:
        with TestClient(app) as worker:
            start_barrier.wait(timeout=3)
            response = worker.post(
                "/api/v1/household/invitations/accept",
                headers=_headers(token_guest),
                json={"token": invite_token},
            )
            payload = response.json()
            code = str(payload.get("error", {}).get("code") or "")
            return int(response.status_code), code

    with ThreadPoolExecutor(max_workers=2) as pool:
        future_a = pool.submit(_accept_once)
        future_b = pool.submit(_accept_once)
        results = [future_a.result(), future_b.result()]

    status_codes = sorted(item[0] for item in results)
    assert status_codes == [200, 400]
    invalid_result = next(item for item in results if item[0] == 400)
    assert invalid_result[1] == "HOUSEHOLD_INVITE_INVALID"


def test_household_invitation_already_processed_not_overwritten_to_expired() -> None:
    with TestClient(app) as client:
        owner_email = f"owner-processed-{uuid.uuid4().hex}@example.com"
        guest_email = f"guest-processed-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "OwnerProcessed")
        token_guest = _auth(client, guest_email, "Password1234", "GuestProcessed")
        invite_resp = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invite_resp.status_code == 201
        invite_token = str(invite_resp.json().get("debug_invite_token") or "").strip()
        assert invite_token

        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_guest),
            json={"token": invite_token},
        )
        assert accepted.status_code == 200

        token_hash = hash_opaque_token(invite_token)
        with SessionLocal() as db:
            invite_row = db.scalar(select(HouseholdInvitation).where(HouseholdInvitation.token_hash == token_hash))
            assert invite_row is not None
            invite_row.expires_at = datetime.now(UTC) - timedelta(days=1)
            db.commit()

        reused = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_guest),
            json={"token": invite_token},
        )
        assert reused.status_code == 400
        assert reused.json()["error"]["code"] == "HOUSEHOLD_INVITE_INVALID"

        with SessionLocal() as db:
            invite_row = db.scalar(select(HouseholdInvitation).where(HouseholdInvitation.token_hash == token_hash))
            assert invite_row is not None
            assert invite_row.status == InvitationStatus.accepted


def test_household_invitation_accept_and_revoke_race_keeps_consistent_state() -> None:
    with TestClient(app) as client:
        owner_email = f"owner-race-revoke-{uuid.uuid4().hex}@example.com"
        guest_email = f"guest-race-revoke-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "OwnerRaceRevoke")
        token_guest = _auth(client, guest_email, "Password1234", "GuestRaceRevoke")
        invite_resp = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invite_resp.status_code == 201
        invite_payload = invite_resp.json()
        invitation_id = str(invite_payload["id"])
        household_id = str(invite_payload["household_id"])
        invite_token = str(invite_payload.get("debug_invite_token") or "").strip()
        assert invite_token

    race_barrier = threading.Barrier(2)

    def _accept_once() -> tuple[int, str]:
        with TestClient(app) as worker:
            race_barrier.wait(timeout=3)
            response = worker.post(
                "/api/v1/household/invitations/accept",
                headers=_headers(token_guest),
                json={"token": invite_token},
            )
            payload = response.json()
            code = str(payload.get("error", {}).get("code") or "")
            return int(response.status_code), code

    def _revoke_once() -> tuple[int, str]:
        with TestClient(app) as worker:
            race_barrier.wait(timeout=3)
            response = worker.delete(
                f"/api/v1/household/invitations/{invitation_id}",
                headers=_headers(token_owner),
            )
            payload = response.json()
            code = str(payload.get("error", {}).get("code") or "")
            return int(response.status_code), code

    with ThreadPoolExecutor(max_workers=2) as pool:
        accept_future = pool.submit(_accept_once)
        revoke_future = pool.submit(_revoke_once)
        accept_status, accept_code = accept_future.result()
        revoke_status, revoke_code = revoke_future.result()

    assert accept_status in {200, 400}
    assert revoke_status in {200, 409}
    if accept_status == 400:
        assert accept_code == "HOUSEHOLD_INVITE_INVALID"
    if revoke_status == 409:
        assert revoke_code == "HOUSEHOLD_INVITE_ALREADY_PROCESSED"

    with SessionLocal() as db:
        invitation = db.get(HouseholdInvitation, invitation_id)
        assert invitation is not None
        guest_user = db.scalar(select(User).where(func.lower(User.email) == guest_email.lower()))
        assert guest_user is not None
        guest_member = db.scalar(
            select(HouseholdMember).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id == guest_user.id,
            )
        )
        if invitation.status == InvitationStatus.accepted:
            assert guest_member is not None
        elif invitation.status == InvitationStatus.revoked:
            assert guest_member is None
        else:
            raise AssertionError(f"unexpected invitation status: {invitation.status}")


def test_household_invitation_rejects_duplicate_display_name_member() -> None:
    with TestClient(app) as client:
        owner_email = f"dup-name-owner-{uuid.uuid4().hex}@example.com"
        guest_email = f"dup-name-guest-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "DupName")
        _auth(client, guest_email, "Password1234", "DupName")

        invited = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invited.status_code == 409
        assert invited.json()["error"]["code"] == "HOUSEHOLD_MEMBER_NAME_CONFLICT"


def test_household_invitation_persists_before_email_send(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        owner_email = f"invite-order-owner-{uuid.uuid4().hex}@example.com"
        guest_email = f"invite-order-guest-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "InviteOrderOwner")
        observed = {"persisted": False}

        def _fake_send(
            *,
            to_email: str,
            inviter_name: str,
            household_name: str,
            token: str,
            expires_minutes: int,
        ) -> bool:
            assert to_email == guest_email
            assert inviter_name
            assert household_name
            assert token
            assert int(expires_minutes) > 0
            with SessionLocal() as check_db:
                pending = check_db.scalar(
                    select(HouseholdInvitation).where(
                        func.lower(HouseholdInvitation.email) == guest_email.lower(),
                        HouseholdInvitation.status == InvitationStatus.pending,
                    )
                )
                observed["persisted"] = pending is not None
            return True

        monkeypatch.setattr(household_route.email_service, "send_household_invitation_email", _fake_send)
        invite_resp = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invite_resp.status_code == 201
        assert observed["persisted"] is True


def test_household_current_rejects_invalid_requested_household_header() -> None:
    with TestClient(app) as client:
        token_first = _auth(client, f"household-first-{uuid.uuid4().hex}@example.com", "Password1234", "FirstHousehold")
        token_second = _auth(client, f"household-second-{uuid.uuid4().hex}@example.com", "Password1234", "SecondHousehold")

        first_current = client.get("/api/v1/household/current", headers=_headers(token_first))
        second_current = client.get("/api/v1/household/current", headers=_headers(token_second))
        assert first_current.status_code == 200
        assert second_current.status_code == 200
        first_household_id = first_current.json()["household"]["id"]
        second_household_id = second_current.json()["household"]["id"]
        assert first_household_id != second_household_id

        denied = client.get(
            "/api/v1/household/current",
            headers={**_headers(token_first), "x-household-id": second_household_id},
        )
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "HOUSEHOLD_ACCESS_FORBIDDEN"

        me_payload = client.get("/api/v1/auth/me", headers=_headers(token_first))
        assert me_payload.status_code == 200
        assert me_payload.json()["active_household_id"] == first_household_id


def test_household_current_get_does_not_persist_fallback_household() -> None:
    with TestClient(app) as client:
        email = f"household-current-nomutate-{uuid.uuid4().hex}@example.com"
        password = "Password1234"
        _auth(client, email, password, "CurrentNoMutate")

        forced_household_id = ""
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.email == email))
            assert user is not None
            unrelated = Household(name=f"Unrelated-{uuid.uuid4().hex[:8]}", base_currency="KRW")
            db.add(unrelated)
            db.flush()
            forced_household_id = str(unrelated.id)
            user.active_household_id = forced_household_id
            db.commit()

        current = client.get("/api/v1/household/current")
        assert current.status_code == 200
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.email == email))
            assert user is not None
            assert str(user.active_household_id or "") == forced_household_id


def test_household_list_invitations_get_does_not_commit_expired_transition() -> None:
    with TestClient(app) as client:
        token = _auth(
            client,
            f"household-inv-list-{uuid.uuid4().hex}@example.com",
            "Password1234",
            "InviteListNoMutate",
        )
        created = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token),
            json={"email": f"invitee-{uuid.uuid4().hex}@example.com", "role": "viewer"},
        )
        assert created.status_code == 201
        invitation_id = str(created.json()["id"])

        with SessionLocal() as db:
            invitation = db.get(HouseholdInvitation, invitation_id)
            assert invitation is not None
            invitation.status = InvitationStatus.pending
            invitation.expires_at = datetime.now(UTC) - timedelta(minutes=1)
            db.commit()

        listed = client.get("/api/v1/household/invitations", headers=_headers(token))
        assert listed.status_code == 200
        entry = next(item for item in listed.json() if str(item.get("id") or "") == invitation_id)
        assert entry["status"] == "expired"

        with SessionLocal() as db:
            invitation = db.get(HouseholdInvitation, invitation_id)
            assert invitation is not None
            assert invitation.status == InvitationStatus.pending


def test_household_invite_requires_co_owner_role() -> None:
    with TestClient(app) as client:
        owner_email = f"owner2-{uuid.uuid4().hex}@example.com"
        guest_email = f"guest2-{uuid.uuid4().hex}@example.com"
        third_email = f"third-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "Owner2")
        token_guest = _auth(client, guest_email, "Password1234", "Guest2")

        invite_resp = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invite_resp.status_code == 201
        invite_token = str(invite_resp.json().get("debug_invite_token") or "")
        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_guest),
            json={"token": invite_token},
        )
        assert accepted.status_code == 200

        owner_household_id = client.get("/api/v1/household/current", headers=_headers(token_owner)).json()["household"]["id"]
        switched = client.post(
            "/api/v1/household/select",
            headers=_headers(token_guest),
            json={"household_id": owner_household_id},
        )
        assert switched.status_code == 200
        assert switched.json()["role"] == "viewer"

        forbidden = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_guest),
            json={"email": third_email, "role": "viewer"},
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "HOUSEHOLD_ROLE_FORBIDDEN"


def test_household_invitation_hides_debug_token_when_disabled() -> None:
    with TestClient(app) as client:
        token_owner = _auth(client, f"invite-nodebug-{uuid.uuid4().hex}@example.com", "Password1234", "InviteNoDebug")
        previous = settings.auth_debug_return_verify_token
        settings.auth_debug_return_verify_token = False
        try:
            invite = client.post(
                "/api/v1/household/invitations",
                headers=_headers(token_owner),
                json={"email": f"invitee-{uuid.uuid4().hex}@example.com", "role": "viewer"},
            )
            assert invite.status_code == 201
            assert not invite.json().get("debug_invite_token")
        finally:
            settings.auth_debug_return_verify_token = previous


def test_household_invitation_debug_token_requires_opt_in_header_in_dev() -> None:
    with TestClient(app) as client:
        token_owner = _auth(client, f"invite-optin-owner-{uuid.uuid4().hex}@example.com", "Password1234", "InviteOptIn")
        previous_debug = settings.auth_debug_return_verify_token
        previous_env = settings.env
        settings.auth_debug_return_verify_token = True
        settings.env = "dev"
        try:
            without_header = client.post(
                "/api/v1/household/invitations",
                headers={**_headers(token_owner), "x-debug-token-opt-in": "false"},
                json={"email": f"invite-optin-a-{uuid.uuid4().hex}@example.com", "role": "viewer"},
            )
            assert without_header.status_code == 201
            assert not without_header.json().get("debug_invite_token")

            with_header = client.post(
                "/api/v1/household/invitations",
                headers={**_headers(token_owner), "x-debug-token-opt-in": "true"},
                json={"email": f"invite-optin-b-{uuid.uuid4().hex}@example.com", "role": "viewer"},
            )
            assert with_header.status_code == 201
            assert with_header.json().get("debug_invite_token")
        finally:
            settings.auth_debug_return_verify_token = previous_debug
            settings.env = previous_env


def test_household_owner_transfer_and_last_owner_guard() -> None:
    with TestClient(app) as client:
        owner_email = f"owner3-{uuid.uuid4().hex}@example.com"
        partner_email = f"partner3-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "Owner3")
        token_partner = _auth(client, partner_email, "Password1234", "Partner3")

        invite = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": partner_email, "role": "co_owner"},
        )
        assert invite.status_code == 201
        invite_token = str(invite.json().get("debug_invite_token") or "")
        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_partner),
            json={"token": invite_token},
        )
        assert accepted.status_code == 200

        owner_household_id = client.get("/api/v1/household/current", headers=_headers(token_owner)).json()["household"]["id"]
        switched = client.post(
            "/api/v1/household/select",
            headers=_headers(token_partner),
            json={"household_id": owner_household_id},
        )
        assert switched.status_code == 200

        members = client.get("/api/v1/household/members", headers=_headers(token_owner))
        assert members.status_code == 200
        partner_member = next(item for item in members.json() if item["email"] == partner_email)
        owner_member = next(item for item in members.json() if item["email"] == owner_email)

        transfer = client.patch(
            f"/api/v1/household/members/{partner_member['member_id']}/role",
            headers=_headers(token_owner),
            json={"role": "owner"},
        )
        assert transfer.status_code == 200
        assert transfer.json()["role"] == "owner"

        owner_after = client.patch(
            f"/api/v1/household/members/{partner_member['member_id']}/role",
            headers=_headers(token_partner),
            json={"role": "viewer"},
        )
        assert owner_after.status_code == 409
        assert owner_after.json()["error"]["code"] == "HOUSEHOLD_OWNER_REQUIRED"

        remove_old_owner = client.delete(
            f"/api/v1/household/members/{owner_member['member_id']}",
            headers=_headers(token_partner),
        )
        assert remove_old_owner.status_code == 200


def test_household_parallel_owner_demotion_keeps_at_least_one_owner() -> None:
    with TestClient(app) as client:
        owner_email = f"owner-race-{uuid.uuid4().hex}@example.com"
        partner_email = f"partner-race-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "OwnerRace")
        token_partner = _auth(client, partner_email, "Password1234", "PartnerRace")

        invite = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": partner_email, "role": "co_owner"},
        )
        assert invite.status_code == 201
        invite_token = str(invite.json().get("debug_invite_token") or "")
        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_partner),
            json={"token": invite_token},
        )
        assert accepted.status_code == 200

        owner_household_id = client.get("/api/v1/household/current", headers=_headers(token_owner)).json()["household"]["id"]
        household_headers_owner = {**_headers(token_owner), "x-household-id": owner_household_id}
        household_headers_partner = {**_headers(token_partner), "x-household-id": owner_household_id}

        members_before = client.get("/api/v1/household/members", headers=household_headers_owner)
        assert members_before.status_code == 200
        owner_member = next(item for item in members_before.json() if item["email"] == owner_email)
        partner_member = next(item for item in members_before.json() if item["email"] == partner_email)

        promote_partner = client.patch(
            f"/api/v1/household/members/{partner_member['member_id']}/role",
            headers=household_headers_owner,
            json={"role": "owner"},
        )
        assert promote_partner.status_code == 200

    race_barrier = threading.Barrier(2)

    def _demote_once(actor_token: str, target_member_id: str) -> int:
        with TestClient(app) as worker:
            race_barrier.wait(timeout=3)
            response = worker.patch(
                f"/api/v1/household/members/{target_member_id}/role",
                headers={**_headers(actor_token), "x-household-id": owner_household_id},
                json={"role": "viewer"},
            )
            return int(response.status_code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        future_a = pool.submit(_demote_once, token_owner, partner_member["member_id"])
        future_b = pool.submit(_demote_once, token_partner, owner_member["member_id"])
        status_codes = [future_a.result(), future_b.result()]

    assert status_codes.count(200) == 1
    assert any(code in {403, 409} for code in status_codes)

    with SessionLocal() as db:
        owner_count = db.scalar(
            select(func.count())
            .select_from(HouseholdMember)
            .where(HouseholdMember.household_id == owner_household_id, HouseholdMember.role == MemberRole.owner)
        )
        assert int(owner_count or 0) >= 1


def test_household_parallel_invite_creation_keeps_single_pending_invitation() -> None:
    with TestClient(app) as client:
        owner_email = f"invite-owner-{uuid.uuid4().hex}@example.com"
        co_owner_email = f"invite-co-owner-{uuid.uuid4().hex}@example.com"
        invitee_email = f"invitee-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "InviteOwner")
        token_co_owner = _auth(client, co_owner_email, "Password1234", "InviteCoOwner")

        invite = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": co_owner_email, "role": "co_owner"},
        )
        assert invite.status_code == 201
        invite_token = str(invite.json().get("debug_invite_token") or "")
        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_co_owner),
            json={"token": invite_token},
        )
        assert accepted.status_code == 200

        household_id = client.get("/api/v1/household/current", headers=_headers(token_owner)).json()["household"]["id"]

    start_barrier = threading.Barrier(2)

    def _create_invitation_once(actor_token: str) -> int:
        with TestClient(app) as worker:
            start_barrier.wait(timeout=3)
            response = worker.post(
                "/api/v1/household/invitations",
                headers={**_headers(actor_token), "x-household-id": household_id},
                json={"email": invitee_email, "role": "viewer"},
            )
            return int(response.status_code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        future_a = pool.submit(_create_invitation_once, token_owner)
        future_b = pool.submit(_create_invitation_once, token_co_owner)
        status_codes = sorted([future_a.result(), future_b.result()])

    assert status_codes == [201, 201]

    with SessionLocal() as db:
        invites = db.scalars(
            select(HouseholdInvitation).where(
                HouseholdInvitation.household_id == household_id,
                HouseholdInvitation.email == invitee_email,
            )
        ).all()
        pending_count = sum(1 for item in invites if item.status == InvitationStatus.pending)
        assert pending_count == 1
    assert not household_route._invite_lock_registry


def test_household_invitation_rate_limited_per_actor_window() -> None:
    previous_window = settings.household_invitation_rate_limit_window_seconds
    previous_max = settings.household_invitation_rate_limit_max_attempts
    settings.household_invitation_rate_limit_window_seconds = 600
    settings.household_invitation_rate_limit_max_attempts = 1
    try:
        with TestClient(app) as client:
            token_owner = _auth(
                client,
                f"invite-ratelimit-owner-{uuid.uuid4().hex}@example.com",
                "Password1234",
                "InviteRateLimitOwner",
            )
            first = client.post(
                "/api/v1/household/invitations",
                headers=_headers(token_owner),
                json={"email": f"invite-ratelimit-a-{uuid.uuid4().hex}@example.com", "role": "viewer"},
            )
            assert first.status_code == 201

            second = client.post(
                "/api/v1/household/invitations",
                headers=_headers(token_owner),
                json={"email": f"invite-ratelimit-b-{uuid.uuid4().hex}@example.com", "role": "viewer"},
            )
            assert second.status_code == 429
            assert second.json()["error"]["code"] == "HOUSEHOLD_INVITE_RATE_LIMITED"
    finally:
        settings.household_invitation_rate_limit_window_seconds = previous_window
        settings.household_invitation_rate_limit_max_attempts = previous_max


def test_household_invitation_returns_503_when_smtp_send_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_mode = settings.email_delivery_mode
    try:
        with TestClient(app) as client:
            owner_token = _auth(
                client,
                f"invite-smtp-owner-{uuid.uuid4().hex}@example.com",
                "Password1234",
                "InviteSmtpOwner",
            )
            settings.email_delivery_mode = "smtp"
            monkeypatch.setattr(household_route.email_service, "send_household_invitation_email", lambda **_: False)
            response = client.post(
                "/api/v1/household/invitations",
                json={"email": f"invite-smtp-target-{uuid.uuid4().hex}@example.com", "role": "viewer"},
                headers=_headers(owner_token),
            )
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "HOUSEHOLD_INVITE_EMAIL_DELIVERY_FAILED"
    finally:
        settings.email_delivery_mode = previous_mode


def test_household_invitation_smtp_failure_allows_immediate_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    previous_mode = settings.email_delivery_mode
    previous_window = settings.household_invitation_rate_limit_window_seconds
    previous_max = settings.household_invitation_rate_limit_max_attempts
    settings.household_invitation_rate_limit_window_seconds = 600
    settings.household_invitation_rate_limit_max_attempts = 1
    attempts = {"count": 0}

    def _send_stub(**_: Any) -> bool:
        attempts["count"] += 1
        return attempts["count"] > 1

    try:
        with TestClient(app) as client:
            owner_token = _auth(
                client,
                f"invite-retry-owner-{uuid.uuid4().hex}@example.com",
                "Password1234",
                "InviteRetryOwner",
            )
            settings.email_delivery_mode = "smtp"
            target_email = f"invite-retry-target-{uuid.uuid4().hex}@example.com"
            monkeypatch.setattr(household_route.email_service, "send_household_invitation_email", _send_stub)

            first = client.post(
                "/api/v1/household/invitations",
                json={"email": target_email, "role": "viewer"},
                headers=_headers(owner_token),
            )
            assert first.status_code == 503
            assert first.json()["error"]["code"] == "HOUSEHOLD_INVITE_EMAIL_DELIVERY_FAILED"

            second = client.post(
                "/api/v1/household/invitations",
                json={"email": target_email, "role": "viewer"},
                headers=_headers(owner_token),
            )
            assert second.status_code == 201

            with SessionLocal() as db:
                invites = db.scalars(
                    select(HouseholdInvitation).where(
                        HouseholdInvitation.inviter_user_id == decode_access_token(owner_token)["sub"],
                        func.lower(HouseholdInvitation.email) == target_email.lower(),
                    )
                ).all()
            assert any(item.status == InvitationStatus.revoked for item in invites)
            assert sum(1 for item in invites if item.status == InvitationStatus.pending) == 1
    finally:
        settings.email_delivery_mode = previous_mode
        settings.household_invitation_rate_limit_window_seconds = previous_window
        settings.household_invitation_rate_limit_max_attempts = previous_max


def test_ws_ticket_cannot_be_used_as_api_bearer_token() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"ws-ticket-{uuid.uuid4().hex}@example.com", "Password1234", "WsTicket")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = current.json()["household"]["id"]

        ticket_resp = client.post("/api/v1/household/ws-ticket", headers=_headers(token))
        assert ticket_resp.status_code == 200
        ticket = ticket_resp.json()["ticket"]

        me_with_ticket = client.get("/api/v1/auth/me", headers=_headers(ticket))
        assert me_with_ticket.status_code == 401
        assert me_with_ticket.json()["error"]["code"] == "AUTH_TOKEN_INVALID"

        with client.websocket_connect(
            f"/ws/v1/household/{household_id}",
            subprotocols=[f"ticket.{ticket}"],
        ) as ws:
            ws.send_text("ping")
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                f"/ws/v1/household/{household_id}",
                subprotocols=[f"ticket.{ticket}"],
            ) as ws:
                ws.send_text("ping")


def test_ws_ticket_query_string_fallback_is_rejected() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"ws-query-{uuid.uuid4().hex}@example.com", "Password1234", "WsQuery")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = current.json()["household"]["id"]

        ticket_resp = client.post("/api/v1/household/ws-ticket", headers=_headers(token))
        assert ticket_resp.status_code == 200
        ticket = ticket_resp.json()["ticket"]

        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f"/ws/v1/household/{household_id}?ticket={ticket}") as ws:
                ws.send_text("ping")


def test_ws_connection_closed_after_member_removed() -> None:
    with TestClient(app) as client:
        owner_email = f"ws-owner-{uuid.uuid4().hex}@example.com"
        guest_email = f"ws-guest-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "WsOwner")
        token_guest = _auth(client, guest_email, "Password1234", "WsGuest")

        invite = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invite.status_code == 201
        invite_token = str(invite.json().get("debug_invite_token") or "")
        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_guest),
            json={"token": invite_token},
        )
        assert accepted.status_code == 200

        owner_household_id = client.get("/api/v1/household/current", headers=_headers(token_owner)).json()["household"]["id"]
        switched = client.post(
            "/api/v1/household/select",
            headers=_headers(token_guest),
            json={"household_id": owner_household_id},
        )
        assert switched.status_code == 200

        members = client.get("/api/v1/household/members", headers=_headers(token_owner))
        assert members.status_code == 200
        guest_member = next(item for item in members.json() if item["email"] == guest_email)

        ticket_resp = client.post("/api/v1/household/ws-ticket", headers=_headers(token_guest))
        assert ticket_resp.status_code == 200
        ticket = ticket_resp.json()["ticket"]

        with client.websocket_connect(
            f"/ws/v1/household/{owner_household_id}",
            subprotocols=[f"ticket.{ticket}"],
        ) as ws:
            removed = client.delete(
                f"/api/v1/household/members/{guest_member['member_id']}",
                headers=_headers(token_owner),
            )
            assert removed.status_code == 200
            with pytest.raises((WebSocketDisconnect, RuntimeError)):
                ws.receive_text()


def test_ws_connection_closed_when_membership_removed_outside_local_hub(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ws_membership_recheck_seconds", 0.2)
    with TestClient(app) as client:
        owner_email = f"ws-orphan-owner-{uuid.uuid4().hex}@example.com"
        guest_email = f"ws-orphan-guest-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "WsOrphanOwner")
        token_guest = _auth(client, guest_email, "Password1234", "WsOrphanGuest")

        invite = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invite.status_code == 201
        invite_token = str(invite.json().get("debug_invite_token") or "")
        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_guest),
            json={"token": invite_token},
        )
        assert accepted.status_code == 200

        owner_household_id = client.get("/api/v1/household/current", headers=_headers(token_owner)).json()["household"]["id"]
        switched = client.post(
            "/api/v1/household/select",
            headers=_headers(token_guest),
            json={"household_id": owner_household_id},
        )
        assert switched.status_code == 200

        members = client.get("/api/v1/household/members", headers=_headers(token_owner))
        assert members.status_code == 200
        guest_member = next(item for item in members.json() if item["email"] == guest_email)

        ticket_resp = client.post("/api/v1/household/ws-ticket", headers=_headers(token_guest))
        assert ticket_resp.status_code == 200
        ticket = ticket_resp.json()["ticket"]

        with client.websocket_connect(
            f"/ws/v1/household/{owner_household_id}",
            subprotocols=[f"ticket.{ticket}"],
        ) as ws:
            # Simulate membership removal in another worker where local hub disconnect is not called.
            with SessionLocal() as db:
                member = db.get(HouseholdMember, guest_member["member_id"])
                assert member is not None
                db.delete(member)
                db.commit()
            with pytest.raises((WebSocketDisconnect, RuntimeError)):
                ws.receive_text()


def test_ws_preissued_ticket_rejected_after_member_removed() -> None:
    with TestClient(app) as client:
        owner_email = f"ws-reissue-owner-{uuid.uuid4().hex}@example.com"
        guest_email = f"ws-reissue-guest-{uuid.uuid4().hex}@example.com"
        token_owner = _auth(client, owner_email, "Password1234", "WsReissueOwner")
        token_guest = _auth(client, guest_email, "Password1234", "WsReissueGuest")

        invite = client.post(
            "/api/v1/household/invitations",
            headers=_headers(token_owner),
            json={"email": guest_email, "role": "viewer"},
        )
        assert invite.status_code == 201
        invite_token = str(invite.json().get("debug_invite_token") or "")
        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(token_guest),
            json={"token": invite_token},
        )
        assert accepted.status_code == 200

        owner_household_id = client.get("/api/v1/household/current", headers=_headers(token_owner)).json()["household"]["id"]
        switched = client.post(
            "/api/v1/household/select",
            headers=_headers(token_guest),
            json={"household_id": owner_household_id},
        )
        assert switched.status_code == 200

        members = client.get("/api/v1/household/members", headers=_headers(token_owner))
        assert members.status_code == 200
        guest_member = next(item for item in members.json() if item["email"] == guest_email)

        ticket_resp = client.post("/api/v1/household/ws-ticket", headers=_headers(token_guest))
        assert ticket_resp.status_code == 200
        ticket = ticket_resp.json()["ticket"]

        removed = client.delete(
            f"/api/v1/household/members/{guest_member['member_id']}",
            headers=_headers(token_owner),
        )
        assert removed.status_code == 200

        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                f"/ws/v1/household/{owner_household_id}",
                subprotocols=[f"ticket.{ticket}"],
            ) as ws:
                ws.send_text("ping")


def test_holding_create_rejects_invalid_currency_and_blank_text_fields() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"holding-validate-{uuid.uuid4().hex}@example.com", "Password1234", "HoldingV")

        invalid_currency = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "stock",
                "symbol": "AAPL",
                "market_symbol": "AAPL",
                "name": "Apple",
                "category": "주식",
                "quantity": 1,
                "average_cost": 100,
                "currency": "   ",
            },
        )
        assert invalid_currency.status_code == 400

        blank_symbol = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "stock",
                "symbol": "   ",
                "market_symbol": "AAPL",
                "name": "Apple",
                "category": "주식",
                "quantity": 1,
                "average_cost": 100,
                "currency": "USD",
            },
        )
        assert blank_symbol.status_code == 400


def test_holding_owner_must_be_household_member() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"holding-owner-{uuid.uuid4().hex}@example.com", "Password1234", "HoldingOwner")
        created = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "cash",
                "symbol": "KRW-CASH-OWNER",
                "market_symbol": "KRW-CASH-OWNER",
                "name": "OwnerPolicy",
                "category": "현금성",
                "owner_name": "NotMember",
                "quantity": 1,
                "average_cost": 1000,
                "currency": "KRW",
            },
        )
        assert created.status_code == 400
        assert created.json()["error"]["code"] == "HOLDING_OWNER_INVALID"

        valid = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "cash",
                "symbol": "KRW-CASH-OWNER-VALID",
                "market_symbol": "KRW-CASH-OWNER-VALID",
                "name": "OwnerPolicyValid",
                "category": "현금성",
                "owner_name": "HoldingOwner",
                "quantity": 1,
                "average_cost": 1000,
                "currency": "KRW",
            },
        )
        assert valid.status_code == 201
        payload = valid.json()

        patched = client.patch(
            f"/api/v1/holdings/{payload['id']}",
            headers=_headers(token),
            json={"base_version": payload["version"], "owner_name": "UnknownMember"},
        )
        assert patched.status_code == 400
        assert patched.json()["error"]["code"] == "HOLDING_OWNER_INVALID"


def test_holding_owner_rejects_ambiguous_member_display_name() -> None:
    with TestClient(app) as client:
        owner_email = f"holding-amb-owner-{uuid.uuid4().hex}@example.com"
        token = _auth(client, owner_email, "Password1234", "DupHolder")
        household_id = ""
        with SessionLocal() as db:
            owner = db.scalar(select(User).where(User.email == owner_email))
            assert owner is not None
            member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == owner.id))
            assert member is not None
            household_id = str(member.household_id)
            duplicate_user = User(
                email=f"holding-amb-guest-{uuid.uuid4().hex}@example.com",
                password_hash="not-used",
                display_name="DupHolder",
                email_verified=True,
                email_verified_at=datetime.now(UTC),
            )
            db.add(duplicate_user)
            db.flush()
            db.add(HouseholdMember(household_id=household_id, user_id=duplicate_user.id, role=MemberRole.viewer))
            db.commit()

        ambiguous = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "cash",
                "symbol": f"KRW-AMB-{uuid.uuid4().hex[:8].upper()}",
                "market_symbol": f"KRW-AMB-{uuid.uuid4().hex[:8].upper()}",
                "name": "AmbiguousOwner",
                "category": "현금성",
                "owner_name": "DupHolder",
                "quantity": 1,
                "average_cost": 1000,
                "currency": "KRW",
            },
        )
        assert ambiguous.status_code == 409
        assert ambiguous.json()["error"]["code"] == "HOLDING_OWNER_AMBIGUOUS"


def test_holding_patch_rejects_invalid_currency() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"holding-patch-currency-{uuid.uuid4().hex}@example.com", "Password1234", "HoldingP")
        created = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "stock",
                "symbol": "AAPL",
                "market_symbol": "AAPL",
                "name": "Apple",
                "category": "주식",
                "quantity": 1,
                "average_cost": 100,
                "currency": "USD",
            },
        )
        assert created.status_code == 201
        holding = created.json()

        patched = client.patch(
            f"/api/v1/holdings/{holding['id']}",
            headers=_headers(token),
            json={"base_version": holding["version"], "currency": "12 "},
        )
        assert patched.status_code == 400


def test_holding_patch_rejects_null_for_required_fields() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"holding-null-patch-{uuid.uuid4().hex}@example.com", "Password1234", "HoldingNull")
        created = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "stock",
                "symbol": "MSFT",
                "market_symbol": "MSFT",
                "name": "Microsoft",
                "category": "주식",
                "quantity": 1,
                "average_cost": 100,
                "currency": "USD",
            },
        )
        assert created.status_code == 201
        holding = created.json()

        patched = client.patch(
            f"/api/v1/holdings/{holding['id']}",
            headers=_headers(token),
            json={"base_version": holding["version"], "market_symbol": None},
        )
        assert patched.status_code == 400
        error_payload = patched.json()["error"]
        assert error_payload["code"] == "HOLDING_PATCH_NULL_NOT_ALLOWED"
        assert "market_symbol" in (error_payload.get("context", {}).get("fields") or [])


def test_holding_patch_rejects_blank_for_required_text_fields() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"holding-blank-patch-{uuid.uuid4().hex}@example.com", "Password1234", "HoldingBlank")
        created = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "stock",
                "symbol": "NVDA",
                "market_symbol": "NVDA",
                "name": "NVIDIA",
                "category": "주식",
                "quantity": 1,
                "average_cost": 100,
                "currency": "USD",
            },
        )
        assert created.status_code == 201
        holding = created.json()

        patched = client.patch(
            f"/api/v1/holdings/{holding['id']}",
            headers=_headers(token),
            json={"base_version": holding["version"], "name": "   "},
        )
        assert patched.status_code == 400
        error_payload = patched.json()["error"]
        assert error_payload["code"] == "HOLDING_PATCH_BLANK_NOT_ALLOWED"
        assert "name" in (error_payload.get("context", {}).get("fields") or [])


def test_transaction_category_blank_string_normalized_to_none() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"tx-category-{uuid.uuid4().hex}@example.com", "Password1234", "TxC")

        created = client.post(
            "/api/v1/transactions",
            headers=_headers(token),
            json={
                "occurred_on": "2026-02-03",
                "flow_type": "expense",
                "amount": 15000,
                "currency": "KRW",
                "memo": "blank-category",
                "category_id": "   ",
            },
        )
        assert created.status_code == 201
        tx = created.json()
        assert tx["category_id"] is None


def test_transaction_create_rejects_category_flow_type_mismatch() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"tx-flow-mismatch-{uuid.uuid4().hex}@example.com", "Password1234", "TxFlow")
        household_id = client.get("/api/v1/household/current", headers=_headers(token)).json()["household"]["id"]
        income_category_id = str(uuid.uuid4())
        with SessionLocal() as db:
            db.add(
                Category(
                    id=income_category_id,
                    household_id=household_id,
                    flow_type=FlowType.income,
                    major="테스트수입",
                    minor="테스트수입소분류",
                    sort_order=9990,
                )
            )
            db.commit()

        created = client.post(
            "/api/v1/transactions",
            headers=_headers(token),
            json={
                "occurred_on": "2026-02-03",
                "flow_type": "expense",
                "amount": 15000,
                "currency": "KRW",
                "memo": "flow-mismatch",
                "category_id": income_category_id,
            },
        )
        assert created.status_code == 400
        error_payload = created.json()["error"]
        assert error_payload["code"] == "TRANSACTION_CATEGORY_FLOW_TYPE_MISMATCH"


def test_transaction_patch_rejects_category_flow_type_mismatch() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"tx-flow-mismatch-patch-{uuid.uuid4().hex}@example.com", "Password1234", "TxFlowPatch")
        household_id = client.get("/api/v1/household/current", headers=_headers(token)).json()["household"]["id"]
        expense_category_id = str(uuid.uuid4())
        with SessionLocal() as db:
            db.add(
                Category(
                    id=expense_category_id,
                    household_id=household_id,
                    flow_type=FlowType.expense,
                    major="테스트지출",
                    minor="테스트지출소분류",
                    sort_order=9991,
                )
            )
            db.commit()

        created = client.post(
            "/api/v1/transactions",
            headers=_headers(token),
            json={
                "occurred_on": "2026-02-03",
                "flow_type": "expense",
                "amount": 15000,
                "currency": "KRW",
                "memo": "flow-mismatch-patch",
                "category_id": expense_category_id,
            },
        )
        assert created.status_code == 201
        tx = created.json()

        patched = client.patch(
            f"/api/v1/transactions/{tx['id']}",
            headers=_headers(token),
            json={"base_version": tx["version"], "flow_type": "income"},
        )
        assert patched.status_code == 400
        error_payload = patched.json()["error"]
        assert error_payload["code"] == "TRANSACTION_CATEGORY_FLOW_TYPE_MISMATCH"


def test_transaction_patch_rejects_null_for_required_fields() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"tx-null-patch-{uuid.uuid4().hex}@example.com", "Password1234", "TxNull")
        created = client.post(
            "/api/v1/transactions",
            headers=_headers(token),
            json={
                "occurred_on": "2026-02-03",
                "flow_type": "expense",
                "amount": 15000,
                "currency": "KRW",
                "memo": "null-patch",
            },
        )
        assert created.status_code == 201
        tx = created.json()

        patched = client.patch(
            f"/api/v1/transactions/{tx['id']}",
            headers=_headers(token),
            json={"base_version": tx["version"], "currency": None},
        )
        assert patched.status_code == 400
        error_payload = patched.json()["error"]
        assert error_payload["code"] == "TRANSACTION_PATCH_NULL_NOT_ALLOWED"
        assert "currency" in (error_payload.get("context", {}).get("fields") or [])

        patched_memo = client.patch(
            f"/api/v1/transactions/{tx['id']}",
            headers=_headers(token),
            json={"base_version": tx["version"], "memo": None},
        )
        assert patched_memo.status_code == 400
        memo_error = patched_memo.json()["error"]
        assert memo_error["code"] == "TRANSACTION_PATCH_NULL_NOT_ALLOWED"
        assert "memo" in (memo_error.get("context", {}).get("fields") or [])


def test_transaction_patch_merge_conflict_and_tenant_isolation() -> None:
    with TestClient(app) as client:
        token_a = _auth(client, "merge-a@example.com", "Password1234", "A")
        token_b = _auth(client, "merge-b@example.com", "Password1234", "B")

        created = client.post(
            "/api/v1/transactions",
            headers=_headers(token_a),
            json={
                "occurred_on": "2026-02-01",
                "flow_type": "expense",
                "amount": 10000,
                "memo": "coffee",
            },
        )
        assert created.status_code == 201
        tx = created.json()

        patch_first = client.patch(
            f"/api/v1/transactions/{tx['id']}",
            headers=_headers(token_a),
            json={"base_version": tx["version"], "memo": "coffee+cake"},
        )
        assert patch_first.status_code == 200
        assert patch_first.json()["version"] == 2

        # base_version old but changing a non-overlapping field -> merged patch
        patch_merged = client.patch(
            f"/api/v1/transactions/{tx['id']}",
            headers=_headers(token_a),
            json={"base_version": 1, "amount": 12000},
        )
        assert patch_merged.status_code == 200
        assert patch_merged.json()["version"] == 3

        # base_version old and overlapping field -> conflict
        patch_conflict = client.patch(
            f"/api/v1/transactions/{tx['id']}",
            headers=_headers(token_a),
            json={"base_version": 1, "memo": "stale-write"},
        )
        assert patch_conflict.status_code == 409
        error_payload = patch_conflict.json()["error"]
        assert error_payload["code"] == "HTTP_409"
        assert "입력값" in error_payload["action"]
        assert error_payload.get("context", {}).get("current_version") == 3

        # Different tenant must not access another tenant's transaction.
        cross_tenant_patch = client.patch(
            f"/api/v1/transactions/{tx['id']}",
            headers=_headers(token_b),
            json={"base_version": 3, "memo": "forbidden"},
        )
        assert cross_tenant_patch.status_code == 404


def test_holding_patch_rejects_when_version_advanced_without_patch_log() -> None:
    with TestClient(app) as client:
        token = _auth(client, "holding-merge-gap@example.com", "Password1234", "Gap")
        created = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "cash",
                "symbol": "KRW-MERGE-GAP",
                "market_symbol": "KRW-MERGE-GAP",
                "name": "머지테스트",
                "category": "현금성",
                "owner_name": "Gap",
                "account_name": "통장",
                "quantity": 1,
                "average_cost": 1000,
                "currency": "KRW",
            },
        )
        assert created.status_code == 201
        holding = created.json()

        # Simulate non-patch update path (e.g. import apply) that increments version but leaves patch-log gap.
        with SessionLocal() as db:
            entity = db.get(Holding, holding["id"])
            assert entity is not None
            entity.name = "서버측 변경"
            entity.version = int(entity.version) + 1
            db.commit()

        stale_patch = client.patch(
            f"/api/v1/holdings/{holding['id']}",
            headers=_headers(token),
            json={"base_version": holding["version"], "category": "현금성-수정"},
        )
        assert stale_patch.status_code == 409


def test_holding_patch_rejects_duplicate_identity_when_owner_and_account_become_null() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"holding-dup-{uuid.uuid4().hex}@example.com", "Password1234", "DupHolding")
        base_payload = {
            "asset_type": "stock",
            "symbol": "AAPL",
            "market_symbol": "AAPL",
            "name": "Apple",
            "category": "주식",
            "quantity": 1,
            "average_cost": 100,
            "currency": "USD",
        }
        first = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={**base_payload, "owner_name": "DupHolding", "account_name": "ACC-A"},
        )
        second = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={**base_payload, "owner_name": "DupHolding", "account_name": "ACC-B"},
        )
        assert first.status_code == 201
        assert second.status_code == 201
        first_entity = first.json()
        second_entity = second.json()

        first_patch = client.patch(
            f"/api/v1/holdings/{first_entity['id']}",
            headers=_headers(token),
            json={"base_version": first_entity["version"], "owner_name": None, "account_name": None},
        )
        assert first_patch.status_code == 200

        second_patch = client.patch(
            f"/api/v1/holdings/{second_entity['id']}",
            headers=_headers(token),
            json={"base_version": second_entity["version"], "owner_name": None, "account_name": None},
        )
        assert second_patch.status_code == 409
        assert second_patch.json()["error"]["code"] == "HOLDING_ALREADY_EXISTS"


def test_holdings_dashboard_and_import_dry_run() -> None:
    with TestClient(app) as client:
        token = _auth(client, "dash@example.com", "Password1234", "Dash")
        created = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "cash",
                "symbol": "KRW-CASH",
                "market_symbol": "KRW-CASH",
                "name": "비상금",
                "category": "현금성",
                "owner_name": "Dash",
                "account_name": "테스트통장",
                "quantity": 1,
                "average_cost": 5000000,
                "currency": "KRW",
            },
        )
        assert created.status_code == 201

        overview = client.get("/api/v1/dashboard/overview?year=2026&month=2", headers=_headers(token))
        assert overview.status_code == 200
        assert "totals" in overview.json()

        portfolio = client.get("/api/v1/dashboard/portfolio?refresh_prices=false", headers=_headers(token))
        assert portfolio.status_code == 200
        assert len(portfolio.json()["items"]) >= 1

        workbook_path = str(next((Path(__file__).resolve().parents[2] / "legacy").glob("*.xlsx")))
        dry_run = client.post(
            "/api/v1/imports/workbook",
            headers=_headers(token),
            json={"mode": "dry_run", "workbook_path": workbook_path},
        )
        assert dry_run.status_code == 200
        report = dry_run.json()
        assert report["sheets"] >= 10
        assert report["monthly_formula_mismatch_count"] >= 1


def test_dashboard_portfolio_rejects_refresh_prices_true_query(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        token = _auth(client, f"portfolio-refresh-{uuid.uuid4().hex}@example.com", "Password1234", "PortfolioRefresh")
        created = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "stock",
                "symbol": "AAPL",
                "market_symbol": "AAPL",
                "name": "Apple",
                "category": "주식",
                "quantity": 1,
                "average_cost": 100,
                "currency": "USD",
            },
        )
        assert created.status_code == 201

        observed_force_refresh: list[bool] = []
        original_quote_holding = dashboard_service.price_service.quote_holding

        async def _spy_quote_holding(
            db: Any,
            holding: Any,
            *,
            force_refresh: bool = False,
            client: Any = None,
        ) -> Any:
            observed_force_refresh.append(bool(force_refresh))
            return await original_quote_holding(db, holding, force_refresh=force_refresh, client=client)

        monkeypatch.setattr(dashboard_service.price_service, "quote_holding", _spy_quote_holding)
        rejected = client.get("/api/v1/dashboard/portfolio?refresh_prices=true", headers=_headers(token))
        assert rejected.status_code == 400
        assert rejected.json()["error"]["code"] == "DASHBOARD_PORTFOLIO_REFRESH_PRICES_UNSUPPORTED"

        portfolio = client.get("/api/v1/dashboard/portfolio?refresh_prices=false", headers=_headers(token))
        assert portfolio.status_code == 200
        assert observed_force_refresh
        assert all(item is False for item in observed_force_refresh)


def test_dashboard_portfolio_returns_retryable_error_when_fx_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        token = _auth(client, f"portfolio-fxdown-{uuid.uuid4().hex}@example.com", "Password1234", "PortfolioFxDown")
        created = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "cash",
                "symbol": "USD-CASH",
                "market_symbol": "USD-CASH",
                "name": "USD cash",
                "category": "현금성",
                "quantity": 100,
                "average_cost": 1,
                "currency": "USD",
            },
        )
        assert created.status_code == 201

        with SessionLocal() as db:
            db.execute(delete(FxRate).where(FxRate.base_currency == "KRW", FxRate.quote_currency == "USD"))
            db.commit()

        async def _fail_fetch_rate(base: str, quote: str) -> tuple[Decimal, str]:
            raise RuntimeError(f"fx provider down: {base}/{quote}")

        monkeypatch.setattr(dashboard_service.fx_service, "_fetch_rate", _fail_fetch_rate)
        portfolio = client.get("/api/v1/dashboard/portfolio?refresh_prices=false", headers=_headers(token))
        assert portfolio.status_code == 503
        payload = portfolio.json()
        assert payload["error"]["code"] == "FX_RATE_UNAVAILABLE"


def test_import_upload_dry_run_and_apply_repeat() -> None:
    with TestClient(app) as client:
        token = _auth(client, "import-upload@example.com", "Password1234", "ImportUpload")
        workbook_path = next((Path(__file__).resolve().parents[2] / "legacy").glob("*.xlsx"))
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        with workbook_path.open("rb") as fp:
            dry_run = client.post(
                "/api/v1/imports/workbook/upload?mode=dry_run",
                headers=_headers(token),
                files={"file": ("workbook.xlsx", fp, content_type)},
            )
        assert dry_run.status_code == 200
        assert dry_run.json()["workbook_path"] == "workbook.xlsx"

        with workbook_path.open("rb") as fp:
            apply_once = client.post(
                "/api/v1/imports/workbook/upload?mode=apply",
                headers=_headers(token),
                files={"file": ("workbook.xlsx", fp, content_type)},
            )
        assert apply_once.status_code == 200

        holdings_resp = client.get("/api/v1/holdings", headers=_headers(token))
        assert holdings_resp.status_code == 200
        holdings = holdings_resp.json()

        by_symbol = {item["market_symbol"]: item for item in holdings}
        assert "360750.KR" in by_symbol
        assert float(by_symbol["360750.KR"]["average_cost"]) == 20836.0
        assert by_symbol["360750.KR"]["currency"] == "KRW"

        assert "489250.KR" in by_symbol
        assert float(by_symbol["489250.KR"]["average_cost"]) == 10877.0
        assert by_symbol["489250.KR"]["currency"] == "KRW"

        voo_main = next(item for item in holdings if item["market_symbol"] == "VOO" and item["name"] == "VANGUARD S&P 500")
        assert abs(float(voo_main["average_cost"]) - 628.7067) < 0.0001
        assert voo_main["currency"] == "USD"

        # Daily DCA rows in the workbook only provide invested KRW; parser must keep KRW basis.
        voo_dca = next(item for item in holdings if item["market_symbol"] == "VOO" and float(item["quantity"]) < 1)
        assert voo_dca["currency"] == "KRW"
        assert abs(float(voo_dca["average_cost"]) - 909874.5458) < 0.001

        qqqm_dca = next(item for item in holdings if item["market_symbol"] == "QQQM")
        assert qqqm_dca["currency"] == "KRW"
        assert abs(float(qqqm_dca["average_cost"]) - 358917.6140) < 0.001

        # qqqm row is imported without .KR suffix and uses KRW invested fallback.
        assert "QQQM" in by_symbol
        assert by_symbol["QQQM"]["currency"] == "KRW"
        assert "QQQM.KR" not in by_symbol

        portfolio_cached = client.get("/api/v1/dashboard/portfolio?refresh_prices=false", headers=_headers(token))
        assert portfolio_cached.status_code == 200
        portfolio_items = portfolio_cached.json()["items"]
        voo_dca_cached = next(item for item in portfolio_items if item["market_symbol"] == "VOO" and float(item["quantity"]) < 1)
        assert abs(float(voo_dca_cached["invested_krw"]) - 445965.0) < 1.0
        assert abs(float(voo_dca_cached["market_value_krw"]) - float(voo_dca_cached["invested_krw"])) < 1.0
        assert abs(float(voo_dca_cached["gain_loss_krw"])) < 1.0

        refresh = client.post("/api/v1/prices/refresh", headers=_headers(token))
        assert refresh.status_code == 200
        refresh_payload = refresh.json()
        assert refresh_payload["accepted"] is True
        assert refresh_payload["in_progress"] is True

        deadline = time.time() + 30
        status_payload = None
        while time.time() < deadline:
            status_resp = client.get("/api/v1/prices/status", headers=_headers(token))
            assert status_resp.status_code == 200
            status_payload = status_resp.json()
            if not status_payload["refresh_in_progress"]:
                break
            time.sleep(0.2)

        assert status_payload is not None
        assert status_payload["refresh_in_progress"] is False
        assert int(status_payload["snapshot_count"]) >= 1

        with workbook_path.open("rb") as fp:
            apply_twice = client.post(
                "/api/v1/imports/workbook/upload?mode=apply",
                headers=_headers(token),
                files={"file": ("workbook.xlsx", fp, content_type)},
            )
        assert apply_twice.status_code == 200, apply_twice.text
        apply_twice_payload = apply_twice.json()
        assert int(apply_twice_payload.get("applied_transactions") or 0) == 0
        assert int(apply_twice_payload.get("skipped_transactions") or 0) >= int(apply_twice_payload.get("transaction_rows") or 0)


def test_import_upload_apply_row_shift_keeps_transaction_idempotency(tmp_path: Path) -> None:
    with TestClient(app) as client:
        token = _auth(client, "import-upload-row-shift@example.com", "Password1234", "ImportUploadShift")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = str(current.json()["household"]["id"])
        workbook_path = next((Path(__file__).resolve().parents[2] / "legacy").glob("*.xlsx"))
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

        with workbook_path.open("rb") as fp:
            apply_once = client.post(
                "/api/v1/imports/workbook/upload?mode=apply",
                headers=_headers(token),
                files={"file": ("workbook.xlsx", fp, content_type)},
            )
        assert apply_once.status_code == 200, apply_once.text
        apply_once_payload = apply_once.json()
        assert int(apply_once_payload.get("applied_transactions") or 0) > 0

        with SessionLocal() as db:
            tx_count_before = int(
                db.scalar(select(func.count(Transaction.id)).where(Transaction.household_id == household_id)) or 0
            )
        assert tx_count_before > 0

        shifted_path = tmp_path / "workbook-shifted.xlsx"
        workbook = load_workbook(workbook_path)
        try:
            shifted = False
            for worksheet in workbook.worksheets:
                title = str(getattr(worksheet, "title", "") or "").strip()
                if not title.isdigit():
                    continue
                month_no = int(title)
                if month_no < 1 or month_no > 12:
                    continue
                worksheet.insert_rows(10, amount=1)
                shifted = True
                break
            assert shifted is True
            workbook.save(shifted_path)
        finally:
            workbook.close()

        with shifted_path.open("rb") as fp:
            apply_shifted = client.post(
                "/api/v1/imports/workbook/upload?mode=apply",
                headers=_headers(token),
                files={"file": ("workbook-shifted.xlsx", fp, content_type)},
            )
        assert apply_shifted.status_code == 200, apply_shifted.text
        shifted_payload = apply_shifted.json()
        assert int(shifted_payload.get("applied_transactions") or 0) == 0

        with SessionLocal() as db:
            tx_count_after = int(
                db.scalar(select(func.count(Transaction.id)).where(Transaction.household_id == household_id)) or 0
            )
        assert tx_count_after == tx_count_before


def test_import_lock_release_does_not_remove_new_owner_lock() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"import-lock-{uuid.uuid4().hex}@example.com", "Password1234", "ImportLock")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = current.json()["household"]["id"]

    stale_seconds = imports_route._lock_timeout_seconds() + 5
    stale_acquired_at = datetime.now(UTC) - timedelta(seconds=stale_seconds)

    with SessionLocal() as db:
        db.add(ImportExecutionLock(household_id=household_id, acquired_at=stale_acquired_at))
        db.commit()

        fresh_acquired_at = imports_route._acquire_import_lock(db, household_id)
        imports_route._release_import_lock(db, household_id, acquired_at=stale_acquired_at)
        still_held = db.get(ImportExecutionLock, household_id)
        assert still_held is not None

        imports_route._release_import_lock(db, household_id, acquired_at=fresh_acquired_at)
        assert db.get(ImportExecutionLock, household_id) is None


def test_import_process_guard_blocks_duplicate_sqlite_apply_lock() -> None:
    household_id = f"guard-{uuid.uuid4().hex}"
    with SessionLocal() as db:
        first_guard = imports_route._acquire_import_process_guard(db, household_id=household_id, mode="apply")
        assert first_guard is not None
        try:
            with pytest.raises(Exception) as exc_info:
                imports_route._acquire_import_process_guard(db, household_id=household_id, mode="apply")
            error = exc_info.value
            assert int(getattr(error, "status_code", 0)) == 429
            detail = getattr(error, "detail", {}) or {}
            code = detail.get("error", {}).get("code") if isinstance(detail.get("error"), dict) else detail.get("code")
            assert code == "IMPORT_ALREADY_RUNNING"
        finally:
            first_guard.release()

        second_guard = imports_route._acquire_import_process_guard(db, household_id=household_id, mode="apply")
        assert second_guard is not None
        second_guard.release()


def test_import_lock_heartbeat_stop_waits_for_thread_completion() -> None:
    stop_event = threading.Event()
    started = threading.Event()
    finished = threading.Event()

    def _worker() -> None:
        started.set()
        while not stop_event.is_set():
            time.sleep(0.01)
        time.sleep(1.2)
        finished.set()

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
    assert started.wait(timeout=1.0) is True

    started_at = time.time()
    imports_route._stop_import_lock_heartbeat(stop_event=stop_event, thread=thread)
    elapsed = time.time() - started_at

    assert finished.is_set() is True
    assert thread.is_alive() is False
    assert elapsed >= 1.0


def test_import_background_heartbeat_disabled_for_sqlite_session() -> None:
    with SessionLocal() as db:
        assert imports_route._should_use_background_heartbeat(db) is False


def test_import_background_heartbeat_enabled_for_non_sqlite_bind() -> None:
    class _DummySession:
        class _DummyBind:
            class _DummyDialect:
                name = "postgresql"

            dialect = _DummyDialect()

        @staticmethod
        def get_bind() -> object:
            return _DummySession._DummyBind()

    assert imports_route._should_use_background_heartbeat(_DummySession()) is True


def test_import_lock_takeover_rejects_when_stale_delete_races(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        token = _auth(client, f"import-lock-race-{uuid.uuid4().hex}@example.com", "Password1234", "ImportLockRace")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = current.json()["household"]["id"]

    stale_seconds = imports_route._lock_timeout_seconds() + 5
    stale_acquired_at = datetime.now(UTC) - timedelta(seconds=stale_seconds)

    with SessionLocal() as db:
        db.add(ImportExecutionLock(household_id=household_id, acquired_at=stale_acquired_at))
        db.commit()

        real_query = db.query

        def fake_query(model):  # noqa: ANN001
            query = real_query(model)
            if model is not ImportExecutionLock:
                return query

            class DeleteRaceQuery:
                def __init__(self, inner):  # noqa: ANN001
                    self.inner = inner

                def filter(self, *args, **kwargs):  # noqa: ANN002, ANN003
                    self.inner = self.inner.filter(*args, **kwargs)
                    return self

                def delete(self, **kwargs):  # noqa: ANN003
                    _ = kwargs
                    return 0

            return DeleteRaceQuery(query)

        monkeypatch.setattr(db, "query", fake_query)
        with pytest.raises(Exception) as exc_info:
            imports_route._acquire_import_lock(db, household_id)
        error = exc_info.value
        assert int(getattr(error, "status_code", 0)) == 429
        detail = getattr(error, "detail", {}) or {}
        code = detail.get("error", {}).get("code") if isinstance(detail.get("error"), dict) else detail.get("code")
        assert code == "IMPORT_ALREADY_RUNNING"


def test_import_with_guard_aborts_when_heartbeat_lease_is_lost(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        token = _auth(client, f"import-lease-{uuid.uuid4().hex}@example.com", "Password1234", "ImportLease")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = current.json()["household"]["id"]

    captured: dict[str, object] = {}

    def fake_import_run(*_args, **kwargs):  # noqa: ANN002, ANN003
        captured["commit"] = kwargs.get("commit")
        return object()

    def fake_start_heartbeat(
        *,
        household_id: str,
        lease_state: dict[str, datetime],
        lease_state_lock: threading.Lock,
        heartbeat_failed: threading.Event,
    ):
        _ = household_id, lease_state, lease_state_lock, heartbeat_failed
        stop_event = threading.Event()
        thread = threading.Thread(target=lambda: None, daemon=True)
        thread.start()
        return stop_event, thread

    monkeypatch.setattr(imports_route.importer, "run", fake_import_run)
    monkeypatch.setattr(imports_route, "_start_import_lock_heartbeat", fake_start_heartbeat)

    # Ensure lease-loss path is taken after importer returns and before commit.
    def fake_is_lock_current(_db: Session, _household_id: str, *, acquired_at: datetime) -> bool:
        _ = acquired_at
        return False

    monkeypatch.setattr(imports_route, "_is_import_lock_current", fake_is_lock_current)

    with SessionLocal() as db:
        household = db.get(Household, household_id)
        assert household is not None
        with pytest.raises(Exception) as exc_info:
            imports_route._run_import_with_guard(
                db,
                household=household,
                workbook_path=Path("dummy.xlsx"),
                mode="apply",
            )
        error = exc_info.value
        assert int(getattr(error, "status_code", 0)) == 409
        detail = getattr(error, "detail", {}) or {}
        code = detail.get("error", {}).get("code") if isinstance(detail.get("error"), dict) else detail.get("code")
        assert code == "IMPORT_LOCK_LOST"
        assert captured.get("commit") is False


def test_import_with_guard_returns_500_for_unexpected_runtime_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        token = _auth(client, f"import-internal-{uuid.uuid4().hex}@example.com", "Password1234", "ImportInternal")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = current.json()["household"]["id"]

    def fake_import_run(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise RuntimeError("unexpected importer failure")

    def fake_start_heartbeat(
        *,
        household_id: str,
        lease_state: dict[str, datetime],
        lease_state_lock: threading.Lock,
        heartbeat_failed: threading.Event,
    ):
        _ = household_id, lease_state, lease_state_lock, heartbeat_failed
        stop_event = threading.Event()
        thread = threading.Thread(target=lambda: None, daemon=True)
        thread.start()
        return stop_event, thread

    monkeypatch.setattr(imports_route.importer, "run", fake_import_run)
    monkeypatch.setattr(imports_route, "_start_import_lock_heartbeat", fake_start_heartbeat)

    with SessionLocal() as db:
        household = db.get(Household, household_id)
        assert household is not None
        with pytest.raises(Exception) as exc_info:
            imports_route._run_import_with_guard(
                db,
                household=household,
                workbook_path=Path("dummy.xlsx"),
                mode="apply",
            )
        error = exc_info.value
        assert int(getattr(error, "status_code", 0)) == 500
        detail = getattr(error, "detail", {}) or {}
        code = detail.get("error", {}).get("code") if isinstance(detail.get("error"), dict) else detail.get("code")
        assert code == "IMPORT_PROCESS_INTERNAL_ERROR"


def test_import_with_guard_maps_too_many_sheets_to_400(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        token = _auth(client, f"import-too-many-sheets-{uuid.uuid4().hex}@example.com", "Password1234", "ImportLimit")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = current.json()["household"]["id"]

    def fake_import_run(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise ValueError("workbook has too many sheets")

    monkeypatch.setattr(imports_route.importer, "run", fake_import_run)

    with SessionLocal() as db:
        household = db.get(Household, household_id)
        assert household is not None
        with pytest.raises(Exception) as exc_info:
            imports_route._run_import_with_guard(
                db,
                household=household,
                workbook_path=Path("dummy.xlsx"),
                mode="apply",
            )
        error = exc_info.value
        assert int(getattr(error, "status_code", 0)) == 400
        detail = getattr(error, "detail", {}) or {}
        code = detail.get("error", {}).get("code") if isinstance(detail.get("error"), dict) else detail.get("code")
        assert code == "IMPORT_WORKBOOK_TOO_MANY_SHEETS"


def test_import_lock_renewal_prevents_stale_takeover() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"import-lock-renew-{uuid.uuid4().hex}@example.com", "Password1234", "ImportLockRenew")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = current.json()["household"]["id"]

    stale_seconds = imports_route._lock_timeout_seconds() + 5
    stale_acquired_at = datetime.now(UTC) - timedelta(seconds=stale_seconds)

    with SessionLocal() as db:
        db.add(ImportExecutionLock(household_id=household_id, acquired_at=stale_acquired_at))
        db.commit()
        renewed_at = imports_route._renew_import_lock_lease(
            db,
            household_id,
            acquired_at=stale_acquired_at,
            renewed_at=datetime.now(UTC),
        )
        assert renewed_at is not None

    with SessionLocal() as db:
        with pytest.raises(Exception) as exc_info:
            imports_route._acquire_import_lock(db, household_id)
        error = exc_info.value
        assert int(getattr(error, "status_code", 0)) == 429
        detail = getattr(error, "detail", {}) or {}
        code = detail.get("error", {}).get("code") if isinstance(detail.get("error"), dict) else detail.get("code")
        assert code == "IMPORT_ALREADY_RUNNING"
        imports_route._release_import_lock(db, household_id, acquired_at=renewed_at)


def test_import_non_member_owner_names_do_not_collapse_to_same_holding() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"import-owner-{uuid.uuid4().hex}@example.com", "Password1234", "ImportOwner")
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = current.json()["household"]["id"]

    rows = [
        ParsedHolding(
            asset_type=AssetType.stock,
            symbol="UNMAPPED-OWNER",
            market_symbol="UNMAPPED-OWNER",
            name="Unmapped Owner Asset",
            category="테스트",
            owner_name="외부보유자-A",
            account_name="테스트계좌",
            quantity=Decimal("1"),
            average_cost=Decimal("1000"),
            currency="KRW",
            source_ref="holdings!A1",
        ),
        ParsedHolding(
            asset_type=AssetType.stock,
            symbol="UNMAPPED-OWNER",
            market_symbol="UNMAPPED-OWNER",
            name="Unmapped Owner Asset",
            category="테스트",
            owner_name="외부보유자-B",
            account_name="테스트계좌",
            quantity=Decimal("2"),
            average_cost=Decimal("2000"),
            currency="KRW",
            source_ref="holdings!A2",
        ),
    ]
    importer = WorkbookImporter()
    with SessionLocal() as db:
        added, updated, issues = importer._apply_holdings(db, household_id, rows)
        db.commit()

        assert added == 2
        assert updated == 0

        imported = db.scalars(
            select(Holding).where(
                Holding.household_id == household_id,
                Holding.market_symbol == "UNMAPPED-OWNER",
            )
        ).all()
        assert len(imported) == 2
        owners = {str(item.owner_name or "") for item in imported}
        assert len(owners) == 2
        assert all(owner.startswith("unmapped:") for owner in owners)

        owner_issues = [issue for issue in issues if issue.code == "HOLDING_OWNER_NOT_MEMBER"]
        assert len(owner_issues) == 2
        source_owner_names = {str((issue.detail or {}).get("owner_name") or "") for issue in owner_issues}
        assert source_owner_names == {"외부보유자-A", "외부보유자-B"}


def test_import_holding_key_avoids_delimiter_collisions() -> None:
    importer = WorkbookImporter()

    key_a = importer._holding_key(AssetType.stock, "ABC", "A:B", "C")
    key_b = importer._holding_key(AssetType.stock, "ABC", "A", "B:C")
    key_empty = importer._holding_key(AssetType.stock, "ABC", None, None)
    key_dash = importer._holding_key(AssetType.stock, "ABC", "-", "-")

    assert key_a != key_b
    assert key_empty != key_dash


def test_price_status_filters_snapshots_by_asset_type_and_symbol() -> None:
    with TestClient(app) as client:
        token = _auth(client, "price-status@example.com", "Password1234", "PriceStatus")

        created = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "stock",
                "symbol": "BTC",
                "market_symbol": "BTC",
                "name": "BTC-Stock-Proxy",
                "category": "기타",
                "owner_name": "PriceStatus",
                "account_name": "A",
                "quantity": 1,
                "average_cost": 1,
                "currency": "USD",
            },
        )
        assert created.status_code == 201

        # Insert snapshot for different asset_type with same symbol.
        with SessionLocal() as db:
            db.add(
                PriceSnapshot(
                    asset_type=AssetType.crypto,
                    symbol="BTC",
                    currency="USD",
                    price=Decimal("50000"),
                    source="test",
                    fetched_at=datetime.now(UTC),
                )
            )
            db.commit()

        status_resp = client.get("/api/v1/prices/status", headers=_headers(token))
        assert status_resp.status_code == 200
        payload = status_resp.json()
        assert payload["holdings_count"] == 1
        assert payload["tracked_holdings_count"] == 1
        assert payload["snapshot_count"] == 0


def test_price_status_reports_tracked_holdings_excluding_non_market_assets() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"price-tracked-{uuid.uuid4().hex}@example.com", "Password1234", "PriceTracked")

        created_market = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "stock",
                "symbol": "AAPL",
                "market_symbol": "AAPL",
                "name": "Apple",
                "category": "주식",
                "owner_name": "PriceTracked",
                "account_name": "Broker",
                "quantity": 1,
                "average_cost": 1,
                "currency": "USD",
            },
        )
        assert created_market.status_code == 201

        created_non_market = client.post(
            "/api/v1/holdings",
            headers=_headers(token),
            json={
                "asset_type": "cash",
                "symbol": "KRW-CASH",
                "market_symbol": "KRW-CASH",
                "name": "현금",
                "category": "현금",
                "owner_name": "PriceTracked",
                "account_name": "Wallet",
                "quantity": 1,
                "average_cost": 1,
                "currency": "KRW",
            },
        )
        assert created_non_market.status_code == 201

        status_resp = client.get("/api/v1/prices/status", headers=_headers(token))
        assert status_resp.status_code == 200
        payload = status_resp.json()
        assert payload["holdings_count"] == 2
        assert payload["tracked_holdings_count"] == 1
        assert payload["snapshot_count"] == 0


def test_spa_fallback_serves_dist_root_file_when_present(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    dist_dir = tmp_path / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    (dist_dir / "index.html").write_text("<html><body>spa index</body></html>\n", encoding="utf-8")
    (dist_dir / "vite.svg").write_text("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n", encoding="utf-8")
    monkeypatch.setattr(app_main, "frontend_dist", dist_dir)

    with TestClient(app) as client:
        static_file = client.get("/vite.svg")
        assert static_file.status_code == 200
        assert "<svg" in static_file.text
        assert "image/svg+xml" in str(static_file.headers.get("content-type") or "")

        fallback = client.get("/unknown-route")
        assert fallback.status_code == 200
        assert "spa index" in fallback.text


def test_price_refresh_state_creation_recovers_from_integrity_race() -> None:
    existing = PriceRefreshStatus(
        household_id="household-1",
        in_progress=False,
        queued=False,
        target_count=0,
        completed_count=0,
        refreshed_count=0,
    )

    class DummyNested:
        def __enter__(self):  # noqa: ANN204
            return None

        def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
            return False

    class DummyDb:
        def __init__(self) -> None:
            self.scalar_calls = 0

        def scalar(self, _query):  # noqa: ANN001
            self.scalar_calls += 1
            if self.scalar_calls == 1:
                return None
            return existing

        def begin_nested(self) -> DummyNested:
            return DummyNested()

        def add(self, _state) -> None:  # noqa: ANN001
            return None

        def flush(self) -> None:
            raise IntegrityError("insert", {}, Exception("duplicate key"))

    recovered = price_service._get_or_create_refresh_state(DummyDb(), "household-1")
    assert recovered is existing


def test_price_refresh_request_recovers_orphaned_in_progress_state(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as client:
        token = _auth(
            client,
            f"price-orphan-{uuid.uuid4().hex}@example.com",
            "Password1234",
            "PriceOrphan",
        )
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = str(current.json()["household"]["id"])

    seeded_started_at = datetime.now(UTC)
    with SessionLocal() as db:
        state = PriceRefreshStatus(
            household_id=household_id,
            in_progress=True,
            queued=False,
            started_at=seeded_started_at,
            target_count=5,
            completed_count=1,
            refreshed_count=0,
        )
        db.merge(state)
        db.commit()

    with price_service._task_lock:
        price_service._refresh_tasks.pop(household_id, None)

    observed: dict[str, Any] = {}

    def _capture_ensure(
        captured_household_id: str,
        *,
        lease_started_at: datetime,
        force_restart: bool = False,
    ) -> None:
        observed["household_id"] = captured_household_id
        observed["lease_started_at"] = lease_started_at
        observed["force_restart"] = force_restart

    monkeypatch.setattr(price_service, "_ensure_refresh_task", _capture_ensure)

    response = asyncio.run(price_service.request_refresh(household_id))
    assert response["queued"] is False
    assert response["in_progress"] is True
    assert observed["household_id"] == household_id
    assert observed["force_restart"] is False
    assert isinstance(observed["lease_started_at"], datetime)
    assert price_service._as_utc(observed["lease_started_at"]) >= seeded_started_at

    with SessionLocal() as db:
        refreshed = db.get(PriceRefreshStatus, household_id)
        assert refreshed is not None
        assert refreshed.in_progress is True
        assert refreshed.queued is False
        assert refreshed.started_at is not None
        assert price_service._as_utc(refreshed.started_at) >= seeded_started_at


def test_price_refresh_request_queues_fresh_lease_without_local_task_in_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with TestClient(app) as client:
        token = _auth(
            client,
            f"price-prod-queue-{uuid.uuid4().hex}@example.com",
            "Password1234",
            "PriceProdQueue",
        )
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = str(current.json()["household"]["id"])

    seeded_started_at = datetime.now(UTC)
    with SessionLocal() as db:
        state = PriceRefreshStatus(
            household_id=household_id,
            in_progress=True,
            queued=False,
            started_at=seeded_started_at,
            target_count=5,
            completed_count=1,
            refreshed_count=0,
        )
        db.merge(state)
        db.commit()

    with price_service._task_lock:
        price_service._refresh_tasks.pop(household_id, None)

    observed: dict[str, Any] = {}

    def _capture_ensure(
        captured_household_id: str,
        *,
        lease_started_at: datetime,
        force_restart: bool = False,
    ) -> None:
        observed["household_id"] = captured_household_id
        observed["lease_started_at"] = lease_started_at
        observed["force_restart"] = force_restart

    monkeypatch.setattr(price_service, "_ensure_refresh_task", _capture_ensure)

    previous_env = settings.env
    settings.env = "prod"
    try:
        response = asyncio.run(price_service.request_refresh(household_id))
    finally:
        settings.env = previous_env

    assert response["queued"] is True
    assert response["in_progress"] is True
    assert observed == {}

    with SessionLocal() as db:
        refreshed = db.get(PriceRefreshStatus, household_id)
        assert refreshed is not None
        assert refreshed.in_progress is True
        assert refreshed.queued is True
        assert refreshed.started_at is not None
        assert price_service._as_utc(refreshed.started_at) == seeded_started_at


def test_price_refresh_request_takes_over_orphaned_lease_after_grace_in_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with TestClient(app) as client:
        token = _auth(
            client,
            f"price-prod-recover-{uuid.uuid4().hex}@example.com",
            "Password1234",
            "PriceProdRecover",
        )
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = str(current.json()["household"]["id"])

    grace_seconds = int(price_service._orphan_takeover_grace_seconds())
    seeded_started_at = datetime.now(UTC) - timedelta(seconds=grace_seconds + 5)
    with SessionLocal() as db:
        state = PriceRefreshStatus(
            household_id=household_id,
            in_progress=True,
            queued=False,
            started_at=seeded_started_at,
            target_count=5,
            completed_count=1,
            refreshed_count=0,
        )
        db.merge(state)
        db.commit()
        db.execute(
            update(PriceRefreshStatus)
            .where(PriceRefreshStatus.household_id == household_id)
            .values(updated_at=seeded_started_at)
        )
        db.commit()

    with price_service._task_lock:
        price_service._refresh_tasks.pop(household_id, None)

    observed: dict[str, Any] = {}

    def _capture_ensure(
        captured_household_id: str,
        *,
        lease_started_at: datetime,
        force_restart: bool = False,
    ) -> None:
        observed["household_id"] = captured_household_id
        observed["lease_started_at"] = lease_started_at
        observed["force_restart"] = force_restart

    monkeypatch.setattr(price_service, "_ensure_refresh_task", _capture_ensure)

    previous_env = settings.env
    settings.env = "prod"
    try:
        response = asyncio.run(price_service.request_refresh(household_id))
    finally:
        settings.env = previous_env

    assert response["queued"] is False
    assert response["in_progress"] is True
    assert observed["household_id"] == household_id
    assert observed["force_restart"] is False
    assert isinstance(observed["lease_started_at"], datetime)
    assert price_service._as_utc(observed["lease_started_at"]) > seeded_started_at

    with SessionLocal() as db:
        refreshed = db.get(PriceRefreshStatus, household_id)
        assert refreshed is not None
        assert refreshed.in_progress is True
        assert refreshed.queued is False
        assert refreshed.started_at is not None
        assert price_service._as_utc(refreshed.started_at) > seeded_started_at


def test_price_refresh_cancels_pending_network_tasks_when_progress_callback_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with TestClient(app) as client:
        token = _auth(
            client,
            f"price-cancel-{uuid.uuid4().hex}@example.com",
            "Password1234",
            "PriceCancel",
        )
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = str(current.json()["household"]["id"])

    with SessionLocal() as db:
        db.add_all(
            [
                Holding(
                    household_id=household_id,
                    asset_type=AssetType.stock,
                    symbol="FAST",
                    market_symbol="FAST",
                    name="FastStock",
                    category="투자",
                    owner_name="A",
                    account_name="Acc-A",
                    quantity=Decimal("1"),
                    average_cost=Decimal("10"),
                    currency="USD",
                ),
                Holding(
                    household_id=household_id,
                    asset_type=AssetType.stock,
                    symbol="SLOW",
                    market_symbol="SLOW",
                    name="SlowStock",
                    category="투자",
                    owner_name="A",
                    account_name="Acc-B",
                    quantity=Decimal("1"),
                    average_cost=Decimal("10"),
                    currency="USD",
                ),
            ]
        )
        db.commit()

    cancelled_symbols: list[str] = []

    async def _fake_fetch_live_result_task(
        *,
        semaphore: asyncio.Semaphore,
        client,  # noqa: ANN001
        key: tuple[AssetType, str],
        holding,  # noqa: ANN001
    ) -> tuple[tuple[AssetType, str], tuple[Decimal | None, str | None, str, bool]]:
        del semaphore, client, holding
        try:
            if key[1] == "FAST":
                await asyncio.sleep(0.01)
            else:
                await asyncio.sleep(1.0)
            return key, (Decimal("123.45"), "USD", "stub", True)
        except asyncio.CancelledError:
            cancelled_symbols.append(key[1])
            raise

    monkeypatch.setattr(price_service, "_fetch_live_result_task", _fake_fetch_live_result_task)

    def _on_progress(done: int, total: int) -> None:
        if total >= 2 and done >= 1:
            raise RuntimeError("force-lease-loss")

    with SessionLocal() as db:
        with pytest.raises(RuntimeError, match="force-lease-loss"):
            asyncio.run(price_service.refresh_household(db, household_id, on_progress=_on_progress))

    assert "SLOW" in cancelled_symbols


def test_price_refresh_cancels_pending_network_tasks_on_cancelled_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with TestClient(app) as client:
        token = _auth(
            client,
            f"price-cancelled-{uuid.uuid4().hex}@example.com",
            "Password1234",
            "PriceCancelled",
        )
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = str(current.json()["household"]["id"])

    with SessionLocal() as db:
        db.add_all(
            [
                Holding(
                    household_id=household_id,
                    asset_type=AssetType.stock,
                    symbol="FAST-CANCEL",
                    market_symbol="FAST-CANCEL",
                    name="FastCancel",
                    category="투자",
                    owner_name="A",
                    account_name="Acc-A",
                    quantity=Decimal("1"),
                    average_cost=Decimal("10"),
                    currency="USD",
                ),
                Holding(
                    household_id=household_id,
                    asset_type=AssetType.stock,
                    symbol="SLOW-CANCEL",
                    market_symbol="SLOW-CANCEL",
                    name="SlowCancel",
                    category="투자",
                    owner_name="A",
                    account_name="Acc-B",
                    quantity=Decimal("1"),
                    average_cost=Decimal("10"),
                    currency="USD",
                ),
            ]
        )
        db.commit()

    cancelled_symbols: list[str] = []

    async def _fake_fetch_live_result_task(
        *,
        semaphore: asyncio.Semaphore,
        client,  # noqa: ANN001
        key: tuple[AssetType, str],
        holding,  # noqa: ANN001
    ) -> tuple[tuple[AssetType, str], tuple[Decimal | None, str | None, str, bool]]:
        del semaphore, client, holding
        try:
            if key[1] == "FAST-CANCEL":
                await asyncio.sleep(0.01)
            else:
                await asyncio.sleep(1.0)
            return key, (Decimal("123.45"), "USD", "stub", True)
        except asyncio.CancelledError:
            cancelled_symbols.append(key[1])
            raise

    monkeypatch.setattr(price_service, "_fetch_live_result_task", _fake_fetch_live_result_task)

    def _on_progress(done: int, total: int) -> None:
        if total >= 2 and done >= 1:
            raise asyncio.CancelledError()

    with SessionLocal() as db:
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(price_service.refresh_household(db, household_id, on_progress=_on_progress))

    assert "SLOW-CANCEL" in cancelled_symbols


def test_price_refresh_non_market_assets_with_same_symbol_keep_distinct_values() -> None:
    with TestClient(app) as client:
        token = _auth(
            client,
            f"price-nonmarket-{uuid.uuid4().hex}@example.com",
            "Password1234",
            "PriceNonMarket",
        )
        current = client.get("/api/v1/household/current", headers=_headers(token))
        assert current.status_code == 200
        household_id = str(current.json()["household"]["id"])

    with SessionLocal() as db:
        first = Holding(
            household_id=household_id,
            asset_type=AssetType.cash,
            symbol="LOCAL-CASH",
            market_symbol="LOCAL-CASH",
            name="생활비",
            category="현금",
            owner_name="A",
            account_name="Wallet-A",
            quantity=Decimal("1"),
            average_cost=Decimal("100000"),
            currency="KRW",
        )
        second = Holding(
            household_id=household_id,
            asset_type=AssetType.cash,
            symbol="LOCAL-CASH",
            market_symbol="LOCAL-CASH",
            name="비상금",
            category="현금",
            owner_name="A",
            account_name="Wallet-B",
            quantity=Decimal("1"),
            average_cost=Decimal("250000"),
            currency="KRW",
        )
        db.add_all([first, second])
        db.commit()
        db.refresh(first)
        db.refresh(second)

    with SessionLocal() as db:
        quotes = asyncio.run(price_service.refresh_household(db, household_id))

    assert quotes[str(first.id)].price == Decimal("100000")
    assert quotes[str(second.id)].price == Decimal("250000")


def test_price_refresh_stale_detection_tracks_updated_heartbeat() -> None:
    stale_window = max(30, int(settings.price_refresh_stale_seconds))
    with SessionLocal() as db:
        household = Household(name=f"PriceHeartbeat-{uuid.uuid4().hex[:8]}", base_currency="KRW")
        db.add(household)
        db.flush()
        state = PriceRefreshStatus(
            household_id=household.id,
            in_progress=True,
            queued=False,
            started_at=datetime.now(UTC) - timedelta(hours=1),
            target_count=10,
            completed_count=3,
            refreshed_count=0,
        )
        db.add(state)
        db.commit()
        db.refresh(state)
        heartbeat = state.updated_at if state.updated_at.tzinfo is not None else state.updated_at.replace(tzinfo=UTC)

    fresh_probe = heartbeat + timedelta(seconds=max(1, stale_window - 1))
    stale_probe = heartbeat + timedelta(seconds=stale_window + 1)
    assert price_service._is_refresh_stale(state, fresh_probe) is False
    assert price_service._is_refresh_stale(state, stale_probe) is True


def test_price_refresh_progress_rejects_stale_lease_updates() -> None:
    with SessionLocal() as db:
        household = Household(name=f"PriceLease-{uuid.uuid4().hex[:8]}", base_currency="KRW")
        db.add(household)
        db.flush()
        lease_started_at = datetime.now(UTC)
        state = PriceRefreshStatus(
            household_id=household.id,
            in_progress=True,
            queued=False,
            started_at=lease_started_at,
            target_count=0,
            completed_count=0,
            refreshed_count=0,
        )
        db.add(state)
        db.commit()
        household_id = str(household.id)

    wrong_lease = lease_started_at + timedelta(seconds=1)
    updated = price_service._update_refresh_progress(
        household_id,
        completed=2,
        target=5,
        lease_started_at=wrong_lease,
    )
    assert updated is False
    with SessionLocal() as db:
        state = db.get(PriceRefreshStatus, household_id)
        assert state is not None
        assert int(state.target_count) == 0
        assert int(state.completed_count) == 0


def test_price_service_krx_detection_requires_numeric_symbol() -> None:
    class _StubHolding:
        def __init__(self, symbol: str, market_symbol: str | None = None) -> None:
            self.symbol = symbol
            self.market_symbol = market_symbol

    assert price_service._is_krx_symbol(_StubHolding("005930")) is True
    assert price_service._is_krx_symbol(_StubHolding("ABCDEF")) is False
    assert price_service._is_krx_symbol(_StubHolding("ABCDEF.KR")) is True


def test_price_service_yahoo_lookup_preserves_dot_qualified_ticker() -> None:
    class _StubHolding:
        asset_type = AssetType.stock

        def __init__(self, market_symbol: str) -> None:
            self.symbol = market_symbol
            self.market_symbol = market_symbol
            self.average_cost = Decimal("1")
            self.currency = "USD"

    class _DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, Any]:
            return {
                "chart": {
                    "result": [
                        {
                            "meta": {
                                "currency": "USD",
                                "regularMarketPrice": 612.34,
                            }
                        }
                    ]
                }
            }

    class _DummyClient:
        def __init__(self) -> None:
            self.requested_url: str | None = None

        async def get(self, url: str, **_kwargs: Any) -> _DummyResponse:
            self.requested_url = url
            return _DummyResponse()

    async def _run() -> None:
        client = _DummyClient()
        price, currency = await price_service._fetch_stock_yahoo(client, _StubHolding("BRK.B"))
        assert price == Decimal("612.34")
        assert currency == "USD"
        assert client.requested_url is not None
        assert client.requested_url.endswith("/BRK.B")

    asyncio.run(_run())


def test_price_service_yahoo_lookup_strips_internal_kr_suffix() -> None:
    class _StubHolding:
        asset_type = AssetType.stock

        def __init__(self, market_symbol: str) -> None:
            self.symbol = market_symbol
            self.market_symbol = market_symbol
            self.average_cost = Decimal("1")
            self.currency = "KRW"

    class _DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, Any]:
            return {
                "chart": {
                    "result": [
                        {
                            "meta": {
                                "currency": "KRW",
                                "regularMarketPrice": 70000,
                            }
                        }
                    ]
                }
            }

    class _DummyClient:
        def __init__(self) -> None:
            self.requested_url: str | None = None

        async def get(self, url: str, **_kwargs: Any) -> _DummyResponse:
            self.requested_url = url
            return _DummyResponse()

    async def _run() -> None:
        client = _DummyClient()
        price, currency = await price_service._fetch_stock_yahoo(client, _StubHolding("005930.KR"))
        assert price == Decimal("70000")
        assert currency == "KRW"
        assert client.requested_url is not None
        assert client.requested_url.endswith("/005930")

    asyncio.run(_run())


def test_price_service_consume_future_exception_handles_failed_future() -> None:
    loop = asyncio.new_event_loop()
    previous_loop = None
    try:
        try:
            previous_loop = asyncio.get_event_loop()
        except RuntimeError:
            previous_loop = None
        asyncio.set_event_loop(loop)
        failed: asyncio.Future[tuple[Decimal | None, str | None, str, bool]] = loop.create_future()
        failed.set_exception(RuntimeError("provider failure"))
        price_service._consume_future_exception(failed)
        assert failed.done()
    finally:
        asyncio.set_event_loop(previous_loop)
        loop.close()


def test_dashboard_manual_asset_prices_do_not_leak_across_households() -> None:
    with TestClient(app) as client:
        token_a = _auth(client, f"manual-isolation-a-{uuid.uuid4().hex}@example.com", "Password1234", "ManualIsoA")
        token_b = _auth(client, f"manual-isolation-b-{uuid.uuid4().hex}@example.com", "Password1234", "ManualIsoB")
        shared_symbol = f"MANUAL-SHARED-{uuid.uuid4().hex[:8].upper()}"

        create_a = client.post(
            "/api/v1/holdings",
            headers=_headers(token_a),
            json={
                "asset_type": "cash",
                "symbol": shared_symbol,
                "market_symbol": shared_symbol,
                "name": "Manual Shared A",
                "category": "현금성",
                "quantity": 1,
                "average_cost": 1000,
                "currency": "KRW",
            },
        )
        create_b = client.post(
            "/api/v1/holdings",
            headers=_headers(token_b),
            json={
                "asset_type": "cash",
                "symbol": shared_symbol,
                "market_symbol": shared_symbol,
                "name": "Manual Shared B",
                "category": "현금성",
                "quantity": 1,
                "average_cost": 9000,
                "currency": "KRW",
            },
        )
        assert create_a.status_code == 201
        assert create_b.status_code == 201

        refresh_a = client.post("/api/v1/prices/refresh", headers=_headers(token_a))
        refresh_b = client.post("/api/v1/prices/refresh", headers=_headers(token_b))
        assert refresh_a.status_code == 200
        assert refresh_b.status_code == 200

        def _wait_refresh_done(token: str) -> None:
            deadline = time.time() + 30
            while time.time() < deadline:
                status_resp = client.get("/api/v1/prices/status", headers=_headers(token))
                assert status_resp.status_code == 200
                if not bool(status_resp.json().get("refresh_in_progress")):
                    return
                time.sleep(0.2)
            raise AssertionError("price refresh did not finish in time")

        _wait_refresh_done(token_a)
        _wait_refresh_done(token_b)

        portfolio_a = client.get("/api/v1/dashboard/portfolio", headers=_headers(token_a))
        portfolio_b = client.get("/api/v1/dashboard/portfolio", headers=_headers(token_b))
        assert portfolio_a.status_code == 200
        assert portfolio_b.status_code == 200

        item_a = next(item for item in portfolio_a.json()["items"] if item["market_symbol"] == shared_symbol)
        item_b = next(item for item in portfolio_b.json()["items"] if item["market_symbol"] == shared_symbol)
        assert float(item_a["invested_krw"]) == 1000.0
        assert float(item_b["invested_krw"]) == 9000.0
        assert float(item_a["market_value_krw"]) == 1000.0
        assert float(item_b["market_value_krw"]) == 9000.0

        with SessionLocal() as db:
            leaked_snapshot = db.scalar(
                select(PriceSnapshot).where(
                    PriceSnapshot.asset_type == AssetType.cash,
                    PriceSnapshot.symbol == shared_symbol,
                )
            )
            assert leaked_snapshot is None


def test_import_path_is_restricted() -> None:
    with TestClient(app) as client:
        token = _auth(client, "import-path@example.com", "Password1234", "ImportPath")
        blocked = client.post(
            "/api/v1/imports/workbook",
            headers=_headers(token),
            json={"mode": "dry_run", "workbook_path": "../README.md"},
        )
        assert blocked.status_code == 400
        error_payload = blocked.json()["error"]
        assert error_payload["code"] == "IMPORT_PATH_NOT_ALLOWED"


def test_import_upload_rejects_invalid_extension() -> None:
    with TestClient(app) as client:
        token = _auth(client, "import-extension@example.com", "Password1234", "ImportExtension")
        response = client.post(
            "/api/v1/imports/workbook/upload?mode=dry_run",
            headers=_headers(token),
            files={"file": ("workbook.txt", io.BytesIO(b"not-xlsx"), "text/plain")},
        )
        assert response.status_code == 400
        error_payload = response.json()["error"]
        assert error_payload["code"] == "IMPORT_WORKBOOK_EXTENSION_INVALID"


def test_import_upload_rejects_oversized_file() -> None:
    with TestClient(app) as client:
        token = _auth(client, "import-oversize@example.com", "Password1234", "ImportOversize")
        previous_limit = settings.import_max_upload_bytes
        settings.import_max_upload_bytes = 8
        try:
            response = client.post(
                "/api/v1/imports/workbook/upload?mode=dry_run",
                headers=_headers(token),
                files={
                    "file": (
                        "workbook.xlsx",
                        io.BytesIO(b"0123456789"),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                },
            )
        finally:
            settings.import_max_upload_bytes = previous_limit

        assert response.status_code == 413
        error_payload = response.json()["error"]
        assert error_payload["code"] == "IMPORT_FILE_TOO_LARGE"
