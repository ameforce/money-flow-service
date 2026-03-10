from __future__ import annotations

import enum
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    JSON,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class MemberRole(str, enum.Enum):
    owner = "owner"
    co_owner = "co_owner"
    editor = "editor"
    viewer = "viewer"


class InvitationStatus(str, enum.Enum):
    pending = "pending"
    accepted = "accepted"
    revoked = "revoked"
    expired = "expired"


class FlowType(str, enum.Enum):
    income = "income"
    expense = "expense"
    investment = "investment"
    transfer = "transfer"


class AssetType(str, enum.Enum):
    stock = "stock"
    crypto = "crypto"
    cash = "cash"
    real_estate = "real_estate"
    pension = "pension"
    other = "other"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    active_household_id: Mapped[str | None] = mapped_column(
        ForeignKey("households.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    memberships: Mapped[list["HouseholdMember"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    active_household: Mapped["Household | None"] = relationship(
        "Household",
        foreign_keys=[active_household_id],
    )
    email_verification_tokens: Mapped[list["EmailVerificationToken"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    __table_args__ = (Index("idx_revoked_expires_at", "expires_at"),)

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class UsedWsTicket(Base):
    __tablename__ = "used_ws_tickets"
    __table_args__ = (Index("idx_used_ws_ticket_expires_at", "expires_at"),)

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class LoginThrottle(Base):
    __tablename__ = "login_throttle"

    key: Mapped[str] = mapped_column(String(320), primary_key=True)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class RegisterThrottle(Base):
    __tablename__ = "register_throttle"

    key: Mapped[str] = mapped_column(String(320), primary_key=True)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ImportExecutionLock(Base):
    __tablename__ = "import_execution_lock"

    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), primary_key=True)
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Household(Base):
    __tablename__ = "households"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    base_currency: Mapped[str] = mapped_column(String(8), nullable=False, default="KRW")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    members: Mapped[list["HouseholdMember"]] = relationship(back_populates="household", cascade="all, delete-orphan")
    categories: Mapped[list["Category"]] = relationship(back_populates="household", cascade="all, delete-orphan")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="household", cascade="all, delete-orphan")
    holdings: Mapped[list["Holding"]] = relationship(back_populates="household", cascade="all, delete-orphan")
    patch_logs: Mapped[list["EntityPatchLog"]] = relationship(back_populates="household", cascade="all, delete-orphan")
    invitations: Mapped[list["HouseholdInvitation"]] = relationship(
        back_populates="household",
        cascade="all, delete-orphan",
    )


class HouseholdMember(Base):
    __tablename__ = "household_members"
    __table_args__ = (UniqueConstraint("household_id", "user_id", name="uq_household_member"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[MemberRole] = mapped_column(String(20), nullable=False, default=MemberRole.editor)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    household: Mapped["Household"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="memberships")


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_email_verification_token_hash"),
        Index("idx_email_verification_user", "user_id"),
        Index("idx_email_verification_expires_at", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    sent_to: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped["User"] = relationship(back_populates="email_verification_tokens")


class HouseholdInvitation(Base):
    __tablename__ = "household_invitations"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_household_invitation_token_hash"),
        Index(
            "uq_household_invite_pending_household_email",
            "household_id",
            text("lower(email)"),
            unique=True,
            sqlite_where=text("status = 'pending'"),
            postgresql_where=text("status = 'pending'"),
        ),
        Index("idx_household_invite_household_status", "household_id", "status"),
        Index("idx_household_invite_email_status", "email", "status"),
        Index("idx_household_invite_expires_at", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    inviter_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    accepted_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    role: Mapped[MemberRole] = mapped_column(String(20), nullable=False, default=MemberRole.viewer)
    status: Mapped[InvitationStatus] = mapped_column(String(20), nullable=False, default=InvitationStatus.pending)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    household: Mapped["Household"] = relationship(back_populates="invitations")


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint("household_id", "flow_type", "major", "minor", name="uq_category_major_minor"),
        Index("idx_category_household_flow", "household_id", "flow_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    flow_type: Mapped[FlowType] = mapped_column(Enum(FlowType), nullable=False)
    major: Mapped[str] = mapped_column(String(120), nullable=False)
    minor: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    household: Mapped["Household"] = relationship(back_populates="categories")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="category")


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("household_id", "source_ref", name="uq_transaction_source_ref"),
        Index("idx_tx_household_date", "household_id", "occurred_on"),
        Index("idx_tx_household_type_date", "household_id", "flow_type", "occurred_on"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    flow_type: Mapped[FlowType] = mapped_column(Enum(FlowType), nullable=False)
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="KRW")
    memo: Mapped[str] = mapped_column(Text, nullable=False, default="")
    owner_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    household: Mapped["Household"] = relationship(back_populates="transactions")
    category: Mapped["Category | None"] = relationship(back_populates="transactions")


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (
        UniqueConstraint(
            "household_id",
            "asset_type",
            "market_symbol",
            "owner_name",
            "account_name",
            name="uq_holding_identity",
        ),
        Index("idx_holding_household", "household_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    asset_type: Mapped[AssetType] = mapped_column(Enum(AssetType), nullable=False)
    symbol: Mapped[str] = mapped_column(String(40), nullable=False)
    market_symbol: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False, default="기타")
    owner_name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    account_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    quantity: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    average_cost: Mapped[Decimal] = mapped_column(Numeric(20, 4), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="KRW")
    source_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    household: Mapped["Household"] = relationship(back_populates="holdings")


class PriceSnapshot(Base):
    __tablename__ = "price_snapshots"
    __table_args__ = (
        UniqueConstraint("asset_type", "symbol", name="uq_price_asset_symbol"),
        Index("idx_price_fetched_at", "fetched_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    asset_type: Mapped[AssetType] = mapped_column(Enum(AssetType), nullable=False)
    symbol: Mapped[str] = mapped_column(String(40), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PriceRefreshStatus(Base):
    __tablename__ = "price_refresh_status"

    household_id: Mapped[str] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"),
        primary_key=True,
    )
    in_progress: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    queued: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    target_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    refreshed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class FxRate(Base):
    __tablename__ = "fx_rates"
    __table_args__ = (
        UniqueConstraint("base_currency", "quote_currency", name="uq_fx_pair"),
        Index("idx_fx_fetched_at", "fetched_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    base_currency: Mapped[str] = mapped_column(String(8), nullable=False)
    quote_currency: Mapped[str] = mapped_column(String(8), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class EntityPatchLog(Base):
    __tablename__ = "entity_patch_logs"
    __table_args__ = (
        Index("idx_patch_entity", "entity_type", "entity_id", "resulting_version"),
        Index("idx_patch_household_created", "household_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    household_id: Mapped[str] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    base_version: Mapped[int] = mapped_column(Integer, nullable=False)
    resulting_version: Mapped[int] = mapped_column(Integer, nullable=False)
    changed_fields: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    merged: Mapped[bool] = mapped_column(nullable=False, default=False)
    conflict_fields: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    household: Mapped["Household"] = relationship(back_populates="patch_logs")
