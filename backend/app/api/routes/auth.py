from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hmac
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import bearer_scheme, get_current_user
from app.core.errors import app_error
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    generate_opaque_token,
    hash_opaque_token,
    hash_password,
    verify_password,
)
from app.db.models import (
    EmailVerificationToken,
    Household,
    HouseholdMember,
    LoginThrottle,
    MemberRole,
    RegisterThrottle,
    RevokedToken,
    User,
)
from app.core.config import settings
from app.db.session import get_db
from app.schemas import (
    AuthClientConfigResponse,
    AuthRefreshResponse,
    AuthResponse,
    LoginRequest,
    RegisterRequest,
    RegisterResponse,
    ResendVerificationRequest,
    UserRead,
    VerifyEmailRequest,
)
from app.services.email_service import email_service


router = APIRouter(prefix="/auth", tags=["auth"])

_LOGIN_WINDOW_SECONDS = 300
_LOGIN_MAX_ATTEMPTS = 5
_LOGIN_IP_MAX_ATTEMPTS = 40
_RESEND_VERIFICATION_MAX_ATTEMPTS = 5
_RESEND_VERIFICATION_IP_MAX_ATTEMPTS = 20
_DEBUG_TOKEN_OPT_IN_HEADER = "x-debug-token-opt-in"
_VERIFICATION_TOKEN_ISSUE_RETRIES = 3
_HOUSEHOLD_NAME_SUFFIX = "의 가계부"
_HOUSEHOLD_NAME_MAX_LENGTH = 120


def _register_attempt_key(email: str, ip: str | None) -> str:
    return f"{email.lower()}::{ip or 'unknown'}"


def _register_ip_attempt_key(ip: str | None) -> str:
    return f"ip::{ip or 'unknown'}"


def _resend_attempt_key(email: str, ip: str | None) -> str:
    return f"resend::{email.lower()}::{ip or 'unknown'}"


def _resend_ip_attempt_key(ip: str | None) -> str:
    return f"resend-ip::{ip or 'unknown'}"


def _login_attempt_key(email: str, ip: str | None) -> str:
    return f"{email.lower()}::{ip or 'unknown'}"


def _login_ip_attempt_key(ip: str | None) -> str:
    return f"ip::{ip or 'unknown'}"


def _should_enforce_ip_global_auth_throttle() -> bool:
    return settings.env.lower() != "test"


def _register_ip_max_attempts() -> int:
    return max(20, int(settings.register_rate_limit_max_attempts) * 5)


def _resend_ip_max_attempts() -> int:
    return max(_RESEND_VERIFICATION_IP_MAX_ATTEMPTS, int(settings.register_rate_limit_max_attempts) * 2)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _set_auth_cookies(response: Response, *, access_token: str, refresh_token: str, remember_me: bool) -> None:
    secure = bool(settings.auth_cookie_secure)
    samesite = settings.auth_cookie_samesite
    common = {
        "httponly": True,
        "secure": secure,
        "samesite": samesite,
        "path": "/",
    }
    access_kwargs = dict(common)
    if remember_me:
        access_kwargs["max_age"] = max(60, int(settings.access_token_minutes) * 60)
    response.set_cookie(
        key=settings.auth_access_cookie_name,
        value=access_token,
        **access_kwargs,
    )
    refresh_kwargs = dict(common)
    if remember_me:
        refresh_kwargs["max_age"] = max(60, int(settings.refresh_token_days) * 24 * 60 * 60)
    response.set_cookie(
        key=settings.auth_refresh_cookie_name,
        value=refresh_token,
        **refresh_kwargs,
    )
    csrf_token = generate_opaque_token(nbytes=24)
    response.set_cookie(
        key=settings.auth_csrf_cookie_name,
        value=csrf_token,
        httponly=False,
        secure=secure,
        samesite=samesite,
        path="/",
        max_age=max(60, int(settings.refresh_token_days) * 24 * 60 * 60) if remember_me else None,
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(key=settings.auth_access_cookie_name, path="/")
    response.delete_cookie(key=settings.auth_refresh_cookie_name, path="/")
    response.delete_cookie(key=settings.auth_csrf_cookie_name, path="/")


def _auth_error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    action: str,
    clear_cookies: bool = False,
) -> JSONResponse:
    error_response = JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message, "action": action}},
    )
    if clear_cookies:
        _clear_auth_cookies(error_response)
    return error_response


def _normalize_origin(value: str | None) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _request_origin_or_referer(request: Request) -> str:
    origin = _normalize_origin(request.headers.get("origin"))
    if origin:
        return origin
    return _normalize_origin(request.headers.get("referer"))


