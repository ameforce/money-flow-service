from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
import hashlib
import re
import subprocess
from pathlib import Path

from app.db.models import FlowType


_DATE_HEADER = re.compile(r"(?P<month>\d{1,2})\s*월\s*(?P<day>\d{1,2})\s*일")
_TIME = re.compile(r"(?P<time>(?:[01]?\d|2[0-3]):[0-5]\d)")
_SIGNED_AMOUNT = re.compile(r"(?P<amount>[+-]\s*\d[\d,]*\s*원)")
_UNSIGNED_AMOUNT = re.compile(r"(?<![+-])\b(?P<amount>\d[\d,]*\s*원)")


class TossOcrError(RuntimeError):
    pass


class TossOcrUnavailableError(TossOcrError):
    pass


@dataclass(frozen=True)
class TossCategoryOption:
    id: str
    flow_type: FlowType
    major: str
    minor: str


@dataclass(frozen=True)
class TossCategoryRecommendation:
    suggested_major: str
    suggested_minor: str
    reason: str
    create_allowed: bool = False


@dataclass
class TossParsedRow:
    row_id: str
    occurred_on: date
    time: str
    item_name: str
    detail: str
    amount: Decimal
    signed_amount: Decimal
    balance: Decimal | None
    flow_type: FlowType
    category_id: str | None
    category_recommendation: TossCategoryRecommendation | None
    included: bool = True
    duplicate_group_id: str | None = None
    exclusion_reason: str | None = None


@dataclass
class TossExcludedCandidate:
    item_name: str
    raw_text: str
    exclusion_reason: str


@dataclass
class TossParseResult:
    rows: list[TossParsedRow]
    excluded_candidates: list[TossExcludedCandidate]


@dataclass
class _PendingRow:
    occurred_on: date | None = None
    item_name: str = ""
    time: str = ""
    detail: str = ""
    signed_amount: Decimal | None = None
    balance: Decimal | None = None
    raw_lines: list[str] | None = None

    def reset(self, *, keep_date: bool = True) -> None:
        current_date = self.occurred_on if keep_date else None
        self.occurred_on = current_date
        self.item_name = ""
        self.time = ""
        self.detail = ""
        self.signed_amount = None
        self.balance = None
        self.raw_lines = []


def parse_toss_ocr_text(
    text: str,
    *,
    categories: list[TossCategoryOption],
    base_year: int,
) -> TossParseResult:
    rows: list[TossParsedRow] = []
    excluded: list[TossExcludedCandidate] = []
    pending = _PendingRow(raw_lines=[])

    for line in _clean_lines(text):
        date_match = _DATE_HEADER.search(line)
        if date_match:
            _flush_pending(pending, rows=rows, excluded=excluded, categories=categories)
            pending.reset(keep_date=False)
            try:
                pending.occurred_on = date(base_year, int(date_match.group("month")), int(date_match.group("day")))
            except ValueError:
                excluded.append(
                    TossExcludedCandidate(
                        item_name=line,
                        raw_text=line,
                        exclusion_reason="invalid_date_header",
                    )
                )
                pending.reset(keep_date=False)
            continue

        if pending.raw_lines is None:
            pending.raw_lines = []
        pending.raw_lines.append(line)

        signed_match = _SIGNED_AMOUNT.search(line)
        time_match = _TIME.search(line)
        if time_match and not pending.time:
            pending.time = _normalize_time(time_match.group("time"))
            before_time = line[: time_match.start()].strip(" |")
            after_time = line[time_match.end() : signed_match.start() if signed_match else len(line)].strip(" |")
            if before_time and not pending.item_name:
                pending.item_name = before_time
            if after_time:
                pending.detail = after_time

        if signed_match:
            if not pending.item_name:
                prefix = line[: signed_match.start()].strip(" |")
                prefix = _TIME.sub("", prefix).strip(" |")
                if prefix:
                    pending.item_name = prefix
            pending.signed_amount = _parse_won(signed_match.group("amount"))
            balance_text = line[signed_match.end() :]
            balance_match = _UNSIGNED_AMOUNT.search(balance_text)
            if balance_match:
                pending.balance = _parse_won(balance_match.group("amount"))
                _flush_pending(pending, rows=rows, excluded=excluded, categories=categories)
                pending.reset()
            continue

        if pending.signed_amount is not None and pending.balance is None:
            unsigned_match = _UNSIGNED_AMOUNT.fullmatch(line)
            if unsigned_match:
                pending.balance = _parse_won(unsigned_match.group("amount"))
                _flush_pending(pending, rows=rows, excluded=excluded, categories=categories)
                pending.reset()
                continue

        if time_match:
            continue

        if _UNSIGNED_AMOUNT.fullmatch(line):
            continue

        if not pending.item_name:
            pending.item_name = line
        elif not pending.detail and pending.time:
            pending.detail = line

    _flush_pending(pending, rows=rows, excluded=excluded, categories=categories)
    _mark_duplicate_groups(rows)
    return TossParseResult(rows=rows, excluded_candidates=excluded)


