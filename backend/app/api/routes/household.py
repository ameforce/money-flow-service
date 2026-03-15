from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from threading import Lock

import anyio
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import (
    get_current_household,
    get_current_user,
    require_co_owner_household,
)
from app.core.config import settings
from app.core.errors import app_error
from app.core.security import create_ws_ticket, generate_opaque_token, hash_opaque_token
from app.db.models import Household, HouseholdInvitation, HouseholdMember, InvitationStatus, MemberRole, User
from app.db.session import get_db
from app.schemas import (
    HouseholdCurrentResponse,
    HouseholdInvitationAcceptRequest,
    HouseholdInvitationAcceptResponse,
    HouseholdInvitationCreate,
    HouseholdInvitationRead,
    HouseholdListResponse,
    HouseholdMemberRead,
    HouseholdMemberRolePatch,
    HouseholdMembershipRead,
    HouseholdRead,
    HouseholdSettingsPatch,
    HouseholdSettingsRead,
    HouseholdSelectRequest,
)
from app.services.email_service import email_service
from app.services.profile import normalize_transaction_row_colors
from app.services.runtime import hub


router = APIRouter(prefix="/household", tags=["household"])
_invite_lock_registry_guard = Lock()
_DEBUG_TOKEN_OPT_IN_HEADER = "x-debug-token-opt-in"


class _InviteLockEntry:
    def __init__(self) -> None:
        self.lock = Lock()
        self.ref_count = 0


_invite_lock_registry: dict[str, _InviteLockEntry] = {}

ROLE_RANK = {
    MemberRole.viewer: 0,
    MemberRole.editor: 1,
    MemberRole.co_owner: 2,
    MemberRole.owner: 3,
}


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _lock_household_members(db: Session, household_id: str) -> dict[str, HouseholdMember]:
    rows = db.scalars(
        select(HouseholdMember)
        .where(HouseholdMember.household_id == household_id)
        .with_for_update()
    ).all()
    return {str(item.id): item for item in rows}


def _ensure_unique_member_display_name(
    db: Session,
    *,
    household_id: str,
    user_id: str,
    display_name: str | None,
) -> None:
    del db, household_id, user_id, display_name
    return None


@contextmanager
def _invite_creation_guard(household_id: str, normalized_email: str):
    key = f"{str(household_id).strip()}::{str(normalized_email).strip().lower()}"
    with _invite_lock_registry_guard:
        entry = _invite_lock_registry.get(key)
        if entry is None:
            entry = _InviteLockEntry()
            _invite_lock_registry[key] = entry
        entry.ref_count += 1
        guard = entry.lock
    guard.acquire()
    try:
        yield
    finally:
        guard.release()
        with _invite_lock_registry_guard:
            entry = _invite_lock_registry.get(key)
            if entry is not None:
                entry.ref_count = max(0, int(entry.ref_count) - 1)
                if entry.ref_count == 0:
                    _invite_lock_registry.pop(key, None)


def _to_member_read(member: HouseholdMember, user: User) -> HouseholdMemberRead:
    return HouseholdMemberRead(
        member_id=member.id,
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=member.role,
        created_at=member.created_at,
    )


def _to_invitation_read(
    invitation: HouseholdInvitation,
    *,
    inviter_display_name: str | None = None,
    debug_invite_token: str | None = None,
    status_override: InvitationStatus | None = None,
    household_name: str | None = None,
) -> HouseholdInvitationRead:
    return HouseholdInvitationRead(
        id=invitation.id,
        household_id=invitation.household_id,
        household_name=household_name,
        email=invitation.email,
        role=invitation.role,
        status=status_override or invitation.status,
        expires_at=invitation.expires_at,
        accepted_at=invitation.accepted_at,
        created_at=invitation.created_at,
        inviter_display_name=inviter_display_name,
        debug_invite_token=debug_invite_token,
    )


def _to_household_settings_read(household: Household) -> HouseholdSettingsRead:
    return HouseholdSettingsRead(
        household_id=str(household.id),
        name=str(household.name),
        base_currency=str(household.base_currency),
        transaction_row_colors=normalize_transaction_row_colors(household.transaction_row_colors),
    )