def _verify_allowed_origin(request: Request, *, allow_missing: bool = True) -> None:
    request_origin = _request_origin_or_referer(request)
    if not request_origin:
        if allow_missing:
            # Non-browser clients can omit Origin/Referer.
            return
        raise app_error(
            status_code=403,
            code="AUTH_CSRF_ORIGIN_REQUIRED",
            message="Origin 또는 Referer 헤더가 필요합니다.",
            action="허용된 출처에서 다시 시도해 주세요.",
        )
    allowed = {_normalize_origin(item) for item in settings.allowed_origins}
    if request_origin in allowed:
        return
    raise app_error(
        status_code=403,
        code="AUTH_CSRF_ORIGIN_FORBIDDEN",
        message="허용되지 않은 출처(origin) 요청입니다.",
        action="동일한 출처에서 다시 시도해 주세요.",
    )


def _verify_csrf_for_cookie_request(request: Request, *, enforce_for_cookie_path: bool = False) -> None:
    has_cookie_auth = bool(
        str(request.cookies.get(settings.auth_access_cookie_name) or "").strip()
        or str(request.cookies.get(settings.auth_refresh_cookie_name) or "").strip()
    )
    if not has_cookie_auth and not enforce_for_cookie_path:
        return
    method = str(request.method or "").upper()
    if method in {"GET", "HEAD", "OPTIONS"}:
        return
    _verify_allowed_origin(request)
    csrf_cookie = str(request.cookies.get(settings.auth_csrf_cookie_name) or "").strip()
    csrf_header = str(request.headers.get(settings.auth_csrf_header_name) or "").strip()
    if not csrf_cookie or not csrf_header or not hmac.compare_digest(csrf_cookie, csrf_header):
        raise app_error(
            status_code=403,
            code="AUTH_CSRF_INVALID",
            message="요청 검증에 실패했습니다.",
            action="페이지를 새로고침한 뒤 다시 시도해 주세요.",
        )


def _should_include_body_token(request: Request | None) -> bool:
    if request is None:
        return False
    if settings.env.lower() not in {"test"}:
        return False
    mode = str(request.headers.get("x-auth-token-mode") or "").strip().lower()
    return mode in {"body", "bearer", "response"}


@router.get("/client-config", response_model=AuthClientConfigResponse)
def get_client_config() -> AuthClientConfigResponse:
    return AuthClientConfigResponse(
        csrf_cookie_name=settings.auth_csrf_cookie_name,
        csrf_header_name=settings.auth_csrf_header_name,
        household_header_name="x-household-id",
    )


def _upsert_revoked_token(db: Session, jti: str, exp_unix: int) -> None:
    expires_at = datetime.fromtimestamp(exp_unix, tz=UTC)
    revoked = db.get(RevokedToken, jti)
    if revoked is None:
        db.add(RevokedToken(jti=jti, expires_at=expires_at))
    else:
        revoked.expires_at = expires_at


def _try_revoke_refresh_token_once(db: Session, jti: str, exp_unix: int) -> bool:
    expires_at = datetime.fromtimestamp(exp_unix, tz=UTC)
    db.add(RevokedToken(jti=jti, expires_at=expires_at))
    try:
        db.flush()
        return True
    except IntegrityError:
        db.rollback()
        return False


def _revoke_token(
    db: Session,
    *,
    raw_token: str | None,
    decoder,
    fallback_exp_seconds: int,
) -> bool:
    token = str(raw_token or "").strip()
    if not token:
        return False
    try:
        payload = decoder(token)
    except Exception:  # noqa: BLE001
        return False
    jti = str(payload.get("jti") or "").strip()
    if not jti:
        return False
    exp = int(payload.get("exp") or int((datetime.now(UTC) + timedelta(seconds=fallback_exp_seconds)).timestamp()))
    _upsert_revoked_token(db, jti, exp)
    return True


def _is_token_revoked(db: Session, jti: str) -> bool:
    revoked = db.get(RevokedToken, jti)
    if revoked is None:
        return False
    if revoked.expires_at and _as_utc(revoked.expires_at) <= datetime.now(UTC):
        db.delete(revoked)
        db.commit()
    return True


def _has_active_revoked_token(db: Session, jti: str) -> bool:
    revoked = db.get(RevokedToken, jti)
    return revoked is not None


def _household_name_from_display_name(display_name: str) -> str:
    prefix = str(display_name or "").strip() or "사용자"
    max_prefix = max(1, _HOUSEHOLD_NAME_MAX_LENGTH - len(_HOUSEHOLD_NAME_SUFFIX))
    return f"{prefix[:max_prefix]}{_HOUSEHOLD_NAME_SUFFIX}"


def _create_household_for_user(db: Session, user: User) -> Household:
    household = Household(name=_household_name_from_display_name(user.display_name), base_currency="KRW")
    db.add(household)
    return household


