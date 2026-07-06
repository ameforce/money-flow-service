from __future__ import annotations

import base64
from datetime import UTC, date, datetime, timedelta
import hashlib
import hmac
import json
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, asc, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_household, get_current_user, require_editor_household
from app.core.config import settings
from app.core.errors import app_error
from app.db.models import Category, Transaction, User
from app.db.session import get_db
from app.schemas import (
    PatchConflict,
    TransactionBulkDeleteRequest,
    TransactionBulkDeleteResult,
    TransactionCreate,
    TransactionHistoryPage,
    TransactionPatch,
    TransactionRead,
)
from app.services.merge import MergeConflictError, merge_patch_or_raise
from app.services.owner_links import resolve_owner_fields
from app.services.runtime import hub


router = APIRouter(prefix="/transactions", tags=["transactions"])
_HISTORY_CURSOR_VERSION = 2
_TRANSACTION_REPLAY_WINDOW_SECONDS = 120
_TRANSACTION_ORDER_STEP = 1024
_TRANSACTION_LIST_MAX_OFFSET = 60_000


class _HistoryCursor:
    def __init__(
        self,
        *,
        household_id: str,
        occurred_on: date,
        order_key: int,
        created_at: datetime,
        transaction_id: str,
    ) -> None:
        self.household_id = household_id
        self.occurred_on = occurred_on
        self.order_key = order_key
        self.created_at = created_at
        self.transaction_id = transaction_id


def _is_category_fk_violation(error: IntegrityError) -> bool:
    text = str(getattr(error, "orig", error)).lower()
    return "foreign key constraint failed" in text or ("foreign key" in text and "category" in text)


def _is_transaction_source_ref_violation(error: IntegrityError) -> bool:
    text = str(getattr(error, "orig", error)).lower()
    return "uq_transaction_source_ref" in text or ("transactions.household_id" in text and "transactions.source_ref" in text)


def _ensure_category_flow_matches(category: Category, flow_type) -> None:
    if category.flow_type == flow_type:
        return
    raise app_error(
        status_code=400,
        code="TRANSACTION_CATEGORY_FLOW_TYPE_MISMATCH",
        message="거래 유형과 카테고리 유형이 일치하지 않습니다.",
        action="동일한 유형의 카테고리를 선택해 주세요.",
    )


def _nullable_column_equals(column, value):
    return column.is_(None) if value is None else column == value


def _recent_matching_transaction_id(
    db: Session,
    *,
    household_id: str,
    category_id: str | None,
    occurred_on: date,
    flow_type,
    amount,
    currency: str,
    memo: str,
    owner_user_id: str | None,
    owner_name: str | None,
    created_by_user_id: str,
) -> str | None:
    replay_cutoff = datetime.now(UTC) - timedelta(seconds=_TRANSACTION_REPLAY_WINDOW_SECONDS)
    return db.scalar(
        select(Transaction.id)
        .where(
            Transaction.household_id == household_id,
            Transaction.source_ref.is_(None),
            Transaction.created_by_user_id == created_by_user_id,
            Transaction.occurred_on == occurred_on,
            Transaction.flow_type == flow_type,
            Transaction.amount == amount,
            Transaction.currency == currency,
            Transaction.memo == memo,
            Transaction.created_at >= replay_cutoff,
            _nullable_column_equals(Transaction.category_id, category_id),
            _nullable_column_equals(Transaction.owner_user_id, owner_user_id),
            _nullable_column_equals(Transaction.owner_name, owner_name),
        )
        .order_by(desc(Transaction.created_at), desc(Transaction.id))
    )


def _list_ordering():
    return (
        desc(Transaction.occurred_on),
        asc(Transaction.order_key),
        asc(Transaction.created_at),
        asc(Transaction.id),
    )


def _history_ordering_asc():
    return (
        asc(Transaction.occurred_on),
        asc(Transaction.order_key),
        asc(Transaction.created_at),
        asc(Transaction.id),
    )


def _history_ordering_desc():
    return (
        desc(Transaction.occurred_on),
        desc(Transaction.order_key),
        desc(Transaction.created_at),
        desc(Transaction.id),
    )


