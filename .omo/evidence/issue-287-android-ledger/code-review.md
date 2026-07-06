# Issue 287 Review Disposition

## GitHub review comments

- Pagination cap: fixed by adding the `offset` query parameter to `GET /api/v1/transactions`, using `offset/limit` in the SQL query, and walking pages in `loadTransactionLedgerItems` until a short page is returned.
- Compact keyboard expansion: fixed by handling `Space` on compact transaction rows, exposing `aria-keyshortcuts`, and asserting the behavior in the Android ledger E2E.
- Compact keyboard selection: fixed by handling `Shift+Space` on compact transaction rows, exposing the shortcut in `aria-keyshortcuts` and row instructions, and asserting keyboard select/deselect in the Android ledger E2E.

## OMO review findings

- Evidence summary mismatch: fixed by committing the shareable evidence logs and QA matrix beside this summary.
- Long-press timer cleanup on unmount: fixed by calling `clearPointerGesture()` from the effect cleanup, which clears the pending long-press timer and stops auto-scroll.
- Stale monthly refresh blocker: fixed by assigning each transaction-ledger refresh a request id and filter query, then applying overview/transactions only if that request is still current. Covered by `issue 287: stale monthly transaction refresh cannot replace the active month`.
- Unbounded offset blocker: fixed by adding `_TRANSACTION_LIST_MAX_OFFSET = 60_000` and `le=_TRANSACTION_LIST_MAX_OFFSET` to the backend route. Covered by `test_transaction_list_rejects_excessive_offset`.
- Stale style concern: reviewed `transaction-owner-chip` and `mobile-toggle-btn` selectors. They are still shared with owner chips and holdings/mobile touch-target regressions, so no unrelated CSS deletion was made in this PR.

## Programming / remove-ai-slops perspective

- Behavior lock: existing #287 E2E plus new stale-refresh and offset-cap tests were added before claiming cleanup.
- Deletion ladder: new request guard is kept because it fixes an observed race at the shared refresh seam; no speculative helper or per-caller duplicate guard was added.
- Slop categories checked: no obvious comments, debug leftovers, broad catches, public API churn, new dependency, or behavior-weakening test changes were introduced.
- Oversized modules: `frontend/src/App.jsx` and `e2e/specs/transactions.spec.js` are legacy oversized files. This hotfix adds scoped regression coverage and does not attempt unrelated extraction inside #287.

## Residual risk

- `frontend/src/App.jsx` remains an oversized legacy file. This PR keeps the diff scoped to #287 behavior and does not attempt an extraction refactor inside the hotfix.
