from __future__ import annotations

import json

from sqlalchemy import text

from app.db.base import Base
from app.db.session import engine
from app.db import models  # noqa: F401
from app.services.profile import DEFAULT_HOLDING_SETTINGS, DEFAULT_TRANSACTION_ROW_COLORS


_SCHEMA_BOOTSTRAPPED_URLS: set[str] = set()


def _sqlite_column_names(conn, table_name: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {str(row[1]).strip().lower() for row in rows if len(row) > 1}


def _repair_legacy_sqlite_schema() -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        user_columns = _sqlite_column_names(conn, "users")
        if not user_columns:
            return
        added_email_verified = False
        if "email_verified" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 1"))
            added_email_verified = True
        if "email_verified_at" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN email_verified_at DATETIME"))
        if "active_household_id" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN active_household_id VARCHAR(36)"))
        if "real_name" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN real_name VARCHAR(120)"))
        if "nickname" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN nickname VARCHAR(120)"))
        if "display_name_mode" not in user_columns:
            conn.execute(text("ALTER TABLE users ADD COLUMN display_name_mode VARCHAR(20) NOT NULL DEFAULT 'real_name'"))
        if added_email_verified:
            conn.execute(text("UPDATE users SET email_verified = 1 WHERE email_verified IS NULL OR email_verified = 0"))
        conn.execute(
            text(
                "UPDATE users SET real_name = display_name "
                "WHERE (real_name IS NULL OR trim(real_name) = '') "
                "AND display_name IS NOT NULL AND trim(display_name) <> ''"
            )
        )
        conn.execute(
            text(
                "UPDATE users SET display_name_mode = 'real_name' "
                "WHERE display_name_mode IS NULL OR trim(display_name_mode) = ''"
            )
        )

        household_columns = _sqlite_column_names(conn, "households")
        if household_columns and "transaction_row_colors" not in household_columns:
            conn.execute(
                text(
                    "ALTER TABLE households ADD COLUMN transaction_row_colors JSON "
                    f"NOT NULL DEFAULT '{json.dumps(DEFAULT_TRANSACTION_ROW_COLORS)}'"
                )
            )
        if household_columns and "holding_settings" not in household_columns:
            conn.execute(
                text(
                    "ALTER TABLE households ADD COLUMN holding_settings JSON "
                    f"NOT NULL DEFAULT '{json.dumps(DEFAULT_HOLDING_SETTINGS)}'"
                )
            )

        transaction_columns = _sqlite_column_names(conn, "transactions")
        if transaction_columns and "owner_user_id" not in transaction_columns:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN owner_user_id VARCHAR(36)"))

        holding_columns = _sqlite_column_names(conn, "holdings")
        if holding_columns and "owner_user_id" not in holding_columns:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN owner_user_id VARCHAR(36)"))
        if holding_columns and "type_key" not in holding_columns:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN type_key VARCHAR(80)"))
        if holding_columns and "display_order" not in holding_columns:
            conn.execute(text("ALTER TABLE holdings ADD COLUMN display_order INTEGER NOT NULL DEFAULT 100"))


def create_schema() -> None:
    url_key = str(engine.url)
    if url_key in _SCHEMA_BOOTSTRAPPED_URLS:
        return
    _repair_legacy_sqlite_schema()
    Base.metadata.create_all(bind=engine)
    _repair_legacy_sqlite_schema()
    _SCHEMA_BOOTSTRAPPED_URLS.add(url_key)