def _issue_verification_token(db: Session, user: User) -> tuple[str, datetime]:
    for _attempt in range(_VERIFICATION_TOKEN_ISSUE_RETRIES):
        now = datetime.now(UTC)
        raw_token = generate_opaque_token()
        token_hash = hash_opaque_token(raw_token)
        expires_at = now + timedelta(minutes=max(5, int(settings.auth_verification_token_minutes)))
        try:
            with db.begin_nested():
                db.query(EmailVerificationToken).filter(
                    EmailVerificationToken.user_id == user.id,
                    EmailVerificationToken.consumed_at.is_(None),
                ).update({"consumed_at": now}, synchronize_session=False)
                db.add(
                    EmailVerificationToken(
                        user_id=user.id,
                        token_hash=token_hash,
                        sent_to=user.email,
                        expires_at=expires_at,
                    )
                )
                db.flush()
            return raw_token, expires_at
        except IntegrityError as error:
            detail = str(getattr(error, "orig", error)).lower()
            if "token_hash" in detail:
                continue
            raise
    raise app_error(
        status_code=503,
        code="AUTH_VERIFICATION_TOKEN_ISSUE_FAILED",
        message="인증 토큰을 발급하지 못했습니다.",
        action="잠시 후 다시 시도해 주세요.",
    )


def _is_debug_token_opted_in(request: Request | None) -> bool:
    if request is None:
        return False
    value = str(request.headers.get(_DEBUG_TOKEN_OPT_IN_HEADER) or "").strip().lower()
    return value in {"1", "true", "yes", "y", "on"}


def _is_debug_token_enabled(request: Request | None) -> bool:
    if not settings.auth_debug_return_verify_token:
        return False
    env_name = settings.env.lower()
    if env_name not in {"dev", "test", "local"}:
        return False
    return _is_debug_token_opted_in(request)


def _maybe_debug_verification_token(token: str, request: Request | None) -> str | None:
    if not _is_debug_token_enabled(request):
        return None
    return token


def _verification_ack_message() -> str:
    base_message = "요청이 접수되었습니다. 가입된 계정이 있으면 인증 메일을 발송합니다."
    env_name = str(settings.env or "").strip().lower()
    if settings.email_delivery_mode != "log":
        return base_message
    if env_name in {"prod", "production"}:
        return base_message
    # Local/dev/test should make delivery mode explicit to avoid false-positive signup UX.
    return (
        f"{base_message} "
        "현재 서버는 EMAIL_DELIVERY_MODE=log 설정이어서 실제 이메일은 전송되지 않습니다. "
        "SMTP 설정 후 다시 시도해 주세요."
    )


def _verification_response(
    *,
    email: str,
    expires_at: datetime,
    token: str,
    sent: bool,
    request: Request | None,
) -> RegisterResponse:
    remaining = max(0, int((expires_at - datetime.now(UTC)).total_seconds()))
    message = _verification_ack_message()
    if not sent:
        message = _verification_ack_message()
    return RegisterResponse(
        status="verification_required",
        email=email,
        message=message,
        verification_expires_in_seconds=remaining,
        debug_verification_token=_maybe_debug_verification_token(token, request),
    )


def _resend_ack_response(email: str) -> RegisterResponse:
    ttl_seconds = max(5, int(settings.auth_verification_token_minutes)) * 60
    return RegisterResponse(
        status="verification_required",
        email=email,
        message=_verification_ack_message(),
        verification_expires_in_seconds=ttl_seconds,
    )


def _consume_verification_token_if_pending(db: Session, raw_token: str) -> None:
    db.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.token_hash == hash_opaque_token(raw_token),
            EmailVerificationToken.consumed_at.is_(None),
        )
        .values(consumed_at=datetime.now(UTC))
        .execution_options(synchronize_session=False)
    )
    db.commit()


def _raise_if_smtp_delivery_failed(
    *,
    sent: bool,
    scope: str,
    db: Session | None = None,
    raw_token: str | None = None,
    cleanup_unverified_user_id: str | None = None,
) -> None:
    if sent or settings.email_delivery_mode != "smtp":
        return
    if db is not None:
        try:
            if raw_token:
                _consume_verification_token_if_pending(db, raw_token)
            if cleanup_unverified_user_id:
                cleanup_user = db.get(User, cleanup_unverified_user_id)
                if cleanup_user is not None and not bool(cleanup_user.email_verified):
                    _delete_user_and_orphan_households(db, cleanup_user)
                    db.commit()
        except Exception:
            db.rollback()
    raise app_error(
        status_code=503,
        code="AUTH_EMAIL_DELIVERY_FAILED",
        message="인증 메일 전송에 실패했습니다.",
        action=f"{scope} 요청을 잠시 후 다시 시도해 주세요.",
    )


