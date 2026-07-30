from __future__ import annotations

import sys

from sqlalchemy import inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.db.models import DisplayNameMode, Household, User
from app.db.session import engine
from app.services.profile import normalize_holding_settings, normalize_transaction_row_colors, sync_user_display_name


_LEGACY_NULL_OWNER_SENTINEL = "__legacy_null_owner__:"


def _log_schema_upgrade_summary(engine: Engine) -> None:
    dialect = str(engine.dialect.name).lower()
    url = engine.url
    host = str(url.host or "")
    database = str(url.database or "")
    try:
        with engine.connect() as conn:
            users = int(conn.execute(text("SELECT COUNT(*) FROM users")).scalar_one())
            households = int(conn.execute(text("SELECT COUNT(*) FROM households")).scalar_one())
    except Exception as exc:  # noqa: BLE001 — deploy diagnostics only
        print(f"[schema_upgrade] summary query failed: {exc}", file=sys.stderr)
        return
    print(
        f"[schema_upgrade] dialect={dialect} host={host!r} database={database!r} "
        f"users={users} households={households}",
        file=sys.stderr,
    )


def _column_names(bind, table_name: str) -> set[str]:
    inspector = inspect(bind)
    return {str(column["name"]).strip().lower() for column in inspector.get_columns(table_name)}


def _add_column_if_missing(bind, table_name: str, column_name: str, ddl: str) -> None:
    if column_name.lower() in _column_names(bind, table_name):
        return
    bind.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {ddl}"))


def _json_type_name(dialect_name: str) -> str:
    if dialect_name == "postgresql":
        return "JSONB"
    return "JSON"


def _sqlite_version_tuple(version: str) -> tuple[int, int, int]:
    parts: list[int] = []
    for raw_part in str(version or "").split(".")[:3]:
        digits = "".join(ch for ch in raw_part if ch.isdigit())
        parts.append(int(digits or 0))
    while len(parts) < 3:
        parts.append(0)
    return parts[0], parts[1], parts[2]


def _holding_owner_identity_sql(dialect_name: str) -> str:
    if dialect_name == "postgresql":
        return (
            "COALESCE("
            "NULLIF(BTRIM(owner_user_id), ''), "
            f"'{_LEGACY_NULL_OWNER_SENTINEL}' || BTRIM(COALESCE(owner_name, ''))"
            ")"
        )
    return (
        "COALESCE("
        "NULLIF(TRIM(owner_user_id), ''), "
        f"'{_LEGACY_NULL_OWNER_SENTINEL}' || TRIM(COALESCE(owner_name, ''))"
        ")"
    )


def _holding_market_symbol_sql(dialect_name: str) -> str:
    if dialect_name == "postgresql":
        return "UPPER(BTRIM(market_symbol))"
    return "UPPER(TRIM(market_symbol))"


def _holding_account_name_sql(dialect_name: str) -> str:
    if dialect_name == "postgresql":
        return "BTRIM(COALESCE(account_name, ''))"
    return "TRIM(COALESCE(account_name, ''))"


def _ensure_holding_identity_index_supported(bind, dialect_name: str) -> None:
    if dialect_name == "postgresql":
        return
    if dialect_name == "sqlite":
        version = str(bind.execute(text("SELECT sqlite_version()")).scalar_one_or_none() or "")
        if _sqlite_version_tuple(version) >= (3, 9, 0):
            return
        raise RuntimeError(
            "Cannot create uq_holding_identity expression index: SQLite 3.9.0 or newer is required "
            f"(detected {version or 'unknown'})."
        )
    raise RuntimeError(
        "Cannot create uq_holding_identity expression index: unsupported database dialect "
        f"{dialect_name!r}."
    )


def _assert_no_duplicate_holding_identities(bind, dialect_name: str) -> None:
    owner_expr = _holding_owner_identity_sql(dialect_name)
    market_expr = _holding_market_symbol_sql(dialect_name)
    account_expr = _holding_account_name_sql(dialect_name)
    duplicates = bind.execute(
        text(
            "SELECT household_id, asset_type, "
            f"{market_expr} AS market_symbol, "
            f"{owner_expr} AS owner_identity, "
            f"{account_expr} AS account_name, "
            "COUNT(*) AS duplicate_count "
            "FROM holdings "
            "GROUP BY household_id, asset_type, "
            f"{market_expr}, {owner_expr}, {account_expr} "
            "HAVING COUNT(*) > 1 "
            "ORDER BY duplicate_count DESC, household_id, asset_type, market_symbol "
            "LIMIT 20"
        )
    ).mappings().all()
    if not duplicates:
        return
    examples = [
        (
            f"household_id={row['household_id']} asset_type={row['asset_type']} "
            f"market_symbol={row['market_symbol']} owner_identity={row['owner_identity']!r} "
            f"account_name={row['account_name']!r} count={row['duplicate_count']}"
        )
        for row in duplicates
    ]
    raise RuntimeError(
        "Cannot create uq_holding_identity because duplicate holding identities already exist. "
        "Resolve duplicates explicitly before rerunning schema upgrade. Examples: "
        + "; ".join(examples)
    )


