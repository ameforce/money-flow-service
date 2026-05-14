#!/usr/bin/env python3
from __future__ import annotations

import argparse
import http.cookiejar
import html
import imaplib
import json
import os
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from pathlib import Path
import re
import secrets
import ssl
import time
from typing import Any, Mapping, NamedTuple
from urllib.error import HTTPError
from urllib.parse import parse_qs, unquote_plus, urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener


PROD_BASE_URL = "https://moneyflow.enmsoftware.com"
URL_PATTERN = re.compile(r"https?://[^\s<>\"']+")
SECRET_FIELD_NAMES = {
    "smtp_pass",
    "smtp_password",
    "smtp_user",
    "database_url",
    "secret_key",
    "access_token",
    "refresh_token",
    "token",
    "verify_token",
    "cookies",
}
VERIFY_TOKEN_PATTERN = re.compile(r"verify_token=([^\s&#'\"]+)")
COOKIE_VALUE_PATTERN = re.compile(r"((?:access|refresh|session|csrf)[-_a-z0-9]*=)[^;\s]+", re.IGNORECASE)


class SmokeValidationError(RuntimeError):
    pass


class VerificationLink(NamedTuple):
    raw_url: str
    token: str


class MailboxMessage(NamedTuple):
    uid: int
    received_at: datetime
    recipients: list[str]
    text: str


class BrowserVerificationResult(NamedTuple):
    auth_me: dict[str, Any]
    cookies: dict[str, str]
    responses: list[dict[str, Any]]


def mask_email(address: str) -> str:
    text = str(address or "").strip()
    if "@" not in text:
        return "***"
    local, domain = text.split("@", 1)
    if len(local) <= 2:
        masked = "*" * len(local)
    else:
        masked = f"{local[:2]}{'*' * (len(local) - 2)}"
    return f"{masked}@{domain}"


def _candidate_urls(text: str) -> list[str]:
    return [match.strip().rstrip(".),;]") for match in URL_PATTERN.findall(html.unescape(str(text or "")))]


def _origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")


def extract_prod_verification_link(text: str, *, base_url: str = PROD_BASE_URL) -> VerificationLink:
    expected_origin = _origin(base_url)
    saw_wrong_origin = False
    saw_query_token = False
    for url in _candidate_urls(text):
        parsed = urlparse(url)
        if "verify_token" not in url:
            continue
        if _origin(url) != expected_origin:
            saw_wrong_origin = True
            continue
        query_token = parse_qs(parsed.query).get("verify_token")
        if query_token:
            saw_query_token = True
            continue
        fragment_values = parse_qs(str(parsed.fragment or "").lstrip("?")).get("verify_token")
        if fragment_values:
            return VerificationLink(raw_url=url, token=unquote_plus(str(fragment_values[0])))
    if saw_query_token:
        raise SmokeValidationError("prod verification link must use hash fragment verify_token")
    if saw_wrong_origin:
        raise SmokeValidationError(f"verification link origin does not match {expected_origin}")
    raise SmokeValidationError("prod verification link not found")


def _redact_string(value: str, private_addresses: list[str]) -> str:
    redacted = str(value or "")
    redacted = VERIFY_TOKEN_PATTERN.sub("verify_token=<redacted>", redacted)
    redacted = COOKIE_VALUE_PATTERN.sub(r"\1<redacted>", redacted)
    for address in private_addresses:
        if address:
            redacted = redacted.replace(address, mask_email(address))
    return redacted


def redact_public_payload(payload: Any, *, private_addresses: list[str] | None = None) -> Any:
    addresses = list(private_addresses or [])
    if isinstance(payload, Mapping):
        output: dict[str, Any] = {}
        for key, value in payload.items():
            normalized_key = str(key).strip().lower()
            if normalized_key in SECRET_FIELD_NAMES or normalized_key.startswith("smtp_pass"):
                output[str(key)] = "<redacted>"
                continue
            output[str(key)] = redact_public_payload(value, private_addresses=addresses)
        return output
    if isinstance(payload, list):
        return [redact_public_payload(item, private_addresses=addresses) for item in payload]
    if isinstance(payload, tuple):
        return [redact_public_payload(item, private_addresses=addresses) for item in payload]
    if isinstance(payload, str):
        return _redact_string(payload, addresses)
    return payload


