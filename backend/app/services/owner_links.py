from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import app_error
from app.db.models import Holding, HouseholdMember, Transaction, User
from app.services.profile import normalize_optional_text


def get_household_member_user(db: Session, household_id: str, user_id: str | None) -> User | None:
    normalized_user_id = normalize_optional_text(user_id)
    if not normalized_user_id:
        return None
    return db.scalar(
        select(User)
        .join(HouseholdMember, HouseholdMember.user_id == User.id)
        .where(
            HouseholdMember.household_id == household_id,
            User.id == normalized_user_id,
        )
        .limit(1)
    )


def normalize_legacy_owner_name(value: str | None) -> str | None:
    normalized = normalize_optional_text(value)
    if not normalized:
        return None
    collapsed = " ".join(normalized.split())
    return collapsed or None


def legacy_owner_name_key(value: str | None) -> str:
    return (normalize_legacy_owner_name(value) or "").lower()


def require_household_member_user(
    db: Session,
    *,
    household_id: str,
    user_id: str | None,
    code: str,
    message: str,
    action: str,
) -> User:
    user = get_household_member_user(db, household_id, user_id)
    if user is not None:
        return user
    raise app_error(
        status_code=400,
        code=code,
        message=message,
        action=action,
    )


def find_unique_household_member_by_display_name(
    db: Session,
    *,
    household_id: str,
    display_name: str | None,
) -> User | None:
    owner_key = legacy_owner_name_key(display_name)
    if not owner_key:
        return None
    rows = db.execute(
        select(User, User.display_name)
        .join(HouseholdMember, HouseholdMember.user_id == User.id)
        .where(HouseholdMember.household_id == household_id)
        .order_by(HouseholdMember.created_at.asc(), User.created_at.asc())
    ).all()
    matches = [user for user, member_display_name in rows if legacy_owner_name_key(member_display_name) == owner_key]
    if len(matches) != 1:
        return None
    return matches[0]


def ensure_unique_household_member_display_name(
    db: Session,
    *,
    household_id: str,
    user_id: str | None,
    display_name: str | None,
    code: str = "HOUSEHOLD_MEMBER_DISPLAY_NAME_DUPLICATE",
    message: str = "동일한 표시 이름을 사용하는 가계 구성원이 이미 있습니다.",
    action: str = "다른 표시 이름을 사용한 뒤 다시 시도해 주세요.",
) -> None:
    normalized = normalize_optional_text(display_name)
    normalized_user_id = normalize_optional_text(user_id)
    if not normalized:
        return
    duplicate_user_id = db.scalar(
        select(User.id)
        .join(HouseholdMember, HouseholdMember.user_id == User.id)
        .where(
            HouseholdMember.household_id == household_id,
            User.id != normalized_user_id,
            func.lower(User.display_name) == normalized.lower(),
        )
        .limit(1)
    )
    if duplicate_user_id is None:
        return
    raise app_error(
        status_code=409,
        code=code,
        message=message,
        action=action,
    )


def resolve_owner_fields(
    db: Session,
    *,
    household_id: str,
    owner_user_id: str | None,
    owner_name: str | None,
    invalid_code: str,
    invalid_message: str,
    invalid_action: str,
) -> tuple[str | None, str | None]:
    normalized_owner_name = normalize_optional_text(owner_name)
    if not normalize_optional_text(owner_user_id):
        return None, normalized_owner_name

    user = require_household_member_user(
        db,
        household_id=household_id,
        user_id=owner_user_id,
        code=invalid_code,
        message=invalid_message,
        action=invalid_action,
    )
    return str(user.id), normalize_optional_text(user.display_name)


def backfill_owner_links_for_household(db: Session, household_id: str) -> dict[str, int]:
    linked_transactions = 0
    linked_holdings = 0

    transactions = db.scalars(
        select(Transaction).where(
            Transaction.household_id == household_id,
            Transaction.owner_user_id.is_(None),
        )
    ).all()
    for entity in transactions:
        user = find_unique_household_member_by_display_name(
            db,
            household_id=household_id,
            display_name=entity.owner_name,
        )
        if user is None:
            continue
        entity.owner_user_id = user.id
        linked_transactions += 1

    holdings = db.scalars(
        select(Holding).where(
            Holding.household_id == household_id,
            Holding.owner_user_id.is_(None),
        )
    ).all()
    for entity in holdings:
        user = find_unique_household_member_by_display_name(
            db,
            household_id=household_id,
            display_name=entity.owner_name,
        )
        if user is None:
            continue
        entity.owner_user_id = user.id
        linked_holdings += 1

    return {
        "transactions": linked_transactions,
        "holdings": linked_holdings,
    }
