from __future__ import annotations

import hashlib
import hmac
import io
import os
from pathlib import Path
import time
from types import SimpleNamespace
from typing import Any
import uuid

from fastapi.testclient import TestClient as FastAPITestClient

TEST_DB_PATH = Path(__file__).resolve().parent / f"test_toss_api_{uuid.uuid4().hex}.db"
os.environ.setdefault("DATABASE_URL", f"sqlite:///{TEST_DB_PATH.as_posix()}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-toss-import-api-tests-1234567890")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("AUTH_DEBUG_RETURN_VERIFY_TOKEN", "true")
os.environ.setdefault("AUTH_COOKIE_SECURE", "false")


class TestClient(FastAPITestClient):
    def request(self, method: str, url: str, **kwargs):  # type: ignore[override]
        return super().request(method, url, **kwargs)


TEST_REQUEST_ORIGIN = "http://127.0.0.1:5173"


def _base_test_headers() -> dict[str, str]:
    return {"origin": TEST_REQUEST_ORIGIN, "x-debug-token-opt-in": "true"}


from app.api.routes import imports as imports_route  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.db.models import Category, FlowType, Transaction  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services.toss_screenshot_importer import TossOcrUnavailableError, parse_toss_ocr_text  # noqa: E402


def _issued_access_token(client: TestClient, payload: dict[str, Any]) -> str:
    token = str(payload.get("access_token") or "").strip()
    if token:
        return token
    cookie_token = str(client.cookies.get(settings.auth_access_cookie_name) or "").strip()
    assert cookie_token
    return cookie_token


def _auth(client: TestClient, email: str, password: str = "Password1234") -> str:
    display_name = f"Toss Importer {email.split('@', 1)[0][-12:]}"
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "display_name": display_name},
        headers=_base_test_headers(),
    )
    assert response.status_code in (200, 201)
    payload = response.json()
    if payload.get("status") == "verification_required":
        verified = client.post(
            "/api/v1/auth/verify-email",
            json={
                "token": payload["debug_verification_token"],
                "password": password,
                "display_name": display_name,
                "remember_me": True,
            },
            headers=_base_test_headers(),
        )
        assert verified.status_code == 200
        return _issued_access_token(client, verified.json())
    return _issued_access_token(client, payload)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", **_base_test_headers()}


def _household_id(client: TestClient, token: str) -> str:
    response = client.get("/api/v1/household/current", headers=_headers(token))
    assert response.status_code == 200
    return str(response.json()["household"]["id"])


def _create_category(household_id: str, flow_type: FlowType, major: str, minor: str) -> str:
    with SessionLocal() as db:
        category = Category(
            household_id=household_id,
            flow_type=flow_type,
            major=major,
            minor=minor,
        )
        db.add(category)
        db.commit()
        db.refresh(category)
        return str(category.id)


def _counts(household_id: str) -> tuple[int, int]:
    with SessionLocal() as db:
        transaction_count = db.query(Transaction).filter(Transaction.household_id == household_id).count()
        category_count = db.query(Category).filter(Category.household_id == household_id).count()
        return int(transaction_count), int(category_count)


def _toss_source_ref_fields(source_ref: str) -> dict[str, str]:
    signature = hmac.new(settings.secret_key.encode("utf-8"), source_ref.encode("utf-8"), hashlib.sha256).hexdigest()
    return {"source_ref": source_ref, "source_ref_signature": signature}


def teardown_module() -> None:
    engine.dispose()
    if TEST_DB_PATH.exists():
        for _ in range(20):
            try:
                TEST_DB_PATH.unlink()
                break
            except PermissionError:
                time.sleep(0.1)


