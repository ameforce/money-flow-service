from __future__ import annotations

from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_household, get_current_user, require_editor_household
from app.core.errors import app_error
from app.db.models import Category, Transaction, User
from app.db.session import get_db
from app.schemas import PatchConflict, TransactionCreate, TransactionPatch, TransactionRead
from app.services.merge import MergeConflictError, merge_patch_or_raise
from app.services.runtime import hub


router = APIRouter(prefix="/transactions", tags=["transactions"])


def _is_category_fk_violation(error: IntegrityError) -> bool:
    text = str(getattr(error, "orig", error)).lower()
    return "foreign key constraint failed" in text or ("foreign key" in text and "category" in text)


def _ensure_category_flow_matches(category: Category, flow_type) -> None:
    if category.flow_type == flow_type:
        return
    raise app_error(
        status_code=400,
        code="TRANSACTION_CATEGORY_FLOW_TYPE_MISMATCH",
        message="거래 유형과 카테고리 유형이 일치하지 않습니다.",
        action="동일한 유형의 카테고리를 선택해 주세요.",
    )


@router.get("", response_model=list[TransactionRead])
def list_transactions(
    year: int | None = Query(default=None, ge=1970, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=3000),
    ctx=Depends(get_current_household),
    db: Session = Depends(get_db),
) -> list[TransactionRead]:
    household, _ = ctx
    query = select(Transaction).where(Transaction.household_id == household.id)
    if (start_date is None) != (end_date is None):
        raise HTTPException(status_code=400, detail="start_date and end_date must be provided together")
    if start_date and end_date:
        if start_date > end_date:
            raise HTTPException(status_code=400, detail="start_date must be <= end_date")
        query = query.where(Transaction.occurred_on >= start_date, Transaction.occurred_on <= end_date)
    elif year is not None and month is not None:
        begin = date(year, month, 1)
        end = date(year + (1 if month == 12 else 0), 1 if month == 12 else month + 1, 1)
        query = query.where(Transaction.occurred_on >= begin, Transaction.occurred_on < end)
    elif year is not None:
        query = query.where(Transaction.occurred_on >= date(year, 1, 1), Transaction.occurred_on < date(year + 1, 1, 1))
    elif month is not None:
        raise HTTPException(status_code=400, detail="month filter requires year")

    items = db.scalars(query.order_by(desc(Transaction.occurred_on), desc(Transaction.created_at)).limit(limit)).all()
    return [TransactionRead.model_validate(item) for item in items]


@router.post("", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionCreate,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionRead:
    household, _ = ctx
    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if category is None or category.household_id != household.id:
            raise HTTPException(status_code=400, detail="invalid category_id")
        _ensure_category_flow_matches(category, payload.flow_type)

    tx = Transaction(
        household_id=household.id,
        category_id=payload.category_id,
        occurred_on=payload.occurred_on,
        flow_type=payload.flow_type,
        amount=payload.amount,
        currency=payload.currency.upper(),
        memo=payload.memo.strip(),
        owner_name=(payload.owner_name or "").strip() or None,
        created_by_user_id=user.id,
    )
    db.add(tx)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if _is_category_fk_violation(error):
            raise app_error(
                status_code=400,
                code="CATEGORY_INVALID",
                message="유효하지 않은 category_id 입니다.",
                action="가계 내 카테고리 ID를 확인해 주세요.",
            ) from error
        raise
    db.refresh(tx)
    background_tasks.add_task(
        hub.broadcast,
        household.id,
        {
            "event": "transaction.created",
            "entity_id": tx.id,
            "version": tx.version,
        },
    )
    return TransactionRead.model_validate(tx)


@router.patch("/{transaction_id}", response_model=TransactionRead)
def patch_transaction(
    transaction_id: str,
    payload: TransactionPatch,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionRead:
    household, _ = ctx
    tx = db.scalar(
        select(Transaction)
        .where(
            Transaction.id == transaction_id,
            Transaction.household_id == household.id,
        )
        .with_for_update()
    )
    if tx is None:
        raise HTTPException(status_code=404, detail="transaction not found")

    fields_set = set(payload.model_fields_set)
    fields_set.discard("base_version")
    patch_data = {field: getattr(payload, field) for field in fields_set}
    null_blocked_fields = {"occurred_on", "flow_type", "amount", "currency", "memo"}
    null_fields = sorted(field for field in null_blocked_fields if field in patch_data and patch_data[field] is None)
    if null_fields:
        raise app_error(
            status_code=400,
            code="TRANSACTION_PATCH_NULL_NOT_ALLOWED",
            message="필수 필드는 null로 수정할 수 없습니다.",
            action="null 대신 유효한 값을 입력해 주세요.",
            context={"fields": null_fields},
        )
    if "currency" in patch_data and patch_data["currency"] is not None:
        patch_data["currency"] = str(patch_data["currency"]).upper()
    if "memo" in patch_data and patch_data["memo"] is not None:
        patch_data["memo"] = str(patch_data["memo"]).strip()
    if "owner_name" in patch_data:
        patch_data["owner_name"] = (patch_data["owner_name"] or "").strip() or None
    next_flow_type = patch_data.get("flow_type", tx.flow_type)
    next_category_id = patch_data.get("category_id", tx.category_id)
    if next_category_id:
        category = db.get(Category, next_category_id)
        if category is None or category.household_id != household.id:
            raise HTTPException(status_code=400, detail="invalid category_id")
        _ensure_category_flow_matches(category, next_flow_type)

    current_data = TransactionRead.model_validate(tx).model_dump(mode="json")
    try:
        merged, changed_fields = merge_patch_or_raise(
            db=db,
            entity_type="transaction",
            entity=tx,
            household_id=household.id,
            actor_user_id=user.id,
            base_version=payload.base_version,
            patch_data=patch_data,
            current_data=current_data,
        )
    except MergeConflictError as error:
        raise HTTPException(
            status_code=409,
            detail=PatchConflict(
                entity_type=error.entity_type,
                entity_id=error.entity_id,
                current_version=error.current_version,
                conflict_fields=error.conflict_fields,
                current_data=error.current_data,
            ).model_dump(mode="json"),
        ) from error

    if not changed_fields:
        return TransactionRead.model_validate(tx)

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if _is_category_fk_violation(error):
            raise app_error(
                status_code=400,
                code="CATEGORY_INVALID",
                message="유효하지 않은 category_id 입니다.",
                action="가계 내 카테고리 ID를 확인해 주세요.",
            ) from error
        raise
    db.refresh(tx)
    background_tasks.add_task(
        hub.broadcast,
        household.id,
        {
            "event": "transaction.patch.applied",
            "entity_id": tx.id,
            "version": tx.version,
            "changed_fields": changed_fields,
            "merged": merged,
        },
    )
    return TransactionRead.model_validate(tx)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: str,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> None:
    household, _ = ctx
    tx = db.get(Transaction, transaction_id)
    if tx is None or tx.household_id != household.id:
        raise HTTPException(status_code=404, detail="transaction not found")
    db.delete(tx)
    db.commit()
    background_tasks.add_task(
        hub.broadcast,
        household.id,
        {
            "event": "transaction.deleted",
            "entity_id": transaction_id,
        },
    )

