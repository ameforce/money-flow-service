from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import app_error
from app.db.models import (
    AssetType,
    Category,
    EntityPatchLog,
    FlowType,
    Holding,
    Household,
    HouseholdMember,
    Transaction,
    User,
)
from app.schemas import ImportIssue, MigrationPackageReport, validate_krw_transaction_amount
from app.services.owner_links import legacy_owner_name_key
from app.services.profile import normalize_holding_settings, normalize_optional_text, normalize_transaction_row_colors

_PACKAGE_KIND = "moneyflow-household-transfer"
_MANIFEST_KIND = "moneyflow-household-transfer-manifest"
_SCHEMA_VERSION = 1
_ZIP_REQUIRED_MEMBERS = ("manifest.json", "payload.json")
_FILE_NAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _decimal_to_text(value: Decimal) -> str:
    normalized = value.quantize(Decimal("0.00000001")).normalize()
    text = format(normalized, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _sanitize_filename_token(value: str, *, fallback: str) -> str:
    text = _FILE_NAME_SAFE_RE.sub("-", str(value or "").strip()).strip("-").lower()
    return text[:32] or fallback


def _owner_key(value: str | None) -> str:
    return legacy_owner_name_key(value)


def _parse_positive_decimal(value: str, *, field_name: str) -> Decimal:
    text = str(value or "").strip()
    try:
        parsed = Decimal(text)
    except InvalidOperation as error:
        raise app_error(
            status_code=400,
            code="MIGRATION_PACKAGE_INVALID",
            message=f"패키지의 {field_name} 값이 유효한 숫자가 아닙니다.",
            action="패키지를 다시 추출해 주세요.",
        ) from error
    if parsed <= 0:
        raise app_error(
            status_code=400,
            code="MIGRATION_PACKAGE_INVALID",
            message=f"패키지의 {field_name} 값은 0보다 커야 합니다.",
            action="패키지를 다시 추출해 주세요.",
        )
    return parsed


def _parse_non_negative_decimal(value: str, *, field_name: str) -> Decimal:
    text = str(value or "").strip()
    try:
        parsed = Decimal(text)
    except InvalidOperation as error:
        raise app_error(
            status_code=400,
            code="MIGRATION_PACKAGE_INVALID",
            message=f"패키지의 {field_name} 값이 유효한 숫자가 아닙니다.",
            action="패키지를 다시 추출해 주세요.",
        ) from error
    if parsed < 0:
        raise app_error(
            status_code=400,
            code="MIGRATION_PACKAGE_INVALID",
            message=f"패키지의 {field_name} 값은 음수가 될 수 없습니다.",
            action="패키지를 다시 추출해 주세요.",
        )
    return parsed


def _parse_positive_krw_transaction_amount(value: str, *, field_name: str) -> Decimal:
    parsed = _parse_positive_decimal(value, field_name=field_name)
    try:
        return validate_krw_transaction_amount(parsed) or parsed
    except ValueError as error:
        raise app_error(
            status_code=400,
            code="MIGRATION_PACKAGE_INVALID",
            message=f"패키지의 {field_name} 값은 원 단위 정수여야 합니다.",
            action="패키지를 다시 추출해 주세요.",
        ) from error


class _PackageSource(BaseModel):
    env: str = Field(default="", max_length=32)
    household_id: str = Field(min_length=1, max_length=36)
    household_name: str = Field(min_length=1, max_length=120)

    @field_validator("env", "household_id", "household_name", mode="before")
    @classmethod
    def _trim_required_text(cls, value: str) -> str:
        return str(value or "").strip()


class _PackageHouseholdSettings(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    base_currency: str = Field(min_length=1, max_length=8)
    transaction_row_colors: dict[str, str] = Field(default_factory=dict)
    holding_settings: dict = Field(default_factory=dict)

    @field_validator("name", "base_currency", mode="before")
    @classmethod
    def _trim_required_text(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("value must not be blank")
        return text


class _PackageCategory(BaseModel):
    flow_type: FlowType
    major: str = Field(min_length=1, max_length=120)
    minor: str = Field(min_length=1, max_length=120)
    sort_order: int = Field(default=100, ge=1, le=9999)

    @field_validator("major", "minor", mode="before")
    @classmethod
    def _trim_required_text(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("value must not be blank")
        return text


class _PackageTransaction(BaseModel):
    occurred_on: date
    flow_type: FlowType
    category_major: str = Field(min_length=1, max_length=120)
    category_minor: str = Field(min_length=1, max_length=120)
    amount: str = Field(min_length=1, max_length=64)
    currency: str = Field(min_length=1, max_length=8)
    memo: str = Field(default="", max_length=5000)
    owner_name: str | None = Field(default=None, max_length=80)
    source_ref: str = Field(min_length=1, max_length=120)
    order_key: int | None = Field(default=None, ge=1)

    @field_validator("category_major", "category_minor", "amount", "currency", "source_ref", mode="before")
    @classmethod
    def _trim_required_text(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("value must not be blank")
        return text

    @field_validator("memo", mode="before")
    @classmethod
    def _normalize_memo(cls, value: str | None) -> str:
        return str(value or "")

    @field_validator("owner_name", mode="before")
    @classmethod
    def _normalize_owner_name(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)


class _PackageHolding(BaseModel):
    asset_type: AssetType
    symbol: str = Field(min_length=1, max_length=40)
    market_symbol: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    type_key: str | None = Field(default=None, max_length=80)
    category: str = Field(default="기타", min_length=1, max_length=80)
    owner_name: str | None = Field(default=None, max_length=80)
    account_name: str = Field(default="", max_length=120)
    quantity: str = Field(min_length=1, max_length=64)
    average_cost: str = Field(min_length=1, max_length=64)
    currency: str = Field(min_length=1, max_length=8)
    display_order: int = Field(default=100, ge=1, le=9999)
    source_ref: str = Field(min_length=1, max_length=120)

    @field_validator("symbol", "market_symbol", "name", "category", "quantity", "average_cost", "currency", "source_ref", mode="before")
    @classmethod
    def _trim_required_text(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("value must not be blank")
        return text

    @field_validator("type_key", "owner_name", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @field_validator("account_name", mode="before")
    @classmethod
    def _normalize_account_name(cls, value: str | None) -> str:
        return str(value or "").strip()


class _PackagePayload(BaseModel):
    kind: str = Field(min_length=1, max_length=80)
    schema_version: int = Field(ge=1)
    exported_at: datetime
    source: _PackageSource
    household_settings: _PackageHouseholdSettings
    categories: list[_PackageCategory]
    transactions: list[_PackageTransaction]
    holdings: list[_PackageHolding]

    @field_validator("kind", mode="before")
    @classmethod
    def _trim_kind(cls, value: str) -> str:
        return str(value or "").strip()


class _PackageManifest(BaseModel):
    kind: str = Field(min_length=1, max_length=120)
    schema_version: int = Field(ge=1)
    payload_sha256: str = Field(min_length=64, max_length=64)
    payload_size_bytes: int = Field(ge=1)
    exported_at: datetime
    source_env: str = Field(default="", max_length=32)
    source_household_id: str = Field(min_length=1, max_length=36)
    source_household_name: str = Field(min_length=1, max_length=120)

    @field_validator("kind", "payload_sha256", "source_env", "source_household_id", "source_household_name", mode="before")
    @classmethod
    def _trim_required_text(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text and cls.__name__ != "_PackageManifest":
            raise ValueError("value must not be blank")
        return text


class MigrationPackageService:
    def export_package(self, db: Session, household: Household) -> tuple[bytes, str]:
        categories = db.scalars(
            select(Category).where(Category.household_id == household.id).order_by(Category.flow_type, Category.major, Category.minor)
        ).all()
        transactions = db.scalars(
            select(Transaction)
            .where(Transaction.household_id == household.id)
            .order_by(
                Transaction.occurred_on.asc(),
                Transaction.order_key.asc(),
                Transaction.created_at.asc(),
                Transaction.id.asc(),
            )
        ).all()
        holdings = db.scalars(
            select(Holding)
            .where(Holding.household_id == household.id)
            .order_by(Holding.display_order.asc(), Holding.updated_at.asc(), Holding.id.asc())
        ).all()

        payload = {
            "kind": _PACKAGE_KIND,
            "schema_version": _SCHEMA_VERSION,
            "exported_at": datetime.now(UTC).isoformat(),
            "source": {
                "env": str(settings.env or "").strip().lower(),
                "household_id": str(household.id),
                "household_name": str(household.name or "").strip(),
            },
            "household_settings": {
                "name": str(household.name or "").strip(),
                "base_currency": str(household.base_currency or "KRW").strip().upper()[:8] or "KRW",
                "transaction_row_colors": normalize_transaction_row_colors(household.transaction_row_colors),
                "holding_settings": normalize_holding_settings(household.holding_settings),
            },
            "categories": [
                {
                    "flow_type": str(getattr(item.flow_type, "value", item.flow_type)),
                    "major": str(item.major or "").strip(),
                    "minor": str(item.minor or "").strip(),
                    "sort_order": int(item.sort_order or 100),
                }
                for item in categories
            ],
            "transactions": [
                {
                    "occurred_on": item.occurred_on.isoformat(),
                    "flow_type": str(getattr(item.flow_type, "value", item.flow_type)),
                    "category_major": str(item.category.major if item.category else "").strip() or "기타",
                    "category_minor": str(item.category.minor if item.category else "").strip() or "기타",
                    "amount": _decimal_to_text(Decimal(item.amount)),
                    "currency": str(item.currency or "KRW").strip().upper()[:8] or "KRW",
                    "memo": str(item.memo or ""),
                    "owner_name": normalize_optional_text(item.owner_name),
                    "source_ref": str(item.source_ref or "").strip() or f"migration:tx:{item.id}",
                    "order_key": int(item.order_key or 0) or None,
                }
                for item in transactions
            ],
            "holdings": [
                {
                    "asset_type": str(getattr(item.asset_type, "value", item.asset_type)),
                    "symbol": str(item.symbol or "").strip(),
                    "market_symbol": str(item.market_symbol or "").strip(),
                    "name": str(item.name or "").strip(),
                    "type_key": normalize_optional_text(item.type_key),
                    "category": str(item.category or "기타").strip() or "기타",
                    "owner_name": normalize_optional_text(item.owner_name),
                    "account_name": str(item.account_name or "").strip(),
                    "quantity": _decimal_to_text(Decimal(item.quantity)),
                    "average_cost": _decimal_to_text(Decimal(item.average_cost)),
                    "currency": str(item.currency or "KRW").strip().upper()[:8] or "KRW",
                    "display_order": int(item.display_order or 100),
                    "source_ref": str(item.source_ref or "").strip() or f"migration:holding:{item.id}",
                }
                for item in holdings
            ],
        }
        payload_bytes = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
        payload_sha256 = hashlib.sha256(payload_bytes).hexdigest()
        manifest = {
            "kind": _MANIFEST_KIND,
            "schema_version": _SCHEMA_VERSION,
            "payload_sha256": payload_sha256,
            "payload_size_bytes": len(payload_bytes),
            "exported_at": payload["exported_at"],
            "source_env": payload["source"]["env"],
            "source_household_id": payload["source"]["household_id"],
            "source_household_name": payload["source"]["household_name"],
        }
        manifest_bytes = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", manifest_bytes)
            archive.writestr("payload.json", payload_bytes)
        timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        env_token = _sanitize_filename_token(payload["source"]["env"], fallback="env")
        household_token = _sanitize_filename_token(payload["source"]["household_name"], fallback="household")
        filename = f"moneyflow-transfer-{env_token}-{household_token}-{timestamp}.zip"
        return buffer.getvalue(), filename

    def load_package(self, package_path: Path) -> _PackagePayload:
        try:
            with zipfile.ZipFile(package_path, mode="r") as archive:
                infos = archive.infolist()
                if not infos:
                    raise app_error(
                        status_code=400,
                        code="MIGRATION_PACKAGE_EMPTY",
                        message="이식 패키지 파일이 비어 있습니다.",
                        action="정상적으로 추출된 파일인지 확인해 주세요.",
                    )
                if len(infos) > int(settings.import_max_zip_entries):
                    raise app_error(
                        status_code=413,
                        code="MIGRATION_PACKAGE_ARCHIVE_TOO_COMPLEX",
                        message="패키지 압축 구조가 너무 복잡해 처리를 중단했습니다.",
                        action="패키지를 다시 추출해 주세요.",
                        context={"max_entries": int(settings.import_max_zip_entries)},
                    )
                names = {info.filename for info in infos}
                if not all(member in names for member in _ZIP_REQUIRED_MEMBERS):
                    raise app_error(
                        status_code=400,
                        code="MIGRATION_PACKAGE_INVALID_ARCHIVE",
                        message="이식 패키지 구조가 올바르지 않습니다.",
                        action="dev 환경에서 패키지를 다시 추출해 주세요.",
                    )
                expanded = sum(int(getattr(info, "file_size", 0) or 0) for info in infos)
                if expanded > int(settings.import_max_uncompressed_bytes):
                    raise app_error(
                        status_code=413,
                        code="MIGRATION_PACKAGE_TOO_LARGE",
                        message="패키지 압축 해제 크기가 제한을 초과했습니다.",
                        action="패키지를 다시 추출하거나 데이터 범위를 줄여 주세요.",
                        context={"max_uncompressed_bytes": int(settings.import_max_uncompressed_bytes)},
                    )
                manifest_bytes = archive.read("manifest.json")
                payload_bytes = archive.read("payload.json")
        except zipfile.BadZipFile as error:
            raise app_error(
                status_code=400,
                code="MIGRATION_PACKAGE_INVALID_ARCHIVE",
                message="유효한 ZIP 패키지가 아닙니다.",
                action="패키지 파일을 확인한 뒤 다시 시도해 주세요.",
            ) from error

        try:
            manifest = _PackageManifest.model_validate_json(manifest_bytes)
        except ValidationError as error:
            raise app_error(
                status_code=400,
                code="MIGRATION_PACKAGE_INVALID_MANIFEST",
                message="패키지 manifest 형식이 올바르지 않습니다.",
                action="dev 환경에서 패키지를 다시 추출해 주세요.",
            ) from error
        if manifest.kind != _MANIFEST_KIND or int(manifest.schema_version) != _SCHEMA_VERSION:
            raise app_error(
                status_code=400,
                code="MIGRATION_PACKAGE_SCHEMA_UNSUPPORTED",
                message="지원하지 않는 패키지 버전입니다.",
                action="최신 버전에서 패키지를 다시 생성해 주세요.",
            )
        digest = hashlib.sha256(payload_bytes).hexdigest()
        if digest != manifest.payload_sha256 or int(manifest.payload_size_bytes) != len(payload_bytes):
            raise app_error(
                status_code=400,
                code="MIGRATION_PACKAGE_HASH_MISMATCH",
                message="패키지 무결성 검증에 실패했습니다.",
                action="파일 전송 중 손상 여부를 확인하고 다시 업로드해 주세요.",
            )
        try:
            payload = _PackagePayload.model_validate_json(payload_bytes)
        except ValidationError as error:
            raise app_error(
                status_code=400,
                code="MIGRATION_PACKAGE_INVALID",
                message="패키지 payload 형식이 올바르지 않습니다.",
                action="dev 환경에서 패키지를 다시 추출해 주세요.",
            ) from error
        if payload.kind != _PACKAGE_KIND or int(payload.schema_version) != _SCHEMA_VERSION:
            raise app_error(
                status_code=400,
                code="MIGRATION_PACKAGE_SCHEMA_UNSUPPORTED",
                message="지원하지 않는 패키지 버전입니다.",
                action="최신 버전에서 패키지를 다시 생성해 주세요.",
            )
        return payload

    def run_transfer(
        self,
        db: Session,
        *,
        household: Household,
        actor_user_id: str,
        package_name: str,
        payload: _PackagePayload,
        mode: str,
        replace_existing: bool,
    ) -> MigrationPackageReport:
        issues: list[ImportIssue] = []
        owner_lookup, ambiguous_owner_names = self._build_owner_lookup(db, household.id)

        owner_names = {
            key
            for key in (
                _owner_key(item.owner_name) for item in [*payload.transactions, *payload.holdings]
            )
            if key
        }
        ambiguous = sorted({name for name in owner_names if name in ambiguous_owner_names})
        unmatched = sorted({name for name in owner_names if name not in owner_lookup and name not in ambiguous_owner_names})
        if ambiguous:
            issues.append(
                ImportIssue(
                    severity="warning",
                    code="MIGRATION_OWNER_NAME_AMBIGUOUS",
                    message="동일 표시명을 가진 구성원이 있어 일부 소유자 연결을 텍스트 이름(owner_name)만 유지했습니다.",
                    detail={"count": len(ambiguous), "sample": ambiguous[:10]},
                )
            )
        if unmatched:
            issues.append(
                ImportIssue(
                    severity="warning",
                    code="MIGRATION_OWNER_NAME_UNMATCHED",
                    message="현재 가계에서 찾을 수 없는 소유자 이름이 있어 owner_user_id를 연결하지 않았습니다.",
                    detail={"count": len(unmatched), "sample": unmatched[:10]},
                )
            )

        category_rows = len(payload.categories)
        transaction_rows = len(payload.transactions)
        holding_rows = len(payload.holdings)
        applied_categories = 0
        applied_transactions = 0
        applied_holdings = 0
        category_sort_orders: dict[tuple[FlowType, str, str], int] = {}
        for index, row in enumerate(payload.categories, start=1):
            key = (row.flow_type, row.major, row.minor)
            if key in category_sort_orders:
                issues.append(
                    ImportIssue(
                        severity="warning",
                        code="MIGRATION_CATEGORY_DUPLICATED",
                        message="중복 카테고리 행을 건너뛰었습니다.",
                        row=index,
                        detail={"flow_type": str(row.flow_type), "major": row.major, "minor": row.minor},
                    )
                )
                continue
            category_sort_orders[key] = int(row.sort_order)
        for row in payload.transactions:
            tx_key = (row.flow_type, row.category_major, row.category_minor)
            category_sort_orders.setdefault(tx_key, 100)

        prepared_transactions: list[dict[str, object]] = []
        seen_source_refs: set[str] = set()
        for index, row in enumerate(payload.transactions, start=1):
            source_ref = row.source_ref
            if source_ref in seen_source_refs:
                issues.append(
                    ImportIssue(
                        severity="warning",
                        code="MIGRATION_TX_SOURCE_REF_DUPLICATED",
                        message="중복 source_ref 거래를 건너뛰었습니다.",
                        row=index,
                        detail={"source_ref": source_ref},
                    )
                )
                continue
            seen_source_refs.add(source_ref)
            amount = _parse_positive_krw_transaction_amount(row.amount, field_name="transactions.amount")
            owner_name = normalize_optional_text(row.owner_name)
            owner_user_id = owner_lookup.get(_owner_key(owner_name)) if owner_name else None
            prepared_transactions.append(
                {
                    "payload_index": index,
                    "category_key": (row.flow_type, row.category_major, row.category_minor),
                    "flow_type": row.flow_type,
                    "occurred_on": row.occurred_on,
                    "amount": amount,
                    "currency": str(row.currency or "KRW").strip().upper()[:8] or "KRW",
                    "memo": str(row.memo or ""),
                    "owner_user_id": owner_user_id,
                    "owner_name": owner_name,
                    "source_ref": source_ref,
                    "order_key": int(row.order_key or 0) or None,
                }
            )

        prepared_holdings: list[dict[str, object]] = []
        seen_holding_identity: set[tuple[str, str, str, str, str]] = set()
        for index, row in enumerate(payload.holdings, start=1):
            quantity = _parse_positive_decimal(row.quantity, field_name="holdings.quantity")
            average_cost = _parse_non_negative_decimal(row.average_cost, field_name="holdings.average_cost")
            owner_name = normalize_optional_text(row.owner_name) or ""
            owner_user_id = owner_lookup.get(_owner_key(owner_name)) if owner_name else None
            identity = (
                str(row.asset_type),
                str(row.market_symbol).strip().upper(),
                str(owner_user_id or ""),
                owner_name.strip(),
                str(row.account_name or "").strip(),
            )
            if identity in seen_holding_identity:
                issues.append(
                    ImportIssue(
                        severity="warning",
                        code="MIGRATION_HOLDING_DUPLICATED",
                        message="동일 식별자 자산이 중복되어 뒤쪽 항목을 건너뛰었습니다.",
                        row=index,
                        detail={
                            "asset_type": str(row.asset_type),
                            "market_symbol": str(row.market_symbol),
                            "owner_name": owner_name,
                        },
                    )
                )
                continue
            seen_holding_identity.add(identity)
            prepared_holdings.append(
                {
                    "asset_type": row.asset_type,
                    "symbol": row.symbol,
                    "market_symbol": row.market_symbol,
                    "name": row.name,
                    "type_key": row.type_key,
                    "category": row.category,
                    "owner_user_id": owner_user_id,
                    "owner_name": owner_name,
                    "account_name": row.account_name,
                    "quantity": quantity,
                    "average_cost": average_cost,
                    "currency": str(row.currency or "KRW").strip().upper()[:8] or "KRW",
                    "display_order": int(row.display_order),
                    "source_ref": row.source_ref,
                }
            )

        if mode == "apply":
            if not replace_existing:
                raise app_error(
                    status_code=400,
                    code="MIGRATION_APPLY_REPLACE_REQUIRED",
                    message="적용 모드에서는 기존 데이터를 교체하도록 확인해야 합니다.",
                    action="replace_existing=true로 다시 시도해 주세요.",
                )

            db.execute(delete(Transaction).where(Transaction.household_id == household.id))
            db.execute(delete(Holding).where(Holding.household_id == household.id))
            db.execute(delete(Category).where(Category.household_id == household.id))
            db.execute(delete(EntityPatchLog).where(EntityPatchLog.household_id == household.id))

            household_settings = payload.household_settings
            household.name = household_settings.name
            household.base_currency = household_settings.base_currency
            household.transaction_row_colors = normalize_transaction_row_colors(household_settings.transaction_row_colors)
            household.holding_settings = normalize_holding_settings(household_settings.holding_settings)

            category_map: dict[tuple[FlowType, str, str], Category] = {}
            for key, sort_order in category_sort_orders.items():
                flow_type, major, minor = key
                category = Category(
                    household_id=household.id,
                    flow_type=flow_type,
                    major=major,
                    minor=minor,
                    sort_order=int(sort_order),
                )
                db.add(category)
                category_map[key] = category
            db.flush()
            applied_categories = len(category_map)

            next_order_keys: dict[date, int] = {}
            ordered_transactions = sorted(
                prepared_transactions,
                key=lambda row: (
                    row["occurred_on"],
                    int(row["order_key"] or 0) if row["order_key"] else 2**63 - 1,
                    int(row["payload_index"]),
                ),
            )
            for row in ordered_transactions:
                category = category_map[row["category_key"]]
                occurred_on = row["occurred_on"]
                if occurred_on not in next_order_keys:
                    max_key = db.scalar(
                        select(func.max(Transaction.order_key)).where(
                            Transaction.household_id == household.id,
                            Transaction.occurred_on == occurred_on,
                        )
                    )
                    next_order_keys[occurred_on] = int(max_key or 0) + 1024
                order_key = next_order_keys[occurred_on]
                next_order_keys[occurred_on] = order_key + 1024
                db.add(
                    Transaction(
                        household_id=household.id,
                        category_id=category.id,
                        flow_type=row["flow_type"],
                        occurred_on=occurred_on,
                        amount=row["amount"],
                        currency=row["currency"],
                        memo=row["memo"],
                        order_key=order_key,
                        owner_user_id=row["owner_user_id"],
                        owner_name=row["owner_name"],
                        source_ref=row["source_ref"],
                        version=1,
                        created_by_user_id=actor_user_id,
                    )
                )
            applied_transactions = len(prepared_transactions)

            for row in prepared_holdings:
                db.add(
                    Holding(
                        household_id=household.id,
                        asset_type=row["asset_type"],
                        symbol=row["symbol"],
                        market_symbol=row["market_symbol"],
                        name=row["name"],
                        type_key=row["type_key"],
                        category=row["category"],
                        owner_user_id=row["owner_user_id"],
                        owner_name=row["owner_name"],
                        account_name=row["account_name"],
                        quantity=row["quantity"],
                        average_cost=row["average_cost"],
                        currency=row["currency"],
                        display_order=row["display_order"],
                        source_ref=row["source_ref"],
                        version=1,
                    )
                )
            applied_holdings = len(prepared_holdings)

        return MigrationPackageReport(
            package_name=package_name,
            mode=mode,
            replace_existing=bool(replace_existing),
            schema_version=int(payload.schema_version),
            source_env=str(payload.source.env or "").strip().lower() or None,
            source_household_name=payload.source.household_name,
            category_rows=category_rows,
            transaction_rows=transaction_rows,
            holding_rows=holding_rows,
            applied_categories=applied_categories,
            applied_transactions=applied_transactions,
            applied_holdings=applied_holdings,
            owner_names_unmatched=len(unmatched),
            owner_names_ambiguous=len(ambiguous),
            issues=issues,
        )

    def _build_owner_lookup(self, db: Session, household_id: str) -> tuple[dict[str, str], set[str]]:
        owner_rows = db.execute(
            select(HouseholdMember.user_id, User.display_name)
            .join(User, User.id == HouseholdMember.user_id)
            .where(HouseholdMember.household_id == household_id)
        ).all()
        grouped: dict[str, set[str]] = {}
        for user_id, display_name in owner_rows:
            key = _owner_key(display_name)
            if not key:
                continue
            grouped.setdefault(key, set()).add(str(user_id))
        resolved = {name: next(iter(ids)) for name, ids in grouped.items() if len(ids) == 1}
        ambiguous = {name for name, ids in grouped.items() if len(ids) > 1}
        return resolved, ambiguous
