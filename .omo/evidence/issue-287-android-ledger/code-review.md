# Issue 287 Review Disposition

## GitHub review comments

- Pagination cap: fixed by adding the `offset` query parameter to `GET /api/v1/transactions`, using `offset/limit` in the SQL query, and walking pages in `loadTransactionLedgerItems` until a short page is returned.
- Compact keyboard expansion: fixed by handling `Space` on compact transaction rows, exposing `aria-keyshortcuts`, and asserting the behavior in the Android ledger E2E.
- Compact keyboard selection: fixed by handling `Shift+Space` on compact transaction rows, exposing the shortcut in `aria-keyshortcuts` and row instructions, and asserting keyboard select/deselect in the Android ledger E2E.
- Latest-row anchoring: fixed by marking the transaction tab for one-time latest-row anchoring on entry, scrolling the latest rendered row after the monthly ledger rows exist, and asserting that the 1001st row is in the opening viewport while the oldest row is not.
- Targeted import reveal priority: fixed by suppressing the generic latest-row anchor while `showImportedTransactions()` refreshes and scrolls the explicit imported transaction, then releasing suppression after the targeted scroll settles.

## OMO review findings

- Evidence summary mismatch: fixed by committing the shareable evidence logs and QA matrix beside this summary.
- Long-press timer cleanup on unmount: fixed by calling `clearPointerGesture()` from the effect cleanup, which clears the pending long-press timer and stops auto-scroll.
- Stale monthly refresh blocker: fixed by assigning each transaction-ledger refresh a request id and filter query, then applying overview/transactions only if that request is still current. Covered by `issue 287: stale monthly transaction refresh cannot replace the active month`.
- Unbounded offset blocker: fixed by adding `_TRANSACTION_LIST_MAX_OFFSET = 60_000` and `le=_TRANSACTION_LIST_MAX_OFFSET` to the backend route. Covered by `test_transaction_list_rejects_excessive_offset`.
- Sticky header regression after latest anchoring: fixed by including `sortedTransactions.length` in the sticky geometry measurement effect dependencies. Covered by the focused Korean-font sticky ledger E2E and the full `transactions.spec.js` rerun.
- Compact row shortcut instruction scope: fixed by using compact-only row activation instructions for `Shift+Space`; desktop rows now describe checkbox selection instead of mobile row shortcuts.
- Import reveal stale guard blocker: fixed by making `showImportedTransactions()` update `appliedYearMonthRef` and clear month pending state before calling `refreshDataWithUiFeedback()`. Covered by RED/GREEN `import flow: workbook dry-run and apply`, which imports a March workbook while the app starts on July.
- Targeted import reveal anchor blocker: fixed by clearing/suppressing pending latest-row anchoring during the imported-transaction reveal path. Covered by the strengthened import E2E, which creates newer March rows and asserts the imported row remains in the viewport while the newest generic row is not.
- Stale style concern: reviewed `transaction-owner-chip` and `mobile-toggle-btn` selectors. They are still shared with owner chips and holdings/mobile touch-target regressions, so no unrelated CSS deletion was made in this PR.

## Programming / remove-ai-slops perspective

- Behavior lock: existing #287 E2E plus new stale-refresh and offset-cap tests were added before claiming cleanup.
- Latest-row behavior lock: the paged-ledger E2E now asserts that the newest rendered monthly row is visible on initial open and the oldest row is not the initial anchor.
- Import reveal behavior lock: the existing workbook import E2E now serves as a stale-guard regression because it applies a March transaction from a July session and asserts the imported row appears after "가져온 거래 보기".
- Import anchor priority lock: the workbook import E2E also creates newer rows in the target month and asserts "가져온 거래 보기" keeps the imported row as the viewport target instead of falling through to the generic latest-row anchor.
- Deletion ladder: new request guard is kept because it fixes an observed race at the shared refresh seam; no speculative helper or per-caller duplicate guard was added.
- Slop categories checked: no obvious comments, debug leftovers, broad catches, public API churn, new dependency, or behavior-weakening test changes were introduced.
- Oversized modules: `frontend/src/App.jsx` and `e2e/specs/transactions.spec.js` are legacy oversized files. This hotfix adds scoped regression coverage and does not attempt unrelated extraction inside #287.

## Residual risk

- `frontend/src/App.jsx` remains an oversized legacy file. This PR keeps the diff scoped to #287 behavior and does not attempt an extraction refactor inside the hotfix.
