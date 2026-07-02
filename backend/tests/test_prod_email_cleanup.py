from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "prod_email_cleanup.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("prod_email_cleanup", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


cleanup = _load_module()


def _seed_connection():
    engine = create_engine("sqlite+pysqlite:///:memory:", future=True)
    conn = engine.connect()
    conn.execute(text("pragma foreign_keys=on"))
    conn.execute(text("create table users (id text primary key, email text not null)"))
    conn.execute(text("create table households (id text primary key)"))
    conn.execute(
        text(
            "create table email_verification_tokens ("
            "id text primary key, user_id text not null references users(id) on delete cascade)"
        )
    )
    conn.execute(
        text(
            "create table household_members ("
            "household_id text not null references households(id) on delete cascade, "
            "user_id text not null references users(id) on delete cascade)"
        )
    )
    conn.execute(text("create table register_throttle (key text primary key)"))
    conn.execute(text("create table login_throttle (key text primary key)"))
    conn.execute(text("insert into users (id, email) values ('user-1', 'Smoke+ABC@example.com')"))
    conn.execute(text("insert into households (id) values ('household-1')"))
    conn.execute(text("insert into household_members (household_id, user_id) values ('household-1', 'user-1')"))
    conn.execute(text("insert into email_verification_tokens (id, user_id) values ('token-1', 'user-1')"))
    conn.execute(text("insert into register_throttle (key) values ('smoke+abc@example.com::signup')"))
    conn.execute(text("insert into register_throttle (key) values ('resend::smoke+abc@example.com::code')"))
    conn.execute(text("insert into login_throttle (key) values ('smoke+abc@example.com::login')"))
    conn.commit()
    return conn


def test_cleanup_exact_email_dry_run_reports_counts_without_deleting() -> None:
    conn = _seed_connection()
    try:
        ledger = cleanup.cleanup_exact_email(conn, "smoke+abc@example.com", execute=False)

        assert ledger["execute"] is False
        assert ledger["wildcard_delete"] is False
        assert ledger["before_counts"]["users"] == 1
        assert ledger["before_counts"]["email_verification_tokens"] == 1
        assert ledger["before_counts"]["register_throttle"] == 2
        assert ledger["after_counts"] == ledger["before_counts"]
    finally:
        conn.close()


def test_cleanup_exact_email_execute_removes_only_exact_smoke_artifacts() -> None:
    conn = _seed_connection()
    try:
        ledger = cleanup.cleanup_exact_email(conn, "smoke+abc@example.com", execute=True)
        conn.commit()

        assert ledger["execute"] is True
        assert ledger["after_counts"] == {
            "users": 0,
            "email_verification_tokens": 0,
            "household_members": 0,
            "orphan_households": 0,
            "register_throttle": 0,
            "login_throttle": 0,
        }
        assert conn.execute(text("select count(*) from users")).scalar_one() == 0
        assert conn.execute(text("select count(*) from households")).scalar_one() == 0
    finally:
        conn.close()


@pytest.mark.parametrize("email", ["smoke%@example.com", "smoke_abc@example.com", "not-an-email"])
def test_cleanup_rejects_wildcards_and_non_email_targets(email: str) -> None:
    conn = _seed_connection()
    try:
        with pytest.raises(cleanup.CleanupError):
            cleanup.cleanup_exact_email(conn, email, execute=True)
    finally:
        conn.close()
