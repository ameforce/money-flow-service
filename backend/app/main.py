from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
from datetime import UTC, datetime
import logging
from pathlib import Path
from typing import Any

import anyio
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.api.routes import auth, categories, dashboard, holdings, household, imports, prices, system, transactions
from app.core.config import settings
from app.core.security import decode_ws_ticket
from app.db.init_db import create_schema
from app.db.models import HouseholdMember, UsedWsTicket
from app.db.session import SessionLocal
from app.services.runtime import hub

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.env.lower() in {"dev", "test", "local"}:
        create_schema()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(system.router)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(household.router, prefix=settings.api_prefix)
app.include_router(categories.router, prefix=settings.api_prefix)
app.include_router(transactions.router, prefix=settings.api_prefix)
app.include_router(holdings.router, prefix=settings.api_prefix)
app.include_router(dashboard.router, prefix=settings.api_prefix)
app.include_router(imports.router, prefix=settings.api_prefix)
app.include_router(prices.router, prefix=settings.api_prefix)


def _default_error_message(status_code: int) -> str:
    if status_code == 400:
        return "요청 값이 올바르지 않습니다."
    if status_code == 401:
        return "인증이 필요합니다."
    if status_code == 403:
        return "요청 권한이 없습니다."
    if status_code == 404:
        return "요청 대상을 찾을 수 없습니다."
    if status_code == 409:
        return "요청 충돌이 발생했습니다."
    if status_code == 413:
        return "요청 크기 제한을 초과했습니다."
    if status_code == 429:
        return "요청이 너무 많습니다."
    if status_code >= 500:
        return "서버 처리 중 문제가 발생했습니다."
    return "요청 처리 중 오류가 발생했습니다."


def _default_error_action(status_code: int) -> str:
    if status_code in {400, 409, 413}:
        return "입력값을 확인한 뒤 다시 시도해 주세요."
    if status_code in {401, 403}:
        return "로그인 상태 또는 권한을 확인해 주세요."
    if status_code == 404:
        return "경로와 요청 대상을 다시 확인해 주세요."
    if status_code >= 500:
        return "잠시 후 다시 시도해 주세요."
    return "다시 시도해 주세요."


def _code_from_text(status_code: int, text: str) -> str:
    normalized = text.strip().lower()
    explicit_codes = {
        "missing token": "AUTH_TOKEN_MISSING",
        "invalid token": "AUTH_TOKEN_INVALID",
        "user not found": "AUTH_USER_NOT_FOUND",
        "household membership missing": "HOUSEHOLD_MEMBERSHIP_MISSING",
        "household not found": "HOUSEHOLD_NOT_FOUND",
        "invalid credentials": "AUTH_INVALID_CREDENTIALS",
        "email already exists": "AUTH_EMAIL_ALREADY_EXISTS",
        "holding already exists": "HOLDING_ALREADY_EXISTS",
        "holding not found": "HOLDING_NOT_FOUND",
        "transaction not found": "TRANSACTION_NOT_FOUND",
        "invalid category_id": "CATEGORY_INVALID",
        "workbook not found": "IMPORT_WORKBOOK_NOT_FOUND",
        "workbook must be .xlsx": "IMPORT_WORKBOOK_EXTENSION_INVALID",
        "start_date and end_date must be provided together": "FILTER_DATE_RANGE_INVALID",
        "start_date must be <= end_date": "FILTER_DATE_ORDER_INVALID",
        "month filter requires year": "FILTER_MONTH_REQUIRES_YEAR",
        "frontend build missing": "FRONTEND_BUILD_MISSING",
        "not found": "RESOURCE_NOT_FOUND",
    }
    if normalized in explicit_codes:
        return explicit_codes[normalized]
    token = "".join(ch if ch.isalnum() else "_" for ch in normalized.upper()).strip("_")
    token = "_".join([item for item in token.split("_") if item])
    if token:
        return token
    return f"HTTP_{status_code}"


def _normalize_http_error(status_code: int, detail: Any) -> dict[str, Any]:
    if isinstance(detail, dict):
        has_error_contract = any(key in detail for key in ("code", "message", "action", "context"))
        code = str(detail.get("code") or "").strip().upper() or f"HTTP_{status_code}"
        message = str(detail.get("message") or "").strip() or _default_error_message(status_code)
        action = str(detail.get("action") or "").strip() or _default_error_action(status_code)
        context = detail.get("context")
        payload = {
            "code": code,
            "message": message,
            "action": action,
        }
        if context is not None:
            payload["context"] = context
        elif not has_error_contract and detail:
            # Preserve structured HTTPException payloads such as PatchConflict.
            payload["context"] = detail
        return payload

    text = str(detail or "").strip()
    return {
        "code": _code_from_text(status_code, text),
        "message": _default_error_message(status_code),
        "action": _default_error_action(status_code),
    }


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    payload = _normalize_http_error(int(exc.status_code), exc.detail)
    return JSONResponse(status_code=int(exc.status_code), content={"error": payload})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    payload = {
        "code": "REQUEST_VALIDATION_FAILED",
        "message": _default_error_message(400),
        "action": _default_error_action(400),
    }
    # Keep validation internals out of client responses.
    _ = exc
    return JSONResponse(status_code=400, content={"error": payload})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, _exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception: %s %s", request.method, request.url.path)
    payload = {
        "code": "INTERNAL_SERVER_ERROR",
        "message": _default_error_message(500),
        "action": _default_error_action(500),
    }
    return JSONResponse(status_code=500, content={"error": payload})