def _is_debug_token_opted_in(request: Request | None) -> bool:
    if request is None:
        return False
    value = str(request.headers.get(_DEBUG_TOKEN_OPT_IN_HEADER) or "").strip().lower()
    return value in {"1", "true", "yes", "y", "on"}


def _maybe_debug_invite_token(token: str, request: Request | None) -> str | None:
    if not settings.auth_debug_return_verify_token:
        return None
    env_name = settings.env.lower()
    if env_name not in {"dev", "test", "local"}:
        return None
    if not _is_debug_token_opted_in(request):
        return None
    return token


def _revoke_pending_invitation_after_delivery_failure(db: Session, invitation_id: str) -> None:
    now = _now()
    db.execute(
        update(HouseholdInvitation)
        .where(
            HouseholdInvitation.id == invitation_id,
            HouseholdInvitation.status == InvitationStatus.pending,
        )
        .values(
            status=InvitationStatus.revoked,
            revoked_at=now,
        )
        .execution_options(synchronize_session=False)
    )
    db.commit()


def _raise_if_invite_email_delivery_failed(
    *,
    sent: bool,
    db: Session | None = None,
    invitation_id: str | None = None,
) -> None:
    if sent or settings.email_delivery_mode != "smtp":
        return
    if db is not None and invitation_id:
        try:
            _revoke_pending_invitation_after_delivery_failure(db, invitation_id)
        except Exception:
            db.rollback()
    raise app_error(
        status_code=503,
        code="HOUSEHOLD_INVITE_EMAIL_DELIVERY_FAILED",
        message="초대 메일 전송에 실패했습니다.",
        action="잠시 후 다시 초대해 주세요.",
    )


def _expire_if_needed(invitation: HouseholdInvitation, now: datetime) -> bool:
    if invitation.status == InvitationStatus.pending and _as_utc(invitation.expires_at) < now:
        invitation.status = InvitationStatus.expired
        return True
    return False


def _accept_invitation_record(
    invitation: HouseholdInvitation,
    *,
    user: User,
    db: Session,
) -> HouseholdInvitationAcceptResponse:
    now = _now()
    if _expire_if_needed(invitation, now):
        db.commit()
    if invitation.status == InvitationStatus.expired:
        raise app_error(
            status_code=400,
            code="HOUSEHOLD_INVITE_EXPIRED",
            message="초대 토큰이 만료되었습니다.",
            action="초대를 다시 요청해 주세요.",
        )
    if invitation.status != InvitationStatus.pending:
        raise app_error(
            status_code=400,
            code="HOUSEHOLD_INVITE_INVALID",
            message="이미 처리된 초대입니다.",
            action="가계 목록을 새로고침해 주세요.",
        )
    if user.email.lower() != str(invitation.email or "").lower():
        raise app_error(
            status_code=403,
            code="HOUSEHOLD_INVITE_EMAIL_MISMATCH",
            message="로그인한 이메일과 초대 이메일이 다릅니다.",
            action="초대 받은 이메일로 로그인해 주세요.",
        )
    _ensure_unique_member_display_name(
        db,
        household_id=invitation.household_id,
        user_id=str(user.id),
        display_name=user.display_name,
    )
    household_name = str(
        db.scalar(select(Household.name).where(Household.id == invitation.household_id)) or "가계"
    )

    member = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == invitation.household_id,
            HouseholdMember.user_id == user.id,
        )
    )
    if member is None:
        member = HouseholdMember(
            household_id=invitation.household_id,
            user_id=user.id,
            role=invitation.role,
        )
        db.add(member)
    else:
        current_rank = ROLE_RANK.get(MemberRole(member.role), 0)
        invite_rank = ROLE_RANK.get(MemberRole(invitation.role), 0)
        if invite_rank > current_rank:
            member.role = invitation.role

    updated_rows = db.execute(
        update(HouseholdInvitation)
        .where(
            HouseholdInvitation.id == invitation.id,
            HouseholdInvitation.status == InvitationStatus.pending,
            HouseholdInvitation.expires_at >= now,
        )
        .values(
            status=InvitationStatus.accepted,
            accepted_user_id=user.id,
            accepted_at=now,
        )
        .execution_options(synchronize_session=False)
    ).rowcount
    if int(updated_rows or 0) != 1:
        raise app_error(
            status_code=400,
            code="HOUSEHOLD_INVITE_INVALID",
            message="이미 처리된 초대입니다.",
            action="가계 목록을 새로고침해 주세요.",
        )
    if user.active_household_id is None:
        user.active_household_id = invitation.household_id
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise app_error(
            status_code=400,
            code="HOUSEHOLD_INVITE_INVALID",
            message="이미 처리된 초대입니다.",
            action="가계 목록을 새로고침해 주세요.",
        )
    return HouseholdInvitationAcceptResponse(
        status="accepted",
        invitation_id=str(invitation.id),
        household_id=invitation.household_id,
        household_name=household_name,
        role=member.role,
        active_household_selected=str(user.active_household_id or "") == str(invitation.household_id),
    )


