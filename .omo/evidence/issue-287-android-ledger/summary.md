# Issue 287 Android Ledger Follow-up Evidence

## RCA

- The transaction list still carried the retired continuous-history rendering path behind an always-false mode flag.
- Mobile touch selection relied on pointer cleanup that did not clear the pending long-press timer when the touch ended outside the row.
- The Android/PWA ledger contract needed real touch input coverage for tap, long press, long-press drag selection, and touch scrolling.
- PR review found three follow-up defects after the first fix: the monthly ledger still capped at the first 1000 rows, the compact row no longer had a keyboard path to expand details after the visible mobile toggle was removed, and the compact row still needed a non-pointer keyboard path for selection after row activation was repurposed for detail expansion.
- PR review also found that replacing the history renderer with an oldest-to-newest monthly table made the transaction tab initially land on the oldest rows instead of the latest/current rows.
- Latest-row auto anchoring exposed a sticky-header timing regression: the header geometry measurement had not re-run after the monthly row count changed, so the first rendered row could sit underneath the sticky filter stack.
- Architecture review found one more stale-request invariant bug: `showImportedTransactions()` switched the visible month for imported rows but did not update `appliedYearMonthRef`, so the new ledger guard could discard the import reveal refresh as stale.
- Codex review found that the one-time latest-row auto anchor could remain pending while `showImportedTransactions()` performed its explicit imported-row reveal, letting the generic latest-row scroll compete with the targeted import scroll.
- Codex review found another entry-point gap in the same latest-row behavior: month changes while already on the Transactions tab refreshed the ledger without re-arming the latest-row anchor. The effect also only depended on row count, so a same-size month replacement could leave a pending anchor unconsumed.
- Full-suite E2E exposed stale test contracts after the #287 fix: several tests still expected the retired mobile transaction row toggle, previous-month seeded rows in the current monthly ledger, exactly two visible donut slice labels, and always-enabled month navigation buttons.

## Fix

- Removed the continuous-history list mode, sentinel rows, history paging state, and related CSS.
- Kept the transaction ledger monthly by default through the regular monthly transactions endpoint.
- Added offset pagination to `GET /api/v1/transactions` and changed the monthly ledger loader to walk all pages until the final short page.
- Added a server-side offset cap so authenticated direct callers cannot request arbitrarily large offsets.
- Added an active filter/request guard so a slow previous month/range refresh cannot overwrite the currently selected ledger.
- Hardened touch gesture cleanup so pointer/touch cancellation and component unmount clear pending long-press state.
- Restored compact-row keyboard contracts: `Space` toggles details, `Shift+Space` toggles selection, and `Enter`/`F2` remain edit shortcuts when editing is available.
- Restored initial latest-row anchoring when the user opens the transaction tab, respecting the active sort direction.
- Re-ran sticky toolbar geometry measurement when the rendered transaction count changes so the latest-row anchor does not overlap the sticky ledger header.
- Aligned import reveal with the month-filter apply path by updating `appliedYearMonthRef` and clearing pending month state before refreshing imported transactions.
- Suppressed the generic latest-row anchor while a targeted imported-transaction reveal is in progress, then released the suppression after the explicit imported-row scroll has settled.
- Re-armed the latest-row anchor for month and range filter applies while the user is already on the Transactions tab, and made the anchor effect observe the sorted row set instead of only its length.
- Added CDP touch-input E2E coverage for Android-style tap, long press, long-press drag selection, scrolling, keyboard expansion, keyboard selection, and 1001-row monthly paging.
- Updated stale E2E contracts to match the shipped UI: mobile transaction rows are the 44px detail target with keyboard shortcuts, monthly-ledger tests seed the active month, WebSocket transaction sync uses the active month, dashboard slice-label assertions allow data/geometry-dependent labels, and disabled month navigation buttons are not pressed for tactile feedback checks.

## Verification

- PASS: `uv run --extra dev python -m pytest -q`
- PASS: `uv run --extra dev python -m pytest backend/tests/test_api_v1.py::test_transaction_list_supports_offset_pagination_in_order -q`
- PASS: `uv run --extra dev python -m pytest backend/tests/test_api_v1.py::test_transaction_list_supports_offset_pagination_in_order backend/tests/test_api_v1.py::test_transaction_list_rejects_excessive_offset -q`
- PASS: `npm.cmd run frontend:build`
- PASS: `npm.cmd run lint --prefix frontend` with 11 existing App.jsx warnings and 0 errors
- PASS: `npm.cmd run e2e -- --grep "issue 287|mobile transaction row selection|transaction tab rolls local date" --project=desktop-chromium --workers=1`
- PASS: `npm.cmd run e2e -- --grep "stale monthly transaction refresh" --project=desktop-chromium --workers=1`
- PASS: `npm.cmd run e2e -- --grep "issue 287: Android PWA transaction ledger uses monthly dense rows" --project=desktop-chromium --workers=1`
- PASS: `npm.cmd run e2e -- --grep "monthly transaction ledger loads every paged row" --project=desktop-chromium --workers=1`
- PASS: `npm.cmd run e2e -- --grep "mobile transaction row selection, touch scroll, and sticky ledger head survive Korean font viewports" --project=desktop-chromium --workers=1`
- RED then PASS: `npm.cmd run e2e -- e2e/specs/import.spec.js --project=desktop-chromium --grep "import flow: workbook dry-run and apply" --workers=1`
- PASS: `npm.cmd run e2e -- e2e/specs/import.spec.js --project=desktop-chromium --grep "import flow: workbook dry-run and apply" --workers=1` with newer same-month rows proving the targeted import reveal is not replaced by latest-row auto anchoring.
- RED then PASS: `npm.cmd run e2e -- --grep "issue 197: transaction month direct input" --project=desktop-chromium --workers=1` with a 28-row applied month proving month switches re-anchor to the latest row.
- PASS: `npm.cmd run e2e -- e2e/specs/transactions.spec.js --project=desktop-chromium --workers=1` with 67 passed
- RED: `npm.cmd run e2e` initially failed 6 stale-contract assertions after the #287 monthly/no-toggle contract landed; see `full-e2e.txt`.
- PASS: `npm.cmd run e2e -- e2e/specs/dashboard.spec.js e2e/specs/layout-stability.spec.js e2e/specs/mobile-touch-targets.spec.js e2e/specs/transactions-ledger-layout.spec.js e2e/specs/transactions-tab-state.spec.js e2e/specs/ws.spec.js --project=desktop-chromium --workers=3` with 23 passed; see `green-full-e2e-failure-rerun-2.txt`.
- PASS: `npm.cmd run e2e` with 164 passed; see `full-e2e-rerun-after-test-contract.txt`.
- PASS: Jenkins branch build #9 deployed `b6c3aa0fcf16dc75ec348b5046fa1569250e2d22` to dev as `v0.1.37.9`; see `jenkins-dev-build-9.md`.
- PASS: `git diff --check`
- PASS: `git diff --summary --diff-filter=T` produced no mode-only diffs

Shareable logs and QA notes are committed in this directory so a detached review worktree can inspect the same evidence.
