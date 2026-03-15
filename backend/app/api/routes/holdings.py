from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_household, get_current_user, require_editor_household
from app.core.errors import app_error
from app.db.models import Holding, User
from app.db.session import get_db
from app.schemas import HoldingCreate, HoldingPatch, HoldingRead, PatchConflict
from app.services.merge import MergeConflictError, merge_patch_or_raise
from app.services.owner_links import resolve_owner_fields
from app.services.profile import normalize_optional_text
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


def _to_holding_read(holding: Holding, linked_owner_name: str | None = None) -> HoldingRead:
    return HoldingRead(
        id=str(holding.id),
        household_id=str(holding.household_id),
        asset_type=holding.asset_type,
        type_key=str(holding.type_key).strip() if str(holding.type_key or "").strip() else None,
        symbol=str(holding.symbol),
        market_symbol=str(holding.market_symbol),
        name=str(holding.name),
        category=str(holding.category),
        owner_user_id=str(holding.owner_user_id).strip() if str(holding.owner_user_id or "").strip() else None,
        owner_name=str(linked_owner_name or holding.owner_name or "").strip() or None,
        account_name=str(holding.account_name or "").strip() or None,
        quantity=holding.quantity,
        average_cost=holding.average_cost,
        currency=str(holding.currency),
        display_order=int(holding.display_order),
        source_ref=str(holding.source_ref).strip() if str(holding.source_ref or "").strip() else None,
        version=int(holding.version),
        updated_at=holding.updated_at,
    )


