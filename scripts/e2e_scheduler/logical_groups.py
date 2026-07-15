"""Current-develop logical groups for isolated E2E jobs."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Final, override

from scripts.e2e_scheduler.model import DiscoveredTest


TRANSACTION_SPEC: Final = Path("e2e/specs/transactions.spec.js")
MOBILE_MATRIX_SPEC: Final = Path("e2e/specs/mobile-browser-matrix.spec.js")
TRANSACTION_GROUPS: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
        "tx-entry-category-owner": (
            "mobile quick entry creates an expense through one-screen staged buttons",
            "issue 193: desktop transaction entry selects category through staged buttons",
            "issue 193: inline transaction edit searches category in one step",
            "issue 194: desktop transaction entry does not expose the removed category quick picker",
            "issue 194: inline transaction edit creates and applies a missing category inline",
            "issue 195: transaction entry keeps a compatible category when type changes",
            "issue 195: transaction entry offers a category restore when type clears selection",
            "issue 195: inline transaction edit restores the original category after type change",
            "mobile quick entry selected category button remains readable while hovered",
            "mobile quick entry defaults owner to current user over recent other member",
            "desktop transaction entry defaults owner and exposes quick member selection",
            "mobile quick entry keeps owner override and filters staged category choices",
            "issue 82: mobile staged category buttons stay readable at 320px",
        ),
        "tx-entry-form-context": (
            "mobile quick entry locks save while a transaction submit is pending",
            "transaction entry primary path stays shallow across mobile tablet and desktop",
            "desktop transaction entry keeps repeat context after save",
            "issue 212: mobile transaction quick amount requests a numeric keypad",
            "mobile quick entry keeps repeat context and returns focus to amount",
            "mobile quick entry rejects decimal KRW amount immediately",
            "mobile quick entry keeps all fields and actions in one non-scrolling sheet",
            "issue 192: mobile quick entry asks before closing a dirty draft and preserves it",
            "mobile quick entry restores the active field instead of jumping back to amount",
            "transaction sheet return focus does not override a newer ledger focus",
            "mobile quick entry stays usable across viewport and Korean font fallbacks",
            "issue 234: mobile transaction add keeps context visible without secondary details",
            "mobile transaction add keeps actions reachable with many staged category options",
            "issue 237: mobile transaction edit keeps completion controls in the first viewport",
        ),
        "tx-entry-crud-validation": (
            "mobile normal add clears stale anchored insert fields after cancelled insert",
            "issue 248: extracted transactions page keeps entry and inline edit wiring live",
            "desktop inline insert locks save while a transaction POST is pending",
            "transactions flow: create, inline edit, delete, responsive",
            "transactions form keeps grouped number format",
            "transactions form rejects decimal KRW amount before rounding can occur",
            "transactions inline edit rejects decimal KRW amount before rounding can occur",
        ),
        "tx-selection-interactions": (
            "desktop transaction row click and sweep selection keep toolbar summary stable",
            "transaction selection persists through passive websocket transaction refresh",
            "issue 233: desktop transaction rows expose keyboard selection",
            "desktop transaction sticky column titles and sweep auto-scroll selection toggle work",
            "mobile transaction row selection, touch scroll, and sticky ledger head survive Korean font viewports",
            "issue 221: mobile transaction status chips keep clear action in viewport",
            "issue 273: desktop transaction row double-click opens inline edit only from row body",
            "transaction selection toolbar bulk deletes multiple rows in one request",
            "transaction ledger selection toolbar stays overflow-free at 820px and 1100px",
        ),
        "tx-ledger-actions-clearance": (
            "transaction add action and sticky toolbar stay reachable after ledger scroll",
            "issue 211: transaction add opens a visible sheet from a scrolled list",
            "issue 222: mobile transaction add action does not cover ledger rows",
            "issue 223: desktop transaction add action does not cover bottom row actions",
            "issue 224: desktop transaction row edit and delete targets stay comfortable",
            "issue 227: 1024px transaction row actions stay inside the viewport",
        ),
        "tx-ledger-readability": (
            "transaction mobile meta text keeps readable contrast",
            "mobile transaction category flow summaries wrap long leading labels",
            "transaction ledger stays readable in landscape compact width",
            "issue 198: mobile collapsed transaction row keeps key details and actions visible",
            "issue 220: mobile collapsed transaction row scans as one ledger line",
            "mobile collapsed transaction row keeps large KRW amount readable",
            "issue #249: mobile transaction sticky stack uses measured heights",
            "mobile transaction expanded row keeps details readable with filter panel open",
            "transactions list affordance: top filters, compact ledger, ownerless marker",
        ),
        "tx-month-date-filter-loading": (
            "issue 196: transaction save clears hiding filters and reveals the saved row",
            "mobile transaction month stepper keeps usable touch targets",
            "issue 197: transaction month direct input clearly marks unapplied changes until Enter",
            "issue 213: mobile transaction add defaults to today outside visible month context",
            "issue 228: mobile transaction filters use ledger headers without duplicate generic toggle",
            "transaction date controls use unambiguous ISO text fields",
            "issue 219: mobile inline transaction date edit uses numeric ISO assistance",
            "issue 230: narrow mobile transaction date filters keep ISO placeholders readable",
            "mobile transaction filter panel stays visible after list scroll",
            "transactions default ledger stays monthly without continuous-history chrome",
            "issue 287: Android PWA transaction ledger uses monthly dense rows",
            "issue 287: monthly transaction ledger loads every paged row",
            "issue 287: stale monthly transaction refresh cannot replace the active month",
        ),
    }
)

MOBILE_MATRIX_GROUPS: Final[Mapping[str, tuple[str, ...]]] = MappingProxyType(
    {
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
)


@dataclass(frozen=True, slots=True)
class DuplicateLogicalGroupTitleError(Exception):
    spec_name: str
    title: str

    @override
    def __str__(self) -> str:
        return (
            f"{self.spec_name} title belongs to multiple logical groups: {self.title}"
        )


def _index_titles(
    groups: Mapping[str, tuple[str, ...]],
    *,
    spec_name: str,
) -> Mapping[str, str]:
    indexed: dict[str, str] = {}
    for group, titles in groups.items():
        for title in titles:
            if title in indexed:
                raise DuplicateLogicalGroupTitleError(
                    spec_name=spec_name,
                    title=title,
                )
            indexed[title] = group
    return MappingProxyType(indexed)


TRANSACTION_GROUP_BY_TITLE: Final = _index_titles(
    TRANSACTION_GROUPS,
    spec_name="transaction",
)
MOBILE_MATRIX_GROUP_BY_TITLE: Final = _index_titles(
    MOBILE_MATRIX_GROUPS,
    spec_name="mobile matrix",
)


@dataclass(frozen=True, slots=True)
class CurrentLogicalGroupResolver:
    """Split current transaction and mobile-matrix bottleneck specs."""

    def resolve(self, test: DiscoveredTest) -> str | None:
        if test.spec_path == TRANSACTION_SPEC:
            if not test.title_path:
                return None
            return TRANSACTION_GROUP_BY_TITLE.get(test.title_path[-1])
        if test.spec_path == MOBILE_MATRIX_SPEC:
            if not test.title_path:
                return None
            return MOBILE_MATRIX_GROUP_BY_TITLE.get(test.title_path[-1])
        return f"spec:{test.spec_path.as_posix()}"