@router.get("/current", response_model=HouseholdCurrentResponse)
def current_household(ctx=Depends(get_current_household)) -> HouseholdCurrentResponse:
    household, member = ctx
    return HouseholdCurrentResponse(household=HouseholdRead.model_validate(household), role=member.role)


@router.get("/settings", response_model=HouseholdSettingsRead)
def get_household_settings(ctx=Depends(get_current_household)) -> HouseholdSettingsRead:
    household, _ = ctx
    return _to_household_settings_read(household)


@router.patch("/settings", response_model=HouseholdSettingsRead)
def patch_household_settings(
    payload: HouseholdSettingsPatch,
    ctx=Depends(require_co_owner_household),
    db: Session = Depends(get_db),
) -> HouseholdSettingsRead:
    household, _ = ctx
    if "name" in payload.model_fields_set and payload.name is not None:
        household.name = payload.name
    if "transaction_row_colors" in payload.model_fields_set and payload.transaction_row_colors is not None:
        household.transaction_row_colors = normalize_transaction_row_colors(payload.transaction_row_colors)
    elif household.transaction_row_colors is None:
        household.transaction_row_colors = normalize_transaction_row_colors(None)
    db.commit()
    db.refresh(household)
    return _to_household_settings_read(household)


@router.get("/list", response_model=HouseholdListResponse)
def list_households(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HouseholdListResponse:
    memberships = db.scalars(
        select(HouseholdMember)
        .where(HouseholdMember.user_id == user.id)
        .order_by(HouseholdMember.created_at.asc())
    ).all()
    payload: list[HouseholdMembershipRead] = []
    for member in memberships:
        household = db.get(Household, member.household_id)
        if household is None:
            continue
        payload.append(
            HouseholdMembershipRead(
                household=HouseholdRead.model_validate(household),
                role=member.role,
                is_active=bool(user.active_household_id == member.household_id),
            )
        )
    return HouseholdListResponse(households=payload)


@router.post("/select", response_model=HouseholdCurrentResponse)
def select_household(
    payload: HouseholdSelectRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HouseholdCurrentResponse:
    member = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.user_id == user.id,
            HouseholdMember.household_id == payload.household_id,
        )
    )
    if member is None:
        raise app_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="HOUSEHOLD_NOT_FOUND",
            message="선택 가능한 가계를 찾을 수 없습니다.",
            action="가계 목록을 새로고침한 뒤 다시 선택해 주세요.",
        )
    household = db.get(Household, member.household_id)
    if household is None:
        raise app_error(
            status_code=status.HTTP_404_NOT_FOUND,
            code="HOUSEHOLD_NOT_FOUND",
            message="선택 가능한 가계를 찾을 수 없습니다.",
            action="가계 목록을 새로고침한 뒤 다시 선택해 주세요.",
        )
    user.active_household_id = household.id
    db.commit()
    return HouseholdCurrentResponse(household=HouseholdRead.model_validate(household), role=member.role)


