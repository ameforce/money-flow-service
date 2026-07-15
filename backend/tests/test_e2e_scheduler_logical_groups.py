from __future__ import annotations

from pathlib import Path

import pytest

from scripts.e2e_scheduler import logical_groups
from scripts.e2e_scheduler.model import DiscoveredTest, TestId


MOBILE_MATRIX_SPEC = Path("e2e/specs/mobile-browser-matrix.spec.js")

EXPECTED_MOBILE_MATRIX_GROUPS = {
    "mobile-core-profiles": (
        "cross-browser mobile matrix traverses core screens for mobile profiles without layout or accessibility regressions",
    ),
    "desktop-core-profiles": (
        "cross-browser mobile matrix traverses desktop core profiles without layout or accessibility regressions",
    ),
    "mobile-dialog-surfaces": (
        "cross-browser mobile matrix audits dialog surfaces without accessibility regressions",
    ),
    "mobile-modal-focus": (
        "MUI-006 transaction sheet owns keyboard focus and restores its trigger",
        "MUI-006 holding sheet owns keyboard focus and restores its trigger",
        "MUI-006 holding focus survives tablet modal-inline orientation transitions",
        "MUI-006 holding focus survives tablet inline-modal orientation transitions",
        "MUI-006 dirty sheet keeps the nested alertdialog topmost",
    ),
    "mobile-import-accessibility": (
        "MUI-002 import file pickers expose keyboard and switch controls",
        "MUI-003 Toss review keeps every editable column reachable by touch and keyboard",
    ),
    "mobile-semantics-status": (
        "MUI-008 collaboration tabs and import mode group expose truthful keyboard semantics",
        "MUI-009 blocking errors and non-blocking statuses expose distinct live-region contracts",
        "W1 status groups do not add inert keyboard stops",
    ),
    "mobile-orientation-zoom": (
        "portrait-landscape transition preserves transaction task state",
        "W1 MUI-001 keeps user zoom enabled in Chromium and WebKit",
    ),
    "mobile-typography-touch-layout": (
        "W1 MUI-005 keeps short-landscape form text at 16px in WebKit",
        "W1 MUI-005 keeps 1024px touch form text readable without flattening hierarchy in WebKit",
        "W1 MUI-007 exposes 44px core targets across mobile work surfaces",
        "W1 MUI-011 keeps the first dashboard task visible and charts readable in landscape",
    ),
}


def _test(spec_path: Path, title: str) -> DiscoveredTest:
    return DiscoveredTest(
        test_id=TestId(f"desktop-chromium::{spec_path}:7::{title}"),
        project="desktop-chromium",
        spec_path=spec_path,
        line=7,
        title_path=(title,),
        browser="chromium",
        viewport=(1280, 720),
        estimated_seconds=1.0,
    )


def test_mobile_matrix_inventory_has_eight_state_independent_business_groups() -> None:
    # Given / When
    groups = logical_groups.MOBILE_MATRIX_GROUPS

    # Then
    assert dict(groups) == EXPECTED_MOBILE_MATRIX_GROUPS
    assert len(groups) == 8
    assert sum(map(len, groups.values())) == 19
    assert len(logical_groups.MOBILE_MATRIX_GROUP_BY_TITLE) == 19


def test_mobile_matrix_duplicate_title_fails_closed() -> None:
    # Given
    duplicate_groups = {
        "first": ("duplicate title",),
        "second": ("duplicate title",),
    }

    # When / Then
    with pytest.raises(
        logical_groups.DuplicateLogicalGroupTitleError,
        match="mobile matrix title belongs to multiple logical groups",
    ):
        _ = logical_groups._index_titles(
            duplicate_groups,
            spec_name="mobile matrix",
        )


@pytest.mark.parametrize(
    ("group", "title"),
    (
        (group, title)
        for group, titles in EXPECTED_MOBILE_MATRIX_GROUPS.items()
        for title in titles
    ),
)
def test_mobile_matrix_title_resolves_to_its_business_group(
    group: str,
    title: str,
) -> None:
    # Given
    discovered = _test(MOBILE_MATRIX_SPEC, title)

    # When
    resolved = logical_groups.CurrentLogicalGroupResolver().resolve(discovered)

    # Then
    assert resolved == group


def test_new_transaction_focus_title_stays_with_entry_context() -> None:
    # Given
    discovered = _test(
        Path("e2e/specs/transactions.spec.js"),
        "transaction sheet return focus does not override a newer ledger focus",
    )

    # When
    resolved = logical_groups.CurrentLogicalGroupResolver().resolve(discovered)

    # Then
    assert resolved == "tx-entry-form-context"


@pytest.mark.parametrize(
    ("title", "expected_group"),
    (
        (
            "mobile quick entry defaults owner to current user over recent other member",
            "tx-entry-category-owner",
        ),
        (
            "mobile quick entry locks save while a transaction submit is pending",
            "tx-entry-form-context",
        ),
        (
            "issue 223: desktop transaction add action does not cover bottom row actions",
            "tx-ledger-actions-clearance",
        ),
        (
            "mobile collapsed transaction row keeps large KRW amount readable",
            "tx-ledger-readability",
        ),
    ),
)
def test_transaction_tail_titles_resolve_to_smaller_business_groups(
    title: str,
    expected_group: str,
) -> None:
    discovered = _test(Path("e2e/specs/transactions.spec.js"), title)

    resolved = logical_groups.CurrentLogicalGroupResolver().resolve(discovered)

    assert resolved == expected_group


def test_transaction_split_preserves_exact_title_inventory() -> None:
    groups = logical_groups.TRANSACTION_GROUPS

    assert "tx-entry-category-context" not in groups
    assert "tx-ledger-layout-actions" not in groups
    assert len(groups) == 7
    assert sum(map(len, groups.values())) == 71
    assert len(logical_groups.TRANSACTION_GROUP_BY_TITLE) == 71


def test_unmapped_spec_keeps_one_spec_level_job() -> None:
    # Given
    spec_path = Path("e2e/specs/dashboard.spec.js")
    discovered = _test(spec_path, "dashboard behavior")

    # When
    resolved = logical_groups.CurrentLogicalGroupResolver().resolve(discovered)

    # Then
    assert resolved == f"spec:{spec_path.as_posix()}"
