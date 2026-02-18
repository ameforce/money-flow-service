from __future__ import annotations

import argparse
from dataclasses import dataclass
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
import imaplib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import smtplib
import ssl
import subprocess
import sys
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote_plus, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
BACKEND_HOST = "127.0.0.1"
EMAIL_BODY_URL_PATTERN = re.compile(r"https?://[^\s<>'\"]+")


@dataclass(frozen=True)
class MailAccount:
    name: str
    address: str
    password: str
    imap_host: str
    imap_port: int
    imap_ssl: bool
    smtp_host: str
    smtp_port: int
    smtp_starttls: bool
    smtp_ssl: bool
    auth_address: str | None = None
    smtp_auth_enabled: bool = True


@dataclass(frozen=True)
class LiveRound:
    name: str
    smtp: MailAccount
    inviter: MailAccount
    invitee: MailAccount


@dataclass(frozen=True)
class MailToken:
    token: str
    source_url: str | None
    source_part: str


def parse_bool_env(name: str, default: bool) -> bool:
    raw = str(os.environ.get(name, "")).strip().lower()
    if not raw:
        return bool(default)
    return raw in {"1", "true", "t", "yes", "y", "on"}


def require_env(name: str) -> str:
    value = str(os.environ.get(name, "")).strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def read_optional_env(name: str) -> str:
    return str(os.environ.get(name, "")).strip()


def mask_email(address: str) -> str:
    text = str(address or "").strip()
    if "@" not in text:
        return "***"
    local, domain = text.split("@", 1)
    if len(local) <= 2:
        local_masked = "*" * len(local)
    else:
        local_masked = f"{local[:2]}{'*' * (len(local) - 2)}"
    return f"{local_masked}@{domain}"


def account_auth_address(account: MailAccount) -> str:
    return str(account.auth_address or account.address).strip()


def build_gmail_alias_address(address: str, tag: str) -> str:
    text = str(address or "").strip().lower()
    if "@" not in text:
        raise RuntimeError(f"invalid gmail address for alias mode: {address}")
    local, domain = text.split("@", 1)
    if domain != "gmail.com":
        raise RuntimeError(f"gmail alias mode requires @gmail.com account: {address}")
    local_base = local.split("+", 1)[0]
    clean_tag = re.sub(r"[^a-z0-9-]+", "-", str(tag or "").strip().lower()).strip("-")
    if not clean_tag:
        clean_tag = "mail-live"
    return f"{local_base}+{clean_tag}@{domain}"


def mask_secret_text(raw: str, secrets_to_mask: list[str]) -> str:
    text = str(raw or "")
    for secret in secrets_to_mask:
        value = str(secret or "")
        if value:
            text = text.replace(value, "***")
    return text


def normalize_error_message(exc: Exception) -> str:
    parts: list[str] = []
    for value in getattr(exc, "args", ()):
        if isinstance(value, bytes):
            parts.append(value.decode("utf-8", errors="replace"))
        else:
            parts.append(str(value))
    text = " | ".join(item for item in parts if item)
    return text or str(exc)


def _account_auth_hint(*, account: MailAccount, error_text: str, channel: str) -> str:
    lower = str(error_text or "").strip().lower()
    email = str(account.address or "").strip().lower()
    if email.endswith("@gmail.com"):
        if (
            "application-specific password required" in lower
            or "invalid credentials" in lower
            or "authenticationfailed" in lower
        ):
            return (
                "Gmail account requires 2-step verification and an App Password (16 chars)."
                f" Set MAIL_LIVE_GMAIL*_PASSWORD to the App Password. (channel={channel})"
            )
    if email.endswith("@naver.com"):
        if "authentication failed" in lower or "[auth]" in lower or "invalid credentials" in lower:
            return (
                "Enable IMAP/SMTP in Naver mail settings and verify external app access is allowed."
                " Use a mail-specific password if your account policy requires one."
                f" (channel={channel})"
            )
    return ""


def _with_account_auth_hint(*, account: MailAccount, error_text: str, channel: str) -> str:
    hint = _account_auth_hint(account=account, error_text=error_text, channel=channel)
    if not hint:
        return error_text
    return f"{error_text} | hint: {hint}"


def pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((BACKEND_HOST, 0))
        return int(sock.getsockname()[1])


def wait_backend_ready(base_url: str, timeout_sec: int = 60) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with urlopen(f"{base_url}/healthz", timeout=2) as response:  # noqa: S310
                if int(response.status) == 200:
                    return
        except URLError:
            pass
        except Exception:
            pass
        time.sleep(0.4)
    raise RuntimeError(f"backend readiness timeout: {base_url}/healthz")


def stop_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["cmd", "/c", "taskkill", "/PID", str(proc.pid), "/T", "/F"],
            cwd=ROOT,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=4)


