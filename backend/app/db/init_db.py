from __future__ import annotations

from sqlalchemy import text

from app.db.base import Base
from app.db.session import engine
from app.db import models  # noqa: F401


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
        if added_email_verified:
            conn.execute(text("UPDATE users SET email_verified = 1 WHERE email_verified IS NULL OR email_verified = 0"))


def create_schema() -> None:
    url_key = str(engine.url)
    if url_key in _SCHEMA_BOOTSTRAPPED_URLS:
        return
    _repair_legacy_sqlite_schema()
    Base.metadata.create_all(bind=engine)
    _repair_legacy_sqlite_schema()
    _SCHEMA_BOOTSTRAPPED_URLS.add(url_key)