def dumps_public_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True)


def dumps_private_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True, default=str)


def select_candidate_messages(
    messages: list[MailboxMessage],
    *,
    min_uid: int,
    after: datetime,
    expected_recipient: str,
) -> list[MailboxMessage]:
    expected = str(expected_recipient or "").strip().lower()
    selected: list[MailboxMessage] = []
    for message in messages:
        received = message.received_at
        if received.tzinfo is None:
            received = received.replace(tzinfo=UTC)
        recipients = {str(item or "").strip().lower() for item in message.recipients}
        if int(message.uid) <= int(min_uid):
            continue
        if received <= after:
            continue
        if expected and expected not in recipients:
            continue
        selected.append(message)
    return selected


def build_cleanup_ledger(*, target_email: str, before_counts: Mapping[str, int], after_counts: Mapping[str, int]) -> dict[str, Any]:
    return {
        "target_email": target_email,
        "wildcard_delete": False,
        "before_counts": dict(before_counts),
        "after_counts": dict(after_counts),
    }


def build_public_report(
    *,
    base_url: str,
    smoke_email: str,
    route_summary: Mapping[str, Any],
    verification_link: str,
    verification_mode: str = "api",
    auth_me: Mapping[str, Any],
    cleanup: Mapping[str, Any],
) -> dict[str, Any]:
    payload = {
        "base_url": base_url,
        "smoke_email": smoke_email,
        "route_summary": dict(route_summary),
        "verification_link": verification_link,
        "verification_mode": verification_mode,
        "auth_me": dict(auth_me),
        "cleanup": dict(cleanup),
        "generated_at": datetime.now(UTC).isoformat(),
    }
    return redact_public_payload(payload, private_addresses=[smoke_email])


def build_private_ledger(*, verification_link: str, cookies: Mapping[str, str], **extra: Any) -> dict[str, Any]:
    ledger = {"verification_link": verification_link, "cookies": dict(cookies), "generated_at": datetime.now(UTC).isoformat()}
    ledger.update(extra)
    return ledger


def _message_text(payload_bytes: bytes) -> str:
    message = BytesParser(policy=policy.default).parsebytes(payload_bytes)
    parts: list[str] = []
    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            if content_type in {"text/plain", "text/html"}:
                try:
                    parts.append(str(part.get_content()))
                except Exception:  # noqa: BLE001
                    payload = part.get_payload(decode=True) or b""
                    parts.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
    else:
        try:
            parts.append(str(message.get_content()))
        except Exception:  # noqa: BLE001
            payload = message.get_payload(decode=True) or b""
            parts.append(payload.decode(message.get_content_charset() or "utf-8", errors="replace"))
    return "\n".join(parts)


def _message_recipients(payload_bytes: bytes) -> list[str]:
    message = BytesParser(policy=policy.default).parsebytes(payload_bytes)
    values = []
    for header in ("to", "cc", "delivered-to", "x-original-to"):
        raw = message.get_all(header, [])
        values.extend(address for _, address in getaddresses(raw) if address)
    return values


def _message_received_at(payload_bytes: bytes) -> datetime:
    message = BytesParser(policy=policy.default).parsebytes(payload_bytes)
    raw_date = str(message.get("date") or "").strip()
    if raw_date:
        try:
            parsed = parsedate_to_datetime(raw_date)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC)
        except Exception:  # noqa: BLE001
            pass
    return datetime.now(UTC)


def _open_imap(*, host: str, port: int, use_ssl: bool, user: str, password: str) -> imaplib.IMAP4:
    if use_ssl:
        client: imaplib.IMAP4 = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context())
    else:
        client = imaplib.IMAP4(host, port)
    client.login(user, password)
    client.select("INBOX")
    return client


def _latest_uid(client: imaplib.IMAP4) -> int:
    status, data = client.uid("search", None, "ALL")
    if status != "OK" or not data or not data[0]:
        return 0
    values = [int(item) for item in bytes(data[0]).split() if item.isdigit()]
    return max(values or [0])


