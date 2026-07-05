# UI/UX RCA Evidence Ledger

Scope: GitHub issue set #240-#259.

GitHub linkage source: `.omo/evidence/uiux-github-issues-240-259-current.json`
records 20 live issues from `ameforce/money-flow-service` via GitHub REST API,
generated at `2026-06-28T16:44:42.0383793Z`.

This ledger maps each reviewed UI/UX issue to root cause, current code surface,
dependency wave, applied status, verification evidence, and remaining risk.

## GitHub Issue Linkage

| Issue | GitHub URL | State |
| --- | --- | --- |
| #240 | https://github.com/ameforce/money-flow-service/issues/240 | open |
| #241 | https://github.com/ameforce/money-flow-service/issues/241 | open |
| #242 | https://github.com/ameforce/money-flow-service/issues/242 | open |
| #243 | https://github.com/ameforce/money-flow-service/issues/243 | open |
| #244 | https://github.com/ameforce/money-flow-service/issues/244 | open |
| #245 | https://github.com/ameforce/money-flow-service/issues/245 | open |
| #246 | https://github.com/ameforce/money-flow-service/issues/246 | open |
| #247 | https://github.com/ameforce/money-flow-service/issues/247 | open |
| #248 | https://github.com/ameforce/money-flow-service/issues/248 | open |
| #249 | https://github.com/ameforce/money-flow-service/issues/249 | open |
| #250 | https://github.com/ameforce/money-flow-service/issues/250 | open |
| #251 | https://github.com/ameforce/money-flow-service/issues/251 | open |
| #252 | https://github.com/ameforce/money-flow-service/issues/252 | open |
| #253 | https://github.com/ameforce/money-flow-service/issues/253 | open |
| #254 | https://github.com/ameforce/money-flow-service/issues/254 | open |
| #255 | https://github.com/ameforce/money-flow-service/issues/255 | open |
| #256 | https://github.com/ameforce/money-flow-service/issues/256 | open |
| #257 | https://github.com/ameforce/money-flow-service/issues/257 | open |
| #258 | https://github.com/ameforce/money-flow-service/issues/258 | open |
| #259 | https://github.com/ameforce/money-flow-service/issues/259 | open |

## Dependency Waves

| Wave | Purpose | Issues |
| --- | --- | --- |
| W1 repeated transaction journey | Keep the highest-frequency task shallow, fast, and field-error safe. | #244, #246, #256, #257, #258, #259 |
| W2 semantic accessibility and chart alternatives | Make visual state available through native semantics and exact values. | #245, #247, #250, #251, #254, #255 |
| W3 layout/system/performance/trust contract | Prevent drift through measured layout, design tokens, budgets, and lifecycle matrices. | #240, #241, #242, #243, #248, #249, #252, #253 |

## Issue Ledger