def test_toss_preview_uses_local_ocr_and_does_not_write(monkeypatch) -> None:
    ocr_calls: list[Path] = []

    def fake_ocr(image_path: Path, **_kwargs) -> str:
        ocr_calls.append(image_path)
        return """
        5월 31일 일요일
        주식회사 카카오
        09:15
        -1,900원
        4,024,514원
        주식회사 카카오
        09:15
        -1,900원
        4,024,514원
        5월 22일 금요일
        댕: 5월 급여
        12:07
        +4,112,948원
        7,436,967원
        DB손08305
        -20,310원
        3,576,229원
        """

    monkeypatch.setattr(
        imports_route,
        "toss_screenshot_importer",
        SimpleNamespace(extract_text_from_image=fake_ocr, parse_toss_ocr_text=parse_toss_ocr_text),
        raising=False,
    )

    with TestClient(app) as client:
        token = _auth(client, f"toss-preview-{uuid.uuid4().hex}@example.com")
        household_id = _household_id(client, token)
        _create_category(household_id, FlowType.income, "급여", "월급")
        before_counts = _counts(household_id)

        response = client.post(
            "/api/v1/imports/toss-screenshots/preview",
            headers=_headers(token),
            files=[("files", ("toss.png", io.BytesIO(b"fake-png"), "image/png"))],
        )

        assert response.status_code == 200
        payload = response.json()
        assert len(ocr_calls) == 1
        assert payload["summary"] == {
            "image_count": 1,
            "parsed_rows": 3,
            "excluded_candidates": 1,
            "duplicate_candidates": 2,
        }
        assert _counts(household_id) == before_counts
        duplicate_rows = [row for row in payload["rows"] if row["item_name"] == "주식회사 카카오"]
        assert len(duplicate_rows) == 2
        assert all(row["included"] is False for row in duplicate_rows)
        assert all(row["exclusion_reason"] == "duplicate_candidate" for row in duplicate_rows)
        salary = next(row for row in payload["rows"] if row["item_name"] == "댕: 5월 급여")
        assert str(salary["source_ref"]).startswith("toss:")
        assert salary["source_ref_signature"]
        assert salary["category_id"] is not None
        assert salary["included"] is True


