from __future__ import annotations

from ipaddress import ip_address
from urllib.parse import urlparse

from fastapi import Request

from app.core.config import settings


DEBUG_TOKEN_OPT_IN_HEADER = "x-debug-token-opt-in"
_DEBUG_TOKEN_ENVS = {"test", "local"}
_LOCAL_HOSTNAMES = {"localhost", "testserver", "host.docker.internal"}


def _hostname_from_value(value: str | None) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if "://" not in text:
        text = f"//{text}"
    parsed = urlparse(text)
    return str(parsed.hostname or "").strip().lower()


def _is_local_debug_host(hostname: str) -> bool:
    host = str(hostname or "").strip().lower().strip("[]")
    if not host:
        return True
    if host in _LOCAL_HOSTNAMES or host.endswith(".localhost"):
        return True
    try:
        address = ip_address(host)
    except ValueError:
        # Single-label names cover local container/service aliases without
        # allowing public DNS names such as dev.moneyflow.enmsoftware.com.
        return "." not in host
    return address.is_loopback or address.is_private or address.is_link_local


def _debug_context_hostnames(request: Request | None) -> list[str]:
    hosts: list[str] = []
    if request is not None:
        hosts.extend(
            [
                _hostname_from_value(request.headers.get("host")),
                _hostname_from_value(request.headers.get("origin")),
                _hostname_from_value(request.headers.get("referer")),
            ]
        )
    hosts.append(_hostname_from_value(settings.frontend_base_url))
    hosts.extend(_hostname_from_value(origin) for origin in settings.allowed_origins)
    return [host for host in hosts if host]


def _is_debug_token_opted_in(request: Request | None) -> bool:
    if request is None:
        return False
    value = str(request.headers.get(DEBUG_TOKEN_OPT_IN_HEADER) or "").strip().lower()
    return value in {"1", "true", "yes", "y", "on"}


def debug_token_response_enabled(request: Request | None) -> bool:
    if not settings.auth_debug_return_verify_token:
        return False
    if str(settings.env or "").strip().lower() not in _DEBUG_TOKEN_ENVS:
        return False
    if not _is_debug_token_opted_in(request):
        return False
    return all(_is_local_debug_host(host) for host in _debug_context_hostnames(request))