def _load_holding_read(db: Session, holding_id: str) -> HoldingRead:
    row = db.execute(
        select(Holding, User.display_name)
        .outerjoin(User, User.id == Holding.owner_user_id)
        .where(Holding.id == holding_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="holding not found")
    holding, linked_owner_name = row
    return _to_holding_read(holding, linked_owner_name)


def _same_owner_identity(
    holding: Holding,
    *,
    owner_user_id: str | None,
    owner_name: str | None,
) -> bool:
    current_owner_user_id = normalize_optional_text(holding.owner_user_id)
    current_owner_name = normalize_optional_text(holding.owner_name)
    if owner_user_id or current_owner_user_id:
        return current_owner_user_id == owner_user_id
    return current_owner_name == owner_name


def _find_duplicate_holding(
    db: Session,
    *,
    household_id: str,
    asset_type,
    market_symbol: str,
    owner_user_id: str | None,
    owner_name: str | None,
    account_name: str,
    exclude_holding_id: str | None = None,
) -> Holding | None:
    candidates = db.scalars(
        select(Holding).where(
            Holding.household_id == household_id,
            Holding.asset_type == asset_type,
            Holding.market_symbol == market_symbol,
            func.coalesce(Holding.account_name, "") == account_name,
        )
    ).all()
    for candidate in candidates:
        if exclude_holding_id and str(candidate.id) == exclude_holding_id:
            continue
        if _same_owner_identity(candidate, owner_user_id=owner_user_id, owner_name=owner_name):
            return candidate
    return None


@router.get("", response_model=list[HoldingRead])
def list_holdings(ctx=Depends(get_current_household), db: Session = Depends(get_db)) -> list[HoldingRead]:
    household, _ = ctx
    rows = db.execute(
        select(Holding, User.display_name)
        .outerjoin(User, User.id == Holding.owner_user_id)
        .where(Holding.household_id == household.id)
        .order_by(Holding.display_order.asc(), Holding.owner_name, Holding.category, Holding.account_name, Holding.symbol)
    ).all()
    return [_to_holding_read(holding, linked_owner_name) for holding, linked_owner_name in rows]


@router.post("", response_model=HoldingRead, status_code=status.HTTP_201_CREATED)
def create_holding(
    payload: HoldingCreate,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> HoldingRead:
    household, _ = ctx
    owner_user_id, owner_name = resolve_owner_fields(
        db,
        household_id=str(household.id),
        owner_user_id=payload.owner_user_id,
        owner_name=payload.owner_name,
        invalid_code="HOLDING_OWNER_INVALID",
        invalid_message="보유자는 현재 가계 구성원만 선택할 수 있습니다.",
        invalid_action="가계 구성원 목록에서 보유자를 다시 선택해 주세요.",
    )
    normalized_account = _normalize_identity_text(payload.account_name)
    duplicate = _find_duplicate_holding(
        db,
        household_id=str(household.id),
        asset_type=payload.asset_type,
        market_symbol=payload.market_symbol.strip().upper(),
        owner_user_id=owner_user_id,
        owner_name=owner_name,
        account_name=normalized_account,
    )
    if duplicate is not None:
        raise app_error(
            status_code=409,
            code="HOLDING_ALREADY_EXISTS",
            message="동일한 자산이 이미 존재합니다.",
            action="시장코드, 소유자, 계좌 조합을 확인해 주세요.",
        )

    next_display_order = int(
        db.scalar(select(func.coalesce(func.max(Holding.display_order), 0)).where(Holding.household_id == household.id)) or 0
    ) + 1
    display_order = int(payload.display_order or next_display_order)
    entity = Holding(
        household_id=household.id,
        asset_type=payload.asset_type,
        type_key=payload.type_key,
        symbol=payload.symbol.strip().upper(),
        market_symbol=payload.market_symbol.strip().upper(),
        name=payload.name.strip(),
        category=payload.category.strip(),
        owner_user_id=owner_user_id,
        owner_name=owner_name or "",
        account_name=normalized_account,
        quantity=payload.quantity,
        average_cost=payload.average_cost,
        currency=payload.currency.upper(),
        display_order=display_order,
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
    return _load_holding_read(db, str(entity.id))


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
    null_blocked_fields = {"market_symbol", "name", "category", "quantity", "average_cost", "currency", "display_order"}
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

    normalize_text_fields = {"market_symbol", "name", "category", "currency", "account_name"}
    for field in normalize_text_fields:
        if field not in patch_data:
            continue
        value = patch_data[field]
        if value is None:
            patch_data[field] = None
            continue
        cleaned = str(value).strip()
        if field in {"market_symbol", "currency"}:
            cleaned = cleaned.upper()
        patch_data[field] = cleaned
    if "type_key" in patch_data:
        patch_data["type_key"] = normalize_optional_text(patch_data["type_key"])

    if "owner_user_id" in patch_data or "owner_name" in patch_data:
        patch_data["owner_user_id"], patch_data["owner_name"] = resolve_owner_fields(
            db,
            household_id=str(household.id),
            owner_user_id=patch_data.get("owner_user_id", entity.owner_user_id),
            owner_name=patch_data.get("owner_name", entity.owner_name),
            invalid_code="HOLDING_OWNER_INVALID",
            invalid_message="보유자는 현재 가계 구성원만 선택할 수 있습니다.",
            invalid_action="가계 구성원 목록에서 보유자를 다시 선택해 주세요.",
        )

    target_identity = {
        "asset_type": entity.asset_type,
        "market_symbol": str(patch_data.get("market_symbol", entity.market_symbol)).strip().upper(),
        "owner_user_id": normalize_optional_text(patch_data.get("owner_user_id", entity.owner_user_id)),
        "owner_name": normalize_optional_text(patch_data.get("owner_name", entity.owner_name)),
        "account_name": _normalize_identity_text(patch_data.get("account_name", entity.account_name)),
    }
    duplicate = _find_duplicate_holding(
        db,
        household_id=str(household.id),
        asset_type=target_identity["asset_type"],
        market_symbol=target_identity["market_symbol"],
        owner_user_id=target_identity["owner_user_id"],
        owner_name=target_identity["owner_name"],
        account_name=target_identity["account_name"],
        exclude_holding_id=str(entity.id),
    )
    if duplicate is not None:
        raise app_error(
            status_code=409,
            code="HOLDING_ALREADY_EXISTS",
            message="동일한 자산이 이미 존재합니다.",
            action="시장코드, 소유자, 계좌 조합을 확인해 주세요.",
        )

    current_data = _load_holding_read(db, str(entity.id)).model_dump(mode="json")
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
        return _load_holding_read(db, str(entity.id))

    if "owner_name" in changed_fields and patch_data.get("owner_name") is None:
        entity.owner_name = ""
    if "account_name" in changed_fields and patch_data.get("account_name") is None:
        entity.account_name = ""

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
    return _load_holding_read(db, str(entity.id))


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