def test_toss_preview_marks_duplicates_across_uploaded_images(monkeypatch) -> None:
    def fake_ocr(_image_path: Path, **_kwargs) -> str:
        return """
        5월 22일 금요일
        주식회사 카카오
        09:15
        -1,900원
        4,024,514원
        """

    monkeypatch.setattr(
        imports_route,
        "toss_screenshot_importer",
        SimpleNamespace(extract_text_from_image=fake_ocr, parse_toss_ocr_text=parse_toss_ocr_text),
        raising=False,
    )

    with TestClient(app) as client:
        token = _auth(client, f"toss-cross-image-duplicate-{uuid.uuid4().hex}@example.com")

        response = client.post(
            "/api/v1/imports/toss-screenshots/preview",
            headers=_headers(token),
            files=[
                ("files", ("toss-1.png", io.BytesIO(b"fake-png-1"), "image/png")),
                ("files", ("toss-2.png", io.BytesIO(b"fake-png-2"), "image/png")),
            ],
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["summary"]["parsed_rows"] == 2
        assert payload["summary"]["duplicate_candidates"] == 2
        assert {row["duplicate_group_id"] for row in payload["rows"]} == {"dup-1"}
        assert all(row["included"] is False for row in payload["rows"])
        assert all(row["exclusion_reason"] == "duplicate_candidate" for row in payload["rows"])


def test_toss_preview_rejects_viewers_and_invalid_images(monkeypatch) -> None:
    monkeypatch.setattr(
        imports_route,
        "toss_screenshot_importer",
        SimpleNamespace(extract_text_from_image=lambda *_args, **_kwargs: "", parse_toss_ocr_text=parse_toss_ocr_text),
        raising=False,
    )

    with TestClient(app) as client:
        owner_token = _auth(client, f"toss-owner-{uuid.uuid4().hex}@example.com")
        viewer_email = f"toss-viewer-{uuid.uuid4().hex}@example.com"
        viewer_token = _auth(client, viewer_email)

        invited = client.post(
            "/api/v1/household/invitations",
            headers=_headers(owner_token),
            json={"email": viewer_email, "role": "viewer"},
        )
        assert invited.status_code == 201
        accepted = client.post(
            "/api/v1/household/invitations/accept",
            headers=_headers(viewer_token),
            json={"token": invited.json()["debug_invite_token"]},
        )
        assert accepted.status_code == 200
        selected = client.post(
            "/api/v1/household/select",
            headers=_headers(viewer_token),
            json={"household_id": accepted.json()["household_id"]},
        )
        assert selected.status_code == 200

        forbidden = client.post(
            "/api/v1/imports/toss-screenshots/preview",
            headers=_headers(viewer_token),
            files=[("files", ("toss.png", io.BytesIO(b"fake-png"), "image/png"))],
        )
        assert forbidden.status_code == 403
        assert forbidden.json()["error"]["code"] == "HOUSEHOLD_ROLE_FORBIDDEN"

        invalid_extension = client.post(
            "/api/v1/imports/toss-screenshots/preview",
            headers=_headers(owner_token),
            files=[("files", ("toss.txt", io.BytesIO(b"fake-text"), "text/plain"))],
        )
        assert invalid_extension.status_code == 400
        assert invalid_extension.json()["error"]["code"] == "TOSS_IMPORT_IMAGE_EXTENSION_INVALID"


def test_toss_preview_reports_local_ocr_unavailable_without_raw_text(monkeypatch) -> None:
    def missing_ocr(*_args, **_kwargs):
        raise TossOcrUnavailableError("raw local path C:/secret/toss.png")

    monkeypatch.setattr(
        imports_route,
        "toss_screenshot_importer",
        SimpleNamespace(extract_text_from_image=missing_ocr, parse_toss_ocr_text=parse_toss_ocr_text),
        raising=False,
    )

    with TestClient(app) as client:
        token = _auth(client, f"toss-ocr-{uuid.uuid4().hex}@example.com")
        response = client.post(
            "/api/v1/imports/toss-screenshots/preview",
            headers=_headers(token),
            files=[("files", ("toss.png", io.BytesIO(b"fake-png"), "image/png"))],
        )

        assert response.status_code == 503
        error = response.json()["error"]
        assert error["code"] == "TOSS_OCR_UNAVAILABLE"
        assert "secret" not in error["message"].lower()
        assert "secret" not in error["action"].lower()


def test_toss_apply_creates_only_included_rows_without_creating_categories() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"toss-apply-{uuid.uuid4().hex}@example.com")
        household_id = _household_id(client, token)
        salary_category_id = _create_category(household_id, FlowType.income, "급여", "월급")
        before_transaction_count, before_category_count = _counts(household_id)

        payload = {
            "rows": [
                {
                    "row_id": "salary-row",
                    "source_image_name": "toss-1.png",
                    "source_image_index": 0,
                    "occurred_on": "2026-05-22",
                    "time": "12:07",
                    "item_name": "댕: 5월 급여",
                    "detail": "",
                    "amount": "4112948",
                    "signed_amount": "4112948",
                    "balance": "7436967",
                    "flow_type": "income",
                    "category_id": salary_category_id,
                    "category_recommendation": None,
                    "included": True,
                    "duplicate_group_id": None,
                    "exclusion_reason": None,
                    **_toss_source_ref_fields("toss:salary-row"),
                },
                {
                    "row_id": "membership-row",
                    "source_image_name": "toss-1.png",
                    "source_image_index": 0,
                    "occurred_on": "2026-05-30",
                    "time": "14:29",
                    "item_name": "유튜브프리미엄",
                    "detail": "",
                    "amount": "11990",
                    "signed_amount": "-11990",
                    "balance": "4062214",
                    "flow_type": "expense",
                    "category_id": None,
                    "category_recommendation": {
                        "suggested_major": "구독",
                        "suggested_minor": "멤버십",
                        "reason": "subscription_keyword",
                        "create_allowed": False,
                    },
                    "included": True,
                    "duplicate_group_id": None,
                    "exclusion_reason": None,
                    **_toss_source_ref_fields("toss:membership-row"),
                },
                {
                    "row_id": "duplicate-row",
                    "source_image_name": "toss-1.png",
                    "source_image_index": 0,
                    "occurred_on": "2026-05-31",
                    "time": "09:15",
                    "item_name": "주식회사 카카오",
                    "detail": "",
                    "amount": "1900",
                    "signed_amount": "-1900",
                    "balance": "4024514",
                    "flow_type": "expense",
                    "category_id": None,
                    "category_recommendation": None,
                    "included": False,
                    "duplicate_group_id": "dup-1",
                    "exclusion_reason": "duplicate_candidate",
                    **_toss_source_ref_fields("toss:duplicate-row"),
                },
            ]
        }

        applied = client.post(
            "/api/v1/imports/toss-screenshots/apply",
            headers=_headers(token),
            json=payload,
        )
        assert applied.status_code == 200
        applied_payload = applied.json()
        assert applied_payload["applied_transactions"] == 2
        assert applied_payload["skipped_transactions"] == 1
        assert len(applied_payload["created_transaction_ids"]) == 2
        assert _counts(household_id) == (before_transaction_count + 2, before_category_count)

        reapplied = client.post(
            "/api/v1/imports/toss-screenshots/apply",
            headers=_headers(token),
            json=payload,
        )
        assert reapplied.status_code == 200
        reapplied_payload = reapplied.json()
        assert reapplied_payload["applied_transactions"] == 0
        assert reapplied_payload["skipped_transactions"] == 3
        assert _counts(household_id) == (before_transaction_count + 2, before_category_count)


