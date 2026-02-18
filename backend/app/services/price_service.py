from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from threading import Lock
from typing import Any, Callable

import httpx
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import AssetType, Holding, PriceRefreshStatus, PriceSnapshot
from app.db.session import SessionLocal


CRYPTO_SYMBOL_TO_ID = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "XRP": "ripple",
    "SOL": "solana",
    "DOGE": "dogecoin",
    "ADA": "cardano",
    "USDT": "tether",
    "USDC": "usd-coin",
}


@dataclass
class Quote:
    price: Decimal | None
    currency: str | None
    source: str
    fetched: bool


FetchedLiveQuote = tuple[Decimal | None, str | None, str]
LiveQuote = tuple[Decimal | None, str | None, str, bool]

_MIN_ORPHAN_TAKEOVER_GRACE_SECONDS = 10
_MAX_ORPHAN_TAKEOVER_GRACE_SECONDS = 30


@dataclass(frozen=True)
class HoldingRefreshInput:
    id: str
    asset_type: AssetType
    symbol: str
    market_symbol: str | None
    average_cost: Decimal
    currency: str


@dataclass(frozen=True)
class SnapshotRefreshInput:
    price: Decimal
    currency: str
    source: str
    fetched_at: datetime


HoldingLike = Holding | HoldingRefreshInput


