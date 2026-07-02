#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection


class CleanupError(RuntimeError):
    pass


def _fetch_user_ids(conn: Connection, email: str) -> list[str]:
    rows = conn.execute(
        text("select id from users where lower(email) = lower(:email)"),
        {"email": email},
    ).fetchall()
    return [str(row[0]) for row in rows]


def _orphan_household_ids(conn: Connection, user_ids: list[str]) -> list[str]:
    household_ids: list[str] = []
    for user_id in user_ids:
        rows = conn.execute(
            text(
                """
                select hm.household_id
                from household_members hm
                where hm.user_id = :user_id
                  and not exists (
                    select 1
                    from household_members other_hm
                    where other_hm.household_id = hm.household_id
                      and other_hm.user_id <> :user_id
                  )
                """
            ),
            {"user_id": user_id},
        ).fetchall()
        household_ids.extend(str(row[0]) for row in rows)
    return sorted(set(household_ids))


def _scalar_count(conn: Connection, sql: str, params: dict[str, Any]) -> int:
    return int(conn.execute(text(sql), params).scalar_one() or 0)


def collect_counts(conn: Connection, email: str) -> dict[str, int]:
    user_ids = _fetch_user_ids(conn, email)
    token_count = 0
    membership_count = 0
    for user_id in user_ids:
        token_count += _scalar_count(conn, "select count(*) from email_verification_tokens where user_id = :user_id", {"user_id": user_id})
        membership_count += _scalar_count(conn, "select count(*) from household_members where user_id = :user_id", {"user_id": user_id})
    orphan_households = _orphan_household_ids(conn, user_ids)
    return {
        "users": len(user_ids),
        "email_verification_tokens": token_count,
        "household_members": membership_count,
        "orphan_households": len(orphan_households),
        "register_throttle": _scalar_count(
            conn,
            "select count(*) from register_throttle where lower(key) like lower(:register_key) or lower(key) like lower(:resend_key)",
            {"register_key": f"{email}::%", "resend_key": f"resend::{email}::%"},
        ),
        "login_throttle": _scalar_count(
            conn,
            "select count(*) from login_throttle where lower(key) like lower(:login_key)",
            {"login_key": f"{email}::%"},
        ),
    }


def cleanup_exact_email(conn: Connection, email: str, *, execute: bool) -> dict[str, Any]:
    normalized_email = str(email or "").strip().lower()
    if not normalized_email or "@" not in normalized_email:
        raise CleanupError("--email must be an exact email address")
    if "%" in normalized_email or "_" in normalized_email:
        raise CleanupError("wildcard characters are not allowed in --email")

    before = collect_counts(conn, normalized_email)
    user_ids = _fetch_user_ids(conn, normalized_email)
    household_ids = _orphan_household_ids(conn, user_ids)

    if execute:
        conn.execute(
            text("delete from register_throttle where lower(key) like lower(:register_key) or lower(key) like lower(:resend_key)"),
            {"register_key": f"{normalized_email}::%", "resend_key": f"resend::{normalized_email}::%"},
        )
        conn.execute(
            text("delete from login_throttle where lower(key) like lower(:login_key)"),
            {"login_key": f"{normalized_email}::%"},
        )
        for user_id in user_ids:
            conn.execute(text("delete from users where id = :user_id"), {"user_id": user_id})
        for household_id in household_ids:
            conn.execute(text("delete from households where id = :household_id"), {"household_id": household_id})

    after = collect_counts(conn, normalized_email)
    return {
        "target_email": normalized_email,
        "wildcard_delete": False,
        "execute": bool(execute),
        "user_ids": user_ids,
        "orphan_household_ids": household_ids,
        "before_counts": before,
        "after_counts": after,
        "generated_at": datetime.now(UTC).isoformat(),
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clean exact prod email smoke artifacts by exact email only.")
    parser.add_argument("--email", required=True, help="exact smoke email to clean; wildcards are rejected")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""), help="database URL; defaults to DATABASE_URL")
    parser.add_argument("--execute", action="store_true", help="perform deletes; default is dry-run counts only")
    parser.add_argument("--output", default="", help="optional JSON ledger output path")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if not str(args.database_url or "").strip():
        raise SystemExit("DATABASE_URL or --database-url is required")
    engine = create_engine(str(args.database_url), future=True)
    with engine.begin() as conn:
        ledger = cleanup_exact_email(conn, str(args.email), execute=bool(args.execute))
    rendered = json.dumps(ledger, ensure_ascii=False, indent=2, sort_keys=True)
    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        Path(args.output).write_text(rendered + "\n", encoding="utf-8")
    print(rendered, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
