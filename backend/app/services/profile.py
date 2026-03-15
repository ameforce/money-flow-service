from __future__ import annotations

import re
from typing import Any

from app.db.models import AssetType, DisplayNameMode, FlowType, User


DEFAULT_TRANSACTION_ROW_COLORS = {
    FlowType.income.value: "#edf9f0",
    FlowType.expense.value: "#fff1f0",
    FlowType.investment.value: "#eff4ff",
    FlowType.transfer.value: "#fff7e8",
}

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_HOLDING_TYPE_KEY_RE = re.compile(r"[^a-z0-9_-]+")
_DISPLAY_NAME_MODES = {mode.value for mode in DisplayNameMode}
_FLOW_TYPE_VALUES = {flow.value for flow in FlowType}
_ASSET_TYPE_VALUES = {asset_type.value for asset_type in AssetType}

DEFAULT_HOLDING_TYPES = [
    {
        "key": AssetType.cash.value,
        "label": "현금성",
        "asset_type": AssetType.cash.value,
        "tracked": False,
        "show_average_cost": True,
        "show_gain_loss": False,
    },
    {
        "key": AssetType.stock.value,
        "label": "주식",
        "asset_type": AssetType.stock.value,
        "tracked": True,
        "show_average_cost": True,
        "show_gain_loss": True,
    },
    {
        "key": AssetType.crypto.value,
        "label": "가상자산",
        "asset_type": AssetType.crypto.value,
        "tracked": True,
        "show_average_cost": True,
        "show_gain_loss": True,
    },
    {
        "key": AssetType.pension.value,
        "label": "연금",
        "asset_type": AssetType.pension.value,
        "tracked": False,
        "show_average_cost": True,
        "show_gain_loss": False,
    },
    {
        "key": AssetType.real_estate.value,
        "label": "부동산",
        "asset_type": AssetType.real_estate.value,
        "tracked": False,
        "show_average_cost": True,
        "show_gain_loss": False,
    },
    {
        "key": AssetType.other.value,
        "label": "기타",
        "asset_type": AssetType.other.value,
        "tracked": False,
        "show_average_cost": True,
        "show_gain_loss": False,
    },
]

DEFAULT_HOLDING_SETTINGS: dict[str, Any] = {
    "types": DEFAULT_HOLDING_TYPES,
    "owner_colors": {},
    "category_colors": {},
    "type_colors": {},
    "category_order": [],
    "column_widths": {},
}


def normalize_optional_text(value: str | None) -> str | None:
    text = str(value or "").strip()
    return text or None


def resolve_display_name(
    *,
    real_name: str | None,
    nickname: str | None,
    display_name_mode: DisplayNameMode | str | None,
    fallback_display_name: str | None = None,
) -> str:
    normalized_real_name = normalize_optional_text(real_name)
    normalized_nickname = normalize_optional_text(nickname)
    normalized_mode = normalize_display_name_mode(display_name_mode)

    if normalized_mode == DisplayNameMode.nickname.value and normalized_nickname:
        return normalized_nickname
    if normalized_real_name:
        return normalized_real_name
    if normalized_nickname:
        return normalized_nickname
    return normalize_optional_text(fallback_display_name) or ""


def normalize_display_name_mode(value: DisplayNameMode | str | None) -> str:
    if isinstance(value, DisplayNameMode):
        return value.value
    text = str(value or "").strip()
    if text in _DISPLAY_NAME_MODES:
        return text
    return DisplayNameMode.real_name.value


def sync_user_display_name(user: User) -> str:
    user.real_name = normalize_optional_text(user.real_name)
    user.nickname = normalize_optional_text(user.nickname)
    user.display_name_mode = normalize_display_name_mode(user.display_name_mode)
    user.display_name = resolve_display_name(
        real_name=user.real_name,
        nickname=user.nickname,
        display_name_mode=user.display_name_mode,
        fallback_display_name=user.display_name,
    )
    return user.display_name


def effective_user_real_name(user: User) -> str | None:
    return normalize_optional_text(user.real_name) or normalize_optional_text(user.display_name)


def normalize_transaction_row_colors(value: dict[str, str] | None) -> dict[str, str]:
    merged = dict(DEFAULT_TRANSACTION_ROW_COLORS)
    if not value:
        return merged

    for raw_key, raw_color in dict(value).items():
        key = str(raw_key or "").strip().lower()
        color = str(raw_color or "").strip()
        if key not in _FLOW_TYPE_VALUES:
            raise ValueError(f"unsupported flow type: {key}")
        if not _HEX_COLOR_RE.fullmatch(color):
            raise ValueError(f"invalid color: {color}")
        merged[key] = color.upper()
    return merged


def _normalize_holding_type_key(value: str, fallback: str) -> str:
    key = str(value or "").strip().lower()
    key = _HOLDING_TYPE_KEY_RE.sub("_", key).strip("_")
    return key or fallback


def _normalize_color_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, str] = {}
    for raw_key, raw_color in value.items():
        key = str(raw_key or "").strip()
        color = str(raw_color or "").strip()
        if not key:
            continue
        if not _HEX_COLOR_RE.fullmatch(color):
            continue
        normalized[key] = color.upper()
    return normalized


def normalize_holding_settings(value: dict[str, Any] | None) -> dict[str, Any]:
    payload = value if isinstance(value, dict) else {}
    normalized_types: list[dict[str, Any]] = []
    used_keys: set[str] = set()
    raw_types = payload.get("types")
    if isinstance(raw_types, list):
        for index, raw_type in enumerate(raw_types):
            if not isinstance(raw_type, dict):
                continue
            fallback_key = f"type_{index + 1}"
            key = _normalize_holding_type_key(raw_type.get("key"), fallback_key)
            if key in used_keys:
                continue
            used_keys.add(key)
            label = str(raw_type.get("label") or raw_type.get("name") or key).strip()[:80] or key
            asset_type = str(raw_type.get("asset_type") or AssetType.other.value).strip().lower()
            if asset_type not in _ASSET_TYPE_VALUES:
                asset_type = AssetType.other.value
            tracked_default = asset_type in {AssetType.stock.value, AssetType.crypto.value}
            tracked = bool(raw_type.get("tracked", tracked_default))
            show_average_cost = bool(raw_type.get("show_average_cost", True))
            show_gain_loss = bool(raw_type.get("show_gain_loss", tracked))
            normalized_types.append(
                {
                    "key": key,
                    "label": label,
                    "asset_type": asset_type,
                    "tracked": tracked,
                    "show_average_cost": show_average_cost,
                    "show_gain_loss": show_gain_loss,
                }
            )
    if not normalized_types:
        normalized_types = [dict(item) for item in DEFAULT_HOLDING_TYPES]

    category_order: list[str] = []
    if isinstance(payload.get("category_order"), list):
        for item in payload.get("category_order") or []:
            text = str(item or "").strip()
            if text and text not in category_order:
                category_order.append(text)

    column_widths: dict[str, int] = {}
    if isinstance(payload.get("column_widths"), dict):
        for raw_key, raw_value in (payload.get("column_widths") or {}).items():
            key = str(raw_key or "").strip()
            if not key:
                continue
            try:
                width = int(raw_value)
            except Exception:
                continue
            if width < 80 or width > 600:
                continue
            column_widths[key] = width

    return {
        "types": normalized_types,
        "owner_colors": _normalize_color_map(payload.get("owner_colors")),
        "category_colors": _normalize_color_map(payload.get("category_colors")),
        "type_colors": _normalize_color_map(payload.get("type_colors")),
        "category_order": category_order,
        "column_widths": column_widths,
    }
