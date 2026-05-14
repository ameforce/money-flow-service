from __future__ import annotations

import importlib.util
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "prod_email_smoke.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("prod_email_smoke", MODULE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smoke = _load_module()


PROD_LINK = "https://moneyflow.enmsoftware.com/#verify_token=raw-secret-token"


def test_extracts_prod_hash_verification_link_from_html_email() -> None:
    link = smoke.extract_prod_verification_link(
        f'<a href="{PROD_LINK}">verify</a>',
        base_url="https://moneyflow.enmsoftware.com",
    )

    assert link.raw_url == PROD_LINK
    assert link.token == "raw-secret-token"


def test_extracts_prod_hash_verification_link_from_plain_text_email() -> None:
    link = smoke.extract_prod_verification_link(
        f"Open this link: {PROD_LINK}\n",
        base_url="https://moneyflow.enmsoftware.com",
    )

    assert link.token == "raw-secret-token"


def test_rejects_verification_link_from_non_prod_domain() -> None:
    with pytest.raises(smoke.SmokeValidationError):
        smoke.extract_prod_verification_link(
            "https://dev.moneyflow.enmsoftware.com/#verify_token=raw-secret-token",
            base_url="https://moneyflow.enmsoftware.com",
        )


def test_rejects_query_token_when_hash_fragment_is_required_for_prod() -> None:
    with pytest.raises(smoke.SmokeValidationError):
        smoke.extract_prod_verification_link(
            "https://moneyflow.enmsoftware.com/verify?verify_token=raw-secret-token",
            base_url="https://moneyflow.enmsoftware.com",
        )


def test_redacts_secret_material_from_public_report() -> None:
    payload = {
        "verify_link": PROD_LINK,
        "cookies": {"access_token": "cookie-secret"},
        "SMTP_PASS": "smtp-secret",
        "DATABASE_URL": "postgresql://secret",
        "SECRET_KEY": "app-secret",
        "recipient": "private-smoke+abc@gmail.com",
        "route": {"host_classification": "external-provider", "tls_mode": "starttls"},
    }

    redacted = smoke.redact_public_payload(payload, private_addresses=["private-smoke+abc@gmail.com"])
    rendered = smoke.dumps_public_json(redacted)

    assert "raw-secret-token" not in rendered
    assert "cookie-secret" not in rendered
    assert "smtp-secret" not in rendered
    assert "postgresql://secret" not in rendered
    assert "app-secret" not in rendered
    assert "private-smoke+abc@gmail.com" not in rendered
    assert "pr***************@gmail.com" in rendered
    assert "external-provider" in rendered


def test_mailbox_poll_ignores_messages_before_min_uid_boundary() -> None:
    boundary = datetime.now(UTC)
    old = smoke.MailboxMessage(uid=10, received_at=boundary - timedelta(seconds=1), recipients=["a@example.com"], text=PROD_LINK)
    new = smoke.MailboxMessage(uid=12, received_at=boundary + timedelta(seconds=1), recipients=["a@example.com"], text=PROD_LINK)

    selected = smoke.select_candidate_messages([old, new], min_uid=10, after=boundary, expected_recipient="a@example.com")

    assert selected == [new]


def test_mailbox_poll_requires_expected_recipient_match() -> None:
    boundary = datetime.now(UTC) - timedelta(seconds=1)
    wrong = smoke.MailboxMessage(uid=12, received_at=datetime.now(UTC), recipients=["other@example.com"], text=PROD_LINK)

    selected = smoke.select_candidate_messages([wrong], min_uid=10, after=boundary, expected_recipient="a@example.com")

    assert selected == []


def test_private_ledger_can_store_raw_link_but_public_ledger_cannot() -> None:
    public = smoke.build_public_report(
        base_url="https://moneyflow.enmsoftware.com",
        smoke_email="private-smoke+abc@gmail.com",
        route_summary={"host_classification": "external-provider", "tls_mode": "starttls"},
        verification_link=PROD_LINK,
        auth_me={"email_verified": True, "email": "private-smoke+abc@gmail.com"},
        cleanup={"status": "pending", "target_email": "private-smoke+abc@gmail.com"},
    )
    private = smoke.build_private_ledger(verification_link=PROD_LINK, cookies={"session": "cookie-secret"})

    assert PROD_LINK in smoke.dumps_private_json(private)
    assert PROD_LINK not in smoke.dumps_public_json(public)
    assert "raw-secret-token" not in smoke.dumps_public_json(public)


def test_cleanup_ledger_targets_exact_smoke_email_only() -> None:
    ledger = smoke.build_cleanup_ledger(target_email="private-smoke+abc@gmail.com", before_counts={"users": 1}, after_counts={"users": 0})

    assert ledger["target_email"] == "private-smoke+abc@gmail.com"
    assert ledger["wildcard_delete"] is False
