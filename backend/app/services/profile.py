from __future__ import annotations

import re

from app.db.models import DisplayNameMode, FlowType, User


DEFAULT_TRANSACTION_ROW_COLORS = {
    FlowType.income.value: "#edf9f0",
    FlowType.expense.value: "#fff1f0",
    FlowType.investment.value: "#eff4ff",
    FlowType.transfer.value: "#fff7e8",
}

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_DISPLAY_NAME_MODES = {mode.value for mode in DisplayNameMode}
_FLOW_TYPE_VALUES = {flow.value for flow in FlowType}


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