| Issue | RCA | Code surface | Wave | Status and proof | Remaining risk |
| --- | --- | --- | --- | --- | --- |
| #240 | New UI edits could bypass `DESIGN.md` token/radius/color contracts. | `frontend/src/App.css`, `scripts/audit_ui_tokens.mjs` | W3 | Fixed raw changed values; `node scripts/audit_ui_tokens.mjs --mode ci --changed-only` passed. | Audit is changed-line scoped, so unrelated legacy raw values remain outside this fix. |
| #241 | Top nav meaning can become visual-only when icon/current state semantics drift. | `frontend/src/App.jsx`, `e2e/specs/uiux-rca.spec.js` | W3 | Guarded by issue #241 E2E in the 6-test RCA run. | Future nav items must extend the same semantic assertions. |
| #242 | Mobile dashboard can hide core state when responsive layout prioritizes charts/tables over user context. | `frontend/src/App.jsx`, dashboard cards, `e2e/specs/uiux-rca.spec.js` | W3 | Guarded by issue #242 E2E in the 6-test RCA run. | Market-context copy can still need product review as data sources expand. |
| #243 | Asset/transaction sheets can diverge on dialog and keyboard focus contracts. | Entry sheets in `frontend/src/App.jsx`, `e2e/specs/uiux-rca.spec.js` | W3 | Guarded by issue #243 E2E: Escape closes mobile holding sheet and restores focus. | Transaction and holding sheets should stay paired in future UX changes. |
| #244 | A compact viewport global pointer/touch blur removed focus visibility after taps. | `frontend/src/App.jsx` | W1 | Removed global blur effect; RED #244 focus failure became GREEN in targeted E2E. | Any future touch cleanup must preserve focus-visible behavior. |
| #245 | Transaction table exposed fake visual row/columnheader roles while the native table head was hidden. | `frontend/src/components/worksurface/TransactionSurfaceTable.jsx`, `frontend/src/App.css` | W2 | Removed fake table roles and visually hid native `thead`; issue #245 E2E passed. | Asset table remains separately guarded by existing semantics; no shared abstraction yet. |
| #246 | Transaction validation used a global message instead of field-linked errors, and stale validation survived close/reopen boundaries. | `frontend/src/App.jsx`, `e2e/specs/uiux-accessibility-gates.spec.js` | W1 | Added field errors with `aria-invalid`, `aria-describedby`, `role=alert`, first-invalid focus; then cleared stale field/global validation feedback on sheet close/open. RED QA carryover became GREEN in `manualQa.json`; #246 linked-error and reopen regression E2E passed. | Additional non-required transaction fields may need the same pattern if they become blocking. |
| #247 | Chart canvases had labels but no visible exact value alternative for dashboard flow. | `frontend/src/App.jsx`, `ChartAccessibleSummary.jsx` | W2 | Added `FlowTrendValueTable`; issue #247/#255 E2E passed. | Future charts must use the shared alternative component. |
| #248 | `App.jsx` concentrated app shell, navigation icons, global actions, client-version status, and chart alternative markup, increasing cross-surface drift risk. | `frontend/src/components/AppShell.jsx`, `frontend/src/components/worksurface/ChartAccessibleSummary.jsx`, `frontend/src/App.jsx`, `frontend/src/clientVersion.test.mjs` | W3 | Extracted `AppShell` with tab metadata, semantic nav/action icons, realtime/version chips, and global action contracts; kept `TAB_IDS` as the App boundary contract; updated client-version unit coverage; frontend build and lint passed. | `App.jsx` remains large, so deeper page/data hook extraction should continue as follow-up refactor debt rather than blocking this shell/topbar/client-version fix. |
| #249 | Mobile sticky layout depended on fixed `10.75rem`/`10.25rem` fallback heights. | `TransactionSurfaceTable.jsx`, `frontend/src/App.css`, `e2e/specs/transactions.spec.js` | W3 | Added measured ledger/filter CSS vars via `ResizeObserver`; issue #249 RED became GREEN. | Uses browser measurement, so no-JS fallback is intentionally not the target surface. |
| #250 | WCAG/axe regressions had no automated gate. | `e2e/specs/uiux-accessibility-gates.spec.js`, package dev dependency | W2 | Added axe gate; initial canvas alt and contrast failures were fixed; accessibility gate passed. | Axe does not replace manual cognitive-flow review. |
| #251 | High contrast, text spacing, and 200% zoom behavior were not gated. | `e2e/specs/uiux-accessibility-gates.spec.js` | W2 | Added forced-colors/text-spacing and explicit 200% text-zoom reflow gates for mobile transaction entry; accessibility gate passed. | OS/browser-specific contrast behavior should be spot-checked in major release QA. |
| #252 | Performance baseline only compared to prior evidence and had no first-run budget or bundle gate. | `frontend/vite.config.js`, `scripts/uiux_performance_budget.mjs`, `performance-baseline.mjs`, `package.json` | W3 | Split vendor chunk, added dist budget and real-Chrome absolute ms budgets, and wired `frontend:build` plus `uiux:perf-budget` into `quality:gate` and `ci:quality:gate`; build, budget, and real Chrome baseline passed. | Budgets are pragmatic thresholds, not a substitute for full Lighthouse reports before major launches. |
| #253 | Data lifecycle trust states existed as scattered UI without a matrix or gate. | `docs/uiux-data-lifecycle-trust-matrix.md`, `scripts/verify_uiux_trust_matrix.mjs`, `frontend/src/App.jsx` | W3 | Added matrix and verification script; import progress is now `role=status` live text; `npm run uiux:trust-matrix` passed. | Matrix must be kept current when new lifecycle states are introduced. |
| #254 | Mobile form input attributes could regress without a global contract. | `e2e/specs/uiux-accessibility-gates.spec.js`, transaction entry controls | W2 | Added mobile form attribute gate for amount, memo, category search, and enter-key hints. | Future forms need separate coverage or shared helpers. |
| #255 | Exact chart alternatives were inconsistent across dashboard and holdings. | `ChartAccessibleSummary.jsx`, `frontend/src/App.jsx` | W2 | Added shared dashboard/holding breakdown lists with exact KRW values and shares; issue #247/#255 E2E passed. | Non-portfolio charts must adopt the same pattern when added. |
| #256 | Transaction entry was not governed as the top repeated journey. | `frontend/src/App.jsx`, `e2e/specs/transactions.spec.js` | W1 | Primary path test covers 320/390/768/1366 and shallow amount/category/memo/save flow. | This journey should stay the first QA target for transaction changes. |
| #257 | Category search occupied primary-path space even when users used quick chips, and the empty-search state could appear before the user searched. | `TransactionCategoryQuickPicker.jsx`, `TransactionCategoryPickerControls.jsx`, `TransactionCategoryPickerModel.js`, `frontend/src/App.jsx` | W1 | Added toggle search mode for transaction entry, changed the primary action to `카테고리 선택`, hid no-result copy until search text exists, and split picker controls/model to stay under the maintainability gate; issue #257/#254 E2E and manual QA passed. | Inline edit keeps always-visible search by design. |
| #258 | Long category chips could lose readability at narrow mobile widths. | `TransactionCategoryQuickPicker.jsx`, `TransactionCategoryPickerControls.jsx`, `TransactionCategoryPickerModel.js`, `e2e/specs/transactions.spec.js` | W1 | Re-ran long-category chip guidance regression; 320px no-overflow and 44px target checks passed after the picker split. | Extremely long user-generated labels still rely on wrapping/ellipsis behavior. |
| #259 | Category management remained inside the repeated transaction entry flow, including a default create-category toggle for empty accounts. | `frontend/src/App.jsx`, `TransactionCategoryQuickPicker.jsx`, `TransactionCategoryPickerControls.jsx`, `TransactionCategoryPickerModel.js`, `e2e/specs/uiux-accessibility-gates.spec.js` | W1 | Removed category management from transaction sheet primary flow and hid create-category controls until explicit search intent; issue #259 E2E, #254 regression, and manual QA passed after the picker split. | Category management remains reachable outside the sheet and should not re-enter quick entry. |