def _create_holding_identity_index(bind, dialect_name: str) -> None:
    _ensure_holding_identity_index_supported(bind, dialect_name)
    _assert_no_duplicate_holding_identities(bind, dialect_name)
    owner_expr = _holding_owner_identity_sql(dialect_name)
    market_expr = _holding_market_symbol_sql(dialect_name)
    account_expr = _holding_account_name_sql(dialect_name)
    if dialect_name == "postgresql":
        bind.execute(text("ALTER TABLE holdings DROP CONSTRAINT IF EXISTS uq_holding_identity"))
    bind.execute(text("DROP INDEX IF EXISTS uq_holding_identity"))
    bind.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_holding_identity "
            "ON holdings ("
            "household_id, "
            "asset_type, "
            f"{market_expr}, "
            f"{owner_expr}, "
            f"{account_expr}"
            ")"
        )
    )


def _backfill_transaction_order_keys(bind) -> None:
    groups = bind.execute(
        text(
            "SELECT DISTINCT household_id, occurred_on "
            "FROM transactions "
            "WHERE order_key IS NULL OR order_key = 0"
        )
    ).mappings().all()
    for group in groups:
        rows = bind.execute(
            text(
                "SELECT id "
                "FROM transactions "
                "WHERE household_id = :household_id AND occurred_on = :occurred_on "
                "ORDER BY created_at DESC, id DESC"
            ),
            {"household_id": group["household_id"], "occurred_on": group["occurred_on"]},
        ).mappings().all()
        for index, row in enumerate(rows, start=1):
            bind.execute(
                text("UPDATE transactions SET order_key = :order_key WHERE id = :id"),
                {"order_key": index * 1024, "id": row["id"]},
            )


def _create_indexes(bind, dialect_name: str) -> None:
    bind.execute(text("DROP INDEX IF EXISTS idx_tx_household_cursor"))
    bind.execute(
        text(
            "CREATE INDEX IF NOT EXISTS idx_tx_household_cursor "
            "ON transactions (household_id, occurred_on, order_key, created_at, id)"
        )
    )
    bind.execute(text("CREATE INDEX IF NOT EXISTS idx_tx_household_owner_user ON transactions (household_id, owner_user_id)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS idx_holding_household_owner_user ON holdings (household_id, owner_user_id)"))
    _create_holding_identity_index(bind, dialect_name)


def upgrade_schema(bind_engine: Engine | None = None) -> None:
    active_engine = bind_engine or engine
    dialect_name = str(active_engine.dialect.name).lower()
    json_type_name = _json_type_name(dialect_name)
    print(
        f"[schema_upgrade] starting dialect={dialect_name} host={active_engine.url.host!r} "
        f"database={active_engine.url.database!r}",
        file=sys.stderr,
    )

    with active_engine.begin() as conn:
        _add_column_if_missing(conn, "users", "real_name", "real_name VARCHAR(120)")
        _add_column_if_missing(conn, "users", "nickname", "nickname VARCHAR(120)")
        _add_column_if_missing(
            conn,
            "users",
            "display_name_mode",
            "display_name_mode VARCHAR(20) NOT NULL DEFAULT 'real_name'",
        )
        _add_column_if_missing(
            conn,
            "households",
            "transaction_row_colors",
            f"transaction_row_colors {json_type_name} NOT NULL DEFAULT '{{}}'",
        )
        _add_column_if_missing(
            conn,
            "households",
            "holding_settings",
            f"holding_settings {json_type_name} NOT NULL DEFAULT '{{}}'",
        )
        _add_column_if_missing(conn, "transactions", "owner_user_id", "owner_user_id VARCHAR(36)")
        _add_column_if_missing(conn, "transactions", "order_key", "order_key INTEGER NOT NULL DEFAULT 0")
        _add_column_if_missing(conn, "transactions", "installment_months", "installment_months INTEGER")
        _add_column_if_missing(conn, "holdings", "owner_user_id", "owner_user_id VARCHAR(36)")
        _add_column_if_missing(conn, "holdings", "type_key", "type_key VARCHAR(80)")
        _add_column_if_missing(conn, "holdings", "display_order", "display_order INTEGER NOT NULL DEFAULT 100")
        if inspect(conn).has_table("email_verification_tokens"):
            _add_column_if_missing(
                conn,
                "email_verification_tokens",
                "verification_code_hash",
                "verification_code_hash VARCHAR(128)",
            )
            _add_column_if_missing(
                conn,
                "email_verification_tokens",
                "pending_password_hash",
                "pending_password_hash VARCHAR(255)",
            )
            _add_column_if_missing(
                conn,
                "email_verification_tokens",
                "pending_display_name",
                "pending_display_name VARCHAR(120)",
            )
            _add_column_if_missing(
                conn,
                "email_verification_tokens",
                "registration_continuation_hash",
                "registration_continuation_hash VARCHAR(128)",
            )
        _backfill_transaction_order_keys(conn)
        _create_indexes(conn, dialect_name)

    with Session(active_engine) as db:
        users = db.scalars(select(User)).all()
        for user in users:
            if not str(user.real_name or "").strip() and str(user.display_name or "").strip():
                user.real_name = str(user.display_name).strip()
            if not str(user.display_name_mode or "").strip():
                user.display_name_mode = DisplayNameMode.real_name.value
            sync_user_display_name(user)

        households = db.scalars(select(Household)).all()
        for household in households:
            household.transaction_row_colors = normalize_transaction_row_colors(household.transaction_row_colors)
            household.holding_settings = normalize_holding_settings(household.holding_settings)

        db.commit()

    _log_schema_upgrade_summary(active_engine)


if __name__ == "__main__":
    upgrade_schema()