def _issue_ws_ticket(ctx) -> dict[str, str | int]:
    household, member = ctx
    ttl_seconds = 30
    ticket = create_ws_ticket(str(member.user_id), str(household.id), ttl_seconds=ttl_seconds)
    return {"ticket": ticket, "expires_in_seconds": ttl_seconds}


@router.post("/ws-ticket")
def issue_ws_ticket(ctx=Depends(get_current_household)) -> dict[str, str | int]:
    return _issue_ws_ticket(ctx)


@router.get("/members", response_model=list[HouseholdMemberRead])
def list_members(ctx=Depends(get_current_household), db: Session = Depends(get_db)) -> list[HouseholdMemberRead]:
    household, _ = ctx
    rows = db.execute(
        select(HouseholdMember, User)
        .join(User, User.id == HouseholdMember.user_id)
        .where(HouseholdMember.household_id == household.id)
        .order_by(HouseholdMember.created_at.asc())
    ).all()
    return [_to_member_read(member, user) for member, user in rows]


@router.get("/invitations", response_model=list[HouseholdInvitationRead])
def list_invitations(ctx=Depends(require_co_owner_household), db: Session = Depends(get_db)) -> list[HouseholdInvitationRead]:
    household, _ = ctx
    now = _now()
    rows = db.execute(
        select(HouseholdInvitation, User.display_name)
        .outerjoin(User, User.id == HouseholdInvitation.inviter_user_id)
        .where(HouseholdInvitation.household_id == household.id)
        .order_by(HouseholdInvitation.created_at.desc())
    ).all()
    payload: list[HouseholdInvitationRead] = []
    for invitation, inviter_name in rows:
        status_override = invitation.status
        if invitation.status == InvitationStatus.pending and _as_utc(invitation.expires_at) < now:
            status_override = InvitationStatus.expired
        payload.append(
            _to_invitation_read(
                invitation,
                inviter_display_name=inviter_name,
                status_override=status_override,
            )
        )
    return payload