def _fetch_messages_after(client: imaplib.IMAP4, *, min_uid: int) -> list[MailboxMessage]:
    status, data = client.uid("search", None, f"UID {min_uid + 1}:*")
    if status != "OK" or not data or not data[0]:
        return []
    messages: list[MailboxMessage] = []
    for uid_bytes in bytes(data[0]).split():
        uid = int(uid_bytes)
        fetch_status, fetch_data = client.uid("fetch", str(uid), "(RFC822)")
        if fetch_status != "OK":
            continue
        for item in fetch_data or []:
            if isinstance(item, tuple) and item[1]:
                payload = bytes(item[1])
                messages.append(
                    MailboxMessage(
                        uid=uid,
                        received_at=_message_received_at(payload),
                        recipients=_message_recipients(payload),
                        text=_message_text(payload),
                    )
                )
    return messages


def _http_json(opener: Any, *, base_url: str, path: str, payload: Mapping[str, Any] | None = None) -> dict[str, Any]:
    body = None if payload is None else json.dumps(dict(payload)).encode("utf-8")
    request = Request(
        f"{base_url.rstrip('/')}{path}",
        data=body,
        headers={"Content-Type": "application/json", "Origin": base_url.rstrip("/")},
        method="GET" if payload is None else "POST",
    )
    try:
        with opener.open(request, timeout=20) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SmokeValidationError(f"HTTP {exc.code} {path}: {detail}") from exc


def _cookie_snapshot(jar: http.cookiejar.CookieJar) -> dict[str, str]:
    return {cookie.name: cookie.value for cookie in jar}


def _browser_cookie_payload(jar: http.cookiejar.CookieJar) -> list[dict[str, Any]]:
    cookies: list[dict[str, Any]] = []
    for cookie in jar:
        cookies.append(
            {
                "name": cookie.name,
                "value": cookie.value,
                "path": cookie.path or "/",
                "httpOnly": "httponly" in {str(key).lower() for key in getattr(cookie, "_rest", {})},
            }
        )
    return cookies


def _browser_verify_script() -> str:
    return r"""
const fs = require('fs');
const { chromium } = require('playwright');

async function main() {
  const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const resultPath = process.argv[3];
  const origin = new URL(payload.base_url);
  const responses = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: payload.base_url });
  const cookies = (payload.cookies || []).map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: origin.hostname,
    path: cookie.path || '/',
    secure: origin.protocol === 'https:',
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: 'Lax',
  }));
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }
  const page = await context.newPage();
  page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/api/v1/auth/verify-email') || url.includes('/api/v1/auth/me')) {
      responses.push({ url, status: response.status() });
    }
  });
  await page.goto(payload.verification_link, {
    waitUntil: 'domcontentloaded',
    timeout: payload.timeout_ms,
  });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const authMe = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
    let body = null;
    try {
      body = await response.json();
    } catch (_error) {
      body = null;
    }
    return { status: response.status, body };
  });
  const finalCookies = await context.cookies();
  await browser.close();
  fs.writeFileSync(resultPath, JSON.stringify({ auth_me: authMe, cookies: finalCookies, responses }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
"""


def _run_browser_verification(
    *,
    base_url: str,
    verification_link: VerificationLink,
    jar: http.cookiejar.CookieJar,
    artifact_dir: Path,
    timeout_sec: int,
) -> BrowserVerificationResult:
    if shutil.which("node") is None:
        raise SmokeValidationError("node is unavailable for browser verification")
    artifact_dir.mkdir(parents=True, exist_ok=True)
    payload_path = artifact_dir / "browser-verify-payload.json"
    script_path = artifact_dir / "browser-verify.js"
    result_path = artifact_dir / "browser-verify-result.json"
    payload = {
        "base_url": base_url.rstrip("/"),
        "verification_link": verification_link.raw_url,
        "cookies": _browser_cookie_payload(jar),
        "timeout_ms": int(timeout_sec) * 1000,
    }
    payload_path.write_text(dumps_private_json(payload) + "\n", encoding="utf-8")
    script_path.write_text(_browser_verify_script(), encoding="utf-8")
    completed = subprocess.run(
        ["node", str(script_path), str(payload_path), str(result_path)],
        cwd=Path.cwd(),
        text=True,
        capture_output=True,
        timeout=int(timeout_sec) + 20,
        check=False,
    )
    if completed.returncode != 0:
        detail = "\n".join(part for part in (completed.stdout.strip(), completed.stderr.strip()) if part)
        raise SmokeValidationError(f"browser verification failed: {detail or completed.returncode}")
    result = json.loads(result_path.read_text(encoding="utf-8"))
    auth_response = result.get("auth_me") or {}
    if int(auth_response.get("status") or 0) != 200:
        raise SmokeValidationError(f"browser /auth/me failed: {auth_response}")
    auth_me = dict(auth_response.get("body") or {})
    if not bool(auth_me.get("email_verified")):
        raise SmokeValidationError(f"browser did not confirm verified email: {auth_me}")
    cookies = {str(cookie.get("name")): str(cookie.get("value")) for cookie in result.get("cookies") or [] if cookie.get("name")}
    responses = [dict(item) for item in result.get("responses") or []]
    return BrowserVerificationResult(auth_me=auth_me, cookies=cookies, responses=responses)


