from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import ROUND_DOWN, Decimal
from collections import defaultdict
from collections.abc import Iterator

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from app.core.errors import app_error
from app.db.models import FlowType, Holding, Household, Transaction, User
from app.schemas import (
    OverviewResponse,
    PortfolioCategorySlice,
    PortfolioItem,
    PortfolioResponse,
    TrendPoint,
)
from app.services.fx_service import FxService
from app.services.price_service import PriceService


class DashboardService:
    def __init__(self, price_service: PriceService, fx_service: FxService) -> None:
        self.price_service = price_service
        self.fx_service = fx_service

    def _month_bounds(self, db: Session, household_id: str, *, fallback_date: date) -> tuple[str, str]:
        fallback_year = fallback_date.year
        fallback_month = fallback_date.month - 23
        while fallback_month <= 0:
            fallback_month += 12
            fallback_year -= 1
        default_minimum = date(fallback_year, fallback_month, 1)
        first_tx = db.scalar(
            select(Transaction.occurred_on)
            .where(Transaction.household_id == household_id)
            .order_by(Transaction.occurred_on.asc())
            .limit(1)
        )
        minimum = first_tx or default_minimum
        maximum = fallback_date
        # Scheduled installment payments extend into future months, so the navigable
        # range must reach the final billing month of the longest-running installment.
        installment_tails = db.execute(
            select(Transaction.occurred_on, Transaction.installment_months).where(
                Transaction.household_id == household_id,
                Transaction.flow_type == FlowType.expense,
                Transaction.installment_months.is_not(None),
            )
        ).all()
        for occurred_on, months in installment_tails:
            tail_year, tail_month = self._shift_month(occurred_on.year, occurred_on.month, int(months) - 1)
            tail_date = date(tail_year, tail_month, 1)
            if tail_date > maximum:
                maximum = tail_date
        if minimum > maximum:
            minimum = maximum
        return minimum.strftime("%Y-%m"), maximum.strftime("%Y-%m")

    def overview_month(
        self,
        db: Session,
        household_id: str,
        *,
        year: int,
        month: int,
    ) -> OverviewResponse:
        today = datetime.now(UTC).date()
        min_month, max_month = self._month_bounds(db, household_id, fallback_date=today)
        year_start = date(year, 1, 1)
        year_end = date(year + 1, 1, 1)
        month_start = date(year, month, 1)
        month_end = date(year + (1 if month == 12 else 0), 1 if month == 12 else month + 1, 1)
        totals = self._empty_totals()
        trend_bucket = {f"{year:04d}-{idx:02d}": self._empty_totals() for idx in range(1, 13)}
        month_totals = db.execute(
            select(
                Transaction.flow_type,
                func.sum(Transaction.amount).label("total_amount"),
            ).where(
                Transaction.household_id == household_id,
                Transaction.occurred_on >= month_start,
                Transaction.occurred_on < month_end,
                Transaction.installment_months.is_(None),
            )
            .group_by(Transaction.flow_type)
        ).all()
        for flow_type, total_amount in month_totals:
            totals[flow_type.value] += Decimal(total_amount or 0)

        month_index = cast(func.extract("month", Transaction.occurred_on), Integer)
        trend_rows = db.execute(
            select(
                month_index.label("month_index"),
                Transaction.flow_type,
                func.sum(Transaction.amount).label("total_amount"),
            ).where(
                Transaction.household_id == household_id,
                Transaction.occurred_on >= year_start,
                Transaction.occurred_on < year_end,
                Transaction.installment_months.is_(None),
            )
            .group_by(month_index, Transaction.flow_type)
        ).all()
        for row in trend_rows:
            month_num = int(row.month_index or 0)
            if month_num < 1 or month_num > 12:
                continue
            key = f"{year:04d}-{month_num:02d}"
            trend_bucket[key][row.flow_type.value] += Decimal(row.total_amount or 0)

        # Installment expenses are billed across N months starting from the purchase
        # month, so spread each slice into its billing month rather than the purchase month.
        installment_rows = db.execute(
            select(
                Transaction.occurred_on,
                Transaction.amount,
                Transaction.installment_months,
            ).where(
                Transaction.household_id == household_id,
                Transaction.flow_type == FlowType.expense,
                Transaction.installment_months.is_not(None),
                Transaction.occurred_on >= self._installment_lookback(year, 1),
                Transaction.occurred_on < year_end,
            )
        ).all()
        installment_expense = Decimal("0")
        for occurred_on, amount, months in installment_rows:
            for slice_year, slice_month, slice_amount in self._installment_month_amounts(
                occurred_on, Decimal(amount), int(months)
            ):
                if slice_year != year:
                    continue
                trend_bucket[f"{year:04d}-{slice_month:02d}"][FlowType.expense.value] += slice_amount
                if slice_month == month:
                    totals[FlowType.expense.value] += slice_amount
                    installment_expense += slice_amount

        trend = [self._to_trend_point(key, trend_bucket[key]) for key in sorted(trend_bucket.keys())]
        return OverviewResponse(
            household_id=household_id,
            filter_mode="month",
            year=year,
            month=month,
            start_date=None,
            end_date=None,
            min_available_month=min_month,
            max_available_month=max_month,
            totals=self._with_net(totals, installment_expense),
            trend=trend,
        )

    def overview_range(
        self,
        db: Session,
        household_id: str,
        *,
        start_date: date,
        end_date: date,
    ) -> OverviewResponse:
        today = datetime.now(UTC).date()
        min_month, max_month = self._month_bounds(db, household_id, fallback_date=today)
        totals = self._empty_totals()
        grouped_totals = db.execute(
            select(
                Transaction.flow_type,
                func.sum(Transaction.amount).label("total_amount"),
            ).where(
                Transaction.household_id == household_id,
                Transaction.occurred_on >= start_date,
                Transaction.occurred_on <= end_date,
                Transaction.installment_months.is_(None),
            )
            .group_by(Transaction.flow_type)
        ).all()
        for flow_type, total_amount in grouped_totals:
            totals[flow_type.value] += Decimal(total_amount or 0)

        trend_bucket: dict[str, dict[str, Decimal]] = defaultdict(self._empty_totals)
        year_index = cast(func.extract("year", Transaction.occurred_on), Integer)
        month_index = cast(func.extract("month", Transaction.occurred_on), Integer)
        grouped_trend_rows = db.execute(
            select(
                year_index.label("year_index"),
                month_index.label("month_index"),
                Transaction.flow_type,
                func.sum(Transaction.amount).label("total_amount"),
            ).where(
                Transaction.household_id == household_id,
                Transaction.occurred_on >= start_date,
                Transaction.occurred_on <= end_date,
                Transaction.installment_months.is_(None),
            )
            .group_by(year_index, month_index, Transaction.flow_type)
        ).all()
        for row in grouped_trend_rows:
            year_num = int(row.year_index or 0)
            month_num = int(row.month_index or 0)
            if year_num <= 0 or month_num < 1 or month_num > 12:
                continue
            key = f"{year_num:04d}-{month_num:02d}"
            trend_bucket[key][row.flow_type.value] += Decimal(row.total_amount or 0)

        # Spread installment expenses into their billing months, counting only the
        # slices whose month falls within the requested range (month granularity).
        installment_rows = db.execute(
            select(
                Transaction.occurred_on,
                Transaction.amount,
                Transaction.installment_months,
            ).where(
                Transaction.household_id == household_id,
                Transaction.flow_type == FlowType.expense,
                Transaction.installment_months.is_not(None),
                Transaction.occurred_on >= self._installment_lookback(start_date.year, start_date.month),
                Transaction.occurred_on <= end_date,
            )
        ).all()
        start_bucket = start_date.year * 12 + (start_date.month - 1)
        end_bucket = end_date.year * 12 + (end_date.month - 1)
        installment_expense = Decimal("0")
        for occurred_on, amount, months in installment_rows:
            for slice_year, slice_month, slice_amount in self._installment_month_amounts(
                occurred_on, Decimal(amount), int(months)
            ):
                slice_bucket = slice_year * 12 + (slice_month - 1)
                if slice_bucket < start_bucket or slice_bucket > end_bucket:
                    continue
                key = f"{slice_year:04d}-{slice_month:02d}"
                totals[FlowType.expense.value] += slice_amount
                trend_bucket[key][FlowType.expense.value] += slice_amount
                installment_expense += slice_amount
        trend = [self._to_trend_point(key, trend_bucket[key]) for key in sorted(trend_bucket.keys())]
        return OverviewResponse(
            household_id=household_id,
            filter_mode="range",
            year=None,
            month=None,
            start_date=start_date,
            end_date=end_date,
            min_available_month=min_month,
            max_available_month=max_month,
            totals=self._with_net(totals, installment_expense),
            trend=trend,
        )

    async def portfolio(
        self,
        db: Session,
        household: Household,
    ) -> PortfolioResponse:
        holding_rows = db.execute(
            select(Holding, User.display_name)
            .outerjoin(User, User.id == Holding.owner_user_id)
            .where(Holding.household_id == household.id)
        ).all()
        items: list[PortfolioItem] = []
        total_market = Decimal("0")
        total_invested = Decimal("0")
        category_bucket: dict[str, dict[str, Decimal]] = {}

        for holding, linked_owner_name in holding_rows:
            quote = await self.price_service.quote_holding(db, holding, force_refresh=False)
            latest_price = Decimal(quote.price) if quote.price is not None else None
            quantity = Decimal(holding.quantity)
            invested_native = quantity * Decimal(holding.average_cost)
            if latest_price is None:
                # Keep portfolio totals stable when a quote is temporarily unavailable.
                market_native = invested_native
                price_currency = holding.currency
            else:
                market_native = quantity * latest_price
                price_currency = quote.currency or holding.currency

            invested_krw = await self._to_krw(db, invested_native, holding.currency)
            market_krw = await self._to_krw(db, market_native, price_currency)
            gain_loss = market_krw - invested_krw

            total_market += market_krw
            total_invested += invested_krw

            cat = holding.category
            bucket = category_bucket.setdefault(
                cat,
                {
                    "market_value_krw": Decimal("0"),
                    "invested_krw": Decimal("0"),
                    "gain_loss_krw": Decimal("0"),
                },
            )
            bucket["market_value_krw"] += market_krw
            bucket["invested_krw"] += invested_krw
            bucket["gain_loss_krw"] += gain_loss

            items.append(
                PortfolioItem(
                    holding_id=holding.id,
                    asset_type=holding.asset_type,
                    type_key=str(holding.type_key).strip() if str(holding.type_key or "").strip() else None,
                    symbol=holding.symbol,
                    market_symbol=holding.market_symbol,
                    name=holding.name,
                    category=holding.category,
                    owner_name=str(linked_owner_name or holding.owner_name or "").strip() or None,
                    account_name=holding.account_name,
                    quantity=Decimal(holding.quantity),
                    average_cost=Decimal(holding.average_cost),
                    currency=holding.currency,
                    display_order=int(holding.display_order),
                    latest_price=latest_price,
                    latest_price_currency=price_currency,
                    market_value_krw=market_krw,
                    invested_krw=invested_krw,
                    gain_loss_krw=gain_loss,
                    source=quote.source,
                )
            )

        categories: list[PortfolioCategorySlice] = []
        for name, values in sorted(category_bucket.items(), key=lambda item: item[1]["market_value_krw"], reverse=True):
            weight = Decimal("0")
            if total_market > 0:
                weight = (values["market_value_krw"] / total_market).quantize(Decimal("0.0001"))
            categories.append(
                PortfolioCategorySlice(
                    category=name,
                    market_value_krw=values["market_value_krw"],
                    invested_krw=values["invested_krw"],
                    gain_loss_krw=values["gain_loss_krw"],
                    weight_ratio=weight,
                )
            )

        return PortfolioResponse(
            household_id=household.id,
            base_currency=household.base_currency,
            as_of=datetime.now(UTC),
            total_market_value_krw=total_market,
            total_invested_krw=total_invested,
            total_gain_loss_krw=total_market - total_invested,
            items=items,
            categories=categories,
        )

    async def _to_krw(self, db: Session, amount: Decimal, currency: str) -> Decimal:
        code = (currency or "KRW").upper()
        if code == "KRW":
            return amount.quantize(Decimal("0.01"))
        try:
            rate, _ = await self.fx_service.get_rate(db, base_currency="KRW", quote_currency=code)
        except Exception as error:  # noqa: BLE001
            raise app_error(
                status_code=503,
                code="FX_RATE_UNAVAILABLE",
                message="환율 정보를 조회할 수 없습니다.",
                action="잠시 후 다시 시도해 주세요.",
                context={"currency": code},
            ) from error
        return (amount * rate).quantize(Decimal("0.01"))

    @staticmethod
    def _shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
        index = year * 12 + (month - 1) + offset
        return index // 12, index % 12 + 1

    @staticmethod
    def _installment_lookback(year: int, month: int) -> date:
        # Longest supported installment is 120 months, so a purchase this far back is
        # the earliest that could still be billing in the requested (year, month).
        lookback_year, lookback_month = DashboardService._shift_month(year, month, -119)
        return date(lookback_year, lookback_month, 1)

    @staticmethod
    def _installment_slices(amount: Decimal, months: int) -> list[Decimal]:
        base = (amount / months).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
        slices = [base for _ in range(months - 1)]
        slices.append(amount - base * (months - 1))
        return slices

    @staticmethod
    def _installment_month_amounts(
        occurred_on: date, amount: Decimal, months: int
    ) -> Iterator[tuple[int, int, Decimal]]:
        for offset, slice_amount in enumerate(DashboardService._installment_slices(amount, months)):
            slice_year, slice_month = DashboardService._shift_month(occurred_on.year, occurred_on.month, offset)
            yield slice_year, slice_month, slice_amount

    @staticmethod
    def _empty_totals() -> dict[str, Decimal]:
        return {
            FlowType.income.value: Decimal("0"),
            FlowType.expense.value: Decimal("0"),
            FlowType.investment.value: Decimal("0"),
            FlowType.transfer.value: Decimal("0"),
        }

    def _with_net(
        self, totals: dict[str, Decimal], installment_expense: Decimal = Decimal("0")
    ) -> dict[str, Decimal]:
        return {
            "income": totals[FlowType.income.value],
            "expense": totals[FlowType.expense.value],
            "investment": totals[FlowType.investment.value],
            "transfer": totals[FlowType.transfer.value],
            # Portion of expense that comes from installment billing in this period.
            "installment_expense": installment_expense,
            "net_cashflow": totals[FlowType.income.value] - totals[FlowType.expense.value] - totals[FlowType.investment.value],
        }

    @staticmethod
    def _to_trend_point(month: str, totals: dict[str, Decimal]) -> TrendPoint:
        return TrendPoint(
            month=month,
            income=totals[FlowType.income.value],
            expense=totals[FlowType.expense.value],
            investment=totals[FlowType.investment.value],
            transfer=totals[FlowType.transfer.value],
            net_cashflow=totals[FlowType.income.value] - totals[FlowType.expense.value] - totals[FlowType.investment.value],
        )