def http_json(
    *,
    base_url: str,
    path: str,
    method: str,
    payload: dict | None = None,
    token: str | None = None,
    include_body_token: bool = False,
    debug_token_opt_in: bool = False,
) -> dict:
    body = None
    headers = {"Content-Type": "application/json", "Origin": "http://127.0.0.1:3000"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if include_body_token:
        headers["x-auth-token-mode"] = "body"
    if debug_token_opt_in:
        headers["x-debug-token-opt-in"] = "true"
    request = Request(
        url=f"{base_url}{path}",
        data=body,
        headers=headers,
        method=method.upper(),
    )
    try:
        with urlopen(request, timeout=20) as response:  # noqa: S310
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        detail = raw
        try:
            parsed = json.loads(raw) if raw else {}
            detail = (
                parsed.get("error", {}).get("message")
                or parsed.get("message")
                or parsed.get("detail")
                or raw
            )
        except Exception:
            pass
        raise RuntimeError(f"{method.upper()} {path} failed({exc.code}): {detail}") from exc


def expect_http_error(
    *,
    base_url: str,
    path: str,
    method: str,
    expected_status: int,
    expected_code: str | None = None,
    payload: dict | None = None,
    token: str | None = None,
    include_body_token: bool = False,
    debug_token_opt_in: bool = False,
) -> dict:
    body = None
    headers = {"Content-Type": "application/json", "Origin": "http://127.0.0.1:3000"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if include_body_token:
        headers["x-auth-token-mode"] = "body"
    if debug_token_opt_in:
        headers["x-debug-token-opt-in"] = "true"
    request = Request(
        url=f"{base_url}{path}",
        data=body,
        headers=headers,
        method=method.upper(),
    )
    try:
        with urlopen(request, timeout=20) as response:  # noqa: S310
            raw = response.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"{method.upper()} {path} expected {expected_status} but succeeded({int(response.status)}): {raw}"
            )
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        parsed: dict = {}
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = {}
        if int(exc.code) != int(expected_status):
            raise RuntimeError(
                f"{method.upper()} {path} expected {expected_status} but got {int(exc.code)}: {raw}"
            ) from exc
        if expected_code is not None:
            code = str((parsed.get("error") or {}).get("code") or "").strip()
            if code != expected_code:
                raise RuntimeError(
                    f"{method.upper()} {path} expected error code {expected_code} but got {code or '<empty>'}"
                )
        return parsed


def open_imap(account: MailAccount) -> imaplib.IMAP4:
    if account.imap_ssl:
        client: imaplib.IMAP4 = imaplib.IMAP4_SSL(account.imap_host, account.imap_port)
    else:
        client = imaplib.IMAP4(account.imap_host, account.imap_port)
    try:
        client.login(account_auth_address(account), account.password)
    except imaplib.IMAP4.error as exc:
        message = _with_account_auth_hint(
            account=account,
            error_text=normalize_error_message(exc),
            channel="imap",
        )
        raise RuntimeError(message) from exc
    except Exception as exc:  # noqa: BLE001
        message = _with_account_auth_hint(
            account=account,
            error_text=normalize_error_message(exc),
            channel="imap",
        )
        raise RuntimeError(message) from exc
    return client


def probe_smtp_auth(account: MailAccount) -> None:
    tls_context = ssl.create_default_context()
    if account.smtp_ssl:
        transport = smtplib.SMTP_SSL(account.smtp_host, account.smtp_port, timeout=15, context=tls_context)
    else:
        transport = smtplib.SMTP(account.smtp_host, account.smtp_port, timeout=15)
    try:
        transport.ehlo()
        if account.smtp_starttls and not account.smtp_ssl:
            transport.starttls(context=tls_context)
            transport.ehlo()
        if account.smtp_auth_enabled:
            auth_address = account_auth_address(account)
            if not auth_address:
                raise RuntimeError("smtp auth enabled but auth address is empty")
            if not account.password:
                raise RuntimeError("smtp auth enabled but password is empty")
            transport.login(auth_address, account.password)
    except Exception as exc:  # noqa: BLE001
        message = _with_account_auth_hint(
            account=account,
            error_text=normalize_error_message(exc),
            channel="smtp",
        )
        raise RuntimeError(message) from exc
    finally:
        try:
            transport.quit()
        except Exception:  # noqa: BLE001
            pass


def run_mail_account_preflight(rounds: list[LiveRound], *, skip_imap_checks: bool = False) -> None:
    if skip_imap_checks:
        print(
            "[mail-live-e2e] preflight skipped: IMAP checks disabled (debug-token mode)",
            flush=True,
        )
        return
    imap_checked: set[tuple[str, str, int, bool]] = set()
    failures: list[str] = []
    for round_cfg in rounds:
        for account in (round_cfg.inviter, round_cfg.invitee):
            imap_key = (
                account_auth_address(account).lower(),
                account.imap_host,
                int(account.imap_port),
                bool(account.imap_ssl),
            )
            if imap_key in imap_checked:
                continue
            imap_checked.add(imap_key)
            try:
                latest_uid(account)
            except Exception as exc:  # noqa: BLE001
                failures.append(
                    f"IMAP preflight failed account={mask_email(account.address)}: {normalize_error_message(exc)}"
                )
    if failures:
        summary = "\n".join(f"- {item}" for item in failures)
        raise RuntimeError(f"mail account preflight failed:\n{summary}")
    print(
        "[mail-live-e2e] preflight passed: recipient IMAP checks succeeded",
        flush=True,
    )


def latest_uid(account: MailAccount) -> int:
    client = open_imap(account)
    try:
        status, _ = client.select("INBOX", readonly=True)
        if status != "OK":
            return 0
        status, data = client.uid("SEARCH", None, "ALL")
        if status != "OK" or not data or not data[0]:
            return 0
        raw_uids = [part for part in data[0].split() if part]
        if not raw_uids:
            return 0
        return max(int(item) for item in raw_uids)
    finally:
        try:
            client.logout()
        except Exception:
            pass


def message_text(payload_bytes: bytes) -> str:
    message = BytesParser(policy=policy.default).parsebytes(payload_bytes)
    chunks: list[str] = []
    if message.is_multipart():
        for part in message.walk():
            content_type = str(part.get_content_type() or "").lower()
            if content_type not in {"text/plain", "text/html"}:
                continue
            raw = part.get_payload(decode=True)
            if raw is None:
                continue
            charset = part.get_content_charset() or "utf-8"
            chunks.append(raw.decode(charset, errors="replace"))
    else:
        raw = message.get_payload(decode=True)
        if raw is not None:
            charset = message.get_content_charset() or "utf-8"
            chunks.append(raw.decode(charset, errors="replace"))
    return "\n".join(chunks)


def message_recipients(payload_bytes: bytes) -> list[str]:
    message = BytesParser(policy=policy.default).parsebytes(payload_bytes)
    fields = []
    fields.extend(message.get_all("to", []))
    fields.extend(message.get_all("cc", []))
    fields.extend(message.get_all("delivered-to", []))
    addresses = []
    for _, addr in getaddresses(fields):
        text = str(addr or "").strip().lower()
        if text:
            addresses.append(text)
    return addresses


def _extract_token_from_url(url: str, token_key: str) -> MailToken | None:
    parsed = urlparse(str(url or "").strip())
    query_values = parse_qs(parsed.query).get(token_key) or []
    if query_values:
        return MailToken(
            token=unquote_plus(str(query_values[0])),
            source_url=url,
            source_part="query",
        )
    fragment_values = parse_qs(str(parsed.fragment or "").lstrip("?")).get(token_key) or []
    if fragment_values:
        return MailToken(
            token=unquote_plus(str(fragment_values[0])),
            source_url=url,
            source_part="fragment",
        )
    return None


def extract_token_from_text(text: str, token_key: str) -> MailToken | None:
    for match in EMAIL_BODY_URL_PATTERN.findall(str(text or "")):
        extracted = _extract_token_from_url(match.strip(), token_key)
        if extracted is not None:
            return extracted
    fallback = re.search(rf"{re.escape(token_key)}=([A-Za-z0-9._%\\-]+)", str(text or ""))
    if fallback:
        return MailToken(
            token=unquote_plus(str(fallback.group(1))),
            source_url=None,
            source_part="text",
        )
    return None


def wait_token(
    *,
    account: MailAccount,
    token_key: str,
    min_uid: int,
    expected_recipient: str,
    timeout_sec: int,
) -> MailToken:
    deadline = time.time() + timeout_sec
    search_clause = f"UID {int(min_uid) + 1}:*"
    expected = str(expected_recipient or "").strip().lower()
    while time.time() < deadline:
        try:
            client = open_imap(account)
            try:
                status, _ = client.select("INBOX", readonly=True)
                if status != "OK":
                    time.sleep(2)
                    continue
                status, data = client.uid("SEARCH", None, search_clause)
                if status != "OK" or not data or not data[0]:
                    time.sleep(2)
                    continue
                raw_uids = [part for part in data[0].split() if part]
                for uid in reversed(raw_uids):
                    status, fetched = client.uid("FETCH", uid, "(RFC822)")
                    if status != "OK" or not fetched:
                        continue
                    payload_bytes = b""
                    for row in fetched:
                        if isinstance(row, tuple) and len(row) >= 2:
                            payload_bytes = row[1]
                            break
                    if not payload_bytes:
                        continue
                    recipients = message_recipients(payload_bytes)
                    if expected and recipients and expected not in recipients:
                        continue
                    token = extract_token_from_text(message_text(payload_bytes), token_key)
                    if token:
                        return token
            finally:
                try:
                    client.logout()
                except Exception:
                    pass
        except Exception:
            # IMAP transient errors are expected in live environments.
            pass
        time.sleep(3)
    raise RuntimeError(
        f"mail token timeout: account={mask_email(account.address)} key={token_key} window={timeout_sec}s"
    )


def ensure_verified_account(
    *,
    base_url: str,
    account: MailAccount,
    app_password: str,
    display_name: str,
    timeout_sec: int,
    use_debug_tokens: bool,
) -> str:
    before_uid = 0
    if not use_debug_tokens:
        before_uid = latest_uid(account)
    register_payload = http_json(
        base_url=base_url,
        path="/api/v1/auth/register",
        method="POST",
        payload={
            "email": account.address,
            "password": app_password,
            "display_name": display_name,
            "remember_me": True,
        },
        include_body_token=True,
        debug_token_opt_in=use_debug_tokens,
    )
    status = str(register_payload.get("status") or "").strip().lower()
    if status == "registered" and register_payload.get("access_token"):
        return str(register_payload["access_token"])
    if status != "verification_required":
        raise RuntimeError(
            f"unexpected register status for {mask_email(account.address)}: {register_payload}"
        )
    debug_verification_token = str(register_payload.get("debug_verification_token") or "").strip()
    if use_debug_tokens and debug_verification_token:
        verify_token = MailToken(
            token=debug_verification_token,
            source_url=None,
            source_part="debug",
        )
    else:
        verify_token = wait_token(
            account=account,
            token_key="verify_token",
            min_uid=before_uid,
            expected_recipient=account.address,
            timeout_sec=timeout_sec,
        )
    if verify_token.source_part not in {"fragment", "debug"}:
        raise RuntimeError(
            "verification link token policy mismatch:"
            f" expected fragment/debug token but got {verify_token.source_part}"
        )
    verify_payload = http_json(
        base_url=base_url,
        path="/api/v1/auth/verify-email",
        method="POST",
        payload={
            "token": verify_token.token,
            "password": app_password,
            "display_name": display_name,
            "remember_me": True,
        },
        include_body_token=True,
    )
    access_token = str(verify_payload.get("access_token") or "").strip()
    if not access_token:
        raise RuntimeError(f"verify-email missing access_token for {mask_email(account.address)}")
    return access_token


def run_round(
    round_cfg: LiveRound,
    app_password: str,
    timeout_sec: int,
    *,
    use_debug_tokens: bool,
    send_only: bool,
) -> None:
    backend_port = pick_free_port()
    base_url = f"http://{BACKEND_HOST}:{backend_port}"
    db_path = ROOT / "e2e" / f"mail_live_{uuid.uuid4().hex}.db"
    db_url = f"sqlite:///./e2e/{db_path.name}"
    env = os.environ.copy()
    env.update(
        {
            "ENV": "test",
            "SECRET_KEY": secrets.token_urlsafe(48),
            "DATABASE_URL": db_url,
            "EMAIL_DELIVERY_MODE": "smtp",
            "SMTP_HOST": round_cfg.smtp.smtp_host,
            "SMTP_PORT": str(round_cfg.smtp.smtp_port),
            "SMTP_USER": account_auth_address(round_cfg.smtp) if round_cfg.smtp.smtp_auth_enabled else "",
            "SMTP_PASS": round_cfg.smtp.password if round_cfg.smtp.smtp_auth_enabled else "",
            "SMTP_STARTTLS": "true" if round_cfg.smtp.smtp_starttls else "false",
            "SMTP_SSL": "true" if round_cfg.smtp.smtp_ssl else "false",
            "SMTP_FROM_EMAIL": round_cfg.smtp.address,
            "SMTP_FROM_NAME": f"money-flow-live-{round_cfg.smtp.name}",
            "AUTH_EMAIL_VERIFICATION_REQUIRED": "true",
            "AUTH_DEBUG_RETURN_VERIFY_TOKEN": "true" if use_debug_tokens else "false",
            "FRONTEND_BASE_URL": "http://127.0.0.1:3000",
        }
    )
    print(
        "[mail-live-e2e] round start:"
        f" {round_cfg.name} | smtp={round_cfg.smtp.name} | inviter={mask_email(round_cfg.inviter.address)}"
        f" | invitee={mask_email(round_cfg.invitee.address)}",
        flush=True,
    )
    backend_logs = parse_bool_env("MAIL_LIVE_BACKEND_LOGS", False)
    backend_proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--app-dir",
            "backend",
            "--host",
            BACKEND_HOST,
            "--port",
            str(backend_port),
            "--use-colors",
        ],
        cwd=ROOT,
        env=env,
        creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0),
        stdout=None if backend_logs else subprocess.DEVNULL,
        stderr=None if backend_logs else subprocess.DEVNULL,
    )
    try:
        wait_backend_ready(base_url, timeout_sec=90)
        inviter_token = ensure_verified_account(
            base_url=base_url,
            account=round_cfg.inviter,
            app_password=app_password,
            display_name=f"{round_cfg.inviter.name}-inviter",
            timeout_sec=timeout_sec,
            use_debug_tokens=use_debug_tokens,
        )
        invitee_token = ensure_verified_account(
            base_url=base_url,
            account=round_cfg.invitee,
            app_password=app_password,
            display_name=f"{round_cfg.invitee.name}-invitee",
            timeout_sec=timeout_sec,
            use_debug_tokens=use_debug_tokens,
        )
        if send_only:
            print(
                f"[mail-live-e2e] send-only round passed: {round_cfg.name}"
                " (verification mails dispatched)",
                flush=True,
            )
            return

        before_invite_uid = 0
        if not use_debug_tokens:
            before_invite_uid = latest_uid(round_cfg.invitee)
        invitation_created = http_json(
            base_url=base_url,
            path="/api/v1/household/invitations",
            method="POST",
            payload={"email": round_cfg.invitee.address, "role": "viewer"},
            token=inviter_token,
            include_body_token=use_debug_tokens,
            debug_token_opt_in=use_debug_tokens,
        )
        debug_invite_token = str(invitation_created.get("debug_invite_token") or "").strip()
        if use_debug_tokens and debug_invite_token:
            invite_token = MailToken(
                token=debug_invite_token,
                source_url=None,
                source_part="debug",
            )
        else:
            invite_token = wait_token(
                account=round_cfg.invitee,
                token_key="invite_token",
                min_uid=before_invite_uid,
                expected_recipient=round_cfg.invitee.address,
                timeout_sec=timeout_sec,
            )
        if invite_token.source_part not in {"fragment", "debug"}:
            raise RuntimeError(
                "invitation link token policy mismatch:"
                f" expected fragment/debug token but got {invite_token.source_part}"
            )
        accepted = http_json(
            base_url=base_url,
            path="/api/v1/household/invitations/accept",
            method="POST",
            payload={"token": invite_token.token},
            token=invitee_token,
        )
        invited_household_id = str(accepted.get("household_id") or "").strip()
        if not invited_household_id:
            raise RuntimeError("invite accept response missing household_id")
        members = http_json(
            base_url=base_url,
            path="/api/v1/household/members",
            method="GET",
            token=inviter_token,
        )
        member_emails = {str(item.get("email") or "").lower() for item in list(members or [])}
        if round_cfg.invitee.address.lower() not in member_emails:
            raise RuntimeError(
                "invite acceptance verification failed:"
                f" {mask_email(round_cfg.invitee.address)} missing from member list"
            )
        selected = http_json(
            base_url=base_url,
            path="/api/v1/household/select",
            method="POST",
            payload={"household_id": invited_household_id},
            token=invitee_token,
        )
        selected_role = str(selected.get("role") or "").strip().lower()
        if selected_role != "viewer":
            raise RuntimeError(
                "invitee role mismatch after household select:"
                f" expected viewer but got {selected_role or '<empty>'}"
            )
        current = http_json(
            base_url=base_url,
            path="/api/v1/household/current",
            method="GET",
            token=invitee_token,
        )
        current_role = str(current.get("role") or "").strip().lower()
        current_household_id = str((current.get("household") or {}).get("id") or "").strip()
        if current_role != "viewer":
            raise RuntimeError(
                "invitee current role mismatch:"
                f" expected viewer but got {current_role or '<empty>'}"
            )
        if current_household_id != invited_household_id:
            raise RuntimeError(
                "invitee active household mismatch:"
                f" expected {invited_household_id} but got {current_household_id or '<empty>'}"
            )

        tx_payload = {
            "occurred_on": str(time.strftime("%Y-%m-%d")),
            "flow_type": "expense",
            "amount": 1000,
            "currency": "KRW",
            "memo": f"mail-live-owner-write-{round_cfg.name}",
        }
        created_tx = http_json(
            base_url=base_url,
            path="/api/v1/transactions",
            method="POST",
            payload=tx_payload,
            token=inviter_token,
        )
        created_tx_id = str(created_tx.get("id") or "").strip()
        if not created_tx_id:
            raise RuntimeError("owner write action verification failed: transaction id missing")

        tx_list = http_json(
            base_url=base_url,
            path="/api/v1/transactions?limit=50",
            method="GET",
            token=invitee_token,
        )
        if not isinstance(tx_list, list):
            raise RuntimeError("viewer read action verification failed: transaction list payload is not a list")

        expect_http_error(
            base_url=base_url,
            path="/api/v1/transactions",
            method="POST",
            payload={
                "occurred_on": str(time.strftime("%Y-%m-%d")),
                "flow_type": "expense",
                "amount": 777,
                "currency": "KRW",
                "memo": f"mail-live-viewer-write-forbidden-{round_cfg.name}",
            },
            token=invitee_token,
            expected_status=403,
            expected_code="HOUSEHOLD_ROLE_FORBIDDEN",
        )
        expect_http_error(
            base_url=base_url,
            path="/api/v1/household/invitations",
            method="POST",
            payload={"email": f"mail-live-forbidden-{uuid.uuid4().hex}@example.com", "role": "viewer"},
            token=invitee_token,
            expected_status=403,
            expected_code="HOUSEHOLD_ROLE_FORBIDDEN",
        )
        print(f"[mail-live-e2e] round passed: {round_cfg.name}", flush=True)
    finally:
        stop_process(backend_proc)
        if db_path.exists():
            try:
                db_path.unlink()
            except Exception:
                pass


