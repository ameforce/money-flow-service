from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_household, get_current_user, require_editor_household
from app.core.errors import app_error
from app.db.models import Holding, HouseholdMember, User
from app.db.session import get_db
from app.schemas import HoldingCreate, HoldingPatch, HoldingRead, PatchConflict
from app.services.merge import MergeConflictError, merge_patch_or_raise
from app.services.runtime import hub


router = APIRouter(prefix="/holdings", tags=["holdings"])


def _is_holding_identity_conflict(error: IntegrityError) -> bool:
    text = str(getattr(error, "orig", error)).lower()
    if "uq_holding_identity" in text:
        return True
    return (
        "unique constraint failed" in text
        and "holdings.household_id" in text
        and "holdings.asset_type" in text
        and "holdings.market_symbol" in text
    )


def _normalize_identity_text(value: str | None) -> str:
    return str(value or "").strip()


def _normalize_and_validate_owner_name(db: Session, household_id: str, owner_name: str | None) -> str:
    normalized = _normalize_identity_text(owner_name)
    if not normalized:
        return ""
    member_count = int(
        db.scalar(
        select(func.count())
        .select_from(HouseholdMember)
        .join(User, User.id == HouseholdMember.user_id)
        .where(
            HouseholdMember.household_id == household_id,
            User.display_name == normalized,
        )
    )
        or 0
    )
    if member_count <= 0:
        raise app_error(
            status_code=400,
            code="HOLDING_OWNER_INVALID",
            message="보유자는 현재 가계 구성원만 선택할 수 있습니다.",
            action="가계 구성원 목록에서 보유자를 다시 선택해 주세요.",
        )
    if member_count > 1:
        raise app_error(
            status_code=409,
            code="HOLDING_OWNER_AMBIGUOUS",
            message="동일한 표시 이름의 구성원이 여러 명이라 보유자를 확정할 수 없습니다.",
            action="가계 구성원 표시 이름을 서로 다르게 변경한 뒤 다시 시도해 주세요.",
        )
    return normalized


@router.get("", response_model=list[HoldingRead])
def list_holdings(ctx=Depends(get_current_household), db: Session = Depends(get_db)) -> list[HoldingRead]:
    household, _ = ctx
    rows = db.scalars(
        select(Holding)
        .where(Holding.household_id == household.id)
        .order_by(Holding.owner_name, Holding.category, Holding.account_name, Holding.symbol)
    ).all()
    return [HoldingRead.model_validate(row) for row in rows]