@router.get("/invitations/received", response_model=list[HouseholdInvitationRead])
def list_received_invitations(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[HouseholdInvitationRead]:
    now = _now()
    normalized_email = user.email.lower()
    rows = db.execute(
        select(HouseholdInvitation, Household.name, User.display_name)
        .join(Household, Household.id == HouseholdInvitation.household_id)
        .outerjoin(User, User.id == HouseholdInvitation.inviter_user_id)
        .where(func.lower(HouseholdInvitation.email) == normalized_email)
        .order_by(HouseholdInvitation.created_at.desc())
    ).all()
    payload: list[HouseholdInvitationRead] = []
    for invitation, household_name, inviter_name in rows:
        status_override = invitation.status
        if invitation.status == InvitationStatus.pending and _as_utc(invitation.expires_at) < now:
            status_override = InvitationStatus.expired
        payload.append(
            _to_invitation_read(
                invitation,
                inviter_display_name=inviter_name,
                status_override=status_override,
                household_name=household_name,
            )
        )
    return payload


@router.post("/invitations", response_model=HouseholdInvitationRead, status_code=status.HTTP_201_CREATED)
def create_invitation(
    payload: HouseholdInvitationCreate,
    request: Request,
    user: User = Depends(get_current_user),
    ctx=Depends(require_co_owner_household),
    db: Session = Depends(get_db),
) -> HouseholdInvitationRead:
    household, actor_member = ctx
    if payload.role == MemberRole.owner:
        raise app_error(
            status_code=400,
            code="HOUSEHOLD_INVITE_ROLE_INVALID",
            message="owner 권한은 초대로 직접 부여할 수 없습니다.",
            action="viewer/editor/co-owner 권한으로 초대한 뒤 owner가 승격해 주세요.",
        )
    normalized_email = payload.email.lower().strip()
    with _invite_creation_guard(household.id, normalized_email):
        db.execute(
            select(Household.id)
            .where(Household.id == household.id)
            .with_for_update()
        ).first()
        actor = db.scalar(
            select(HouseholdMember)
            .where(
                HouseholdMember.id == actor_member.id,
                HouseholdMember.household_id == household.id,
                HouseholdMember.user_id == user.id,
            )
            .with_for_update()
        )
        if actor is None or actor.role not in {MemberRole.owner, MemberRole.co_owner}:
            raise app_error(
                status_code=403,
                code="HOUSEHOLD_ROLE_FORBIDDEN",
                message="초대 생성 권한이 없습니다.",
                action="owner/co-owner 권한을 확인해 주세요.",
            )
        existing_user = db.scalar(select(User).where(func.lower(User.email) == normalized_email))
        if existing_user is not None:
            _ensure_unique_member_display_name(
                db,
                household_id=household.id,
                user_id=str(existing_user.id),
                display_name=existing_user.display_name,
            )
            existing_member = db.scalar(
                select(HouseholdMember).where(
                    HouseholdMember.household_id == household.id,
                    HouseholdMember.user_id == existing_user.id,
                )
            )
            if existing_member is not None:
                raise app_error(
                    status_code=409,
                    code="HOUSEHOLD_MEMBER_ALREADY_EXISTS",
                    message="이미 가계 구성원인 이메일입니다.",
                    action="멤버 목록에서 권한 변경을 진행해 주세요.",
                )

        now = _now()
        invite_window_seconds = max(60, int(settings.household_invitation_rate_limit_window_seconds))
        invite_window_start = now - timedelta(seconds=invite_window_seconds)
        invite_max_attempts = max(1, int(settings.household_invitation_rate_limit_max_attempts))
        recent_invite_count = int(
            db.scalar(
                select(func.count(HouseholdInvitation.id)).where(
                    HouseholdInvitation.household_id == household.id,
                    HouseholdInvitation.inviter_user_id == user.id,
                    HouseholdInvitation.status != InvitationStatus.revoked,
                    HouseholdInvitation.created_at >= invite_window_start,
                )
            )
            or 0
        )
        if recent_invite_count >= invite_max_attempts:
            raise app_error(
                status_code=429,
                code="HOUSEHOLD_INVITE_RATE_LIMITED",
                message="초대 메일 발송 요청이 너무 많습니다.",
                action="잠시 후 다시 시도해 주세요.",
            )
        pending = db.scalars(
            select(HouseholdInvitation).where(
                HouseholdInvitation.household_id == household.id,
                func.lower(HouseholdInvitation.email) == normalized_email,
                HouseholdInvitation.status == InvitationStatus.pending,
            )
            .with_for_update()
        ).all()
        for item in pending:
            item.status = InvitationStatus.revoked
            item.revoked_at = now

        raw_token = generate_opaque_token()
        expires_at = now + timedelta(hours=max(1, int(settings.household_invitation_token_hours)))
        invitation = HouseholdInvitation(
            household_id=household.id,
            email=normalized_email,
            inviter_user_id=user.id,
            role=payload.role,
            status=InvitationStatus.pending,
            token_hash=hash_opaque_token(raw_token),
            expires_at=expires_at,
        )
        db.add(invitation)
        created_new_invitation = True
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            created_new_invitation = False
            invitation = db.scalar(
                select(HouseholdInvitation)
                .where(
                    HouseholdInvitation.household_id == household.id,
                    func.lower(HouseholdInvitation.email) == normalized_email,
                    HouseholdInvitation.status == InvitationStatus.pending,
                )
                .order_by(HouseholdInvitation.created_at.desc())
            )
            if invitation is None:
                raise app_error(
                    status_code=409,
                    code="HOUSEHOLD_INVITE_CONFLICT",
                    message="동일한 이메일의 활성 초대가 이미 존재합니다.",
                    action="잠시 후 초대 목록을 새로고침해 주세요.",
                )
        if created_new_invitation:
            db.refresh(invitation)
            sent = email_service.send_household_invitation_email(
                to_email=normalized_email,
                inviter_name=user.display_name,
                household_name=household.name,
                token=raw_token,
                expires_minutes=max(60, int(settings.household_invitation_token_hours) * 60),
            )
            _raise_if_invite_email_delivery_failed(
                sent=sent,
                db=db,
                invitation_id=str(invitation.id),
            )
    return _to_invitation_read(
        invitation,
        inviter_display_name=user.display_name if created_new_invitation else None,
        debug_invite_token=_maybe_debug_invite_token(raw_token, request) if created_new_invitation else None,
    )


@router.post("/invitations/accept", response_model=HouseholdInvitationAcceptResponse)
def accept_invitation(
    payload: HouseholdInvitationAcceptRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HouseholdInvitationAcceptResponse:
    invite = db.scalar(
        select(HouseholdInvitation)
        .where(HouseholdInvitation.token_hash == hash_opaque_token(payload.token))
        .with_for_update()
    )
    if invite is None:
        raise app_error(
            status_code=400,
            code="HOUSEHOLD_INVITE_INVALID",
            message="유효하지 않은 초대 토큰입니다.",
            action="초대 메일에서 최신 링크를 다시 열어 주세요.",
        )
    return _accept_invitation_record(invite, user=user, db=db)


@router.post("/invitations/{invitation_id}/accept", response_model=HouseholdInvitationAcceptResponse)
def accept_invitation_by_id(
    invitation_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HouseholdInvitationAcceptResponse:
    invite = db.scalar(
        select(HouseholdInvitation)
        .where(HouseholdInvitation.id == invitation_id)
        .with_for_update()
    )
    if invite is None:
        raise app_error(
            status_code=404,
            code="HOUSEHOLD_INVITE_NOT_FOUND",
            message="초대 정보를 찾을 수 없습니다.",
            action="초대 현황을 새로고침해 주세요.",
        )
    return _accept_invitation_record(invite, user=user, db=db)


@router.delete("/invitations/{invitation_id}")
def revoke_invitation(
    invitation_id: str,
    ctx=Depends(require_co_owner_household),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    household, _ = ctx
    invitation = db.scalar(
        select(HouseholdInvitation).where(
            HouseholdInvitation.id == invitation_id,
            HouseholdInvitation.household_id == household.id,
        )
    )
    if invitation is None:
        raise app_error(
            status_code=404,
            code="HOUSEHOLD_INVITE_NOT_FOUND",
            message="초대 정보를 찾을 수 없습니다.",
            action="목록을 새로고침해 주세요.",
        )
    updated_rows = db.execute(
        update(HouseholdInvitation)
        .where(
            HouseholdInvitation.id == invitation_id,
            HouseholdInvitation.household_id == household.id,
            HouseholdInvitation.status == InvitationStatus.pending,
        )
        .values(
            status=InvitationStatus.revoked,
            revoked_at=_now(),
        )
        .execution_options(synchronize_session=False)
    ).rowcount
    if int(updated_rows or 0) != 1:
        raise app_error(
            status_code=409,
            code="HOUSEHOLD_INVITE_ALREADY_PROCESSED",
            message="이미 처리된 초대입니다.",
            action="목록을 새로고침해 주세요.",
        )
    db.commit()
    return {"status": "revoked"}


@router.patch("/members/{member_id}/role", response_model=HouseholdMemberRead)
def patch_member_role(
    member_id: str,
    payload: HouseholdMemberRolePatch,
    user: User = Depends(get_current_user),
    ctx=Depends(require_co_owner_household),
    db: Session = Depends(get_db),
) -> HouseholdMemberRead:
    household, actor_member = ctx
    locked_members = _lock_household_members(db, household.id)
    target_member = locked_members.get(str(member_id))
    if target_member is None:
        raise app_error(
            status_code=404,
            code="HOUSEHOLD_MEMBER_NOT_FOUND",
            message="구성원을 찾을 수 없습니다.",
            action="멤버 목록을 새로고침해 주세요.",
        )
    actor_member = locked_members.get(str(actor_member.id))
    if actor_member is None or actor_member.role not in {MemberRole.owner, MemberRole.co_owner}:
        raise app_error(
            status_code=403,
            code="HOUSEHOLD_ROLE_FORBIDDEN",
            message="권한 변경 권한이 없습니다.",
            action="owner/co-owner 권한을 요청해 주세요.",
        )
    target_user = db.get(User, target_member.user_id)
    if target_user is None:
        raise app_error(
            status_code=404,
            code="HOUSEHOLD_MEMBER_NOT_FOUND",
            message="구성원을 찾을 수 없습니다.",
            action="멤버 목록을 새로고침해 주세요.",
        )
    next_role = payload.role
    actor_is_owner = actor_member.role == MemberRole.owner

    if target_member.role == MemberRole.owner and not actor_is_owner:
        raise app_error(
            status_code=403,
            code="HOUSEHOLD_ROLE_FORBIDDEN",
            message="owner 권한 변경은 owner만 수행할 수 있습니다.",
            action="owner에게 요청해 주세요.",
        )
    if next_role == MemberRole.owner and not actor_is_owner:
        raise app_error(
            status_code=403,
            code="HOUSEHOLD_ROLE_FORBIDDEN",
            message="owner 권한 부여는 owner만 수행할 수 있습니다.",
            action="owner에게 요청해 주세요.",
        )

    if target_member.role == MemberRole.owner and next_role != MemberRole.owner:
        owner_count = sum(1 for item in locked_members.values() if item.role == MemberRole.owner)
        if int(owner_count or 0) <= 1:
            raise app_error(
                status_code=409,
                code="HOUSEHOLD_OWNER_REQUIRED",
                message="최소 1명의 owner는 유지되어야 합니다.",
                action="다른 owner를 먼저 지정해 주세요.",
            )

    if next_role == MemberRole.owner and target_member.role != MemberRole.owner and actor_member.id != target_member.id:
        actor_member.role = MemberRole.co_owner
    target_member.role = next_role
    db.commit()
    db.refresh(target_member)
    return _to_member_read(target_member, target_user)


@router.delete("/members/{member_id}")
def remove_member(
    member_id: str,
    user: User = Depends(get_current_user),
    ctx=Depends(require_co_owner_household),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    household, actor_member = ctx
    locked_members = _lock_household_members(db, household.id)
    actor_member = locked_members.get(str(actor_member.id))
    if actor_member is None or actor_member.role not in {MemberRole.owner, MemberRole.co_owner}:
        raise app_error(
            status_code=403,
            code="HOUSEHOLD_ROLE_FORBIDDEN",
            message="구성원 제거 권한이 없습니다.",
            action="owner/co-owner 권한을 요청해 주세요.",
        )
    target = locked_members.get(str(member_id))
    if target is None:
        raise app_error(
            status_code=404,
            code="HOUSEHOLD_MEMBER_NOT_FOUND",
            message="구성원을 찾을 수 없습니다.",
            action="멤버 목록을 새로고침해 주세요.",
        )

    if target.role == MemberRole.owner:
        if actor_member.role != MemberRole.owner:
            raise app_error(
                status_code=403,
                code="HOUSEHOLD_ROLE_FORBIDDEN",
                message="owner 제거는 owner만 수행할 수 있습니다.",
                action="owner에게 요청해 주세요.",
            )
        owner_count = sum(1 for item in locked_members.values() if item.role == MemberRole.owner)
        if int(owner_count or 0) <= 1:
            raise app_error(
                status_code=409,
                code="HOUSEHOLD_OWNER_REQUIRED",
                message="최소 1명의 owner는 유지되어야 합니다.",
                action="다른 owner를 먼저 지정해 주세요.",
            )

    removed_user = db.get(User, target.user_id)
    removed_user_id = str(target.user_id)
    db.delete(target)
    if removed_user is not None and removed_user.active_household_id == household.id:
        removed_user.active_household_id = None
    db.commit()
    anyio.from_thread.run(hub.disconnect_member, household.id, removed_user_id)
    return {"status": "removed"}