def _build_gmail_account(
    *,
    name: str,
    email_env: str,
    password_env: str,
    required: bool,
) -> MailAccount | None:
    email = require_env(email_env) if required else read_optional_env(email_env)
    password = require_env(password_env) if required else read_optional_env(password_env)
    if not email and not password:
        return None
    if not email or not password:
        missing = email_env if not email else password_env
        raise RuntimeError(f"incomplete optional gmail account config: missing {missing}")
    return MailAccount(
        name=name,
        address=email,
        password=password,
        imap_host=os.environ.get("MAIL_LIVE_GMAIL_IMAP_HOST", "imap.gmail.com"),
        imap_port=int(os.environ.get("MAIL_LIVE_GMAIL_IMAP_PORT", "993")),
        imap_ssl=parse_bool_env("MAIL_LIVE_GMAIL_IMAP_SSL", True),
        smtp_host=os.environ.get("MAIL_LIVE_GMAIL_SMTP_HOST", "smtp.gmail.com"),
        smtp_port=int(os.environ.get("MAIL_LIVE_GMAIL_SMTP_PORT", "587")),
        smtp_starttls=parse_bool_env("MAIL_LIVE_GMAIL_SMTP_STARTTLS", True),
        smtp_ssl=parse_bool_env("MAIL_LIVE_GMAIL_SMTP_SSL", False),
        auth_address=email,
    )