def _maybe_cleanup_auth_artifacts(db: Session, now: datetime) -> None:
    if int(now.timestamp()) % 30 != 0:
        return
    login_window_ttl = max(3600, _LOGIN_WINDOW_SECONDS * 4)
    register_window = max(60, int(settings.register_rate_limit_window_seconds))
    register_window_ttl = max(3600, register_window * 4)
    db.execute(
        delete(RevokedToken)
        .where(RevokedToken.expires_at <= now)
        .execution_options(synchronize_session=False)
    )
    db.execute(
        delete(LoginThrottle)
        .where(LoginThrottle.window_started_at < now - timedelta(seconds=login_window_ttl))
        .execution_options(synchronize_session=False)
    )
    db.execute(
        delete(RegisterThrottle)
        .where(RegisterThrottle.window_started_at < now - timedelta(seconds=register_window_ttl))
        .execution_options(synchronize_session=False)
    )


def _consume_register_attempt(
    db: Session,
    *,
    key: str,
    now: datetime,
    max_attempts_override: int | None = None,
) -> None:
    window_seconds = max(60, int(settings.register_rate_limit_window_seconds))
    max_attempts = max_attempts_override or int(settings.register_rate_limit_max_attempts)
    max_attempts = max(1, int(max_attempts))
    window_cutoff = now - timedelta(seconds=window_seconds)
    _maybe_cleanup_auth_artifacts(db, now)
    for _ in range(4):
        try:
            updated = db.execute(
                update(RegisterThrottle)
                .where(RegisterThrottle.key == key)
                .values(
                    attempt_count=case(
                        (RegisterThrottle.window_started_at < window_cutoff, 1),
                        else_=RegisterThrottle.attempt_count + 1,
                    ),
                    window_started_at=case(
                        (RegisterThrottle.window_started_at < window_cutoff, now),
                        else_=RegisterThrottle.window_started_at,
                    ),
                )
            )
            if int(updated.rowcount or 0) == 0:
                db.add(RegisterThrottle(key=key, attempt_count=1, window_started_at=now))
            db.commit()
        except IntegrityError:
            db.rollback()
            continue

        throttle = db.get(RegisterThrottle, key)
        if throttle is None:
            return
        started_at = _as_utc(throttle.window_started_at)
        if now - started_at <= timedelta(seconds=window_seconds) and int(throttle.attempt_count) > max_attempts:
            raise app_error(
                status_code=429,
                code="AUTH_REGISTER_RATE_LIMITED",
                message="회원가입 시도 횟수가 너무 많습니다.",
                action="잠시 후 다시 시도해 주세요.",
            )
        return

    raise app_error(
        status_code=503,
        code="AUTH_REGISTER_THROTTLE_UNAVAILABLE",
        message="회원가입 보호 장치를 일시적으로 사용할 수 없습니다.",
        action="잠시 후 다시 시도해 주세요.",
    )


def _record_login_failure(db: Session, *, key: str, now: datetime) -> None:
    _maybe_cleanup_auth_artifacts(db, now)
    for _ in range(3):
        try:
            updated = db.execute(
                update(LoginThrottle)
                .where(LoginThrottle.key == key)
                .values(failed_count=LoginThrottle.failed_count + 1)
            )
            if int(updated.rowcount or 0) > 0:
                db.commit()
                return
            db.add(LoginThrottle(key=key, failed_count=1, window_started_at=now))
            db.commit()
            return
        except IntegrityError:
            db.rollback()

    db.execute(
        update(LoginThrottle)
        .where(LoginThrottle.key == key)
        .values(failed_count=LoginThrottle.failed_count + 1)
    )
    db.commit()


def _consume_resend_attempt(
    db: Session,
    *,
    key: str,
    now: datetime,
    max_attempts_override: int | None = None,
) -> None:
    window_seconds = max(60, int(settings.register_rate_limit_window_seconds))
    max_attempts = max_attempts_override or _RESEND_VERIFICATION_MAX_ATTEMPTS
    max_attempts = max(1, int(max_attempts))
    window_cutoff = now - timedelta(seconds=window_seconds)
    _maybe_cleanup_auth_artifacts(db, now)
    for _ in range(4):
        try:
            updated = db.execute(
                update(RegisterThrottle)
                .where(RegisterThrottle.key == key)
                .values(
                    attempt_count=case(
                        (RegisterThrottle.window_started_at < window_cutoff, 1),
                        else_=RegisterThrottle.attempt_count + 1,
                    ),
                    window_started_at=case(
                        (RegisterThrottle.window_started_at < window_cutoff, now),
                        else_=RegisterThrottle.window_started_at,
                    ),
                )
            )
            if int(updated.rowcount or 0) == 0:
                db.add(RegisterThrottle(key=key, attempt_count=1, window_started_at=now))
            db.commit()
        except IntegrityError:
            db.rollback()
            continue

        throttle = db.get(RegisterThrottle, key)
        if throttle is None:
            return
        started_at = _as_utc(throttle.window_started_at)
        if now - started_at <= timedelta(seconds=window_seconds) and int(throttle.attempt_count) > max_attempts:
            raise app_error(
                status_code=429,
                code="AUTH_RESEND_RATE_LIMITED",
                message="인증 메일 재전송 시도 횟수가 너무 많습니다.",
                action="잠시 후 다시 시도해 주세요.",
            )
        return

    raise app_error(
        status_code=503,
        code="AUTH_RESEND_THROTTLE_UNAVAILABLE",
        message="재전송 보호 장치를 일시적으로 사용할 수 없습니다.",
        action="잠시 후 다시 시도해 주세요.",
    )


