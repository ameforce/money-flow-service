from __future__ import annotations
import asyncio

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_household
from app.core.errors import app_error
from app.db.session import get_db
from app.schemas import OverviewResponse, PortfolioResponse
from app.services.runtime import dashboard_service


router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview", response_model=OverviewResponse)
def overview(
    year: int | None = Query(default=None, ge=1970, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    ctx=Depends(get_current_household),
    db: Session = Depends(get_db),
) -> OverviewResponse:
    household, _ = ctx
    if (start_date is None) != (end_date is None):
        raise HTTPException(status_code=400, detail="start_date and end_date must be provided together")
    if start_date and end_date:
        if start_date > end_date:
            raise HTTPException(status_code=400, detail="start_date must be <= end_date")
        return dashboard_service.overview_range(
            db,
            household.id,
            start_date=start_date,
            end_date=end_date,
        )

    today = datetime.now(UTC)
    return dashboard_service.overview_month(
        db,
        household.id,
        year=year or today.year,
        month=month or today.month,
    )


@router.get("/portfolio", response_model=PortfolioResponse)
def portfolio(
    refresh_prices: bool | None = Query(
        default=None,
        deprecated=True,
        description="Deprecated. This endpoint never triggers a refresh. Use POST /prices/refresh.",
    ),
    ctx=Depends(get_current_household),
    db: Session = Depends(get_db),
) -> PortfolioResponse:
    if refresh_prices:
        raise app_error(
            status_code=400,
            code="DASHBOARD_PORTFOLIO_REFRESH_PRICES_UNSUPPORTED",
            message="대시보드 조회에서 refresh_prices=true는 지원하지 않습니다.",
            action="POST /api/v1/prices/refresh로 시세 갱신을 먼저 요청해 주세요.",
        )
    household, _ = ctx
    return asyncio.run(dashboard_service.portfolio(db, household))