def _build_naver_account(*, required: bool) -> MailAccount | None:
    if required:
        naver_email = require_env("MAIL_LIVE_NAVER_EMAIL")
        naver_password = require_env("MAIL_LIVE_NAVER_PASSWORD")
    else:
        naver_email = read_optional_env("MAIL_LIVE_NAVER_EMAIL")
        naver_password = read_optional_env("MAIL_LIVE_NAVER_PASSWORD")
        if not naver_email and not naver_password:
            return None
        if not naver_email or not naver_password:
            missing = "MAIL_LIVE_NAVER_EMAIL" if not naver_email else "MAIL_LIVE_NAVER_PASSWORD"
            raise RuntimeError(f"incomplete optional naver account config: missing {missing}")
    return MailAccount(
        name="naver",
        address=naver_email,
        password=naver_password,
        imap_host=os.environ.get("MAIL_LIVE_NAVER_IMAP_HOST", "imap.naver.com"),
        imap_port=int(os.environ.get("MAIL_LIVE_NAVER_IMAP_PORT", "993")),
        imap_ssl=parse_bool_env("MAIL_LIVE_NAVER_IMAP_SSL", True),
        smtp_host=os.environ.get("MAIL_LIVE_NAVER_SMTP_HOST", "smtp.naver.com"),
        smtp_port=int(os.environ.get("MAIL_LIVE_NAVER_SMTP_PORT", "465")),
        smtp_starttls=parse_bool_env("MAIL_LIVE_NAVER_SMTP_STARTTLS", False),
        smtp_ssl=parse_bool_env("MAIL_LIVE_NAVER_SMTP_SSL", True),
        auth_address=naver_email,
    )


