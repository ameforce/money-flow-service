from __future__ import annotations

from typing import Any

from fastapi import HTTPException


def app_error(
    status_code: int,
    code: str,
    message: str,
    action: str,
    *,
    context: dict[str, Any] | None = None,
) -> HTTPException:
    detail: dict[str, Any] = {
        "code": code,
        "message": message,
        "action": action,
    }
    if context:
        detail["context"] = context
    return HTTPException(status_code=status_code, detail=detail)

