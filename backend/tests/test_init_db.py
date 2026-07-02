from __future__ import annotations

import os
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-init-db-tests-1234567890")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_init_db_bootstrap.db")

import app.db.init_db as init_db


def _reset_bootstrap_cache() -> set[str]:
    previous = set(init_db._SCHEMA_BOOTSTRAPPED_URLS)
    init_db._SCHEMA_BOOTSTRAPPED_URLS.clear()
    return previous


def _restore_bootstrap_cache(previous: set[str]) -> None:
    init_db._SCHEMA_BOOTSTRAPPED_URLS.clear()
    init_db._SCHEMA_BOOTSTRAPPED_URLS.update(previous)


def test_create_schema_repairs_before_and_after_create(monkeypatch) -> None:
    calls: list[str] = []
    fake_engine = SimpleNamespace(
        url="sqlite:///./init-db-order.db",
        dialect=SimpleNamespace(name="sqlite"),
    )
    monkeypatch.setattr(init_db, "engine", fake_engine)
    monkeypatch.setattr(init_db, "_repair_legacy_sqlite_schema", lambda: calls.append("repair"))
    monkeypatch.setattr(init_db.Base.metadata, "create_all", lambda **_: calls.append("create_all"))
    previous = _reset_bootstrap_cache()
    try:
        init_db.create_schema()
    finally:
        _restore_bootstrap_cache(previous)
    assert calls == ["repair", "create_all", "repair"]


def test_create_schema_uses_cache_for_same_url(monkeypatch) -> None:
    calls: list[str] = []
    fake_engine = SimpleNamespace(
        url="sqlite:///./init-db-retry.db",
        dialect=SimpleNamespace(name="sqlite"),
    )
    monkeypatch.setattr(init_db, "engine", fake_engine)
    monkeypatch.setattr(init_db, "_repair_legacy_sqlite_schema", lambda: calls.append("repair"))
    monkeypatch.setattr(init_db.Base.metadata, "create_all", lambda **_: calls.append("create_all"))
    previous = _reset_bootstrap_cache()
    try:
        init_db.create_schema()
        init_db.create_schema()
    finally:
        _restore_bootstrap_cache(previous)
    assert calls == ["repair", "create_all", "repair"]


def test_create_schema_recreates_when_cached_sqlite_schema_is_missing(monkeypatch) -> None:
    calls: list[str] = []
    fake_engine = SimpleNamespace(
        url="sqlite:///./init-db-missing-after-cache.db",
        dialect=SimpleNamespace(name="sqlite"),
    )
    monkeypatch.setattr(init_db, "engine", fake_engine)
    monkeypatch.setattr(init_db, "_is_schema_bootstrap_cache_valid", lambda: False, raising=False)
    monkeypatch.setattr(init_db, "_repair_legacy_sqlite_schema", lambda: calls.append("repair"))
    monkeypatch.setattr(init_db.Base.metadata, "create_all", lambda **_: calls.append("create_all"))
    previous = _reset_bootstrap_cache()
    try:
        init_db._SCHEMA_BOOTSTRAPPED_URLS.add(str(fake_engine.url))
        init_db.create_schema()
    finally:
        _restore_bootstrap_cache(previous)
    assert calls == ["repair", "create_all", "repair"]