def build_accounts(*, require_naver: bool) -> tuple[list[MailAccount], MailAccount | None]:
    gmail_accounts: list[MailAccount] = []
    primary = _build_gmail_account(
        name="gmail_primary",
        email_env="MAIL_LIVE_GMAIL_EMAIL",
        password_env="MAIL_LIVE_GMAIL_PASSWORD",
        required=True,
    )
    if primary is not None:
        gmail_accounts.append(primary)
    secondary = _build_gmail_account(
        name="gmail_secondary",
        email_env="MAIL_LIVE_GMAIL_SECONDARY_EMAIL",
        password_env="MAIL_LIVE_GMAIL_SECONDARY_PASSWORD",
        required=False,
    )
    if secondary is not None:
        gmail_accounts.append(secondary)
    if not gmail_accounts:
        raise RuntimeError("at least one Gmail account is required for live mail rounds")

    naver = _build_naver_account(required=require_naver)
    return gmail_accounts, naver


def build_dedicated_smtp_sender() -> MailAccount | None:
    smtp_email = read_optional_env("MAIL_LIVE_SMTP_EMAIL")
    smtp_password = read_optional_env("MAIL_LIVE_SMTP_PASSWORD")
    smtp_auth_enabled = parse_bool_env("MAIL_LIVE_SMTP_AUTH_ENABLED", True)
    if not smtp_email and not smtp_password:
        return None
    if not smtp_email:
        missing = "MAIL_LIVE_SMTP_EMAIL"
        raise RuntimeError(f"incomplete dedicated smtp sender config: missing {missing}")
    if smtp_auth_enabled and not smtp_password:
        raise RuntimeError(
            "incomplete dedicated smtp sender config: missing MAIL_LIVE_SMTP_PASSWORD "
            "(or set MAIL_LIVE_SMTP_AUTH_ENABLED=false for no-auth local relay)"
        )
    smtp_auth_email = read_optional_env("MAIL_LIVE_SMTP_AUTH_EMAIL") or smtp_email
    sender_name = read_optional_env("MAIL_LIVE_SMTP_ACCOUNT_LABEL") or "dedicated"
    smtp_host = str(os.environ.get("MAIL_LIVE_SMTP_HOST") or "email-smtp.ap-northeast-2.amazonaws.com").strip()
    smtp_port = int(os.environ.get("MAIL_LIVE_SMTP_PORT") or "587")
    smtp_starttls = parse_bool_env("MAIL_LIVE_SMTP_STARTTLS", True)
    smtp_ssl = parse_bool_env("MAIL_LIVE_SMTP_SSL", False)
    if smtp_ssl and smtp_starttls:
        raise RuntimeError("MAIL_LIVE_SMTP_SSL and MAIL_LIVE_SMTP_STARTTLS cannot both be true")
    # Dedicated sender account is for outbound only; IMAP fields are placeholders.
    return MailAccount(
        name=sender_name,
        address=smtp_email,
        password=smtp_password,
        imap_host=smtp_host,
        imap_port=smtp_port,
        imap_ssl=smtp_ssl,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_starttls=smtp_starttls,
        smtp_ssl=smtp_ssl,
        auth_address=smtp_auth_email if smtp_auth_enabled else None,
        smtp_auth_enabled=smtp_auth_enabled,
    )