def _same_day_ordering():
    return (
        asc(Transaction.order_key),
        asc(Transaction.created_at),
        asc(Transaction.id),
    )


def _same_day_transactions(db: Session, *, household_id: str, occurred_on: date) -> list[Transaction]:
    return list(
        db.scalars(
            select(Transaction)
            .where(Transaction.household_id == household_id, Transaction.occurred_on == occurred_on)
            .order_by(*_same_day_ordering())
            .with_for_update()
        ).all()
    )


def _rebalance_order_keys(db: Session, *, household_id: str, occurred_on: date) -> list[Transaction]:
    rows = _same_day_transactions(db, household_id=household_id, occurred_on=occurred_on)
    for index, transaction in enumerate(rows, start=1):
        transaction.order_key = index * _TRANSACTION_ORDER_STEP
    db.flush()
    return rows


def _next_append_order_key(
    db: Session,
    *,
    household_id: str,
    occurred_on: date,
    exclude_transaction_id: str | None = None,
) -> int:
    where_clauses = [
        Transaction.household_id == household_id,
        Transaction.occurred_on == occurred_on,
    ]
    if exclude_transaction_id:
        where_clauses.append(Transaction.id != exclude_transaction_id)
    max_key = db.scalar(
        select(func.max(Transaction.order_key)).where(*where_clauses)
    )
    return int(max_key or 0) + _TRANSACTION_ORDER_STEP


