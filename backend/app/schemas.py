from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.db.models import AssetType, DisplayNameMode, FlowType, InvitationStatus, MemberRole
from app.services.profile import (
    DEFAULT_HOLDING_SETTINGS,
    DEFAULT_TRANSACTION_ROW_COLORS,
    normalize_holding_settings,
    normalize_optional_text,
    normalize_transaction_row_colors,
)

SUPPORTED_CURRENCIES = {"KRW", "USD", "JPY", "EUR"}


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    real_name: str | None = None
    nickname: str | None = None
    display_name_mode: DisplayNameMode = DisplayNameMode.real_name
    display_name: str
    email_verified: bool
    email_verified_at: datetime | None = None
    active_household_id: str | None = None
    created_at: datetime


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)
    remember_me: bool = True

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("display_name must not be blank")
        return text


class RegisterResponse(BaseModel):
    status: Literal["verification_required", "registered"]
    email: str
    message: str
    verification_expires_in_seconds: int | None = None
    debug_verification_token: str | None = None
    access_token: str | None = None
    token_type: Literal["bearer"] | None = None
    user: UserRead | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    remember_me: bool = True


class AuthResponse(BaseModel):
    access_token: str | None = None
    token_type: Literal["bearer"] | None = None
    user: UserRead


class AuthRefreshResponse(BaseModel):
    access_token: str | None = None
    token_type: Literal["bearer"] | None = None


class AuthClientConfigResponse(BaseModel):
    csrf_cookie_name: str
    csrf_header_name: str
    household_header_name: str