def build_cross_provider_rounds(
    *,
    gmail_accounts: list[MailAccount],
    naver: MailAccount,
) -> list[LiveRound]:
    rounds: list[LiveRound] = []
    for gmail in gmail_accounts:
        rounds.append(
            LiveRound(
                name=f"{gmail.name}_to_naver",
                smtp=gmail,
                inviter=gmail,
                invitee=naver,
            )
        )
        rounds.append(
            LiveRound(
                name=f"naver_to_{gmail.name}",
                smtp=gmail,
                inviter=naver,
                invitee=gmail,
            )
        )
    return rounds


def build_gmail_alias_rounds(
    *,
    primary_gmail: MailAccount,
    alias_prefix: str,
) -> list[LiveRound]:
    run_suffix = uuid.uuid4().hex[:8]
    inviter_alias = MailAccount(
        name="gmail_alias_inviter",
        address=build_gmail_alias_address(primary_gmail.address, f"{alias_prefix}-inviter-{run_suffix}"),
        password=primary_gmail.password,
        imap_host=primary_gmail.imap_host,
        imap_port=primary_gmail.imap_port,
        imap_ssl=primary_gmail.imap_ssl,
        smtp_host=primary_gmail.smtp_host,
        smtp_port=primary_gmail.smtp_port,
        smtp_starttls=primary_gmail.smtp_starttls,
        smtp_ssl=primary_gmail.smtp_ssl,
        auth_address=account_auth_address(primary_gmail),
    )
    invitee_alias = MailAccount(
        name="gmail_alias_invitee",
        address=build_gmail_alias_address(primary_gmail.address, f"{alias_prefix}-invitee-{run_suffix}"),
        password=primary_gmail.password,
        imap_host=primary_gmail.imap_host,
        imap_port=primary_gmail.imap_port,
        imap_ssl=primary_gmail.imap_ssl,
        smtp_host=primary_gmail.smtp_host,
        smtp_port=primary_gmail.smtp_port,
        smtp_starttls=primary_gmail.smtp_starttls,
        smtp_ssl=primary_gmail.smtp_ssl,
        auth_address=account_auth_address(primary_gmail),
    )
    return [
        LiveRound(
            name="gmail_alias_inviter_to_invitee",
            smtp=primary_gmail,
            inviter=inviter_alias,
            invitee=invitee_alias,
        ),
        LiveRound(
            name="gmail_alias_invitee_to_inviter",
            smtp=primary_gmail,
            inviter=invitee_alias,
            invitee=inviter_alias,
        ),
    ]