def _midpoint_or_rebalance(
    db: Session,
    *,
    household_id: str,
    occurred_on: date,
    before_key: int | None,
    after_key: int | None,
) -> int | None:
    low = int(before_key or 0)
    high = int(after_key) if after_key is not None else None
    if high is None:
        return low + _TRANSACTION_ORDER_STEP
    if high - low > 1:
        return low + ((high - low) // 2)
    _rebalance_order_keys(db, household_id=household_id, occurred_on=occurred_on)
    return None


def _allocate_order_key(
    db: Session,
    *,
    household_id: str,
    occurred_on: date,
    anchor_transaction_id: str | None,
    insert_position: Literal["above", "below"] | None,
) -> int:
    if bool(anchor_transaction_id) != bool(insert_position):
        raise app_error(
            status_code=400,
            code="TRANSACTION_INSERT_ANCHOR_REQUIRED",
            message="삽입 기준 거래와 위치를 함께 지정해야 합니다.",
            action="위/아래 삽입을 선택한 거래를 다시 확인해 주세요.",
        )
    if not anchor_transaction_id:
        return _next_append_order_key(db, household_id=household_id, occurred_on=occurred_on)

    for _ in range(2):
        rows = _same_day_transactions(db, household_id=household_id, occurred_on=occurred_on)
        anchor_index = next((index for index, row in enumerate(rows) if str(row.id) == anchor_transaction_id), None)
        if anchor_index is None:
            anchor = db.get(Transaction, anchor_transaction_id)
            if anchor is not None and anchor.household_id == household_id and anchor.occurred_on != occurred_on:
                raise app_error(
                    status_code=400,
                    code="TRANSACTION_INSERT_ANCHOR_DATE_MISMATCH",
                    message="삽입 기준 거래와 날짜가 일치하지 않습니다.",
                    action="같은 날짜의 거래를 기준으로 다시 삽입해 주세요.",
                )
            raise HTTPException(status_code=404, detail="transaction anchor not found")

        if insert_position == "above":
            before = rows[anchor_index - 1] if anchor_index > 0 else None
            after = rows[anchor_index]
        else:
            before = rows[anchor_index]
            after = rows[anchor_index + 1] if anchor_index + 1 < len(rows) else None
        allocated = _midpoint_or_rebalance(
            db,
            household_id=household_id,
            occurred_on=occurred_on,
            before_key=before.order_key if before is not None else None,
            after_key=after.order_key if after is not None else None,
        )
        if allocated is not None:
            return allocated

    raise app_error(
        status_code=409,
        code="TRANSACTION_ORDER_REBALANCE_FAILED",
        message="거래 순서를 재정렬하지 못했습니다.",
        action="목록을 새로고침한 뒤 다시 시도해 주세요.",
    )


def _history_today() -> date:
    return datetime.now(UTC).date()


def _canonical_created_at(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    else:
        value = value.astimezone(UTC)
    return value.isoformat().replace("+00:00", "Z")


def _history_cursor_signature(payload: dict[str, object]) -> str:
    signing_payload = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(settings.secret_key.encode("utf-8"), signing_payload, hashlib.sha256).hexdigest()


def _encode_history_cursor(transaction: Transaction, household_id: str) -> str:
    payload: dict[str, object] = {
        "v": _HISTORY_CURSOR_VERSION,
        "household_id": str(household_id),
        "occurred_on": transaction.occurred_on.isoformat(),
        "order_key": int(transaction.order_key),
        "created_at": _canonical_created_at(transaction.created_at),
        "id": str(transaction.id),
    }
    payload["sig"] = _history_cursor_signature(payload)
    token = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(token).decode("ascii").rstrip("=")


def _decode_history_cursor(raw_cursor: str, household_id: str) -> _HistoryCursor:
    try:
        normalized = str(raw_cursor or "").strip()
        if not normalized:
            raise ValueError("empty cursor")
        padded = normalized + ("=" * (-len(normalized) % 4))
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("cursor payload must be an object")
        supplied_sig = str(payload.get("sig") or "")
        unsigned = {key: value for key, value in payload.items() if key != "sig"}
        expected_sig = _history_cursor_signature(unsigned)
        if not supplied_sig or not hmac.compare_digest(supplied_sig, expected_sig):
            raise ValueError("cursor signature mismatch")
        if int(payload.get("v") or 0) != _HISTORY_CURSOR_VERSION:
            raise ValueError("unsupported cursor version")
        cursor_household_id = str(payload.get("household_id") or "")
        if cursor_household_id != str(household_id):
            raise ValueError("cursor household mismatch")
        occurred_on = date.fromisoformat(str(payload.get("occurred_on") or ""))
        order_key = int(payload.get("order_key"))
        created_raw = str(payload.get("created_at") or "")
        created_at = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
        if created_at.tzinfo is not None:
            created_at = created_at.astimezone(UTC)
        transaction_id = str(payload.get("id") or "").strip()
        if not transaction_id:
            raise ValueError("missing transaction id")
    except Exception as exc:
        raise app_error(
            status_code=400,
            code="TRANSACTION_HISTORY_CURSOR_INVALID",
            message="거래 내역 커서가 유효하지 않습니다.",
            action="목록을 새로고침한 뒤 다시 시도해 주세요.",
        ) from exc
    return _HistoryCursor(
        household_id=str(household_id),
        occurred_on=occurred_on,
        order_key=order_key,
        created_at=created_at,
        transaction_id=transaction_id,
    )


def _older_than_cursor(cursor: _HistoryCursor):
    return or_(
        Transaction.occurred_on < cursor.occurred_on,
        and_(Transaction.occurred_on == cursor.occurred_on, Transaction.order_key < cursor.order_key),
        and_(
            Transaction.occurred_on == cursor.occurred_on,
            Transaction.order_key == cursor.order_key,
            Transaction.created_at < cursor.created_at,
        ),
        and_(
            Transaction.occurred_on == cursor.occurred_on,
            Transaction.order_key == cursor.order_key,
            Transaction.created_at == cursor.created_at,
            Transaction.id < cursor.transaction_id,
        ),
    )


def _newer_than_cursor(cursor: _HistoryCursor):
    return or_(
        Transaction.occurred_on > cursor.occurred_on,
        and_(Transaction.occurred_on == cursor.occurred_on, Transaction.order_key > cursor.order_key),
        and_(
            Transaction.occurred_on == cursor.occurred_on,
            Transaction.order_key == cursor.order_key,
            Transaction.created_at > cursor.created_at,
        ),
        and_(
            Transaction.occurred_on == cursor.occurred_on,
            Transaction.order_key == cursor.order_key,
            Transaction.created_at == cursor.created_at,
            Transaction.id > cursor.transaction_id,
        ),
    )


def _to_transaction_read(transaction: Transaction, linked_owner_name: str | None = None) -> TransactionRead:
    return TransactionRead(
        id=str(transaction.id),
        household_id=str(transaction.household_id),
        category_id=str(transaction.category_id).strip() if str(transaction.category_id or "").strip() else None,
        occurred_on=transaction.occurred_on,
        flow_type=transaction.flow_type,
        amount=transaction.amount,
        currency=str(transaction.currency),
        memo=str(transaction.memo or ""),
        order_key=int(transaction.order_key),
        owner_user_id=str(transaction.owner_user_id).strip() if str(transaction.owner_user_id or "").strip() else None,
        owner_name=str(linked_owner_name or transaction.owner_name or "").strip() or None,
        source_ref=str(transaction.source_ref).strip() if str(transaction.source_ref or "").strip() else None,
        version=int(transaction.version),
        created_at=transaction.created_at,
        updated_at=transaction.updated_at,
    )


def _load_transaction_read(db: Session, transaction_id: str) -> TransactionRead:
    row = db.execute(
        select(Transaction, User.display_name)
        .outerjoin(User, User.id == Transaction.owner_user_id)
        .where(Transaction.id == transaction_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="transaction not found")
    transaction, linked_owner_name = row
    return _to_transaction_read(transaction, linked_owner_name)


@router.get("", response_model=list[TransactionRead])
def list_transactions(
    year: int | None = Query(default=None, ge=1970, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=3000),
    offset: int = Query(default=0, ge=0, le=_TRANSACTION_LIST_MAX_OFFSET),
    ctx=Depends(get_current_household),
    db: Session = Depends(get_db),
) -> list[TransactionRead]:
    household, _ = ctx
    query = (
        select(Transaction, User.display_name)
        .outerjoin(User, User.id == Transaction.owner_user_id)
        .where(Transaction.household_id == household.id)
    )
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

    rows = db.execute(query.order_by(*_list_ordering()).offset(offset).limit(limit)).all()
    return [_to_transaction_read(transaction, linked_owner_name) for transaction, linked_owner_name in rows]


@router.get("/history", response_model=TransactionHistoryPage)
def list_transaction_history(
    anchor_date: date | None = Query(default=None),
    direction: Literal["initial", "older", "newer"] = Query(default="initial"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=120, ge=1, le=500),
    ctx=Depends(get_current_household),
    db: Session = Depends(get_db),
) -> TransactionHistoryPage:
    household, _ = ctx
    today = _history_today()
    active_anchor = anchor_date or today
    base_query = (
        select(Transaction, User.display_name)
        .outerjoin(User, User.id == Transaction.owner_user_id)
        .where(Transaction.household_id == household.id)
    )
    history_query = base_query.where(Transaction.occurred_on <= active_anchor)

    decoded_cursor = _decode_history_cursor(cursor, str(household.id)) if cursor else None
    fetch_limit = limit + 1
    if direction == "older":
        if decoded_cursor is None:
            raise app_error(
                status_code=400,
                code="TRANSACTION_HISTORY_CURSOR_REQUIRED",
                message="이전 거래를 이어 보려면 커서가 필요합니다.",
                action="목록을 새로고침한 뒤 다시 시도해 주세요.",
            )
        query = history_query.where(_older_than_cursor(decoded_cursor)).order_by(*_history_ordering_desc())
        raw_rows = db.execute(query.limit(fetch_limit)).all()
        has_more = len(raw_rows) > limit
        page_rows = raw_rows[:limit]
        page_rows = list(reversed(page_rows))
        has_older = has_more
        has_newer = True
    elif direction == "newer":
        if decoded_cursor is None:
            raise app_error(
                status_code=400,
                code="TRANSACTION_HISTORY_CURSOR_REQUIRED",
                message="다음 거래를 이어 보려면 커서가 필요합니다.",
                action="목록을 새로고침한 뒤 다시 시도해 주세요.",
            )
        newer_upper_bound = max(active_anchor, today)
        query = (
            base_query.where(Transaction.occurred_on <= newer_upper_bound)
            .where(_newer_than_cursor(decoded_cursor))
            .order_by(*_history_ordering_asc())
        )
        raw_rows = db.execute(query.limit(fetch_limit)).all()
        has_more = len(raw_rows) > limit
        page_rows = raw_rows[:limit]
        has_older = True
        has_newer = has_more
    else:
        query = history_query.order_by(*_history_ordering_desc())
        raw_rows = db.execute(query.limit(fetch_limit)).all()
        has_more = len(raw_rows) > limit
        page_rows = raw_rows[:limit]
        page_rows = list(reversed(page_rows))
        has_older = has_more
        has_newer = active_anchor < today

    items = [_to_transaction_read(transaction, linked_owner_name) for transaction, linked_owner_name in page_rows]
    first_transaction = page_rows[0][0] if page_rows else None
    last_transaction = page_rows[-1][0] if page_rows else None
    return TransactionHistoryPage(
        items=items,
        older_cursor=_encode_history_cursor(first_transaction, str(household.id)) if first_transaction else None,
        newer_cursor=_encode_history_cursor(last_transaction, str(household.id)) if last_transaction else None,
        has_older=has_older,
        has_newer=has_newer,
        anchor_date=active_anchor,
        today=today,
    )


@router.post("", response_model=TransactionRead, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionCreate,
    background_tasks: BackgroundTasks,
    response: Response,
    ctx=Depends(require_editor_household),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionRead:
    household, _ = ctx
    source_ref = str(payload.source_ref or "").strip() or None
    if source_ref:
        existing_id = db.scalar(
            select(Transaction.id).where(
                Transaction.household_id == household.id,
                Transaction.source_ref == source_ref,
            )
        )
        if existing_id:
            response.status_code = status.HTTP_200_OK
            return _load_transaction_read(db, str(existing_id))

    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if category is None or category.household_id != household.id:
            raise HTTPException(status_code=400, detail="invalid category_id")
        _ensure_category_flow_matches(category, payload.flow_type)

    owner_user_id, owner_name = resolve_owner_fields(
        db,
        household_id=str(household.id),
        owner_user_id=payload.owner_user_id,
        owner_name=payload.owner_name,
        invalid_code="TRANSACTION_OWNER_INVALID",
        invalid_message="거래자는 현재 가계 구성원만 선택할 수 있습니다.",
        invalid_action="가계 구성원 목록에서 거래자를 다시 선택해 주세요.",
    )
    memo = payload.memo.strip()
    currency = payload.currency.upper()
    has_insert_intent = bool(payload.anchor_transaction_id or payload.insert_position)
    if not source_ref and not has_insert_intent:
        existing_id = _recent_matching_transaction_id(
            db,
            household_id=str(household.id),
            category_id=payload.category_id,
            occurred_on=payload.occurred_on,
            flow_type=payload.flow_type,
            amount=payload.amount,
            currency=currency,
            memo=memo,
            owner_user_id=owner_user_id,
            owner_name=owner_name,
            created_by_user_id=str(user.id),
        )
        if existing_id:
            response.status_code = status.HTTP_200_OK
            return _load_transaction_read(db, str(existing_id))

    order_key = _allocate_order_key(
        db,
        household_id=str(household.id),
        occurred_on=payload.occurred_on,
        anchor_transaction_id=payload.anchor_transaction_id,
        insert_position=payload.insert_position,
    )
    transaction = Transaction(
        household_id=household.id,
        category_id=payload.category_id,
        occurred_on=payload.occurred_on,
        flow_type=payload.flow_type,
        amount=payload.amount,
        currency=currency,
        memo=memo,
        order_key=order_key,
        owner_user_id=owner_user_id,
        owner_name=owner_name,
        source_ref=source_ref,
        created_by_user_id=user.id,
    )
    db.add(transaction)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if source_ref and _is_transaction_source_ref_violation(error):
            existing_id = db.scalar(
                select(Transaction.id).where(
                    Transaction.household_id == household.id,
                    Transaction.source_ref == source_ref,
                )
            )
            if existing_id:
                response.status_code = status.HTTP_200_OK
                return _load_transaction_read(db, str(existing_id))
        if _is_category_fk_violation(error):
            raise app_error(
                status_code=400,
                code="CATEGORY_INVALID",
                message="유효하지 않은 category_id 입니다.",
                action="가계 내 카테고리 ID를 확인해 주세요.",
            ) from error
        raise
    db.refresh(transaction)
    background_tasks.add_task(
        hub.broadcast,
        household.id,
        {
            "event": "transaction.created",
            "entity_id": transaction.id,
            "version": transaction.version,
        },
    )
    return _load_transaction_read(db, str(transaction.id))


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
    transaction = db.scalar(
        select(Transaction)
        .where(
            Transaction.id == transaction_id,
            Transaction.household_id == household.id,
        )
        .with_for_update()
    )
    if transaction is None:
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
    if "owner_user_id" in patch_data or "owner_name" in patch_data:
        patch_data["owner_user_id"], patch_data["owner_name"] = resolve_owner_fields(
            db,
            household_id=str(household.id),
            owner_user_id=patch_data.get("owner_user_id", transaction.owner_user_id),
            owner_name=patch_data.get("owner_name", transaction.owner_name),
            invalid_code="TRANSACTION_OWNER_INVALID",
            invalid_message="거래자는 현재 가계 구성원만 선택할 수 있습니다.",
            invalid_action="가계 구성원 목록에서 거래자를 다시 선택해 주세요.",
        )

    next_flow_type = patch_data.get("flow_type", transaction.flow_type)
    next_category_id = patch_data.get("category_id", transaction.category_id)
    if next_category_id:
        category = db.get(Category, next_category_id)
        if category is None or category.household_id != household.id:
            raise HTTPException(status_code=400, detail="invalid category_id")
        _ensure_category_flow_matches(category, next_flow_type)

    current_data = _load_transaction_read(db, str(transaction.id)).model_dump(mode="json")
    try:
        merged, changed_fields = merge_patch_or_raise(
            db=db,
            entity_type="transaction",
            entity=transaction,
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
        return _load_transaction_read(db, str(transaction.id))

    if "occurred_on" in changed_fields:
        transaction.order_key = _next_append_order_key(
            db,
            household_id=str(household.id),
            occurred_on=transaction.occurred_on,
            exclude_transaction_id=str(transaction.id),
        )

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
    db.refresh(transaction)
    background_tasks.add_task(
        hub.broadcast,
        household.id,
        {
            "event": "transaction.patch.applied",
            "entity_id": transaction.id,
            "version": transaction.version,
            "changed_fields": changed_fields,
            "merged": merged,
        },
    )
    return _load_transaction_read(db, str(transaction.id))


@router.post("/bulk-delete", response_model=TransactionBulkDeleteResult)
def bulk_delete_transactions(
    payload: TransactionBulkDeleteRequest,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> TransactionBulkDeleteResult:
    household, _ = ctx
    deleted_ids = list(dict.fromkeys(payload.transaction_ids))
    transactions = list(
        db.scalars(
            select(Transaction)
            .where(Transaction.id.in_(deleted_ids), Transaction.household_id == household.id)
            .with_for_update()
        ).all()
    )
    found_ids = {str(transaction.id) for transaction in transactions}
    if len(found_ids) != len(deleted_ids):
        db.rollback()
        missing_ids = [transaction_id for transaction_id in deleted_ids if transaction_id not in found_ids]
        raise app_error(
            status_code=404,
            code="TRANSACTION_BULK_DELETE_NOT_FOUND",
            message="삭제할 거래를 모두 찾지 못했습니다.",
            action="목록을 새로고침한 뒤 다시 선택해 주세요.",
            context={"transaction_ids": missing_ids},
        )

    by_id = {str(transaction.id): transaction for transaction in transactions}
    for transaction_id in deleted_ids:
        db.delete(by_id[transaction_id])
    db.commit()
    background_tasks.add_task(
        hub.broadcast,
        household.id,
        {
            "event": "transaction.bulk_deleted",
            "entity_ids": deleted_ids,
        },
    )
    return TransactionBulkDeleteResult(deleted_count=len(deleted_ids), deleted_ids=deleted_ids)


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: str,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> None:
    household, _ = ctx
    transaction = db.get(Transaction, transaction_id)
    if transaction is None or transaction.household_id != household.id:
        raise HTTPException(status_code=404, detail="transaction not found")
    db.delete(transaction)
    db.commit()
    background_tasks.add_task(
        hub.broadcast,
        household.id,
        {
            "event": "transaction.deleted",
            "entity_id": transaction_id,
        },
    )