class VerifyEmailRequest(BaseModel):
    token: str = Field(min_length=12, max_length=512)
    password: str = Field(min_length=8, max_length=128)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    remember_me: bool = True

    @field_validator("display_name")
    @classmethod
    def validate_optional_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            raise ValueError("display_name must not be blank")
        return text


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class ProfilePatchRequest(BaseModel):
    real_name: str | None = Field(default=None, max_length=120)
    nickname: str | None = Field(default=None, max_length=120)
    display_name_mode: DisplayNameMode | None = None

    @field_validator("real_name", "nickname")
    @classmethod
    def normalize_profile_text(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @model_validator(mode="after")
    def validate_non_empty_patch(self) -> ProfilePatchRequest:
        if not self.model_fields_set:
            raise ValueError("at least one profile field is required")
        return self


class HouseholdRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    base_currency: str
    created_at: datetime


class HouseholdCurrentResponse(BaseModel):
    household: HouseholdRead
    role: MemberRole


class HouseholdMembershipRead(BaseModel):
    household: HouseholdRead
    role: MemberRole
    is_active: bool


class HouseholdListResponse(BaseModel):
    households: list[HouseholdMembershipRead]


class HouseholdSelectRequest(BaseModel):
    household_id: str = Field(min_length=1, max_length=36)


class HouseholdMemberRead(BaseModel):
    member_id: str
    user_id: str
    email: str
    display_name: str
    role: MemberRole
    created_at: datetime


class HouseholdInvitationCreate(BaseModel):
    email: EmailStr
    role: MemberRole = MemberRole.viewer


class HouseholdInvitationRead(BaseModel):
    id: str
    household_id: str
    household_name: str | None = None
    email: str
    role: MemberRole
    status: InvitationStatus
    expires_at: datetime
    accepted_at: datetime | None = None
    created_at: datetime
    inviter_user_id: str | None = None
    inviter_display_name: str | None = None
    debug_invite_token: str | None = None


class HouseholdInvitationAcceptRequest(BaseModel):
    token: str = Field(min_length=12, max_length=512)


class HouseholdInvitationAcceptResponse(BaseModel):
    status: Literal["accepted"]
    invitation_id: str
    household_id: str
    household_name: str
    role: MemberRole
    active_household_selected: bool


class HouseholdMemberRolePatch(BaseModel):
    role: MemberRole


class HouseholdSettingsRead(BaseModel):
    household_id: str
    name: str
    base_currency: str
    transaction_row_colors: dict[str, str] = Field(default_factory=lambda: dict(DEFAULT_TRANSACTION_ROW_COLORS))
    holding_settings: dict[str, Any] = Field(default_factory=lambda: dict(DEFAULT_HOLDING_SETTINGS))


class HouseholdSettingsPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    transaction_row_colors: dict[str, str] | None = None
    holding_settings: dict[str, Any] | None = None

    @field_validator("name")
    @classmethod
    def validate_household_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            raise ValueError("name must not be blank")
        return text

    @field_validator("transaction_row_colors")
    @classmethod
    def validate_transaction_row_colors(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is None:
            return None
        return normalize_transaction_row_colors(value)

    @field_validator("holding_settings")
    @classmethod
    def validate_holding_settings(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return None
        return normalize_holding_settings(value)

    @model_validator(mode="after")
    def validate_non_empty_patch(self) -> HouseholdSettingsPatch:
        if not self.model_fields_set:
            raise ValueError("at least one household setting is required")
        return self


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    flow_type: FlowType
    major: str
    minor: str
    sort_order: int
    usage_count: int = 0


class CategoryCreate(BaseModel):
    flow_type: FlowType
    major: str = Field(min_length=1, max_length=120)
    minor: str = Field(min_length=1, max_length=120)

    @field_validator("major", "minor")
    @classmethod
    def normalize_category_text(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("blank value is not allowed")
        return text


class CategoryPatch(BaseModel):
    major: str | None = Field(default=None, min_length=1, max_length=120)
    minor: str | None = Field(default=None, min_length=1, max_length=120)

    @field_validator("major", "minor")
    @classmethod
    def normalize_optional_category_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            raise ValueError("blank value is not allowed")
        return text

    @model_validator(mode="after")
    def validate_non_empty_patch(self) -> CategoryPatch:
        if not self.model_fields_set:
            raise ValueError("at least one category field is required")
        return self


class CategoryRenameMajorRequest(BaseModel):
    flow_type: FlowType
    current_major: str = Field(min_length=1, max_length=120)
    next_major: str = Field(min_length=1, max_length=120)

    @field_validator("current_major", "next_major")
    @classmethod
    def normalize_major_text(cls, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            raise ValueError("blank value is not allowed")
        return text


class CategoryUsageEntry(BaseModel):
    transaction_id: str
    occurred_on: date
    amount: Decimal
    memo: str
    owner_name: str | None = None


class CategoryUsageMonth(BaseModel):
    month: str
    total_amount: Decimal
    count: int
    items: list[CategoryUsageEntry]


class TransactionCreate(BaseModel):
    occurred_on: date
    flow_type: FlowType
    amount: Decimal = Field(gt=0)
    currency: str = Field(default="KRW", min_length=3, max_length=8)
    category_id: str | None = None
    memo: str = Field(default="", max_length=2000)
    owner_user_id: str | None = Field(default=None, max_length=36)
    owner_name: str | None = Field(default=None, max_length=80)

    @field_validator("currency")
    @classmethod
    def normalize_transaction_currency(cls, value: str) -> str:
        code = str(value).strip().upper()
        if code != "KRW":
            raise ValueError("unsupported transaction currency")
        return code

    @field_validator("category_id", "owner_user_id")
    @classmethod
    def normalize_identifier(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @field_validator("owner_name")
    @classmethod
    def normalize_owner_name(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)


class TransactionPatch(BaseModel):
    base_version: int = Field(ge=1)
    occurred_on: date | None = None
    flow_type: FlowType | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    category_id: str | None = None
    memo: str | None = Field(default=None, max_length=2000)
    owner_user_id: str | None = Field(default=None, max_length=36)
    owner_name: str | None = Field(default=None, max_length=80)

    @field_validator("currency")
    @classmethod
    def normalize_patch_transaction_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        code = str(value).strip().upper()
        if code != "KRW":
            raise ValueError("unsupported transaction currency")
        return code

    @field_validator("category_id", "owner_user_id")
    @classmethod
    def normalize_patch_identifier(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @field_validator("owner_name")
    @classmethod
    def normalize_patch_owner_name(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)


class TransactionRead(BaseModel):
    id: str
    household_id: str
    category_id: str | None
    occurred_on: date
    flow_type: FlowType
    amount: Decimal
    currency: str
    memo: str
    owner_user_id: str | None = None
    owner_name: str | None
    source_ref: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class HoldingCreate(BaseModel):
    asset_type: AssetType
    type_key: str | None = Field(default=None, max_length=80)
    symbol: str = Field(min_length=1, max_length=40)
    market_symbol: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    category: str = Field(default="기타", min_length=1, max_length=80)
    owner_user_id: str | None = Field(default=None, max_length=36)
    owner_name: str | None = Field(default=None, max_length=80)
    account_name: str | None = Field(default=None, max_length=120)
    quantity: Decimal = Field(gt=0)
    average_cost: Decimal = Field(ge=0)
    currency: str = Field(default="KRW", min_length=3, max_length=8)
    display_order: int | None = Field(default=None, ge=1)

    @field_validator("symbol", "market_symbol", "name", "category")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        text = str(value).strip()
        if not text:
            raise ValueError("blank value is not allowed")
        return text

    @field_validator("owner_user_id")
    @classmethod
    def normalize_owner_user_id(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @field_validator("type_key")
    @classmethod
    def normalize_type_key(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @field_validator("owner_name", "account_name")
    @classmethod
    def normalize_optional_text_fields(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        code = str(value).strip().upper()
        if not re.fullmatch(r"[A-Z]{3,8}", code):
            raise ValueError("invalid currency code")
        if code not in SUPPORTED_CURRENCIES:
            raise ValueError("unsupported currency code")
        return code


class HoldingPatch(BaseModel):
    base_version: int = Field(ge=1)
    type_key: str | None = Field(default=None, max_length=80)
    market_symbol: str | None = Field(default=None, min_length=1, max_length=40)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    owner_user_id: str | None = Field(default=None, max_length=36)
    owner_name: str | None = Field(default=None, max_length=80)
    account_name: str | None = Field(default=None, max_length=120)
    quantity: Decimal | None = Field(default=None, gt=0)
    average_cost: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    display_order: int | None = Field(default=None, ge=1)

    @field_validator("owner_user_id")
    @classmethod
    def normalize_patch_owner_user_id(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @field_validator("type_key")
    @classmethod
    def normalize_patch_type_key(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @field_validator("owner_name", "account_name")
    @classmethod
    def normalize_patch_text_fields(cls, value: str | None) -> str | None:
        return normalize_optional_text(value)

    @field_validator("currency")
    @classmethod
    def normalize_patch_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        code = str(value).strip().upper()
        if not re.fullmatch(r"[A-Z]{3,8}", code):
            raise ValueError("invalid currency code")
        if code not in SUPPORTED_CURRENCIES:
            raise ValueError("unsupported currency code")
        return code


class HoldingRead(BaseModel):
    id: str
    household_id: str
    asset_type: AssetType
    type_key: str | None = None
    symbol: str
    market_symbol: str
    name: str
    category: str
    owner_user_id: str | None = None
    owner_name: str | None
    account_name: str | None
    quantity: Decimal
    average_cost: Decimal
    currency: str
    display_order: int
    source_ref: str | None
    version: int
    updated_at: datetime


class PatchConflict(BaseModel):
    entity_type: str
    entity_id: str
    current_version: int
    conflict_fields: list[str]
    current_data: dict[str, Any]


class TrendPoint(BaseModel):
    month: str
    income: Decimal
    expense: Decimal
    investment: Decimal
    transfer: Decimal
    net_cashflow: Decimal


class OverviewResponse(BaseModel):
    household_id: str
    filter_mode: Literal["month", "range"]
    year: int | None
    month: int | None
    start_date: date | None
    end_date: date | None
    min_available_month: str | None = None
    max_available_month: str | None = None
    totals: dict[str, Decimal]
    trend: list[TrendPoint]


class PortfolioItem(BaseModel):
    holding_id: str
    asset_type: AssetType
    type_key: str | None = None
    symbol: str
    market_symbol: str
    name: str
    category: str
    owner_name: str | None
    account_name: str | None
    quantity: Decimal
    average_cost: Decimal
    currency: str
    display_order: int
    latest_price: Decimal | None
    latest_price_currency: str | None
    market_value_krw: Decimal
    invested_krw: Decimal
    gain_loss_krw: Decimal
    source: str


class PortfolioCategorySlice(BaseModel):
    category: str
    market_value_krw: Decimal
    invested_krw: Decimal
    gain_loss_krw: Decimal
    weight_ratio: Decimal


class PortfolioResponse(BaseModel):
    household_id: str
    base_currency: str
    as_of: datetime
    total_market_value_krw: Decimal
    total_invested_krw: Decimal
    total_gain_loss_krw: Decimal
    items: list[PortfolioItem]
    categories: list[PortfolioCategorySlice]


class ImportIssue(BaseModel):
    severity: Literal["info", "warning", "error"]
    code: str
    message: str
    sheet: str | None = None
    row: int | None = None
    detail: dict[str, Any] | None = None


class ImportReport(BaseModel):
    workbook_path: str
    sheets: int
    formula_cells: int
    merged_ranges: int
    chart_count: int
    monthly_formula_mismatch_count: int
    detected_mismatch_cells: list[str]
    category_rows: int
    transaction_rows: int
    holding_rows: int
    applied_categories: int
    applied_transactions: int
    applied_holdings_added: int
    applied_holdings_updated: int
    skipped_transactions: int
    issues: list[ImportIssue]


class ImportRequest(BaseModel):
    workbook_path: str | None = Field(default=None, max_length=512)
    mode: Literal["dry_run", "apply"] = "dry_run"


class PriceStatus(BaseModel):
    household_id: str
    cache_seconds: int
    holdings_count: int
    tracked_holdings_count: int
    stale_count: int
    snapshot_count: int
    fx_base_currency: str
    updated_at: datetime | None
    refresh_in_progress: bool = False
    refresh_queued: bool = False
    refresh_started_at: datetime | None = None
    refresh_finished_at: datetime | None = None
    refresh_target_count: int = 0
    refresh_completed_count: int = 0
    refresh_refreshed_count: int = 0
    refresh_last_duration_ms: int | None = None
    refresh_last_error: str | None = None