class PriceService:
    def __init__(self) -> None:
        self._task_lock = Lock()
        self._refresh_tasks: dict[str, asyncio.Task[None]] = {}
        self._quote_flight_lock = Lock()
        self._quote_flights: dict[tuple[AssetType, str], asyncio.Future[LiveQuote]] = {}

    async def request_refresh(self, household_id: str) -> dict[str, Any]:
        now = datetime.now(UTC)
        response, lease_started_at, force_restart = await asyncio.to_thread(
            self._prepare_refresh_request,
            household_id,
            now,
        )
        should_start_local_task = force_restart or not bool(response.get("queued"))
        if should_start_local_task:
            self._ensure_refresh_task(
                household_id,
                lease_started_at=lease_started_at,
                force_restart=force_restart,
            )
        return response

    def _prepare_refresh_request(
        self,
        household_id: str,
        now: datetime,
    ) -> tuple[dict[str, Any], datetime, bool]:
        with SessionLocal() as db:
            state = self._get_or_create_refresh_state(db, household_id, lock=True)
            stale = self._is_refresh_stale(state, now)
            task_running = self._has_running_refresh_task(household_id)
            env_name = str(settings.env or "").strip().lower()
            local_single_worker_mode = env_name in {"dev", "test", "local"}
            if state.in_progress and not stale:
                # In multi-worker deployments, local task maps are process-local.
                # Fresh in-progress leases should be queued unless we are in a local single-worker mode.
                if task_running:
                    if not state.queued:
                        state.queued = True
                        db.commit()
                    return self._refresh_response(state, queued=True), self._as_utc(state.started_at or now), False
                if not local_single_worker_mode:
                    heartbeat_at = state.updated_at or state.started_at
                    heartbeat_age_seconds: float | None = None
                    if heartbeat_at is not None:
                        heartbeat_age_seconds = (now - self._as_utc(heartbeat_at)).total_seconds()
                    if (
                        heartbeat_age_seconds is None
                        or heartbeat_age_seconds < self._orphan_takeover_grace_seconds()
                    ):
                        if not state.queued:
                            state.queued = True
                            db.commit()
                        return self._refresh_response(state, queued=True), self._as_utc(state.started_at or now), False
            force_restart = bool(state.in_progress and stale and task_running)

            state.in_progress = True
            state.queued = False
            state.started_at = now
            state.target_count = 0
            state.completed_count = 0
            state.refreshed_count = 0
            state.last_error = None
            db.commit()
            response = self._refresh_response(state, queued=False)
            return response, self._as_utc(state.started_at or now), force_restart

    @staticmethod
    def _orphan_takeover_grace_seconds() -> int:
        stale_window_seconds = max(30, int(settings.price_refresh_stale_seconds))
        provider_window_seconds = max(1, int(float(settings.price_provider_timeout_seconds) * 2))
        adaptive_window = max(provider_window_seconds, stale_window_seconds // 8)
        return max(
            _MIN_ORPHAN_TAKEOVER_GRACE_SECONDS,
            min(_MAX_ORPHAN_TAKEOVER_GRACE_SECONDS, adaptive_window),
        )

    def _has_running_refresh_task(self, household_id: str) -> bool:
        with self._task_lock:
            current = self._refresh_tasks.get(household_id)
            if current is None:
                return False
            if current.done():
                self._refresh_tasks.pop(household_id, None)
                return False
            return True

    def _ensure_refresh_task(
        self,
        household_id: str,
        *,
        lease_started_at: datetime,
        force_restart: bool = False,
    ) -> None:
        with self._task_lock:
            current = self._refresh_tasks.get(household_id)
            if current is not None and current.done():
                self._refresh_tasks.pop(household_id, None)
                current = None
            if current is not None and force_restart:
                current.cancel()
                self._refresh_tasks.pop(household_id, None)
                current = None
            if current is not None:
                return
            self._start_refresh_task_locked(household_id, lease_started_at)

    def _start_refresh_task_locked(self, household_id: str, lease_started_at: datetime) -> None:
        task = asyncio.create_task(self._run_refresh_job(household_id, lease_started_at))
        self._refresh_tasks[household_id] = task
        task.add_done_callback(lambda done, hid=household_id: self._cleanup_refresh_task(hid, done))

    def _cleanup_refresh_task(self, household_id: str, task: asyncio.Task[None]) -> None:
        with self._task_lock:
            current = self._refresh_tasks.get(household_id)
            if current is task:
                self._refresh_tasks.pop(household_id, None)
        try:
            task.result()
        except asyncio.CancelledError:
            return
        except Exception:
            # Refresh errors are persisted in DB status.
            return

    async def _run_refresh_job(self, household_id: str, lease_started_at: datetime) -> None:
        started = datetime.now(UTC)
        refreshed_count = 0
        error_text: str | None = None
        lease_lost = False
        try:
            def _on_progress(done: int, total: int) -> None:
                updated = self._update_refresh_progress(
                    household_id,
                    done,
                    total,
                    lease_started_at=lease_started_at,
                )
                if not updated:
                    raise RuntimeError("PRICE_REFRESH_LEASE_LOST")

            with SessionLocal() as db:
                quotes = await self.refresh_household(
                    db,
                    household_id,
                    on_progress=_on_progress,
                )
            refreshed_count = len(quotes)
        except Exception as exc:  # noqa: BLE001
            if str(exc) == "PRICE_REFRESH_LEASE_LOST":
                lease_lost = True
            else:
                error_text = str(exc)
        if lease_lost:
            return

        finished = datetime.now(UTC)
        queued_next = False
        next_lease_started_at: datetime | None = None
        with SessionLocal() as db:
            state = self._get_or_create_refresh_state(db, household_id, lock=True)
            if not self._lease_matches(state, lease_started_at):
                return
            queued_next = bool(state.queued)
            base_started = state.started_at or started
            state.last_duration_ms = int((finished - self._as_utc(base_started)).total_seconds() * 1000)
            if state.completed_count < state.target_count:
                state.completed_count = state.target_count
            if queued_next:
                # Keep in-progress state while chaining the queued refresh.
                state.in_progress = True
                state.queued = False
                state.started_at = finished
                state.finished_at = None
                state.target_count = 0
                state.completed_count = 0
                state.refreshed_count = 0
                state.last_error = None
                next_lease_started_at = self._as_utc(state.started_at)
            else:
                state.in_progress = False
                state.queued = False
                state.finished_at = finished
                state.refreshed_count = refreshed_count
                state.last_error = error_text
            db.commit()

        if queued_next and next_lease_started_at is not None:
            with self._task_lock:
                self._start_refresh_task_locked(household_id, next_lease_started_at)

    def _update_refresh_progress(
        self,
        household_id: str,
        completed: int,
        target: int,
        *,
        lease_started_at: datetime,
    ) -> bool:
        with SessionLocal() as db:
            state = self._get_or_create_refresh_state(db, household_id, lock=True)
            if not self._lease_matches(state, lease_started_at):
                return False
            state.target_count = max(target, 0)
            state.completed_count = max(0, min(completed, max(target, completed)))
            db.commit()
            return True

    @staticmethod
    def _lease_matches(state: PriceRefreshStatus, lease_started_at: datetime) -> bool:
        if not state.in_progress or state.started_at is None:
            return False
        left = PriceService._as_utc(state.started_at)
        right = PriceService._as_utc(lease_started_at)
        return left == right

    async def refresh_household(
        self,
        db: Session,
        household_id: str,
        *,
        on_progress: Callable[[int, int], None] | None = None,
    ) -> dict[str, Quote]:
        db_holdings = db.scalars(select(Holding).where(Holding.household_id == household_id)).all()
        holdings = [self._to_refresh_input(item) for item in db_holdings]
        unique_by_symbol: dict[tuple[AssetType, str], HoldingRefreshInput] = {}
        for holding in holdings:
            key = self._holding_refresh_key(holding)
            if key not in unique_by_symbol:
                unique_by_symbol[key] = holding

        total_symbols = len(unique_by_symbol)
        completed = 0
        if on_progress is not None:
            on_progress(completed, total_symbols)

        raw_snapshot_map = self._snapshot_map(db, unique_by_symbol.keys())
        snapshot_map: dict[tuple[AssetType, str], SnapshotRefreshInput] = {
            key: SnapshotRefreshInput(
                price=Decimal(row.price),
                currency=row.currency,
                source=row.source,
                fetched_at=self._as_utc(row.fetched_at),
            )
            for key, row in raw_snapshot_map.items()
        }

        # End the read transaction before waiting on external quote providers.
        db.commit()

        live_results: dict[tuple[AssetType, str], LiveQuote] = {}
        network_tasks: list[asyncio.Task[tuple[tuple[AssetType, str], LiveQuote]]] = []
        semaphore = asyncio.Semaphore(max(1, settings.price_refresh_concurrency))
        stale_before = datetime.now(UTC) - timedelta(seconds=settings.price_cache_seconds)

        timeout = max(0.5, float(settings.price_provider_timeout_seconds))
        async with httpx.AsyncClient(timeout=timeout) as client:
            for key, holding in unique_by_symbol.items():
                if self._is_non_market_asset(holding.asset_type):
                    live_results[key] = (Decimal(holding.average_cost), holding.currency, "manual", False)
                    completed += 1
                    if on_progress is not None:
                        on_progress(completed, total_symbols)
                    continue

                snapshot = snapshot_map.get(key)
                if snapshot is not None and snapshot.fetched_at >= stale_before:
                    live_results[key] = (
                        snapshot.price,
                        snapshot.currency,
                        snapshot.source,
                        False,
                    )
                    completed += 1
                    if on_progress is not None:
                        on_progress(completed, total_symbols)
                    continue

                network_tasks.append(
                    asyncio.create_task(
                        self._fetch_live_result_task(
                            semaphore=semaphore,
                            client=client,
                            key=key,
                            holding=holding,
                        )
                    )
                )

            try:
                for task in asyncio.as_completed(network_tasks):
                    key, live_result = await task
                    live_results[key] = live_result
                    completed += 1
                    if on_progress is not None:
                        on_progress(completed, total_symbols)
            except asyncio.CancelledError:
                for network_task in network_tasks:
                    if not network_task.done():
                        network_task.cancel()
                if network_tasks:
                    await asyncio.gather(*network_tasks, return_exceptions=True)
                raise
            except Exception:
                for network_task in network_tasks:
                    if not network_task.done():
                        network_task.cancel()
                if network_tasks:
                    await asyncio.gather(*network_tasks, return_exceptions=True)
                raise

        now = datetime.now(UTC)
        quote_by_symbol: dict[tuple[AssetType, str], Quote] = {}
        for key, holding in unique_by_symbol.items():
            snapshot = snapshot_map.get(key)
            price, currency, source, fetched_live = live_results.get(
                key,
                (None, holding.currency, "unavailable", False),
            )

            if price is None:
                if snapshot is not None:
                    quote_by_symbol[key] = Quote(
                        price=snapshot.price,
                        currency=snapshot.currency,
                        source=f"{snapshot.source}:stale",
                        fetched=False,
                    )
                else:
                    quote_by_symbol[key] = Quote(
                        price=None,
                        currency=holding.currency,
                        source="unavailable",
                        fetched=fetched_live,
                    )
                continue

            normalized_currency = (currency or holding.currency or "KRW").upper()
            if fetched_live and not self._is_non_market_asset(holding.asset_type):
                self._upsert_snapshot(
                    db,
                    asset_type=holding.asset_type,
                    symbol=key[1],
                    currency=normalized_currency,
                    price=price,
                    source=source,
                    fetched_at=now,
                )

            quote_by_symbol[key] = Quote(
                price=price,
                currency=normalized_currency,
                source=source,
                fetched=fetched_live,
            )

        result: dict[str, Quote] = {}
        for holding in holdings:
            key = self._holding_refresh_key(holding)
            quote = quote_by_symbol.get(key)
            if quote is None:
                quote = Quote(price=None, currency=holding.currency, source="unavailable", fetched=False)
            result[holding.id] = quote

        db.commit()
        if on_progress is not None:
            on_progress(total_symbols, total_symbols)
        return result

    async def _fetch_live_result_task(
        self,
        *,
        semaphore: asyncio.Semaphore,
        client: httpx.AsyncClient,
        key: tuple[AssetType, str],
        holding: HoldingLike,
    ) -> tuple[tuple[AssetType, str], LiveQuote]:
        async with semaphore:
            try:
                return key, await self._fetch_live_quote_singleflight(client, key, holding)
            except Exception:  # noqa: BLE001
                return key, (None, holding.currency, "unavailable", True)

    @staticmethod
    def _to_refresh_input(holding: Holding) -> HoldingRefreshInput:
        return HoldingRefreshInput(
            id=str(holding.id),
            asset_type=holding.asset_type,
            symbol=holding.symbol,
            market_symbol=holding.market_symbol,
            average_cost=Decimal(holding.average_cost),
            currency=holding.currency,
        )

    async def _fetch_live_quote_singleflight(
        self,
        client: httpx.AsyncClient,
        key: tuple[AssetType, str],
        holding: HoldingLike,
    ) -> LiveQuote:
        owner = False
        with self._quote_flight_lock:
            current = self._quote_flights.get(key)
            if current is None:
                current = asyncio.get_running_loop().create_future()
                self._quote_flights[key] = current
                owner = True
            shared_future = current

        if not owner:
            return await shared_future

        try:
            price, currency, source = await self._fetch_live_quote(client, holding)
            result: LiveQuote = (price, currency, source, True)
            shared_future.set_result(result)
            return result
        except BaseException as exc:  # noqa: BLE001
            if not shared_future.done():
                shared_future.set_exception(exc)
                shared_future.add_done_callback(self._consume_future_exception)
            raise
        finally:
            with self._quote_flight_lock:
                current = self._quote_flights.get(key)
                if current is shared_future:
                    self._quote_flights.pop(key, None)

    @staticmethod
    def _consume_future_exception(future: asyncio.Future[LiveQuote]) -> None:
        # If no waiter is attached, proactively consume the exception to avoid
        # "Future exception was never retrieved" warnings in provider outage bursts.
        try:
            _ = future.exception()
        except BaseException:
            pass

    async def quote_holding(
        self,
        db: Session,
        holding: Holding,
        *,
        force_refresh: bool = False,
        client: httpx.AsyncClient | None = None,
    ) -> Quote:
        if self._is_non_market_asset(holding.asset_type):
            return Quote(
                price=Decimal(holding.average_cost),
                currency=holding.currency,
                source="manual",
                fetched=False,
            )

        symbol = self._symbol(holding)
        snapshot = db.scalar(
            select(PriceSnapshot).where(
                PriceSnapshot.asset_type == holding.asset_type,
                PriceSnapshot.symbol == symbol,
            )
        )

        stale_before = datetime.now(UTC) - timedelta(seconds=settings.price_cache_seconds)
        if not force_refresh:
            if snapshot is None:
                return Quote(price=None, currency=holding.currency, source="unavailable", fetched=False)
            snapshot_source = snapshot.source
            if self._as_utc(snapshot.fetched_at) < stale_before:
                snapshot_source = f"{snapshot_source}:stale"
            return Quote(
                price=Decimal(snapshot.price),
                currency=snapshot.currency,
                source=snapshot_source,
                fetched=False,
            )

        if client is None:
            timeout = max(0.5, float(settings.price_provider_timeout_seconds))
            async with httpx.AsyncClient(timeout=timeout) as one_client:
                price, currency, source = await self._fetch_live_quote(one_client, holding)
        else:
            price, currency, source = await self._fetch_live_quote(client, holding)

        if price is None:
            if snapshot is not None:
                return Quote(
                    price=Decimal(snapshot.price),
                    currency=snapshot.currency,
                    source=f"{snapshot.source}:stale",
                    fetched=False,
                )
            return Quote(price=None, currency=holding.currency, source="unavailable", fetched=True)

        normalized_currency = (currency or holding.currency or "KRW").upper()
        now = datetime.now(UTC)
        self._upsert_snapshot(
            db,
            asset_type=holding.asset_type,
            symbol=symbol,
            currency=normalized_currency,
            price=price,
            source=source,
            fetched_at=now,
        )
        return Quote(price=price, currency=normalized_currency, source=source, fetched=True)

    def status(self, db: Session, household_id: str) -> dict[str, Any]:
        holdings = db.scalars(select(Holding).where(Holding.household_id == household_id)).all()
        holding_keys = {
            (item.asset_type, self._symbol(item))
            for item in holdings
            if not self._is_non_market_asset(item.asset_type)
        }
        snapshots = []
        if holding_keys:
            asset_types = {asset_type for asset_type, _ in holding_keys}
            symbols = {symbol for _, symbol in holding_keys}
            candidates = db.scalars(
                select(PriceSnapshot).where(
                    PriceSnapshot.asset_type.in_(asset_types),
                    PriceSnapshot.symbol.in_(symbols),
                )
            ).all()
            snapshots = [snap for snap in candidates if (snap.asset_type, str(snap.symbol).upper()) in holding_keys]

        stale_before = datetime.now(UTC) - timedelta(seconds=settings.price_cache_seconds)
        stale_count = sum(1 for snap in snapshots if self._as_utc(snap.fetched_at) < stale_before)
        latest = max((self._as_utc(snap.fetched_at) for snap in snapshots), default=None)

        state = db.get(PriceRefreshStatus, household_id)
        return {
            "holdings_count": len(holdings),
            "tracked_holdings_count": len(holding_keys),
            "snapshot_count": len(snapshots),
            "stale_count": stale_count,
            "updated_at": latest,
            "refresh_in_progress": bool(state.in_progress) if state else False,
            "refresh_queued": bool(state.queued) if state else False,
            "refresh_started_at": state.started_at if state else None,
            "refresh_finished_at": state.finished_at if state else None,
            "refresh_target_count": int(state.target_count) if state else 0,
            "refresh_completed_count": int(state.completed_count) if state else 0,
            "refresh_refreshed_count": int(state.refreshed_count) if state else 0,
            "refresh_last_duration_ms": state.last_duration_ms if state else None,
            "refresh_last_error": "PRICE_REFRESH_FAILED" if (state and state.last_error) else None,
        }

    async def _fetch_live_quote(self, client: httpx.AsyncClient, holding: HoldingLike) -> FetchedLiveQuote:
        if holding.asset_type == AssetType.stock:
            price, source, currency = await self._fetch_stock(client, holding)
            return price, currency, source
        if holding.asset_type == AssetType.crypto:
            price, source, currency = await self._fetch_crypto(client, holding)
            return price, currency, source
        if holding.asset_type in {AssetType.cash, AssetType.real_estate, AssetType.pension, AssetType.other}:
            return Decimal(holding.average_cost), holding.currency, "manual"
        return None, holding.currency, "unavailable"

    async def _fetch_crypto(self, client: httpx.AsyncClient, holding: HoldingLike) -> tuple[Decimal | None, str, str]:
        symbol = self._symbol(holding)
        coin_id = CRYPTO_SYMBOL_TO_ID.get(symbol, symbol.lower())
        url = "https://api.coingecko.com/api/v3/simple/price"
        params = {"ids": coin_id, "vs_currencies": "krw,usd"}
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload: dict[str, Any] = response.json()
            node = payload.get(coin_id, {})
            if "krw" in node:
                return Decimal(str(node["krw"])), "coingecko", "KRW"
            if "usd" in node:
                return Decimal(str(node["usd"])), "coingecko", "USD"
        except Exception:  # noqa: BLE001
            return None, "coingecko", holding.currency
        return None, "coingecko", holding.currency

    async def _fetch_stock(self, client: httpx.AsyncClient, holding: HoldingLike) -> tuple[Decimal | None, str, str]:
        if self._is_krx_symbol(holding):
            naver_price = await self._fetch_stock_naver(client, holding)
            if naver_price is not None:
                return naver_price, "naver", "KRW"

        yahoo_price, yahoo_currency = await self._fetch_stock_yahoo(client, holding)
        if yahoo_price is not None and yahoo_currency:
            return yahoo_price, "yahoo", yahoo_currency

        for candidate in self._stock_symbol_candidates(holding):
            try:
                url = f"https://stooq.com/q/l/?s={candidate}&f=sd2t2ohlcv&h&e=csv"
                response = await client.get(url)
                if response.status_code == 200:
                    parsed = self._parse_stooq(response.text)
                    if parsed is not None:
                        currency = "KRW" if candidate.endswith(".kr") else "USD"
                        return parsed, "stooq", currency
            except Exception:  # noqa: BLE001
                continue
        return None, "unavailable", holding.currency

    @staticmethod
    def _parse_stooq(raw_csv: str) -> Decimal | None:
        lines = [line.strip() for line in raw_csv.splitlines() if line.strip()]
        if len(lines) < 2:
            return None
        cols = [part.strip() for part in lines[1].split(",")]
        if len(cols) < 7:
            return None
        close = cols[6]
        if close in {"N/D", ""}:
            return None
        return Decimal(str(close))

    @staticmethod
    def _symbol(holding: HoldingLike) -> str:
        return (holding.market_symbol or holding.symbol).strip().upper()

    def _holding_refresh_key(self, holding: HoldingLike) -> tuple[AssetType, str]:
        symbol = self._symbol(holding)
        if self._is_non_market_asset(holding.asset_type):
            return (holding.asset_type, f"{symbol}::{holding.id}")
        return (holding.asset_type, symbol)

    @staticmethod
    def _is_non_market_asset(asset_type: AssetType) -> bool:
        return asset_type in {AssetType.cash, AssetType.real_estate, AssetType.pension, AssetType.other}

    def _stock_symbol_candidates(self, holding: HoldingLike) -> list[str]:
        base = self._symbol(holding).lower()
        values: list[str] = [base]
        code = base.split(".")[0]
        if "." not in base and self._is_krx_symbol(holding):
            values.append(f"{code}.kr")
        if "." not in base and not self._is_krx_symbol(holding):
            values.append(f"{code}.us")
        if "." in base:
            values.append(code)
        dedup: list[str] = []
        seen: set[str] = set()
        for item in values:
            if item in seen:
                continue
            seen.add(item)
            dedup.append(item)
        return dedup

    async def _fetch_stock_naver(self, client: httpx.AsyncClient, holding: HoldingLike) -> Decimal | None:
        base = self._symbol(holding).split(".")[0]
        try:
            response = await client.get(
                "https://polling.finance.naver.com/api/realtime",
                params={"query": f"SERVICE_ITEM:{base}"},
            )
            if response.status_code != 200:
                return None
            try:
                payload = response.json()
            except Exception:
                raw = response.content
                decoded = raw.decode("cp949")
                payload = json.loads(decoded)
            datas = payload.get("result", {}).get("areas", [{}])[0].get("datas", [])
            if not datas:
                return None
            value = datas[0].get("nv")
            if value in (None, "", "-"):
                return None
            return Decimal(str(value))
        except Exception:  # noqa: BLE001
            return None

    async def _fetch_stock_yahoo(self, client: httpx.AsyncClient, holding: HoldingLike) -> tuple[Decimal | None, str | None]:
        symbol = self._yahoo_symbol(holding)
        if not symbol:
            return None, None
        try:
            response = await client.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
                params={"interval": "1d", "range": "1d"},
                headers={"User-Agent": "Mozilla/5.0"},
            )
            if response.status_code != 200:
                return None, None
            payload = response.json()
            result = payload.get("chart", {}).get("result") or []
            if not result:
                return None, None
            node = result[0]
            meta = node.get("meta", {}) or {}
            currency = meta.get("currency")
            raw_price = meta.get("regularMarketPrice")
            if raw_price in (None, "", "-"):
                closes = (((node.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [])
                for value in reversed(closes):
                    if value not in (None, "", "-"):
                        raw_price = value
                        break
            if raw_price in (None, "", "-"):
                return None, None
            return Decimal(str(raw_price)), str(currency or "").upper() or None
        except Exception:  # noqa: BLE001
            return None, None

    @staticmethod
    def _yahoo_symbol(holding: HoldingLike) -> str:
        symbol = PriceService._symbol(holding)
        if symbol.endswith(".KR"):
            return symbol[:-3]
        return symbol

    def _is_krx_symbol(self, holding: HoldingLike) -> bool:
        symbol = self._symbol(holding)
        if symbol.endswith(".KR"):
            return True
        base = symbol.split(".")[0]
        return len(base) == 6 and base.isdigit()

    def _snapshot_map(
        self,
        db: Session,
        keys: Any,
    ) -> dict[tuple[AssetType, str], PriceSnapshot]:
        key_list = list(keys)
        if not key_list:
            return {}
        symbols = {symbol for _, symbol in key_list}
        asset_types = {asset_type for asset_type, _ in key_list}
        rows = db.scalars(
            select(PriceSnapshot).where(
                PriceSnapshot.symbol.in_(symbols),
                PriceSnapshot.asset_type.in_(asset_types),
            )
        ).all()
        result: dict[tuple[AssetType, str], PriceSnapshot] = {}
        for row in rows:
            result[(row.asset_type, str(row.symbol).upper())] = row
        return result

    def _upsert_snapshot(
        self,
        db: Session,
        *,
        asset_type: AssetType,
        symbol: str,
        currency: str,
        price: Decimal,
        source: str,
        fetched_at: datetime,
    ) -> None:
        values = {
            "asset_type": asset_type,
            "symbol": symbol,
            "currency": currency,
            "price": price,
            "source": source,
            "fetched_at": fetched_at,
        }
        dialect = (db.bind.dialect.name if db.bind is not None else "").lower()
        if dialect == "sqlite":
            stmt = sqlite_insert(PriceSnapshot).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=["asset_type", "symbol"],
                set_={
                    "currency": currency,
                    "price": price,
                    "source": source,
                    "fetched_at": fetched_at,
                },
            )
            db.execute(stmt)
            return
        if dialect == "postgresql":
            stmt = pg_insert(PriceSnapshot).values(**values)
            stmt = stmt.on_conflict_do_update(
                index_elements=[PriceSnapshot.asset_type, PriceSnapshot.symbol],
                set_={
                    "currency": currency,
                    "price": price,
                    "source": source,
                    "fetched_at": fetched_at,
                },
            )
            db.execute(stmt)
            return

        snapshot = db.scalar(
            select(PriceSnapshot).where(
                PriceSnapshot.asset_type == asset_type,
                PriceSnapshot.symbol == symbol,
            )
        )
        if snapshot is None:
            db.add(PriceSnapshot(**values))
            return
        snapshot.currency = currency
        snapshot.price = price
        snapshot.source = source
        snapshot.fetched_at = fetched_at

    def _get_or_create_refresh_state(
        self,
        db: Session,
        household_id: str,
        *,
        lock: bool = False,
    ) -> PriceRefreshStatus:
        query = select(PriceRefreshStatus).where(PriceRefreshStatus.household_id == household_id)
        if lock:
            query = query.with_for_update()
        state = db.scalar(query)
        if state is not None:
            return state
        state = PriceRefreshStatus(
            household_id=household_id,
            in_progress=False,
            queued=False,
            target_count=0,
            completed_count=0,
            refreshed_count=0,
        )
        try:
            with db.begin_nested():
                db.add(state)
                db.flush()
            return state
        except IntegrityError:
            state = db.scalar(query)
            if state is not None:
                return state
            raise

    def _is_refresh_stale(self, state: PriceRefreshStatus, now: datetime) -> bool:
        if not state.in_progress:
            return False
        heartbeat_at = state.updated_at or state.started_at
        if heartbeat_at is None:
            return True
        stale_before = now - timedelta(seconds=max(30, settings.price_refresh_stale_seconds))
        return self._as_utc(heartbeat_at) < stale_before

    @staticmethod
    def _refresh_response(state: PriceRefreshStatus, *, queued: bool) -> dict[str, Any]:
        return {
            "accepted": True,
            "queued": queued,
            "in_progress": bool(state.in_progress),
            "started_at": state.started_at,
            "target_count": int(state.target_count),
            "completed_count": int(state.completed_count),
        }

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
