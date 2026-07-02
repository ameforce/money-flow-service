from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_household, require_editor_household
from app.core.errors import app_error
from app.db.models import Category, Transaction
from app.db.session import get_db
from app.schemas import (
    CategoryCreate,
    CategoryPatch,
    CategoryRead,
    CategoryRenameMajorRequest,
    CategoryUsageEntry,
    CategoryUsageMonth,
)


router = APIRouter(prefix="/categories", tags=["categories"])


def _duplicate_category_error() -> Exception:
    return app_error(
        status_code=409,
        code="CATEGORY_DUPLICATE",
        message="동일한 대분류/중분류 카테고리가 이미 존재합니다.",
        action="이름을 바꾸거나 기존 카테고리를 사용해 주세요.",
    )


def _to_category_read(category: Category, usage_count: int = 0) -> CategoryRead:
    return CategoryRead(
        id=str(category.id),
        flow_type=category.flow_type,
        major=str(category.major),
        minor=str(category.minor),
        sort_order=int(category.sort_order),
        usage_count=int(usage_count),
    )


def _category_usage_map(db: Session, household_id: str) -> dict[str, int]:
    rows = db.execute(
        select(Category.id, func.count(Transaction.id))
        .outerjoin(Transaction, Transaction.category_id == Category.id)
        .where(Category.household_id == household_id)
        .group_by(Category.id)
    ).all()
    return {str(category_id): int(usage_count or 0) for category_id, usage_count in rows}


def _load_household_category(db: Session, household_id: str, category_id: str) -> Category:
    category = db.get(Category, category_id)
    if category is None or str(category.household_id) != household_id:
        raise HTTPException(status_code=404, detail="category not found")
    return category


@router.get("", response_model=list[CategoryRead])
def list_categories(ctx=Depends(get_current_household), db: Session = Depends(get_db)) -> list[CategoryRead]:
    household, _ = ctx
    rows = db.execute(
        select(Category, func.count(Transaction.id))
        .outerjoin(Transaction, Transaction.category_id == Category.id)
        .where(Category.household_id == household.id)
        .group_by(Category.id)
        .order_by(Category.flow_type, Category.sort_order, Category.major, Category.minor)
    ).all()
    return [_to_category_read(category, usage_count) for category, usage_count in rows]


@router.get("/{category_id}/usage", response_model=list[CategoryUsageMonth])
def list_category_usage(
    category_id: str,
    ctx=Depends(get_current_household),
    db: Session = Depends(get_db),
) -> list[CategoryUsageMonth]:
    household, _ = ctx
    category = _load_household_category(db, str(household.id), category_id)
    rows = db.scalars(
        select(Transaction)
        .where(
            Transaction.household_id == household.id,
            Transaction.category_id == category.id,
        )
        .order_by(Transaction.occurred_on.desc(), Transaction.created_at.desc())
    ).all()
    month_items: dict[str, list[CategoryUsageEntry]] = defaultdict(list)
    month_totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for transaction in rows:
        month_key = transaction.occurred_on.strftime("%Y-%m")
        amount = Decimal(transaction.amount or 0)
        month_totals[month_key] += amount
        month_items[month_key].append(
            CategoryUsageEntry(
                transaction_id=str(transaction.id),
                occurred_on=transaction.occurred_on,
                amount=amount,
                memo=str(transaction.memo or ""),
                owner_name=str(transaction.owner_name or "").strip() or None,
            )
        )

    return [
        CategoryUsageMonth(
            month=month_key,
            total_amount=month_totals[month_key],
            count=len(month_items[month_key]),
            items=month_items[month_key],
        )
        for month_key in sorted(month_items.keys(), reverse=True)
    ]


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> CategoryRead:
    household, _ = ctx
    duplicate = db.scalar(
        select(Category.id).where(
            Category.household_id == household.id,
            Category.flow_type == payload.flow_type,
            Category.major == payload.major,
            Category.minor == payload.minor,
        )
    )
    if duplicate is not None:
        raise _duplicate_category_error()

    next_sort_order = int(
        db.scalar(select(func.coalesce(func.max(Category.sort_order), 0)).where(Category.household_id == household.id)) or 0
    ) + 1
    category = Category(
        household_id=household.id,
        flow_type=payload.flow_type,
        major=payload.major,
        minor=payload.minor,
        sort_order=next_sort_order,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return _to_category_read(category, 0)


@router.patch("/{category_id}", response_model=CategoryRead)
def patch_category(
    category_id: str,
    payload: CategoryPatch,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> CategoryRead:
    household, _ = ctx
    category = _load_household_category(db, str(household.id), category_id)
    next_major = payload.major if "major" in payload.model_fields_set and payload.major is not None else category.major
    next_minor = payload.minor if "minor" in payload.model_fields_set and payload.minor is not None else category.minor

    duplicate = db.scalar(
        select(Category.id).where(
            Category.household_id == household.id,
            Category.flow_type == category.flow_type,
            Category.major == next_major,
            Category.minor == next_minor,
            Category.id != category.id,
        )
    )
    if duplicate is not None:
        raise _duplicate_category_error()

    category.major = next_major
    category.minor = next_minor
    db.commit()
    db.refresh(category)
    usage_count = int(
        db.scalar(select(func.count(Transaction.id)).where(Transaction.category_id == category.id))
        or 0
    )
    return _to_category_read(category, usage_count)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: str,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> None:
    household, _ = ctx
    category = _load_household_category(db, str(household.id), category_id)
    usage_count = int(
        db.scalar(select(func.count(Transaction.id)).where(Transaction.category_id == category.id))
        or 0
    )
    if usage_count > 0:
        raise app_error(
            status_code=409,
            code="CATEGORY_IN_USE",
            message="이미 사용 중인 카테고리는 삭제할 수 없습니다.",
            action="이름을 바꾸거나 다른 미사용 카테고리를 정리해 주세요.",
        )
    db.delete(category)
    db.commit()


@router.post("/rename-major", response_model=list[CategoryRead])
def rename_major_category_group(
    payload: CategoryRenameMajorRequest,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> list[CategoryRead]:
    household, _ = ctx
    categories = db.scalars(
        select(Category)
        .where(
            Category.household_id == household.id,
            Category.flow_type == payload.flow_type,
            Category.major == payload.current_major,
        )
        .order_by(Category.sort_order, Category.minor)
    ).all()
    if not categories:
        raise HTTPException(status_code=404, detail="category group not found")

    next_minor_keys = {str(item.minor): str(item.id) for item in categories}
    conflicts = db.scalars(
        select(Category.id).where(
            Category.household_id == household.id,
            Category.flow_type == payload.flow_type,
            Category.major == payload.next_major,
            Category.minor.in_(next_minor_keys.keys()),
            Category.id.not_in(next_minor_keys.values()),
        )
    ).all()
    if conflicts:
        raise _duplicate_category_error()

    for category in categories:
        category.major = payload.next_major
    db.commit()

    usage_map = _category_usage_map(db, str(household.id))
    return [_to_category_read(category, usage_map.get(str(category.id), 0)) for category in categories]