def resolve_smtp_sender(
    *,
    gmail_accounts: list[MailAccount],
    naver: MailAccount | None,
    dedicated_sender: MailAccount | None,
    preferred: str,
    probe_smtp: bool = True,
) -> MailAccount:
    account_map: dict[str, MailAccount] = {account.name: account for account in gmail_accounts}
    if naver is not None:
        account_map["naver"] = naver
    if dedicated_sender is not None:
        account_map["dedicated"] = dedicated_sender
    mode = str(preferred or "auto").strip().lower() or "auto"
    if mode != "auto":
        account = account_map.get(mode)
        if account is None:
            valid_names = ", ".join(sorted(["auto", *account_map.keys()]))
            raise RuntimeError(f"invalid smtp sender: {mode}. valid: {valid_names}")
        if probe_smtp:
            probe_smtp_auth(account)
        print(
            f"[mail-live-e2e] smtp sender selected(explicit): {account.name} ({mask_email(account.address)})"
            + (" [preflight skipped]" if not probe_smtp else ""),
            flush=True,
        )
        return account

    probe_errors: list[str] = []
    candidates = []
    if dedicated_sender is not None:
        candidates.append(dedicated_sender)
    candidates.extend(gmail_accounts)
    if naver is not None:
        candidates.append(naver)
    if not candidates:
        raise RuntimeError("no smtp sender candidates available")
    if not probe_smtp:
        selected = candidates[0]
        print(
            f"[mail-live-e2e] smtp sender selected(auto): {selected.name} ({mask_email(selected.address)}) [preflight skipped]",
            flush=True,
        )
        return selected
    for account in candidates:
        try:
            probe_smtp_auth(account)
            print(
                f"[mail-live-e2e] smtp sender selected(auto): {account.name} ({mask_email(account.address)})",
                flush=True,
            )
            return account
        except Exception as exc:  # noqa: BLE001
            probe_errors.append(
                f"{account.name}({mask_email(account.address)}): {normalize_error_message(exc)}"
            )
    summary = "\n".join(f"- {item}" for item in probe_errors)
    raise RuntimeError(f"smtp sender preflight failed:\n{summary}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run live SMTP+IMAP E2E verification (register email verify + invitation accept)."
    )
    parser.add_argument(
        "--rounds",
        default=os.environ.get("MAIL_LIVE_ROUNDS", "all"),
        help="comma-separated round names or 'all'",
    )
    parser.add_argument(
        "--app-password",
        default=os.environ.get("MAIL_LIVE_APP_PASSWORD", ""),
        help="password used for app account registration (required, not email account password)",
    )
    parser.add_argument(
        "--mail-timeout-sec",
        type=int,
        default=int(os.environ.get("MAIL_LIVE_TIMEOUT_SEC", "240")),
        help="max wait for verification/invite mail arrival",
    )
    parser.add_argument(
        "--smtp-sender",
        default=os.environ.get("MAIL_LIVE_SMTP_SENDER", "auto"),
        help="smtp sender account: auto | dedicated | gmail_primary | gmail_secondary | naver",
    )
    parser.add_argument(
        "--identity-mode",
        default=os.environ.get("MAIL_LIVE_IDENTITY_MODE", "cross_provider"),
        help="identity topology: cross_provider | gmail_alias",
    )
    parser.add_argument(
        "--gmail-alias-prefix",
        default=os.environ.get("MAIL_LIVE_GMAIL_ALIAS_PREFIX", "mail-live-e2e"),
        help="alias prefix used in gmail_alias mode",
    )
    parser.add_argument(
        "--continue-on-fail",
        action="store_true",
        help="continue remaining rounds even if one round fails",
    )
    parser.add_argument(
        "--use-debug-tokens",
        action="store_true",
        default=parse_bool_env("MAIL_LIVE_USE_DEBUG_TOKENS", False),
        help="use debug verification/invite tokens returned by API to bypass IMAP token polling",
    )
    parser.add_argument(
        "--send-only",
        action="store_true",
        default=parse_bool_env("MAIL_LIVE_SEND_ONLY", False),
        help="focus goal on outbound send only (skip invitation flow and force debug-token path)",
    )
    parser.add_argument(
        "--skip-smtp-preflight",
        action="store_true",
        default=parse_bool_env("MAIL_LIVE_SKIP_SMTP_PREFLIGHT", False),
        help="skip smtp login probe before running rounds; use to verify actual send attempts via app path",
    )
    parser.add_argument(
        "--skip-imap-preflight",
        action="store_true",
        default=parse_bool_env("MAIL_LIVE_SKIP_IMAP_PREFLIGHT", False),
        help="skip recipient IMAP preflight checks before running rounds",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    app_password = str(args.app_password or "").strip()
    if not app_password:
        raise RuntimeError("MAIL_LIVE_APP_PASSWORD (or --app-password) is required")
    send_only = bool(args.send_only)
    use_debug_tokens = bool(args.use_debug_tokens)
    if send_only and not use_debug_tokens:
        print(
            "[mail-live-e2e] send-only mode enabled: forcing debug-token path to avoid IMAP token polling",
            flush=True,
        )
        use_debug_tokens = True
    skip_smtp_preflight = bool(args.skip_smtp_preflight) or send_only
    skip_imap_preflight = bool(args.skip_imap_preflight) or use_debug_tokens
    if skip_smtp_preflight:
        print("[mail-live-e2e] smtp preflight skipped by option", flush=True)
    if skip_imap_preflight:
        print("[mail-live-e2e] imap preflight skipped by option", flush=True)
    identity_mode = str(args.identity_mode or "cross_provider").strip().lower() or "cross_provider"
    if identity_mode not in {"cross_provider", "gmail_alias"}:
        raise RuntimeError("MAIL_LIVE_IDENTITY_MODE must be one of: cross_provider, gmail_alias")

    gmail_accounts, naver = build_accounts(require_naver=identity_mode == "cross_provider")
    dedicated_sender = build_dedicated_smtp_sender()
    if identity_mode == "cross_provider":
        if naver is None:
            raise RuntimeError("cross_provider mode requires MAIL_LIVE_NAVER_EMAIL/PASSWORD")
        rounds = build_cross_provider_rounds(gmail_accounts=gmail_accounts, naver=naver)
    else:
        rounds = build_gmail_alias_rounds(
            primary_gmail=gmail_accounts[0],
            alias_prefix=str(args.gmail_alias_prefix or "mail-live-e2e"),
        )

    available_round_names = [round_cfg.name for round_cfg in rounds]
    selected_raw = str(args.rounds or "all").strip().lower()
    if selected_raw != "all":
        selected_names = {item.strip() for item in selected_raw.split(",") if item.strip()}
        rounds = [item for item in rounds if item.name in selected_names]
        if not rounds:
            valid = ", ".join(sorted(available_round_names))
            raise RuntimeError(f"no rounds selected; check --rounds. valid rounds: {valid}")

    secrets_to_mask = [app_password, *[account.password for account in gmail_accounts]]
    if naver is not None:
        secrets_to_mask.append(naver.password)
    if dedicated_sender is not None:
        secrets_to_mask.append(dedicated_sender.password)
    try:
        preferred_sender = str(args.smtp_sender or "auto")
        if identity_mode == "gmail_alias" and preferred_sender.strip().lower() == "auto":
            preferred_sender = "gmail_primary"
        smtp_sender = resolve_smtp_sender(
            gmail_accounts=gmail_accounts,
            naver=naver,
            dedicated_sender=dedicated_sender,
            preferred=preferred_sender,
            probe_smtp=not skip_smtp_preflight,
        )
    except Exception as exc:  # noqa: BLE001
        message = mask_secret_text(str(exc), secrets_to_mask)
        print(f"[mail-live-e2e] smtp sender selection failed: {message}", flush=True)
        return 1
    rounds = [
        LiveRound(
            name=round_cfg.name,
            smtp=smtp_sender,
            inviter=round_cfg.inviter,
            invitee=round_cfg.invitee,
        )
        for round_cfg in rounds
    ]
    print(f"[mail-live-e2e] selected rounds: {', '.join(item.name for item in rounds)}", flush=True)
    try:
        run_mail_account_preflight(rounds, skip_imap_checks=skip_imap_preflight)
    except Exception as exc:  # noqa: BLE001
        message = mask_secret_text(str(exc), secrets_to_mask)
        print(f"[mail-live-e2e] preflight failed: {message}", flush=True)
        return 1
    failures: list[tuple[str, str]] = []
    for round_cfg in rounds:
        try:
            run_round(
                round_cfg=round_cfg,
                app_password=app_password,
                timeout_sec=max(30, int(args.mail_timeout_sec)),
                use_debug_tokens=use_debug_tokens,
                send_only=send_only,
            )
        except Exception as exc:
            message = mask_secret_text(str(exc), secrets_to_mask)
            print(f"[mail-live-e2e] round failed({round_cfg.name}): {message}", flush=True)
            failures.append((round_cfg.name, message))
            if not args.continue_on_fail:
                break

    if failures:
        print("[mail-live-e2e] failure summary:", flush=True)
        for name, message in failures:
            print(f"- {name}: {message}", flush=True)
        return 1
    print("[mail-live-e2e] all rounds passed", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