def run_smoke(args: argparse.Namespace) -> int:
    base_url = str(args.base_url or PROD_BASE_URL).rstrip("/")
    recipient = str(args.recipient or "").strip()
    if not recipient:
        raise SmokeValidationError("--recipient is required")
    password = str(args.password or secrets.token_urlsafe(18))
    display_name = str(args.display_name or "Prod Email Smoke")
    started_at = datetime.now(UTC)

    client = _open_imap(
        host=str(args.imap_host),
        port=int(args.imap_port),
        use_ssl=bool(args.imap_ssl),
        user=str(args.imap_user),
        password=str(args.imap_password),
    )
    try:
        min_uid = _latest_uid(client)
    finally:
        try:
            client.logout()
        except Exception:  # noqa: BLE001
            pass

    jar = http.cookiejar.CookieJar()
    opener = build_opener(HTTPCookieProcessor(jar))
    register_payload = _http_json(
        opener,
        base_url=base_url,
        path="/api/v1/auth/register",
        payload={"email": recipient, "password": password, "display_name": display_name},
    )
    if str(register_payload.get("status") or "") != "verification_required":
        raise SmokeValidationError(f"unexpected register status: {register_payload}")
    if register_payload.get("debug_verification_token"):
        raise SmokeValidationError("prod smoke received debug_verification_token")

    deadline = time.time() + int(args.timeout_sec)
    verification_link: VerificationLink | None = None
    while time.time() < deadline:
        client = _open_imap(
            host=str(args.imap_host),
            port=int(args.imap_port),
            use_ssl=bool(args.imap_ssl),
            user=str(args.imap_user),
            password=str(args.imap_password),
        )
        try:
            messages = select_candidate_messages(
                _fetch_messages_after(client, min_uid=min_uid),
                min_uid=min_uid,
                after=started_at,
                expected_recipient=recipient,
            )
        finally:
            try:
                client.logout()
            except Exception:  # noqa: BLE001
                pass
        for message in messages:
            try:
                verification_link = extract_prod_verification_link(message.text, base_url=base_url)
                break
            except SmokeValidationError:
                continue
        if verification_link is not None:
            break
        time.sleep(float(args.poll_interval_sec))
    if verification_link is None:
        raise SmokeValidationError("external mailbox verification link was not received before timeout")

    verification_mode = str(args.verification_mode or "auto").strip().lower()
    if verification_mode not in {"auto", "browser", "api"}:
        raise SmokeValidationError("--verification-mode must be one of: auto, browser, api")

    browser_result: BrowserVerificationResult | None = None
    verify_payload: Mapping[str, Any]
    if verification_mode in {"auto", "browser"}:
        try:
            browser_result = _run_browser_verification(
                base_url=base_url,
                verification_link=verification_link,
                jar=jar,
                artifact_dir=Path(str(args.browser_artifact_dir)),
                timeout_sec=int(args.browser_timeout_sec),
            )
        except SmokeValidationError as exc:
            if verification_mode == "browser":
                raise
            print(f"[prod-email-smoke] browser verification unavailable; falling back to API verification: {exc}", file=sys.stderr)

    if browser_result is not None:
        verification_mode = "browser"
        auth_me = browser_result.auth_me
        verify_payload = {"mode": "browser", "responses": browser_result.responses}
        cookie_snapshot = browser_result.cookies
    else:
        verification_mode = "api"
        verify_payload = _http_json(
            opener,
            base_url=base_url,
            path="/api/v1/auth/verify-email",
            payload={"token": verification_link.token},
        )
        auth_me = _http_json(opener, base_url=base_url, path="/api/v1/auth/me")
        cookie_snapshot = _cookie_snapshot(jar)
    if not bool(auth_me.get("email_verified")):
        raise SmokeValidationError(f"/auth/me did not confirm verified email: {auth_me}")

    cleanup = build_cleanup_ledger(target_email=recipient, before_counts={}, after_counts={})
    public_report = build_public_report(
        base_url=base_url,
        smoke_email=recipient,
        route_summary={"host_classification": "external-provider", "proof": "external-mailbox-received"},
        verification_link=verification_link.raw_url,
        verification_mode=verification_mode,
        auth_me=auth_me,
        cleanup=cleanup,
    )
    private_ledger = build_private_ledger(
        verification_link=verification_link.raw_url,
        cookies=cookie_snapshot,
        register_response=register_payload,
        verify_response=verify_payload,
        recipient=recipient,
    )
    if args.public_report:
        Path(args.public_report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.public_report).write_text(dumps_public_json(public_report) + "\n", encoding="utf-8")
    if args.private_ledger:
        Path(args.private_ledger).parent.mkdir(parents=True, exist_ok=True)
        Path(args.private_ledger).write_text(dumps_private_json(private_ledger) + "\n", encoding="utf-8")
    print(dumps_public_json(public_report), flush=True)
    return 0


