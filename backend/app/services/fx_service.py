from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import FxRate


class FxService:
    async def get_rate(
        self,
        db: Session,
        *,
        base_currency: str,
        quote_currency: str,
    ) -> tuple[Decimal, str]:
        base = base_currency.upper()
        quote = quote_currency.upper()
        if base == quote:
            return Decimal("1"), "identity"

        snapshot = db.scalar(
            select(FxRate).where(FxRate.base_currency == base, FxRate.quote_currency == quote)
        )
        cached_rate = Decimal(snapshot.rate) if snapshot is not None else None
        cached_source = str(snapshot.source) if snapshot is not None else ""
        cached_fetched_at = self._as_utc(snapshot.fetched_at) if snapshot is not None else None
        stale_before = datetime.now(UTC) - timedelta(seconds=settings.fx_cache_seconds)
        if cached_rate is not None and cached_fetched_at is not None and cached_fetched_at >= stale_before:
            return cached_rate, cached_source

        # Release the read transaction before external network I/O.
        db.rollback()

        try:
            rate, source = await self._fetch_rate(base, quote)
        except Exception:
            if cached_rate is not None:
                return cached_rate, f"{cached_source}:stale"
            raise
        now = datetime.now(UTC)
        self._upsert_rate(
            db,
            base_currency=base,
            quote_currency=quote,
            rate=rate,
            source=source,
            fetched_at=now,
        )
        db.commit()
        return rate, source

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    def _upsert_rate(
        self,
        db: Session,
        *,
        base_currency: str,
        quote_currency: str,
        rate: Decimal,
        source: str,
        fetched_at: datetime,
    ) -> None:
        values = {
            "base_currency": base_currency,
            "quote_currency": quote_currency,
            "rate": rate,
            "source": source,
            "fetched_at": fetched_at,
        }
        dialect = (db.bind.dialect.name if db.bind is not None else "").lower()
        if dialect == "sqlite":
            stmt = sqlite_insert(FxRate).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=["base_currency", "quote_currency"],
                set_={
                    "rate": rate,
                    "source": source,
                    "fetched_at": fetched_at,
                },
            )
            db.execute(stmt)
            return
        if dialect == "postgresql":
            stmt = pg_insert(FxRate).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=[FxRate.base_currency, FxRate.quote_currency],
                set_={
                    "rate": rate,
                    "source": source,
                    "fetched_at": fetched_at,
                },
            )
            db.execute(stmt)
            return

        snapshot = db.scalar(
            select(FxRate).where(
                FxRate.base_currency == base_currency,
                FxRate.quote_currency == quote_currency,
            )
        )
        if snapshot is None:
            db.add(FxRate(**values))
            return
        snapshot.rate = rate
        snapshot.source = source
        snapshot.fetched_at = fetched_at

    async def _fetch_rate(self, base: str, quote: str) -> tuple[Decimal, str]:
        # Free source with broad coverage.
        url = f"https://open.er-api.com/v6/latest/{quote}"
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url)
            response.raise_for_status()
            payload: dict[str, Any] = response.json()

        rates = payload.get("rates")
        if not isinstance(rates, dict):
            raise ValueError("invalid fx response")
        target = rates.get(base)
        if target in (None, 0):
            raise ValueError(f"missing fx rate for {base}/{quote}")
        return Decimal(str(target)), "open.er-api"
