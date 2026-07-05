# Issue 287 Android Ledger Follow-up Evidence

## RCA

- The transaction list still carried the retired continuous-history rendering path behind an always-false mode flag.
- Mobile touch selection relied on pointer cleanup that did not clear the pending long-press timer when the touch ended outside the row.
- The Android/PWA ledger contract needed real touch input coverage for tap, long press, long-press drag selection, and touch scrolling.

## Fix

- Removed the continuous-history list mode, sentinel rows, history paging state, and related CSS.
- Kept the transaction ledger monthly by default through the regular monthly transactions endpoint.
- Hardened touch gesture cleanup so pointer/touch cancellation clears pending long-press state.
- Added CDP touch-input E2E coverage for Android-style tap, long press, long-press drag selection, and scroll behavior.

## Verification

- PASS: `uv run --extra dev python -m pytest -q`
- PASS: `npm.cmd run frontend:build`
- PASS: `npm.cmd run lint --prefix frontend` with 11 existing App.jsx warnings and 0 errors
- PASS: `npm.cmd run e2e -- --grep "issue 287|mobile transaction row selection|transaction tab rolls local date" --project=desktop-chromium`
- PASS: `npm.cmd run e2e -- e2e/specs/transactions.spec.js --project=desktop-chromium` with 65 passed
- PASS: `git diff --check`
- PASS: `git diff --summary --diff-filter=T` produced no mode-only diffs

Raw local logs are saved beside this file in the same evidence directory.
