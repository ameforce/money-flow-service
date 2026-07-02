from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_household, require_editor_household
from app.core.config import settings
from app.db.session import get_db
from app.schemas import PriceStatus
from app.services.runtime import price_service


router = APIRouter(prefix="/prices", tags=["prices"])


async def _request_price_refresh(ctx) -> dict:
    household, _ = ctx
    refresh_job = await price_service.request_refresh(household.id)
    return {
        "household_id": household.id,
        "accepted": bool(refresh_job.get("accepted", False)),
        "queued": bool(refresh_job.get("queued", False)),
        "in_progress": bool(refresh_job.get("in_progress", False)),
        "started_at": refresh_job.get("started_at"),
        "target_count": int(refresh_job.get("target_count", 0)),
        "completed_count": int(refresh_job.get("completed_count", 0)),
    }


@router.post("/refresh")
async def refresh_prices(ctx=Depends(require_editor_household)) -> dict:
    return await _request_price_refresh(ctx)


@router.get("/status", response_model=PriceStatus)
def price_status(ctx=Depends(get_current_household), db: Session = Depends(get_db)) -> PriceStatus:
    household, _ = ctx
    status_data = price_service.status(db, household.id)
    return PriceStatus(
        household_id=household.id,
        cache_seconds=settings.price_cache_seconds,
        holdings_count=status_data["holdings_count"],
        tracked_holdings_count=status_data["tracked_holdings_count"],
        stale_count=status_data["stale_count"],
        snapshot_count=status_data["snapshot_count"],
        fx_base_currency=household.base_currency,
        updated_at=status_data["updated_at"],
        refresh_in_progress=status_data["refresh_in_progress"],
        refresh_queued=status_data["refresh_queued"],
        refresh_started_at=status_data["refresh_started_at"],
        refresh_finished_at=status_data["refresh_finished_at"],
        refresh_target_count=status_data["refresh_target_count"],
        refresh_completed_count=status_data["refresh_completed_count"],
        refresh_refreshed_count=status_data["refresh_refreshed_count"],
        refresh_last_duration_ms=status_data["refresh_last_duration_ms"],
        refresh_last_error=status_data["refresh_last_error"],
    )