def _env(name: str, default: str = "") -> str:
    return str(os.environ.get(name, default)).strip()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run production deployed-domain email verification smoke with external IMAP proof.")
    parser.add_argument("--base-url", default=_env("PROD_EMAIL_SMOKE_BASE_URL", PROD_BASE_URL))
    parser.add_argument("--recipient", default=_env("PROD_EMAIL_SMOKE_RECIPIENT"))
    parser.add_argument("--password", default=_env("PROD_EMAIL_SMOKE_PASSWORD"))
    parser.add_argument("--display-name", default=_env("PROD_EMAIL_SMOKE_DISPLAY_NAME", "Prod Email Smoke"))
    parser.add_argument("--imap-host", default=_env("PROD_EMAIL_SMOKE_IMAP_HOST"))
    parser.add_argument("--imap-port", type=int, default=int(_env("PROD_EMAIL_SMOKE_IMAP_PORT", "993")))
    parser.add_argument("--imap-user", default=_env("PROD_EMAIL_SMOKE_IMAP_USER"))
    parser.add_argument("--imap-password", default=_env("PROD_EMAIL_SMOKE_IMAP_PASSWORD"))
    parser.add_argument("--imap-ssl", action=argparse.BooleanOptionalAction, default=_env("PROD_EMAIL_SMOKE_IMAP_SSL", "true").lower() != "false")
    parser.add_argument("--timeout-sec", type=int, default=int(_env("PROD_EMAIL_SMOKE_TIMEOUT_SEC", "240")))
    parser.add_argument("--poll-interval-sec", type=float, default=float(_env("PROD_EMAIL_SMOKE_POLL_INTERVAL_SEC", "5")))
    parser.add_argument("--verification-mode", default=_env("PROD_EMAIL_SMOKE_VERIFICATION_MODE", "auto"), choices=("auto", "browser", "api"))
    parser.add_argument("--browser-timeout-sec", type=int, default=int(_env("PROD_EMAIL_SMOKE_BROWSER_TIMEOUT_SEC", "45")))
    parser.add_argument("--browser-artifact-dir", default=_env("PROD_EMAIL_SMOKE_BROWSER_ARTIFACT_DIR", ".omx/private/prod-email-smoke/browser"))
    parser.add_argument("--public-report", default=_env("PROD_EMAIL_SMOKE_PUBLIC_REPORT", ".omx/reports/prod-email-smoke/public-report.json"))
    parser.add_argument("--private-ledger", default=_env("PROD_EMAIL_SMOKE_PRIVATE_LEDGER", ".omx/private/prod-email-smoke/private-ledger.json"))
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    missing = [name for name in ("imap_host", "imap_user", "imap_password") if not str(getattr(args, name, "")).strip()]
    if missing:
        raise SystemExit("missing required IMAP settings: " + " ".join(missing))
    try:
        return run_smoke(args)
    except SmokeValidationError as exc:
        raise SystemExit(f"[prod-email-smoke] {exc}") from exc


if __name__ == "__main__":
    raise SystemExit(main())
