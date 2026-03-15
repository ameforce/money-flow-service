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
    normalized = normalize_optional_text(display_name)
    if not normalized:
        return None
    rows = db.scalars(
        select(User)
        .join(HouseholdMember, HouseholdMember.user_id == User.id)
        .where(
            HouseholdMember.household_id == household_id,
            func.lower(User.display_name) == normalized.lower(),
        )
        .order_by(HouseholdMember.created_at.asc(), User.created_at.asc())
    ).all()
    if len(rows) != 1:
        return None
    return rows[0]


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
