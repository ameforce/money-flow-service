from __future__ import annotations

from sqlalchemy import inspect, select, text
from sqlalchemy.engine import Engine

from app.db.models import DisplayNameMode, Household, User
from app.db.session import SessionLocal, engine
from app.services.owner_links import backfill_owner_links_for_household
from app.services.profile import normalize_holding_settings, normalize_transaction_row_colors, sync_user_display_name


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


def _create_indexes(bind, dialect_name: str) -> None:
    bind.execute(text("CREATE INDEX IF NOT EXISTS idx_tx_household_owner_user ON transactions (household_id, owner_user_id)"))
    bind.execute(text("CREATE INDEX IF NOT EXISTS idx_holding_household_owner_user ON holdings (household_id, owner_user_id)"))
    if dialect_name != "postgresql":
        return
    bind.execute(text("ALTER TABLE holdings DROP CONSTRAINT IF EXISTS uq_holding_identity"))
    bind.execute(text("DROP INDEX IF EXISTS uq_holding_identity"))
    bind.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_holding_identity "
            "ON holdings (household_id, asset_type, market_symbol, owner_user_id, account_name)"
        )
    )


def upgrade_schema(bind_engine: Engine | None = None) -> None:
    active_engine = bind_engine or engine
    dialect_name = str(active_engine.dialect.name).lower()
    json_type_name = _json_type_name(dialect_name)

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
        _add_column_if_missing(conn, "holdings", "owner_user_id", "owner_user_id VARCHAR(36)")
        _add_column_if_missing(conn, "holdings", "type_key", "type_key VARCHAR(80)")
        _add_column_if_missing(conn, "holdings", "display_order", "display_order INTEGER NOT NULL DEFAULT 100")
        _create_indexes(conn, dialect_name)

    with SessionLocal() as db:
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

        for household in households:
            backfill_owner_links_for_household(db, str(household.id))

        db.commit()


if __name__ == "__main__":
    upgrade_schema()
