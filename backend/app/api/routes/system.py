from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter


router = APIRouter(tags=["system"])


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
def readyz() -> dict[str, str]:
    return {"status": "ready", "time": datetime.now(UTC).isoformat()}

