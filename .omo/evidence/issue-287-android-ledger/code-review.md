# Issue 287 Review Disposition

## GitHub review comments

- Pagination cap: fixed by adding the `offset` query parameter to `GET /api/v1/transactions`, using `offset/limit` in the SQL query, and walking pages in `loadTransactionLedgerItems` until a short page is returned.
- Compact keyboard expansion: fixed by handling `Space` on compact transaction rows, exposing `aria-keyshortcuts`, and asserting the behavior in the Android ledger E2E.

## OMO review findings

- Evidence summary mismatch: fixed by committing the shareable evidence logs and QA matrix beside this summary.
- Long-press timer cleanup on unmount: fixed by calling `clearPointerGesture()` from the effect cleanup, which clears the pending long-press timer and stops auto-scroll.
- Stale style concern: reviewed `transaction-owner-chip` and `mobile-toggle-btn` selectors. They are still shared with owner chips and holdings/mobile touch-target regressions, so no unrelated CSS deletion was made in this PR.

## Residual risk

- `frontend/src/App.jsx` remains an oversized legacy file. This PR keeps the diff scoped to #287 behavior and does not attempt an extraction refactor inside the hotfix.
