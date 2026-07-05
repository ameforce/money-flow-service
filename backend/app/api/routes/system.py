from __future__ import annotations

from datetime import UTC, datetime
import os

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine

router = APIRouter(tags=["system"])


_CLIENT_VERSION_NO_STORE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _normalize_client_version(value: str) -> str:
    text = str(value or "").strip()
    if text.startswith("v"):
        text = text[1:]
    return text or "0.0.0"


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get(f"{settings.api_prefix}/system/client-version")
def client_version() -> JSONResponse:
    version = _normalize_client_version(os.environ.get("APP_VERSION", "0.0.0"))
    return JSONResponse({"version": version}, headers=_CLIENT_VERSION_NO_STORE_HEADERS)

@router.get("/readyz")
def readyz() -> dict[str, str]:
    db_state = "error"
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_state = "ok"
    except Exception:  # noqa: BLE001
        db_state = "error"
    return {
        "status": "ready",
        "time": datetime.now(UTC).isoformat(),
        "env": str(settings.env or "").strip().lower(),
        "db": db_state,
    }