## Final Review Notes

- The highest-priority transaction registration complaint is covered by W1.
- Jenkins build #3 exposed stale E2E assumptions after the W1 transaction-entry redesign: settings/category usage now verifies the quick category primary path, ISO date validation opens secondary details explicitly, and visual desktop history/list assertions target the visible ledger-head classes instead of native-header or ARIA-role selectors.
- #245's semantic contract is preserved: the visible sticky desktop ledger head remains roleless, while the native table header remains the accessible header source.
- Quick-entry secondary details now reserve larger sticky-action clearance so the `거래자` field is not covered by sticky save/reset buttons under Jenkins/Linux rendering.
- Visual QA caught that transaction validation still rendered a duplicate global bottom message over the sticky save/reset actions; transaction entry now keeps the field-linked inline error only while the sheet is open.
- Full E2E exposed two stale decimal-KRW assertions that still waited for the removed global `.message`; the tests now assert the actual W1/#246 contract: amount field `aria-invalid`, `aria-describedby`, visible `#transaction-quick-amount-error`, and no duplicate global transaction-validation message while the entry sheet/form is open.
- Slow history QA caught a transaction-list continuation defect: after a user saved a backdated transaction, the list correctly stayed anchored to the saved month, but the bottom history sentinel could stay intersecting while the scroll-direction ref was still `up`, so newer pages were not loaded when the user/test moved back to the latest transaction. The observer now treats actual document-end position as a newer-load signal only for the bottom edge, and its post-observe kick is gated by rootMargin/visibility checks so an offscreen sentinel cannot trigger unsolicited pagination. The slow E2E path now also asserts that a mid-list anchored month does not issue unexpected older/newer history requests before the user moves to an edge.
- The remaining legacy risk is `App.jsx` size; #248 now separates the app shell/topbar/nav responsibility, but deeper page/data hook extraction remains refactor debt.
- Manual and browser QA must continue to cover mobile 320/390, tablet 768, and desktop 1366 before release.