def test_toss_apply_uses_preview_source_ref_after_user_edits() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"toss-source-ref-{uuid.uuid4().hex}@example.com")
        household_id = _household_id(client, token)
        before_transaction_count, before_category_count = _counts(household_id)
        source_fields = _toss_source_ref_fields("toss:immutable-source-ref")

        first_payload = {
            "rows": [
                {
                    "row_id": "edited-row",
                    "source_image_name": "toss.png",
                    "source_image_index": 0,
                    "occurred_on": "2026-05-22",
                    "time": "12:07",
                    "item_name": "사용자가 수정한 급여",
                    "detail": "",
                    "amount": "4112948",
                    "signed_amount": "4112948",
                    "balance": "7436967",
                    "flow_type": "income",
                    "category_id": None,
                    "category_recommendation": None,
                    "included": True,
                    "duplicate_group_id": None,
                    "exclusion_reason": None,
                    **source_fields,
                }
            ]
        }
        first_apply = client.post(
            "/api/v1/imports/toss-screenshots/apply",
            headers=_headers(token),
            json=first_payload,
        )
        assert first_apply.status_code == 200
        assert first_apply.json()["applied_transactions"] == 1

        second_payload = {
            "rows": [
                {
                    **first_payload["rows"][0],
                    "item_name": "다시 수정한 급여",
                    "amount": "999999",
                    "signed_amount": "999999",
                }
            ]
        }
        second_apply = client.post(
            "/api/v1/imports/toss-screenshots/apply",
            headers=_headers(token),
            json=second_payload,
        )
        assert second_apply.status_code == 200
        assert second_apply.json()["applied_transactions"] == 0
        assert second_apply.json()["skipped_transactions"] == 1
        assert _counts(household_id) == (before_transaction_count + 1, before_category_count)

        with SessionLocal() as db:
            stored = db.query(Transaction).filter(Transaction.household_id == household_id).one()
            assert stored.source_ref == "toss:immutable-source-ref"
            assert stored.memo == "12:07 | 사용자가 수정한 급여"


def test_toss_apply_appends_same_day_transactions_after_existing_rows() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"toss-order-key-{uuid.uuid4().hex}@example.com")
        existing = client.post(
            "/api/v1/transactions",
            headers=_headers(token),
            json={
                "occurred_on": "2026-05-22",
                "flow_type": "expense",
                "amount": "1000",
                "currency": "KRW",
                "memo": "manual-before-toss",
            },
        )
        assert existing.status_code == 201

        applied = client.post(
            "/api/v1/imports/toss-screenshots/apply",
            headers=_headers(token),
            json={
                "rows": [
                    {
                        "row_id": "same-day-toss-row",
                        "source_image_name": "toss.png",
                        "source_image_index": 0,
                        "occurred_on": "2026-05-22",
                        "time": "12:07",
                        "item_name": "토스카페",
                        "detail": "",
                        "amount": "4500",
                        "signed_amount": "-4500",
                        "balance": "10000",
                        "flow_type": "expense",
                        "category_id": None,
                        "category_recommendation": None,
                        "included": True,
                        "duplicate_group_id": None,
                        "exclusion_reason": None,
                        **_toss_source_ref_fields("toss:same-day-order"),
                    }
                ]
            },
        )
        assert applied.status_code == 200
        assert applied.json()["applied_transactions"] == 1

        listed = client.get("/api/v1/transactions?year=2026&month=5", headers=_headers(token))
        assert listed.status_code == 200
        same_day = [item for item in listed.json() if item["occurred_on"] == "2026-05-22"]
        assert [item["memo"] for item in same_day[:2]] == ["manual-before-toss", "12:07 | 토스카페"]
        assert [item["order_key"] for item in same_day[:2]] == [1024, 2048]


