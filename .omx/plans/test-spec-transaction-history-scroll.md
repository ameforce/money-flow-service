# Test Spec: Toss-like Transaction History Scroll

## Status
- Consensus: **APPROVED**
- Pairs with PRD: `.omx/plans/prd-transaction-history-scroll.md`
- Source requirements: `.omx/specs/deep-interview-transaction-history-scroll.md`

## Test principles
1. Prove cursor/feed correctness before UI polish.
2. Prove scroll anchoring with measurable DOM/scroll evidence, not visual assumption alone.
3. Preserve existing `/transactions`, dashboard/report, month controls, mobile sticky filters, and compact row behavior.
4. Verify no-future behavior from backend and frontend perspectives.
5. Live-smoke with temporary prefixed data and cleanup evidence.

## Backend API tests
Add tests near existing transaction API tests in `backend/tests/test_api_v1.py` or a focused equivalent.

### Existing list compatibility
- `GET /api/v1/transactions` still returns a bare list.
- Existing `year/month`, `start_date/end_date`, and `limit` behavior remains compatible.
- Optional deterministic `id` tie-breaker must not change response shape.

### History initial page
Setup:
- Auth user/household.
- Create transactions across multiple dates including today, past dates, and optionally future DB rows.

Assertions:
- `GET /api/v1/transactions/history` returns a page envelope with `items`, cursors, `has_older`, `has_newer`, `anchor_date`, and `today`.
- Returned `today` is backend-authoritative.
- Future `anchor_date` is clamped to `today`.
- Items are ascending by `(occurred_on, created_at, id)` and each item is `<= today`.
- `has_newer` is false when initial page is anchored at today/latest.

### Older pagination
- Call initial with small `limit`.
- Use `older_cursor` with `direction=older`.
- Assert returned rows are strictly older than the cursor key.
- Assert no duplicate ids across pages.
- Assert `limit + 1` sentinel row is not returned in `items`.
- Assert `has_older` accurately flips when history is exhausted.

### Newer pagination
- Anchor to a past month/date or use an older page cursor.
- Use `newer_cursor` with `direction=newer`.
- Assert returned rows are strictly newer than cursor key but `<= today`.
- Assert `has_newer` false when today/latest endpoint is reached.

### Same-date/tie-breaker stability
- Create rows with the same `occurred_on` and same/near `created_at` values where possible.
- Use small limits across page boundaries.
- Assert no skip/duplicate via `id` tie-breaker.

### Cursor safety
- Malformed cursor returns safe 400.
- Cursor from another household cannot leak rows and returns safe error/empty behavior per implementation contract.
- Cursor household metadata, if present, is never trusted as authorization.

### Tenant isolation
- Two households each have transactions.
- History endpoint for one household never returns the other's rows.

### Future exclusion
- Insert/create future-dated row directly if API validation permits; otherwise seed DB row in test.
- Assert history feed excludes it and does not expose future endpoint.

## Frontend/unit or component-level checks
Use the project's existing frontend testing approach if available; otherwise cover through E2E.

### State isolation
- `periodTransactions`/existing report data remains separate from `transactionHistoryItems`.
- Dashboard/report totals/recent transaction displays are not inflated by full history feed.

### Sorting policy
- History mode displays ascending order with latest at bottom.
- Date sort toggle is disabled/hidden/non-interactive in history mode, or sorting remains only in legacy/report mode.

### Date grouping
- Prepared rows render one compact date header before the first transaction of each date.
- No date header appears for empty dates.
- Header rows do not change transaction row markup or height.

## Playwright/E2E tests
Add or extend `e2e/specs/transactions.spec.js` and `e2e/support/helpers.js`.

### Helper support
Extend `createBasicTransaction(page, opts)` to support explicit `occurredOn`/date values while preserving current default behavior.

### Non-consecutive date grouping
Setup:
- Register/login test user.
- Create transactions on 3+ non-consecutive dates, e.g. 2026-03-17, 2026-03-18, 2026-03-20.

Assertions:
- Date headers/dividers exist for those exact dates.
- No header exists for empty dates such as 2026-03-19.
- Transaction rows remain visible under correct date groups.
- Header height is bounded and row heights remain compact, reusing current `expectCompactLedgerRow` style checks where possible.

### Initial today/latest anchor
- Create or locate transactions with latest date <= today.
- Open transaction tab.
- Assert the latest/today endpoint is reachable/visible after initial load.
- Assert no future-date endpoint/header appears.

### Upward older loading and anchor stability
- Ensure more records exist than a test page limit or use test-only small limit if available.
- Scroll near the top sentinel.
- Assert older records are loaded/prepended.
- Record a stable `data-transaction-id` row's bounding rect before/after load and assert it stays within an acceptable delta after `window.scrollBy` compensation.
- Assert no duplicate rows.

### Month jump + downward newer return
- Use month controls to jump to a past month.
- Assert history feed resets around selected month-end clamped by backend today.
- Scroll downward/bottom sentinel to load newer rows.
- Assert loading stops at today/latest and does not go beyond.

### Sort neutrality
- Assert the date header sort control cannot invert history order in history mode.
- If a legacy/report mode retains sort, assert it is scoped and does not affect history scroll semantics.

### Existing transaction interactions remain intact
- Create, inline edit, delete still work.
- Selection summary still works.
- Mobile sticky filters still work.
- Existing compact mobile row height remains bounded (currently tests assert rows <= 56px).
- FAB/sheet behavior remains stable.

## Local verification commands
Run at minimum after implementation:
```bash
uv run python -m pytest -q
npm run frontend:build
npm run lint --prefix frontend
npm run e2e:raw -- e2e/specs/transactions.spec.js
```

Before final done/release claim, run broader gate when feasible:
```bash
npm run quality:gate
```

If a command cannot run, record the blocker and run the next-best targeted check.

## Hotfix/release verification
1. Confirm branch state and sync:
   - `git status -sb`
   - fetch latest remote refs
   - rebase/merge latest `hotfix/v0.1.2` before dev deploy/live test
2. Resolve conflicts and rerun relevant local verification.
3. Commit/push from task/hotfix branch, not `main`/`develop`.
4. Use `$enm-jenkins` to confirm Jenkins build success.
5. Use `$enm-server` to confirm dev deployment state.
6. Smoke `https://dev.moneyflow.enmsoftware.com/` and `/healthz`.

## Dev live-smoke checklist
Credentials/config source:
- `/home/enmso/workspace/daeng/git/project/money-flow-service/.omx/.env`

Steps:
1. Login to dev with configured account.
2. Create prefixed temporary transactions across multiple dates/months, e.g. prefix `omx-history-scroll-<timestamp>`.
3. Verify:
   - initial latest/today endpoint;
   - upward older loading;
   - month jump to past;
   - downward newer return to today/latest;
   - no future endpoint;
   - date headers only for dates with transactions;
   - compact row density;
   - month controls still present.
4. Delete/cleanup temporary transactions when possible.
5. Record cleanup result and any remaining prefixed records.

## Stop condition for implementation
Implementation may be reported complete only when:
- PRD acceptance criteria are satisfied or documented as an explicit residual risk.
- Backend/API tests pass.
- Frontend build/lint pass.
- Transaction E2E passes or a precise environmental blocker is documented with next-best evidence.
- Branch is synced with `hotfix/v0.1.2` before dev live test.
- Jenkins/dev/live smoke evidence is collected for release completion.
