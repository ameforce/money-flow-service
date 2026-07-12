# UI/UX RCA Evidence Ledger

Scope: GitHub issue set #240-#259.

GitHub linkage source: `.omo/evidence/uiux-github-issues-240-259-current.json`
records 20 live issues from `ameforce/money-flow-service` via GitHub REST API,
generated at `2026-06-28T16:44:42.0383793Z`.

## v0.1.48 baseline mobile audit contract

- Requested develop baseline: `ee835f2c4633ba9ac796410e6ceb837455eedd86`.
- Matching tagged main baseline: `8f8481c18a878753eb04bfbe77bcdeab236e5708` (`v0.1.48`).
- Both commits resolve to tree `bd9eba86fe89edfa3aa7036d924291ccf358e696`; findings below therefore apply to the same v0.1.48 source tree.
- Runtime screenshots, traces, DOM geometry, accessibility results, and browser logs belong under `.omo/evidence/mobile-uiux-v0.1.49/<finding-id>/`.
- Static evidence may point to a repository path and line. A finding cannot become verified from static evidence alone when its acceptance condition requires a browser, orientation, assistive-technology, or real-device result.

### Severity and status schema

| Severity | Review level | Definition |
| --- | --- | --- |
| P0 / CRITICAL | Release stop | App entry, data integrity, or the complete primary task is unavailable. |
| P1 / HIGH | Release stop | A common mobile or accessibility path is blocked, or required browser coverage cannot prove the path. |
| P2 / MEDIUM | Release stop | A workaround exists, but usability, accessibility, feedback, layout, or performance is materially degraded. |
| P3 / LOW | Release stop | Consistency, visual finish, browser variance, or maintainability remains below the declared design contract. |

Allowed status values are exactly `Open`, `In progress`, `Fixed, pending verification`, and `Fixed and verified`. Only `Fixed and verified` is resolved. That state requires implementation evidence, a regression check, and the applicable artifact path in the Verification column.

### Unresolved-zero gate

- Merge-ready requires every mobile finding row to be exactly `Fixed and verified`; P0/P1/P2/P3 unresolved counts must all be zero.
- Explaining, deferring, resolving a review thread, or accepting visual debt does not change a finding status.
- Accepted debt: none. No P0-P3 finding may be moved outside this ledger to make the gate pass.
- Current W0 count: P0 0, P1 4, P2 7, P3 2; unresolved total 13.
- `quality:gate` is the per-wave regression gate and permits explicitly Open product findings while preventing new regressions. `quality:gate:final` is the release gate; it runs the strict browser matrix, zero-diagnostic react-doctor mode, and `uiux:rca-ledger:final` after runtime evidence has been generated.

### Confirmed mobile findings