def extract_text_from_image(
    image_path: Path,
    *,
    executable: str,
    language: str,
    timeout_seconds: float,
) -> str:
    command = [
        str(executable or "tesseract"),
        str(image_path),
        "stdout",
        "-l",
        str(language or "kor+eng"),
        "--psm",
        "6",
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=float(timeout_seconds),
            check=False,
        )
    except FileNotFoundError as error:
        raise TossOcrUnavailableError("Tesseract OCR executable was not found.") from error
    except subprocess.TimeoutExpired as error:
        raise TossOcrError("Tesseract OCR timed out.") from error

    if completed.returncode != 0:
        stderr = str(completed.stderr or "").strip()
        raise TossOcrError(stderr or "Tesseract OCR failed.")
    return str(completed.stdout or "")


def _clean_lines(text: str) -> list[str]:
    return [line.strip() for line in str(text or "").splitlines() if line.strip()]


def _flush_pending(
    pending: _PendingRow,
    *,
    rows: list[TossParsedRow],
    excluded: list[TossExcludedCandidate],
    categories: list[TossCategoryOption],
) -> None:
    if not (pending.item_name or pending.time or pending.signed_amount is not None):
        return
    raw_text = "\n".join(pending.raw_lines or []).strip()
    if (
        pending.occurred_on is None
        or not pending.time
        or not pending.item_name
        or pending.signed_amount is None
        or pending.balance is None
    ):
        excluded.append(
            TossExcludedCandidate(
                item_name=pending.item_name,
                raw_text=raw_text,
                exclusion_reason="missing_required_fields",
            )
        )
        return

    signed_amount = pending.signed_amount
    flow_type = _infer_flow_type(pending.item_name, pending.detail, signed_amount)
    category_id = _match_category_id(
        categories,
        flow_type=flow_type,
        item_name=pending.item_name,
        detail=pending.detail,
    )
    recommendation = None if category_id else _recommend_category(flow_type, pending.item_name, pending.detail)
    row_key = _row_hash(
        str(pending.occurred_on),
        pending.time,
        pending.item_name,
        str(signed_amount),
        str(pending.balance or ""),
    )
    rows.append(
        TossParsedRow(
            row_id=f"toss-row-{row_key[:16]}",
            occurred_on=pending.occurred_on,
            time=pending.time,
            item_name=pending.item_name,
            detail=pending.detail,
            amount=abs(signed_amount),
            signed_amount=signed_amount,
            balance=pending.balance,
            flow_type=flow_type,
            category_id=category_id,
            category_recommendation=recommendation,
        )
    )


def _mark_duplicate_groups(rows: list[TossParsedRow]) -> None:
    grouped: dict[str, list[TossParsedRow]] = {}
    for row in rows:
        key = _row_hash(
            str(row.occurred_on),
            row.time,
            _normalize_key(row.item_name),
            str(row.signed_amount),
            str(row.balance or ""),
        )
        grouped.setdefault(key, []).append(row)

    duplicate_index = 0
    for group_rows in grouped.values():
        if len(group_rows) <= 1:
            continue
        duplicate_index += 1
        group_id = f"dup-{duplicate_index}"
        for row in group_rows:
            row.duplicate_group_id = group_id
            row.included = False
            row.exclusion_reason = "duplicate_candidate"


def _infer_flow_type(item_name: str, detail: str, signed_amount: Decimal) -> FlowType:
    text = f"{item_name} {detail}"
    if any(keyword in text for keyword in ("급여", "캐시백", "환급", "해지 남은금액", "입금")):
        return FlowType.income
    if any(keyword in text for keyword in ("청약", "증권", "주식", "증거금", "공모")):
        return FlowType.investment
    if any(keyword in text for keyword in ("이체", "송금", "모임통장")):
        return FlowType.transfer
    return FlowType.income if signed_amount > 0 else FlowType.expense


def _match_category_id(
    categories: list[TossCategoryOption],
    *,
    flow_type: FlowType,
    item_name: str,
    detail: str,
) -> str | None:
    text = _normalize_key(f"{item_name} {detail}")
    for category in categories:
        if category.flow_type != flow_type:
            continue
        major = _normalize_key(category.major)
        minor = _normalize_key(category.minor)
        if (minor and minor in text) or (major and major in text):
            return category.id
    return None


def _recommend_category(flow_type: FlowType, item_name: str, detail: str) -> TossCategoryRecommendation:
    text = f"{item_name} {detail}"
    if flow_type == FlowType.income:
        return TossCategoryRecommendation("수입", "기타수입", "income_fallback")
    if any(keyword in text for keyword in ("유튜브", "네이버플러스", "멤버십")):
        return TossCategoryRecommendation("구독", "멤버십", "subscription_keyword")
    if any(keyword in text for keyword in ("CU", "편의점", "카페", "커피")):
        return TossCategoryRecommendation("생활", "식비", "merchant_keyword")
    if flow_type == FlowType.investment:
        return TossCategoryRecommendation("투자", "기타투자", "investment_fallback")
    if flow_type == FlowType.transfer:
        return TossCategoryRecommendation("이체", "기타이체", "transfer_fallback")
    return TossCategoryRecommendation("지출", "기타지출", "expense_fallback")


def _parse_won(text: str) -> Decimal:
    normalized = str(text or "").replace("원", "").replace(",", "").replace(" ", "").strip()
    return Decimal(normalized)


def _normalize_time(text: str) -> str:
    hour, minute = str(text).split(":", 1)
    return f"{int(hour):02d}:{minute}"


def _row_hash(*parts: str) -> str:
    payload = "|".join(_normalize_key(part) for part in parts)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _normalize_key(text: str) -> str:
    return re.sub(r"\s+", "", str(text or "").strip().lower())
