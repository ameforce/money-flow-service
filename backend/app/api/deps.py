from __future__ import annotations

from datetime import UTC, datetime
import hmac
from typing import Annotated
from urllib.parse import urlparse

from fastapi import Depends, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_access_token
from app.core.errors import app_error
from app.db.models import Household, HouseholdMember, MemberRole, RevokedToken, User
from app.db.session import get_db


bearer_scheme = HTTPBearer(auto_error=False)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _normalize_origin(value: str | None) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = urlparse(text)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _enforce_cookie_csrf(request: Request) -> None:
    method = str(request.method or "").upper()
    if method in {"GET", "HEAD", "OPTIONS"}:
        return
    origin = _normalize_origin(request.headers.get("origin"))
    if origin:
        allowed = {_normalize_origin(item) for item in settings.allowed_origins}
        if origin not in allowed:
            raise app_error(
                status_code=status.HTTP_403_FORBIDDEN,
                code="AUTH_CSRF_ORIGIN_FORBIDDEN",
                message="허용되지 않은 출처(origin) 요청입니다.",
                action="동일한 출처에서 다시 시도해 주세요.",
            )
    csrf_cookie = str(request.cookies.get(settings.auth_csrf_cookie_name) or "").strip()
    csrf_header = str(request.headers.get(settings.auth_csrf_header_name) or "").strip()
    if not csrf_cookie or not csrf_header or not hmac.compare_digest(csrf_cookie, csrf_header):
        raise app_error(
            status_code=status.HTTP_403_FORBIDDEN,
            code="AUTH_CSRF_INVALID",
            message="요청 검증에 실패했습니다.",
            action="페이지를 새로고침한 뒤 다시 시도해 주세요.",
        )


def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    raw_token = ""
    used_cookie_auth = False
    if credentials is not None and str(credentials.credentials or "").strip():
        raw_token = str(credentials.credentials).strip()
    if not raw_token:
        raw_token = str(request.cookies.get(settings.auth_access_cookie_name) or "").strip()
        used_cookie_auth = bool(raw_token)
    if used_cookie_auth:
        _enforce_cookie_csrf(request)
    if not raw_token:
        raise app_error(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_TOKEN_MISSING",
            message="로그인이 필요합니다.",
            action="다시 로그인해 주세요.",
        )
    try:
        payload = decode_access_token(raw_token)
        user_id = str(payload["sub"])
    except Exception as error:  # noqa: BLE001
        raise app_error(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_TOKEN_INVALID",
            message="인증 토큰이 유효하지 않습니다.",
            action="다시 로그인해 주세요.",
        ) from error

    user = db.get(User, user_id)
    if user is None:
        raise app_error(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTH_USER_NOT_FOUND",
            message="사용자 정보를 찾을 수 없습니다.",
            action="다시 로그인해 주세요.",
        )
    token_jti = str(payload.get("jti") or "")
    if token_jti:
        revoked = db.get(RevokedToken, token_jti)
        if revoked is not None:
            # Revoked token is always invalid regardless of expiry metadata.
            if revoked.expires_at and _as_utc(revoked.expires_at) <= datetime.now(UTC):
                db.delete(revoked)
                db.commit()
            raise app_error(
                status_code=status.HTTP_401_UNAUTHORIZED,
                code="AUTH_TOKEN_INVALID",
                message="인증 토큰이 유효하지 않습니다.",
                action="다시 로그인해 주세요.",
            )
    return user


def get_current_household(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> tuple[Household, HouseholdMember]:
    memberships = db.scalars(
        select(HouseholdMember)
        .where(HouseholdMember.user_id == user.id)
        .order_by(HouseholdMember.created_at.asc())
    ).all()
    if not memberships:
        raise app_error(
            status_code=status.HTTP_403_FORBIDDEN,
            code="HOUSEHOLD_MEMBERSHIP_MISSING",
            message="가계 구성원 정보가 없습니다.",
            action="관리자에게 가계 초대 상태를 확인해 달라고 요청해 주세요.",
        )

    requested_household_id = str(request.headers.get("x-household-id") or "").strip()
    by_household_id = {str(item.household_id): item for item in memberships}
    member: HouseholdMember | None = None
    if requested_household_id:
        member = by_household_id.get(requested_household_id)
        if member is None:
            raise app_error(
                status_code=status.HTTP_403_FORBIDDEN,
                code="HOUSEHOLD_ACCESS_FORBIDDEN",
                message="요청한 가계에 접근할 수 없습니다.",
                action="가계 식별자를 확인한 뒤 다시 시도해 주세요.",
            )
    else:
        active_household_id = str(user.active_household_id or "").strip()
        member = by_household_id.get(active_household_id)
        if member is None:
            member = memberships[0]

    household = db.get(Household, member.household_id)
    if household is None:
        raise app_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="HOUSEHOLD_NOT_FOUND",
            message="가계 정보를 찾을 수 없습니다.",
            action="다시 로그인하거나 관리자에게 문의해 주세요.",
        )
    return household, member


def require_editor_household(
    ctx: Annotated[tuple[Household, HouseholdMember], Depends(get_current_household)],
) -> tuple[Household, HouseholdMember]:
    household, member = ctx
    if member.role not in {MemberRole.owner, MemberRole.co_owner, MemberRole.editor}:
        raise app_error(
            status_code=status.HTTP_403_FORBIDDEN,
            code="HOUSEHOLD_ROLE_FORBIDDEN",
            message="수정 권한이 없습니다.",
            action="가계 owner/co-owner/editor 권한을 요청해 주세요.",
        )
    return household, member


def require_co_owner_household(
    ctx: Annotated[tuple[Household, HouseholdMember], Depends(get_current_household)],
) -> tuple[Household, HouseholdMember]:
    household, member = ctx
    if member.role not in {MemberRole.owner, MemberRole.co_owner}:
        raise app_error(
            status_code=status.HTTP_403_FORBIDDEN,
            code="HOUSEHOLD_ROLE_FORBIDDEN",
            message="구성원/초대 관리 권한이 없습니다.",
            action="가계 owner/co-owner 권한을 요청해 주세요.",
        )
    return household, member


def require_owner_household(
    ctx: Annotated[tuple[Household, HouseholdMember], Depends(get_current_household)],
) -> tuple[Household, HouseholdMember]:
    household, member = ctx
    if member.role != MemberRole.owner:
        raise app_error(
            status_code=status.HTTP_403_FORBIDDEN,
            code="HOUSEHOLD_ROLE_FORBIDDEN",
            message="소유자 권한이 필요합니다.",
            action="가계 owner 권한을 요청해 주세요.",
        )
    return household, member