| ID | Severity | Surface | RCA | Evidence | Wave | Status | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MUI-001 | P1 | Auth and all mobile pages | The viewport contract caps zoom at 1.0, preventing user-controlled pinch zoom despite the separate synthetic 200% font test. | `frontend/index.html:8`, `e2e/specs/uiux-accessibility-gates.spec.js:16-20` | W1 shell/layout | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-001/` must contain WebKit and Chromium zoom evidence. |
| MUI-002 | P1 | Import | Workbook, Toss, and migration upload triggers are pointer-only divs while their file inputs use `display:none`, so keyboard and switch users cannot start the task. | `frontend/src/pages/importing/WorkbookImportPanel.jsx:31-38`, `frontend/src/pages/importing/TossImportPanel.jsx:11-18`, `frontend/src/pages/importing/MigrationPackagePanel.jsx:37-38`, `frontend/src/App.css:6287-6289` | W2 task/accessibility | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-002/` must prove keyboard activation and focus order for all upload modes. |
| MUI-003 | P1 | Toss import review | A 1080px review table depends on horizontal scrolling while the root touch contract allows only vertical pan; mobile Toss review is not covered by its current desktop-only scenario. | `frontend/src/App.css:519-524`, `frontend/src/index.css:58-66`, `e2e/specs/import.spec.js:492-518` | W2 task/accessibility | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-003/` must prove every editable column is reachable at 320/390px by touch and keyboard. |
| MUI-004 | P1 | Test and release gate | The named project matrix contains desktop, tablet, and mobile Chromium only, so Firefox and WebKit behavior cannot be closed as verified. | `playwright.config.js:22-40`, `package.json:16`, `package.json:36` | W0 evidence | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-004/` must contain passing Chromium, Firefox, and WebKit matrices for the same SHA. |
| MUI-005 | P2 | Short landscape on auth, dashboard filters, settings, collaboration, and import | Shared inputs default to 0.9rem. The 16px compact override covers widths through 820px and short landscapes through 900px, but 915x412 falls outside both conditions and remains susceptible to iOS focus zoom/reflow. | `frontend/src/App.css:2543-2554`, `frontend/src/App.css:6583-6586`, `frontend/src/App.css:8007-8011` | W1 shell/layout | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-005/` must prove 16px-or-greater form text at 915x412 WebKit and retain 844x390 as a regression control. |
| MUI-006 | P2 | Transaction sheet, holding sheet, confirmation dialog | Modal surfaces implement labels and Escape handling but no shared focus trap, background inert contract, or complete initial/return focus contract. | `frontend/src/App.jsx:3838-3883`, `frontend/src/App.jsx:4223-4263`, `frontend/src/App.jsx:10747-10770` | W2 task/accessibility | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-006/` must prove Tab containment, Escape, dirty-confirm nesting, and trigger focus return. |
| MUI-007 | P2 | Transactions, holdings, settings, landscape navigation | Several frequent compact controls are below 44px, including 36px transaction selection actions and 40px settings controls; the touch test samples only a transaction row and holding toggle. | `frontend/src/App.css:1640-1659`, `frontend/src/App.css:6362-6367`, `frontend/src/App.css:6456-6462`, `frontend/src/App.css:10232-10237`, `e2e/specs/mobile-touch-targets.spec.js:57-111` | W1 shell/layout | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-007/` must contain a full interactive-target inventory with zero sub-44px core targets. |
| MUI-008 | P2 | Collaboration and import mode navigation | Tab-like controls have incomplete tab semantics and keyboard behavior: collaboration omits selected/panel relationships and import exposes a tablist containing ordinary buttons. | `frontend/src/pages/collaboration/CollaborationInviteTables.jsx:57-67`, `frontend/src/pages/collaboration/CollaborationInviteTables.jsx:141-151`, `frontend/src/pages/importing/WorkbookImportPanel.jsx:21-27` | W2 task/accessibility | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-008/` must prove roles, selected state, relationships, and arrow-key behavior. |
| MUI-009 | P2 | Auth and global recovery feedback | Success, guidance, and failure strings share one untyped message channel rendered as polite status, so blocking auth/API errors are not exposed as assertive, severity-specific feedback. | `frontend/src/App.jsx:10071-10077`, `frontend/src/App.jsx:10710-10716` | W2 task/accessibility | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-009/` must prove error alert announcement and non-blocking status behavior separately. |
| MUI-010 | P2 | Motion across all pages | Reduced-motion disables two invite animations only; global transition-all rules, socket pulse, spinner rotation, and other transitions remain active. | `frontend/src/App.css:760`, `frontend/src/App.css:1958`, `frontend/src/App.css:2561`, `frontend/src/App.css:10454-10458` | W3 polish/architecture | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-010/` must record reduced-motion computed styles and interaction states. |
| MUI-011 | P2 | Dashboard in landscape | Compact charts keep fixed 204px and 296px heights, and slice labels shrink to 0.54rem without a landscape override, consuming most short-screen workspace. | `frontend/src/App.css:7186-7194`, `frontend/src/App.css:7232-7235`, `frontend/src/App.css:10184-10348` | W1 shell/layout | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-011/` must prove first-task visibility and readable chart context at 800x360, 844x390, and 915x412. |
| MUI-012 | P3 | Design system | The canonical token contract is not enforced over legacy raw colors and the current quality gate does not run the token audit, permitting cross-browser and cross-surface drift. | `DESIGN.md:13-38`, `frontend/src/App.css`, `scripts/audit_ui_tokens.mjs`, `package.json:36` | W3 polish/architecture | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-012/` must contain the zero-orphan token audit result. |
| MUI-013 | P3 | React state and responsive architecture | App-level ownership remains concentrated in a 10k-line component with page prop bundles, coupling viewport changes, realtime refresh, forms, dialogs, and tab state. | `frontend/src/App.jsx:2178-2415`, `frontend/src/App.jsx:10088-10571`, `docs/uiux-rca-evidence-ledger.md` issue #248 | W3 polish/architecture | Open | Pending: `.omo/evidence/mobile-uiux-v0.1.49/MUI-013/` must include react-doctor, react-scan, build, and state-preservation evidence. |

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
