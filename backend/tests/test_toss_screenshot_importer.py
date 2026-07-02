from __future__ import annotations

import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-toss-import-tests-1234567890")

from app.db.models import FlowType
from app.core.config import settings
from app.schemas import TossImportSummary, TossScreenshotPreviewResponse
from app.services.toss_screenshot_importer import TossCategoryOption, parse_toss_ocr_text


def test_toss_import_settings_have_image_and_ocr_limits() -> None:
    assert settings.toss_import_max_images >= 1
    assert settings.toss_import_max_image_bytes >= 1024 * 1024
    assert ".png" in settings.toss_import_allowed_extensions
    assert settings.toss_import_ocr_timeout_seconds > 0


def test_toss_preview_schema_exposes_rows_candidates_summary_and_issues() -> None:
    response = TossScreenshotPreviewResponse(
        rows=[],
        excluded_candidates=[],
        summary=TossImportSummary(
            image_count=1,
            parsed_rows=0,
            excluded_candidates=0,
            duplicate_candidates=0,
        ),
        issues=[],
    )

    assert response.summary.image_count == 1
    assert response.rows == []
    assert response.excluded_candidates == []


def test_parse_toss_text_groups_duplicates_and_excludes_partial_rows() -> None:
    text = """
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

    result = parse_toss_ocr_text(
        text,
        categories=[
            TossCategoryOption(id="salary", flow_type=FlowType.income, major="급여", minor="월급"),
        ],
        base_year=2026,
    )

    assert len(result.rows) == 3
    duplicate_rows = [row for row in result.rows if row.item_name == "주식회사 카카오"]
    assert len(duplicate_rows) == 2
    assert {row.duplicate_group_id for row in duplicate_rows} == {"dup-1"}
    assert all(row.included is False for row in duplicate_rows)
    assert all(row.exclusion_reason == "duplicate_candidate" for row in duplicate_rows)

    salary = next(row for row in result.rows if row.item_name == "댕: 5월 급여")
    assert salary.occurred_on.isoformat() == "2026-05-22"
    assert salary.time == "12:07"
    assert salary.flow_type == FlowType.income
    assert salary.amount == 4112948
    assert salary.category_id == "salary"
    assert salary.included is True

    assert len(result.excluded_candidates) == 1
    excluded = result.excluded_candidates[0]
    assert excluded.item_name == "DB손08305"
    assert excluded.exclusion_reason == "missing_required_fields"


def test_parse_toss_text_flushes_rows_when_amount_and_balance_share_line() -> None:
    text = """
    5월 22일 금요일
    주식회사 카카오 09:15 -1,900원 4,024,514원
    유튜브프리미엄 14:29 -11,990원 4,062,214원
    """

    result = parse_toss_ocr_text(text, categories=[], base_year=2026)

    assert [row.item_name for row in result.rows] == ["주식회사 카카오", "유튜브프리미엄"]
    assert [row.time for row in result.rows] == ["09:15", "14:29"]
    assert [row.balance for row in result.rows] == [4024514, 4062214]
    assert result.excluded_candidates == []


def test_parse_toss_text_excludes_rows_without_balance() -> None:
    text = """
    5월 31일 일요일
    주식회사 카카오
    09:15
    -1,900원
    """

    result = parse_toss_ocr_text(text, categories=[], base_year=2026)

    assert result.rows == []
    assert len(result.excluded_candidates) == 1
    assert result.excluded_candidates[0].item_name == "주식회사 카카오"
    assert result.excluded_candidates[0].exclusion_reason == "missing_required_fields"


def test_parse_toss_text_reports_invalid_date_headers_as_excluded_candidates() -> None:
    text = """
    13월 40일 일요일
    주식회사 카카오
    09:15
    -1,900원
    4,024,514원
    """

    result = parse_toss_ocr_text(text, categories=[], base_year=2026)

    assert result.rows == []
    assert len(result.excluded_candidates) == 2
    assert result.excluded_candidates[0].exclusion_reason == "invalid_date_header"
    assert result.excluded_candidates[1].exclusion_reason == "missing_required_fields"


def test_category_matching_never_creates_missing_categories() -> None:
    text = """
    5월 31일 일요일
    유튜브프리미엄
    14:29
    -11,990원
    4,062,214원
    """

    result = parse_toss_ocr_text(
        text,
        categories=[
            TossCategoryOption(id="food", flow_type=FlowType.expense, major="생활", minor="식비"),
        ],
        base_year=2026,
    )

    assert len(result.rows) == 1
    row = result.rows[0]
    assert row.category_id is None
    assert row.category_recommendation is not None
    assert row.category_recommendation.create_allowed is False
    assert row.category_recommendation.suggested_major
    assert row.category_recommendation.suggested_minor
