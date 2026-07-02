from __future__ import annotations

from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import os
import secrets
from typing import Any
import uuid

import jwt

from app.core.config import settings


RESERVED_JWT_CLAIMS = {"sub", "typ", "jti", "iat", "exp"}


def _derive_hash(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = _derive_hash(password, salt)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, salt_hex, digest_hex = encoded.split("$", 2)
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    actual = _derive_hash(password, salt)
    return hmac.compare_digest(expected, actual)


def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "typ": "access",
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
    }
    if extra:
        payload.update({key: value for key, value in extra.items() if key not in RESERVED_JWT_CLAIMS})
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def create_refresh_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "typ": "refresh",
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=max(1, settings.refresh_token_days))).timestamp()),
    }
    if extra:
        payload.update({key: value for key, value in extra.items() if key not in RESERVED_JWT_CLAIMS})
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def create_ws_ticket(subject: str, household_id: str, *, ttl_seconds: int = 30) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "household_id": household_id,
        "typ": "ws_ticket",
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=max(5, ttl_seconds))).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    if str(payload.get("typ") or "") != "access":
        raise jwt.InvalidTokenError("invalid token type")
    if not str(payload.get("jti") or "").strip():
        raise jwt.InvalidTokenError("missing jti")
    return payload


def decode_refresh_token(token: str) -> dict[str, Any]:
    payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    if str(payload.get("typ") or "") != "refresh":
        raise jwt.InvalidTokenError("invalid token type")
    if not str(payload.get("jti") or "").strip():
        raise jwt.InvalidTokenError("missing jti")
    return payload


def decode_ws_ticket(ticket: str) -> dict[str, Any]:
    payload = jwt.decode(ticket, settings.secret_key, algorithms=["HS256"])
    if str(payload.get("typ") or "") != "ws_ticket":
        raise jwt.InvalidTokenError("invalid ticket type")
    if not str(payload.get("jti") or "").strip():
        raise jwt.InvalidTokenError("missing jti")
    return payload


def generate_opaque_token(*, nbytes: int = 32) -> str:
    return secrets.token_urlsafe(max(16, nbytes))


def hash_opaque_token(token: str) -> str:
    normalized = str(token or "").strip()
    digest = hmac.new(settings.secret_key.encode("utf-8"), normalized.encode("utf-8"), hashlib.sha256).hexdigest()
    return digest