def _validate_ws_ticket(household_id: str, ticket: str | None) -> dict[str, Any] | None:
    if not ticket:
        return None
    try:
        payload = decode_ws_ticket(ticket)
        if str(payload.get("household_id") or "") != household_id:
            return None
        jti = str(payload.get("jti") or "").strip()
        exp = int(payload.get("exp") or 0)
        now_ts = int(datetime.now(UTC).timestamp())
        if not jti or exp <= 0 or exp <= now_ts:
            return None
        now_dt = datetime.fromtimestamp(now_ts, tz=UTC)
        expires_dt = datetime.fromtimestamp(exp, tz=UTC)
        with SessionLocal() as db:
            db.execute(delete(UsedWsTicket).where(UsedWsTicket.expires_at <= now_dt))
            db.add(
                UsedWsTicket(
                    jti=jti,
                    household_id=household_id,
                    expires_at=expires_dt,
                )
            )
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                return None
        return payload
    except Exception:  # noqa: BLE001
        return None


def _extract_ws_ticket(websocket: WebSocket) -> tuple[str | None, str | None]:
    raw_protocols = str(websocket.headers.get("sec-websocket-protocol") or "")
    requested_protocols = [item.strip() for item in raw_protocols.split(",") if item.strip()]
    for protocol in requested_protocols:
        if protocol.startswith("ticket."):
            return protocol.removeprefix("ticket."), protocol
    return None, None


def _ws_member_exists(household_id: str, user_id: str) -> bool:
    with SessionLocal() as db:
        member_id = db.scalar(
            select(HouseholdMember.id).where(
                HouseholdMember.household_id == household_id,
                HouseholdMember.user_id == user_id,
            )
        )
    return member_id is not None


@app.websocket("/ws/v1/household/{household_id}")
async def household_ws(household_id: str, websocket: WebSocket) -> None:
    ticket, selected_protocol = _extract_ws_ticket(websocket)
    payload = await anyio.to_thread.run_sync(_validate_ws_ticket, household_id, ticket)
    if payload is None:
        await websocket.close(code=1008)
        return
    user_id = str(payload.get("sub") or "").strip()
    if not user_id:
        await websocket.close(code=1008)
        return
    member_exists = await anyio.to_thread.run_sync(_ws_member_exists, household_id, user_id)
    if not member_exists:
        await websocket.close(code=1008)
        return

    if selected_protocol:
        await websocket.accept(subprotocol=selected_protocol)
    else:
        await websocket.accept()
    await hub.connect(household_id, user_id, websocket)
    recheck_interval = max(0.2, float(settings.ws_membership_recheck_seconds))
    next_recheck_at = anyio.current_time() + recheck_interval
    try:
        while True:
            timeout_sec = max(0.0, next_recheck_at - anyio.current_time())
            try:
                await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=timeout_sec,
                )
            except TimeoutError:
                pass
            if anyio.current_time() >= next_recheck_at:
                # Re-check membership periodically so revoked users are disconnected across workers.
                member_exists = await anyio.to_thread.run_sync(_ws_member_exists, household_id, user_id)
                if not member_exists:
                    await websocket.close(code=1008)
                    break
                next_recheck_at = anyio.current_time() + recheck_interval
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await hub.disconnect(household_id, websocket)


frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
frontend_assets = frontend_dist / "assets"
if frontend_assets.exists():
    app.mount("/assets", StaticFiles(directory=frontend_assets), name="assets")


@app.get("/", include_in_schema=False)
def root():
    index_path = frontend_dist / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return JSONResponse(
        {
            "message": "frontend not built",
            "hint": "run `cmd /c npm run build --prefix frontend`",
        }
    )


@app.get("/{path:path}", include_in_schema=False)
def spa_fallback(path: str):
    if path.startswith("api/") or path.startswith("ws/"):
        raise HTTPException(status_code=404, detail="not found")
    dist_root = frontend_dist.resolve()
    candidate = (dist_root / path).resolve()
    if candidate.is_file() and (candidate.parent == dist_root or dist_root in candidate.parents):
        return FileResponse(candidate)
    index_path = frontend_dist / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="frontend build missing")
    return FileResponse(index_path)