def _delete_user_and_orphan_households(db: Session, user: User) -> None:
    household_ids = {
        str(item or "").strip()
        for item in db.scalars(select(HouseholdMember.household_id).where(HouseholdMember.user_id == user.id)).all()
        if str(item or "").strip()
    }
    db.delete(user)
    db.flush()
    for household_id in household_ids:
        has_member = db.scalar(select(HouseholdMember.id).where(HouseholdMember.household_id == household_id).limit(1))
        if has_member is not None:
            continue
        orphan_household = db.get(Household, household_id)
        if orphan_household is not None:
            db.delete(orphan_household)


def _lock_user_for_household_bootstrap(db: Session, user_id: str) -> User | None:
    return db.scalar(
        select(User)
        .where(User.id == user_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )


def _ensure_default_household_membership(db: Session, user: User) -> None:
    if user.active_household_id is not None:
        return

    existing_household_id = db.scalar(
        select(HouseholdMember.household_id)
        .where(HouseholdMember.user_id == user.id)
        .limit(1)
    )
    if existing_household_id is not None:
        user.active_household_id = existing_household_id
        return

    household = _create_household_for_user(db, user)
    db.flush()
    claimed = db.execute(
        update(User)
        .where(
            User.id == user.id,
            User.active_household_id.is_(None),
        )
        .values(active_household_id=household.id)
    )
    if int(claimed.rowcount or 0) > 0:
        db.add(HouseholdMember(household_id=household.id, user_id=user.id, role=MemberRole.owner))
        user.active_household_id = household.id
        return

    # Another concurrent request already assigned the default household.
    db.delete(household)
    db.flush()
    latest_household_id = db.scalar(select(User.active_household_id).where(User.id == user.id))
    if latest_household_id is not None:
        user.active_household_id = latest_household_id
        return

    fallback_household_id = db.scalar(
        select(HouseholdMember.household_id)
        .where(HouseholdMember.user_id == user.id)
        .limit(1)
    )
    if fallback_household_id is not None:
        user.active_household_id = fallback_household_id


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> RegisterResponse:
    now = datetime.now(UTC)
    normalized_email = payload.email.lower()
    client_ip = getattr(getattr(request, "client", None), "host", None)
    limit_key = _register_attempt_key(normalized_email, client_ip)
    _consume_register_attempt(db, key=limit_key, now=now)
    if _should_enforce_ip_global_auth_throttle():
        _consume_register_attempt(
            db,
            key=_register_ip_attempt_key(client_ip),
            now=now,
            max_attempts_override=_register_ip_max_attempts(),
        )

    existing = db.scalar(select(User).where(func.lower(User.email) == normalized_email))
    if existing is not None and bool(existing.email_verified):
        _clear_auth_cookies(response)
        return _resend_ack_response(normalized_email)
    if existing is not None and not bool(existing.email_verified):
        ttl_hours = max(1, int(settings.register_unverified_ttl_hours))
        created_at = _as_utc(existing.created_at)
        if created_at + timedelta(hours=ttl_hours) < now:
            _delete_user_and_orphan_households(db, existing)
            db.commit()
            existing = None

    user = existing
    created_new_user = False
    if user is None:
        created_new_user = True
        initial_password_hash = hash_password(payload.password)
        if settings.auth_email_verification_required:
            # Credentials are finalized at verify-email step to avoid pre-verification account takeover races.
            initial_password_hash = hash_password(generate_opaque_token())
        user = User(
            email=normalized_email,
            password_hash=initial_password_hash,
            display_name=payload.display_name.strip(),
            email_verified=not settings.auth_email_verification_required,
            email_verified_at=now if not settings.auth_email_verification_required else None,
        )
        db.add(user)
        try:
            db.flush()
        except IntegrityError as error:
            db.rollback()
            raise app_error(
                status_code=409,
                code="AUTH_EMAIL_ALREADY_EXISTS",
                message="이미 가입된 이메일입니다.",
                action="로그인하거나 다른 이메일로 가입해 주세요.",
            ) from error

    if (not created_new_user) and user.active_household_id is None:
        locked_user = _lock_user_for_household_bootstrap(db, user.id)
        if locked_user is not None:
            user = locked_user

    _ensure_default_household_membership(db, user)

    if not settings.auth_email_verification_required:
        # Verification-disabled mode must finalize credentials for reused unverified accounts.
        user.password_hash = hash_password(payload.password)
        user.display_name = payload.display_name.strip()
        user.email_verified = True
        if user.email_verified_at is None:
            user.email_verified_at = now
        try:
            db.commit()
        except IntegrityError as error:
            db.rollback()
            raise app_error(
                status_code=409,
                code="AUTH_EMAIL_ALREADY_EXISTS",
                message="이미 가입된 이메일입니다.",
                action="로그인하거나 다른 이메일로 가입해 주세요.",
            ) from error
        db.refresh(user)
        access_token = create_access_token(user.id)
        refresh_token = create_refresh_token(user.id, extra={"remember_me": bool(payload.remember_me)})
        _set_auth_cookies(
            response,
            access_token=access_token,
            refresh_token=refresh_token,
            remember_me=bool(payload.remember_me),
        )
        include_body_token = _should_include_body_token(request)
        return RegisterResponse(
            status="registered",
            email=user.email,
            message="회원가입이 완료되었습니다.",
            access_token=access_token if include_body_token else None,
            token_type="bearer" if include_body_token else None,
            user=UserRead.model_validate(user),
        )

    raw_token, expires_at = _issue_verification_token(db, user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise app_error(
            status_code=409,
            code="AUTH_EMAIL_ALREADY_EXISTS",
            message="이미 가입된 이메일입니다.",
            action="로그인하거나 다른 이메일로 가입해 주세요.",
        ) from error
    sent = email_service.send_verification_email(
        to_email=user.email,
        token=raw_token,
        expires_minutes=max(5, int(settings.auth_verification_token_minutes)),
    )
    _raise_if_smtp_delivery_failed(
        sent=sent,
        scope="회원가입",
        db=db,
        raw_token=raw_token,
        cleanup_unverified_user_id=user.id if created_new_user else None,
    )
    _clear_auth_cookies(response)
    return _verification_response(
        email=user.email,
        expires_at=expires_at,
        token=raw_token,
        sent=sent,
        request=request,
    )


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
    _verify_allowed_origin(request, allow_missing=False)
    now = datetime.now(UTC)
    client_ip = getattr(getattr(request, "client", None), "host", None)
    limit_key = _login_attempt_key(payload.email, client_ip)
    ip_limit_key = _login_ip_attempt_key(client_ip)
    enforce_ip_global_throttle = _should_enforce_ip_global_auth_throttle()
    throttle_keys = [limit_key]
    if enforce_ip_global_throttle:
        throttle_keys.append(ip_limit_key)
    window_cutoff = now - timedelta(seconds=_LOGIN_WINDOW_SECONDS)
    try:
        db.execute(
            update(LoginThrottle)
            .where(
                LoginThrottle.key.in_(throttle_keys),
                LoginThrottle.window_started_at < window_cutoff,
            )
            .values(failed_count=0, window_started_at=now)
        )
        db.commit()
    except IntegrityError:
        db.rollback()

    throttle = db.get(LoginThrottle, limit_key)
    ip_throttle = db.get(LoginThrottle, ip_limit_key) if enforce_ip_global_throttle else None

    if throttle is not None and int(throttle.failed_count) >= _LOGIN_MAX_ATTEMPTS:
        raise app_error(
            status_code=429,
            code="AUTH_RATE_LIMITED",
            message="로그인 시도 횟수가 너무 많습니다.",
            action="잠시 후 다시 시도해 주세요.",
        )
    if ip_throttle is not None and int(ip_throttle.failed_count) >= _LOGIN_IP_MAX_ATTEMPTS:
        raise app_error(
            status_code=429,
            code="AUTH_RATE_LIMITED",
            message="로그인 시도 횟수가 너무 많습니다.",
            action="잠시 후 다시 시도해 주세요.",
        )

    user = db.scalar(select(User).where(func.lower(User.email) == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        _record_login_failure(db, key=limit_key, now=now)
        if enforce_ip_global_throttle:
            _record_login_failure(db, key=ip_limit_key, now=now)
        raise app_error(
            status_code=401,
            code="AUTH_INVALID_CREDENTIALS",
            message="이메일 또는 비밀번호가 올바르지 않습니다.",
            action="입력값을 확인하고 다시 시도해 주세요.",
        )
    if settings.auth_email_verification_required and not bool(user.email_verified):
        raise app_error(
            status_code=403,
            code="AUTH_EMAIL_NOT_VERIFIED",
            message="이메일 인증이 완료되지 않았습니다.",
            action="인증 메일 재전송 후 인증을 완료해 주세요.",
        )
    if throttle is not None:
        db.delete(throttle)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id, extra={"remember_me": bool(payload.remember_me)})
    _set_auth_cookies(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
        remember_me=bool(payload.remember_me),
    )
    include_body_token = _should_include_body_token(request)
    return AuthResponse(
        access_token=access_token if include_body_token else None,
        token_type="bearer" if include_body_token else None,
        user=UserRead.model_validate(user),
    )


@router.post("/refresh", response_model=AuthRefreshResponse)
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)) -> AuthRefreshResponse | JSONResponse:
    _verify_csrf_for_cookie_request(request)
    refresh_token = str(request.cookies.get(settings.auth_refresh_cookie_name) or "").strip()
    if not refresh_token:
        return _auth_error_response(
            status_code=401,
            code="AUTH_TOKEN_MISSING",
            message="로그인이 필요합니다.",
            action="다시 로그인해 주세요.",
            clear_cookies=True,
        )
    try:
        payload = decode_refresh_token(refresh_token)
    except Exception:  # noqa: BLE001
        return _auth_error_response(
            status_code=401,
            code="AUTH_TOKEN_INVALID",
            message="인증 토큰이 유효하지 않습니다.",
            action="다시 로그인해 주세요.",
            clear_cookies=True,
        )

    refresh_jti = str(payload.get("jti") or "").strip()
    user_id = str(payload.get("sub") or "")
    user = db.get(User, user_id)
    if user is None:
        return _auth_error_response(
            status_code=401,
            code="AUTH_USER_NOT_FOUND",
            message="사용자 정보를 찾을 수 없습니다.",
            action="다시 로그인해 주세요.",
            clear_cookies=True,
        )
    if settings.auth_email_verification_required and not bool(user.email_verified):
        return _auth_error_response(
            status_code=403,
            code="AUTH_EMAIL_NOT_VERIFIED",
            message="이메일 인증이 완료되지 않았습니다.",
            action="인증 메일 재전송 후 인증을 완료해 주세요.",
            clear_cookies=True,
        )

    remember_me = bool(payload.get("remember_me", True))
    current_access_token = str(request.cookies.get(settings.auth_access_cookie_name) or "").strip()
    try:
        if refresh_jti:
            refresh_exp = int(
                payload.get("exp")
                or int((datetime.now(UTC) + timedelta(days=settings.refresh_token_days)).timestamp())
            )
            revoked = _try_revoke_refresh_token_once(db, refresh_jti, refresh_exp)
            if not revoked:
                replayed = _has_active_revoked_token(db, refresh_jti)
                return _auth_error_response(
                    status_code=401,
                    code="AUTH_TOKEN_INVALID",
                    message="인증 토큰이 유효하지 않습니다.",
                    action="다시 로그인해 주세요.",
                    clear_cookies=not replayed,
                )
        if current_access_token:
            _revoke_token(
                db,
                raw_token=current_access_token,
                decoder=decode_access_token,
                fallback_exp_seconds=max(60, int(settings.access_token_minutes) * 60),
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        replayed = bool(refresh_jti) and _has_active_revoked_token(db, refresh_jti)
        return _auth_error_response(
            status_code=401,
            code="AUTH_TOKEN_INVALID",
            message="인증 토큰이 유효하지 않습니다.",
            action="다시 로그인해 주세요.",
            clear_cookies=not replayed,
        )
    access_token = create_access_token(user.id)
    next_refresh_token = create_refresh_token(user.id, extra={"remember_me": remember_me})
    _set_auth_cookies(
        response,
        access_token=access_token,
        refresh_token=next_refresh_token,
        remember_me=remember_me,
    )
    include_body_token = _should_include_body_token(request)
    return AuthRefreshResponse(
        access_token=access_token if include_body_token else None,
        token_type="bearer" if include_body_token else None,
    )


@router.post("/verify-email", response_model=AuthResponse)
def verify_email(payload: VerifyEmailRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
    now = datetime.now(UTC)
    token_hash = hash_opaque_token(payload.token)
    token_row = db.scalar(select(EmailVerificationToken).where(EmailVerificationToken.token_hash == token_hash))
    if token_row is None:
        raise app_error(
            status_code=400,
            code="AUTH_VERIFICATION_TOKEN_INVALID",
            message="이메일 인증 토큰이 유효하지 않습니다.",
            action="인증 메일 재전송 후 다시 시도해 주세요.",
        )
    if token_row.consumed_at is not None:
        raise app_error(
            status_code=400,
            code="AUTH_VERIFICATION_TOKEN_INVALID",
            message="이미 사용된 인증 토큰입니다.",
            action="인증 메일 재전송 후 다시 시도해 주세요.",
        )
    if _as_utc(token_row.expires_at) < now:
        token_row.consumed_at = now
        db.commit()
        raise app_error(
            status_code=400,
            code="AUTH_VERIFICATION_TOKEN_EXPIRED",
            message="이메일 인증 토큰이 만료되었습니다.",
            action="인증 메일을 재전송해 주세요.",
        )
    consumed_rows = db.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.id == token_row.id,
            EmailVerificationToken.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    ).rowcount
    if int(consumed_rows or 0) != 1:
        raise app_error(
            status_code=400,
            code="AUTH_VERIFICATION_TOKEN_INVALID",
            message="이미 사용된 인증 토큰입니다.",
            action="인증 메일 재전송 후 다시 시도해 주세요.",
        )

    user = db.get(User, token_row.user_id)
    if user is None:
        raise app_error(
            status_code=404,
            code="AUTH_USER_NOT_FOUND",
            message="사용자 정보를 찾을 수 없습니다.",
            action="다시 회원가입을 시도해 주세요.",
        )

    user.password_hash = hash_password(payload.password)
    display_name = str(payload.display_name or "").strip()
    if display_name:
        user.display_name = display_name
    user.email_verified = True
    user.email_verified_at = now
    if user.active_household_id is None:
        member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
        if member is not None:
            user.active_household_id = member.household_id
    db.commit()
    db.refresh(user)

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id, extra={"remember_me": bool(payload.remember_me)})
    _set_auth_cookies(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
        remember_me=bool(payload.remember_me),
    )
    include_body_token = _should_include_body_token(request)
    return AuthResponse(
        access_token=access_token if include_body_token else None,
        token_type="bearer" if include_body_token else None,
        user=UserRead.model_validate(user),
    )


@router.post("/resend-verification", response_model=RegisterResponse)
def resend_verification(
    payload: ResendVerificationRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> RegisterResponse:
    now = datetime.now(UTC)
    normalized_email = payload.email.lower()
    client_ip = getattr(getattr(request, "client", None), "host", None)
    _consume_resend_attempt(db, key=_resend_attempt_key(normalized_email, client_ip), now=now)
    if _should_enforce_ip_global_auth_throttle():
        _consume_resend_attempt(
            db,
            key=_resend_ip_attempt_key(client_ip),
            now=now,
            max_attempts_override=_resend_ip_max_attempts(),
        )
    user = db.scalar(select(User).where(func.lower(User.email) == normalized_email))
    if user is None:
        _clear_auth_cookies(response)
        return _resend_ack_response(normalized_email)
    if bool(user.email_verified):
        _clear_auth_cookies(response)
        return _resend_ack_response(normalized_email)

    db.execute(select(User.id).where(User.id == user.id).with_for_update()).first()
    cooldown = max(0, int(settings.auth_verification_resend_cooldown_seconds))
    latest = db.scalar(
        select(EmailVerificationToken)
        .where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.consumed_at.is_(None),
        )
        .order_by(EmailVerificationToken.created_at.desc())
        .with_for_update()
    )
    if latest is not None and (_as_utc(latest.created_at) + timedelta(seconds=cooldown)) > now:
        _clear_auth_cookies(response)
        return _resend_ack_response(normalized_email)

    raw_token, expires_at = _issue_verification_token(db, user)
    db.commit()
    sent = email_service.send_verification_email(
        to_email=user.email,
        token=raw_token,
        expires_minutes=max(5, int(settings.auth_verification_token_minutes)),
    )
    _raise_if_smtp_delivery_failed(sent=sent, scope="인증 메일 재발송", db=db, raw_token=raw_token)
    _clear_auth_cookies(response)
    return _verification_response(
        email=user.email,
        expires_at=expires_at,
        token=raw_token,
        sent=sent,
        request=request,
    )


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(user)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)] = None,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    has_bearer = bool(credentials is not None and str(credentials.credentials or "").strip())
    if not has_bearer:
        _verify_csrf_for_cookie_request(request, enforce_for_cookie_path=True)
    access_token = ""
    if credentials is not None:
        access_token = str(credentials.credentials or "")
    if not access_token:
        access_token = str(request.cookies.get(settings.auth_access_cookie_name) or "")
    refresh_token = str(request.cookies.get(settings.auth_refresh_cookie_name) or "")

    changed = False
    changed = _revoke_token(
        db,
        raw_token=access_token,
        decoder=decode_access_token,
        fallback_exp_seconds=max(60, int(settings.access_token_minutes) * 60),
    ) or changed
    changed = _revoke_token(
        db,
        raw_token=refresh_token,
        decoder=decode_refresh_token,
        fallback_exp_seconds=max(60, int(settings.refresh_token_days) * 24 * 60 * 60),
    ) or changed
    if changed:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    _clear_auth_cookies(response)
    return {"status": "ok"}