def test_toss_apply_rejects_tampered_source_ref_signature() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"toss-signature-{uuid.uuid4().hex}@example.com")
        source_fields = _toss_source_ref_fields("toss:signed-row")
        source_fields["source_ref_signature"] = "0" * 64

        response = client.post(
            "/api/v1/imports/toss-screenshots/apply",
            headers=_headers(token),
            json={
                "rows": [
                    {
                        "row_id": "signed-row",
                        "source_image_name": "toss.png",
                        "source_image_index": 0,
                        "occurred_on": "2026-05-22",
                        "time": "12:07",
                        "item_name": "급여",
                        "detail": "",
                        "amount": "10000",
                        "signed_amount": "10000",
                        "balance": "10000",
                        "flow_type": "income",
                        "category_id": None,
                        "category_recommendation": None,
                        "included": True,
                        "duplicate_group_id": None,
                        "exclusion_reason": None,
                        **source_fields,
                    }
                ]
            },
        )

        assert response.status_code == 400
        assert response.json()["error"]["code"] == "TOSS_IMPORT_SOURCE_REF_INVALID"


def test_toss_apply_rejects_cross_flow_or_foreign_categories() -> None:
    with TestClient(app) as client:
        token = _auth(client, f"toss-category-{uuid.uuid4().hex}@example.com")
        household_id = _household_id(client, token)
        expense_category_id = _create_category(household_id, FlowType.expense, "생활", "식비")

        mismatch = client.post(
            "/api/v1/imports/toss-screenshots/apply",
            headers=_headers(token),
            json={
                "rows": [
                    {
                        "row_id": "wrong-flow",
                        "source_image_name": "toss.png",
                        "source_image_index": 0,
                        "occurred_on": "2026-05-22",
                        "time": "12:07",
                        "item_name": "급여",
                        "detail": "",
                        "amount": "10000",
                        "signed_amount": "10000",
                        "balance": "10000",
                        "flow_type": "income",
                        "category_id": expense_category_id,
                        "category_recommendation": None,
                        "included": True,
                        "duplicate_group_id": None,
                        "exclusion_reason": None,
                        **_toss_source_ref_fields("toss:wrong-flow"),
                    }
                ]
            },
        )
        assert mismatch.status_code == 400
        assert mismatch.json()["error"]["code"] == "TRANSACTION_CATEGORY_FLOW_TYPE_MISMATCH"

        foreign_token = _auth(client, f"toss-foreign-{uuid.uuid4().hex}@example.com")
        foreign_household_id = _household_id(client, foreign_token)
        foreign_category_id = _create_category(foreign_household_id, FlowType.expense, "생활", "식비")
        invalid = client.post(
            "/api/v1/imports/toss-screenshots/apply",
            headers=_headers(token),
            json={
                "rows": [
                    {
                        "row_id": "foreign-category",
                        "source_image_name": "toss.png",
                        "source_image_index": 0,
                        "occurred_on": "2026-05-22",
                        "time": "12:07",
                        "item_name": "편의점",
                        "detail": "",
                        "amount": "10000",
                        "signed_amount": "-10000",
                        "balance": "10000",
                        "flow_type": "expense",
                        "category_id": foreign_category_id,
                        "category_recommendation": None,
                        "included": True,
                        "duplicate_group_id": None,
                        "exclusion_reason": None,
                        **_toss_source_ref_fields("toss:foreign-category"),
                    }
                ]
            },
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"]["code"] == "CATEGORY_INVALID"