@router.post("", response_model=HoldingRead, status_code=status.HTTP_201_CREATED)
def create_holding(
    payload: HoldingCreate,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> HoldingRead:
    household, _ = ctx
    normalized_owner = _normalize_and_validate_owner_name(db, household.id, payload.owner_name)
    normalized_account = _normalize_identity_text(payload.account_name)
    existing = db.scalar(
        select(Holding).where(
            Holding.household_id == household.id,
            Holding.asset_type == payload.asset_type,
            Holding.market_symbol == payload.market_symbol.strip().upper(),
            func.coalesce(Holding.owner_name, "") == normalized_owner,
            func.coalesce(Holding.account_name, "") == normalized_account,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="holding already exists")

    entity = Holding(
        household_id=household.id,
        asset_type=payload.asset_type,
        symbol=payload.symbol.strip().upper(),
        market_symbol=payload.market_symbol.strip().upper(),
        name=payload.name.strip(),
        category=payload.category.strip(),
        owner_name=normalized_owner,
        account_name=normalized_account,
        quantity=payload.quantity,
        average_cost=payload.average_cost,
        currency=payload.currency.upper(),
    )
    db.add(entity)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if _is_holding_identity_conflict(error):
            raise app_error(
                status_code=409,
                code="HOLDING_ALREADY_EXISTS",
                message="동일한 자산이 이미 존재합니다.",
                action="시장코드, 소유자, 계좌 조합을 확인해 주세요.",
            ) from error
        raise
    db.refresh(entity)
    background_tasks.add_task(
        hub.broadcast,
        household.id,
        {"event": "holding.created", "entity_id": entity.id, "version": entity.version},
    )
    return HoldingRead.model_validate(entity)


@router.patch("/{holding_id}", response_model=HoldingRead)
def patch_holding(
    holding_id: str,
    payload: HoldingPatch,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HoldingRead:
    household, _ = ctx
    entity = db.scalar(
        select(Holding)
        .where(
            Holding.id == holding_id,
            Holding.household_id == household.id,
        )
        .with_for_update()
    )
    if entity is None:
        raise HTTPException(status_code=404, detail="holding not found")

    fields_set = set(payload.model_fields_set)
    fields_set.discard("base_version")
    patch_data = {field: getattr(payload, field) for field in fields_set}
    null_blocked_fields = {"market_symbol", "name", "category", "quantity", "average_cost", "currency"}
    null_fields = sorted(field for field in null_blocked_fields if field in patch_data and patch_data[field] is None)
    if null_fields:
        raise app_error(
            status_code=400,
            code="HOLDING_PATCH_NULL_NOT_ALLOWED",
            message="필수 필드는 null로 수정할 수 없습니다.",
            action="null 대신 유효한 값을 입력해 주세요.",
            context={"fields": null_fields},
        )
    blank_blocked_fields = {"market_symbol", "name", "category"}
    blank_fields = sorted(
        field
        for field in blank_blocked_fields
        if field in patch_data and patch_data[field] is not None and not str(patch_data[field]).strip()
    )
    if blank_fields:
        raise app_error(
            status_code=400,
            code="HOLDING_PATCH_BLANK_NOT_ALLOWED",
            message="필수 텍스트 필드는 공백으로 수정할 수 없습니다.",
            action="공백이 아닌 값을 입력해 주세요.",
            context={"fields": blank_fields},
        )

    normalize_text_fields = {"market_symbol", "name", "category", "currency", "owner_name", "account_name"}
    for field in normalize_text_fields:
        if field not in patch_data:
            continue
        value = patch_data[field]
        if field in {"owner_name", "account_name"}:
            patch_data[field] = _normalize_identity_text(value)
            continue
        if value is None:
            patch_data[field] = None
            continue
        cleaned = str(value).strip()
        if field in {"market_symbol", "currency"}:
            cleaned = cleaned.upper()
        patch_data[field] = cleaned

    if "owner_name" in patch_data:
        patch_data["owner_name"] = _normalize_and_validate_owner_name(
            db,
            household.id,
            patch_data["owner_name"],
        )

    target_identity = {
        "asset_type": entity.asset_type,
        "market_symbol": str(patch_data.get("market_symbol", entity.market_symbol)).strip().upper(),
        "owner_name": _normalize_identity_text(patch_data.get("owner_name", entity.owner_name)),
        "account_name": _normalize_identity_text(patch_data.get("account_name", entity.account_name)),
    }
    duplicate = db.scalar(
        select(Holding).where(
            Holding.household_id == household.id,
            Holding.asset_type == target_identity["asset_type"],
            Holding.market_symbol == target_identity["market_symbol"],
            func.coalesce(Holding.owner_name, "") == target_identity["owner_name"],
            func.coalesce(Holding.account_name, "") == target_identity["account_name"],
            Holding.id != entity.id,
        )
    )
    if duplicate is not None:
        raise app_error(
            status_code=409,
            code="HOLDING_ALREADY_EXISTS",
            message="동일한 자산이 이미 존재합니다.",
            action="시장코드, 소유자, 계좌 조합을 확인해 주세요.",
        )

    current_data = HoldingRead.model_validate(entity).model_dump(mode="json")
    try:
        merged, changed_fields = merge_patch_or_raise(
            db=db,
            entity_type="holding",
            entity=entity,
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
        return HoldingRead.model_validate(entity)

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if _is_holding_identity_conflict(error):
            raise app_error(
                status_code=409,
                code="HOLDING_ALREADY_EXISTS",
                message="동일한 자산이 이미 존재합니다.",
                action="시장코드, 소유자, 계좌 조합을 확인해 주세요.",
            ) from error
        raise
    db.refresh(entity)
    background_tasks.add_task(
        hub.broadcast,
        household.id,
        {
            "event": "holding.patch.applied",
            "entity_id": entity.id,
            "version": entity.version,
            "changed_fields": changed_fields,
            "merged": merged,
        },
    )
    return HoldingRead.model_validate(entity)


@router.delete("/{holding_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_holding(
    holding_id: str,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> None:
    household, _ = ctx
    entity = db.get(Holding, holding_id)
    if entity is None or entity.household_id != household.id:
        raise HTTPException(status_code=404, detail="holding not found")
    db.delete(entity)
    db.commit()
    background_tasks.add_task(hub.broadcast, household.id, {"event": "holding.deleted", "entity_id": holding_id})

