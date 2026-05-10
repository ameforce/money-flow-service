# PRD: Toss-like Transaction History Scroll

## Status
- Workflow: `$ralplan --consensus --direct .omx/specs/deep-interview-transaction-history-scroll.md`
- Consensus: **APPROVED**
- Architect: **APPROVE** after v2 revisions
- Critic: **APPROVE** after v2.1 revisions
- Source requirements: `.omx/specs/deep-interview-transaction-history-scroll.md`
- Planning draft: `.omx/plans/ralplan-transaction-history-scroll-draft.md`
- Target execution branch: `feat/transaction-history-scroll`
- Required pre-live integration: latest `hotfix/v0.1.2`

## Problem
Money-flow's transaction list is currently month/range driven. Users who want to review ledger history must navigate month-by-month instead of continuously moving through transaction history. The desired UX is closer to Toss: start at today/latest, scroll upward into older history, and scroll downward back toward today/latest without future navigation.

## Goals
1. Transaction tab initially anchors around today/latest transaction history.
2. Upward scrolling progressively loads older transactions/months.
3. Downward scrolling from a past position returns toward newer data and stops at today/latest.
4. Future dates after backend-authoritative `today` are not accessible in the history feed.
5. Transactions are separated by actual transaction date using compact, thin date headers/dividers.
6. Existing month controls remain as auxiliary jump controls.
7. Existing compact Excel-like row density is preserved.
8. Existing dashboard/report/month transaction semantics remain compatible.
9. Feature is locally verified, then synchronized with latest `hotfix/v0.1.2`, deployed to dev, and live-smoked using `.omx/.env` account credentials.

## Non-goals
- Removing/replacing month controls entirely.
- Card-style transaction redesign, large vertical spacing, or row-height-heavy visual changes.
- Showing empty calendar days with no transactions.
- Global search/filter overhaul across all historical transactions.
- Broad dashboard, holdings/assets, settings, auth, or collaboration UX redesign.
- Changing the existing `GET /api/v1/transactions` response shape.

## Users / jobs-to-be-done
- As a household finance user, I want to review old and recent transactions continuously so I do not have to click month-by-month.
- As a user checking cashflow on specific dates, I want visual date separators so I can scan daily groups quickly without losing dense table layout.
- As a user already relying on month controls, I want those controls to remain available as a quick jump mechanism.

## Current implementation facts
- `backend/app/api/routes/transactions.py` currently exposes `GET /transactions` as a bare `list[TransactionRead]` with `year`, `month`, `start_date`, `end_date`, and `limit`.
- `frontend/src/App.jsx` currently owns `filterMode`, `yearMonth`, `range`, transaction fetching, filtering, sorting, and month controls.
- `frontend/src/components/worksurface/TransactionSurfaceTable.jsx` renders a flat table and currently exposes date sort behavior.
- Existing `transactions` state feeds more than the transaction tab, including dashboard/report/recent transaction derived UI.
- Mobile/sticky transaction behavior currently depends on `window` scroll.

## Decision summary
Implement a dedicated transaction history/feed path using a new `/api/v1/transactions/history` endpoint and a separate frontend history state path.

### Why this option
- Preserves the existing `GET /transactions` list contract for report/month callers.
- Gives the history UI explicit pagination metadata and backend-authoritative `today`.
- Makes cursor, no-future, tenant isolation, and scroll continuity testable.
- Avoids a broad virtualized/search overhaul that exceeds first-pass scope.

## Functional requirements

### Backend history feed
Add `GET /api/v1/transactions/history` returning a page envelope:

```json
{
  "items": [/* TransactionRead */],
  "older_cursor": "... or null",
  "newer_cursor": "... or null",
  "has_older": true,
  "has_newer": false,
  "anchor_date": "2026-05-03",
  "today": "2026-05-03"
}
```

Parameters:
- `anchor_date?: date` — defaults to backend `today`; future values are clamped to backend `today`.
- `direction?: "initial" | "older" | "newer"` — default `initial`.
- `cursor?: string` — opaque cursor for `(occurred_on, created_at, id)`.
- `limit?: int` — default around 80-150; max around 300-500.

Contract:
- Backend `today` is authoritative and returned in every response.
- Items are returned in ascending `(occurred_on, created_at, id)` order for display.
- `older_cursor` is based on the first returned item; `newer_cursor` is based on the last returned item.
- `limit + 1` sentinel rows are used to compute `has_older`/`has_newer`, and sentinel rows are excluded from returned `items` before cursors are finalized.
- Invalid/malformed/foreign cursors return a safe 400 and never broaden query scope.
- Cursor values never authorize access; every query is scoped by current household.
- Cursors should be opaque and signed/HMAC-protected when practical; otherwise strict decode/validation plus household-scoped query enforcement is mandatory.
- Add or document a composite index such as `(household_id, occurred_on, created_at, id)` for cursor queries.

### Frontend state and UX
- Introduce separate history feed state:
  - `transactionHistoryItems`
  - `transactionHistoryOlderCursor` / `transactionHistoryNewerCursor`
  - `transactionHistoryHasOlder` / `transactionHistoryHasNewer`
  - `transactionHistoryLoadingOlder` / `transactionHistoryLoadingNewer` / `transactionHistoryInitialLoading`
  - `transactionHistoryToday`
  - `transactionHistoryAnchorDate`
- Keep existing period/report/month data separate, e.g. `periodTransactions`, so dashboard/report totals are not inflated by full history data.
- History mode display order is invariant ascending. Existing date sort controls must not invert the history feed; render the date header as non-interactive in history mode or restrict sorting to legacy/report mode.
- Month controls remain visible. Selecting a month resets the history feed with `anchor_date = min(selected month end, backendToday)`.
- Header filters may apply to the loaded history window unless server-side filter pagination is explicitly added; copy must not imply global search if only loaded items are filtered.

### Scroll behavior
- Use `window` scroll root for the first pass to preserve existing mobile sticky behavior.
- Top sentinel near the first rows triggers `loadOlder()`.
- Bottom sentinel near the last rows triggers `loadNewer()` only when `has_newer` is true.
- Older prepend must preserve visible position:
  1. Record stable first visible transaction row id and `getBoundingClientRect().top`.
  2. Fetch/prepend older de-duplicated items.
  3. On next layout frame, find the same row and compute `delta = newTop - oldTop`.
  4. `window.scrollBy(0, delta)`.
- Add a stable DOM anchor identifier such as `data-transaction-id` on transaction rows.

### Date grouping and density
- Render a compact date group row/divider before the first transaction for each `occurred_on` date.
- Show only dates with transactions; no empty dates.
- Date headers should be thin and bounded; transaction rows must remain close to existing compact row height.
- Preserve existing selection, inline edit, delete, mobile sticky filters, and compact row interactions.

### CRUD integration
- Create: if new transaction falls within the history cap, insert/upsert into history feed or trigger a compact reload without duplicates.
- Edit: if `occurred_on` changes, move the item across date groups via upsert+resort or reload.
- Delete: remove visible item from history items and clear relevant selection/expanded state.
- Period/report refresh remains independent.

## Operational requirements
- Before dev deploy/live test, fetch and rebase/merge with latest `hotfix/v0.1.2`.
- Run local verification before reporting implementation complete.
- Commit/push on the task/hotfix branch; do not commit directly to `main` or `develop`.
- Confirm Jenkins build and dev deployment via `$enm-jenkins` and `$enm-server`.
- Live test at `dev.moneyflow.enmsoftware.com` using `/home/enmso/workspace/daeng/git/project/money-flow-service/.omx/.env` credentials/config.
- Live test may create prefixed temporary transactions across multiple dates/months and should clean them up when possible.

## Acceptance criteria
1. Transaction tab enters at today/latest history endpoint.
2. Upward scroll loads older records and preserves current visible row position.
3. Downward scroll from a past/month-jumped position loads newer records until today/latest and then stops.
4. No future-dated records/endpoints are visible in the history feed even if such rows exist in DB.
5. Non-consecutive transaction dates render date headers for only those dates.
6. Transaction rows remain compact; no card-style spacing or row-height regression.
7. Existing month controls remain and function as jump controls.
8. History order cannot be inverted by the existing date sort toggle.
9. Dashboard/report data remains based on period transactions, not full history feed.
10. Existing transaction create/edit/delete/mobile sticky flows do not regress.
11. Backend and E2E tests cover the history contract and UI behavior.
12. Dev live smoke verifies grouping, scroll, no-future cap, month jump, and cleanup.

## ADR
### Decision
Add a dedicated transaction history/feed endpoint and separate frontend history state to implement Toss-like continuous transaction browsing with compact date grouping.

### Drivers
- Deterministic continuous scroll semantics and no-future cap.
- Backward compatibility for existing `/transactions` list/report callers.
- Compact table density and existing transaction-tab behavior preservation.
- Testability of cursor continuity, tenant safety, and scroll anchoring.

### Alternatives considered
- Existing endpoint month-window stitching: rejected because it lacks durable cursor/has-more semantics and can truncate dense windows silently.
- Extending existing `/transactions` with history envelope params: rejected because it risks route ambiguity and response-shape drift for list callers.
- Full virtualized/global-search overhaul: rejected as too broad for first-pass scope.

### Consequences
- Adds a new API and frontend state path.
- Requires careful CRUD synchronization and state partitioning.
- Requires cursor/index rigor and expanded tests.
- Provides safer rollback and less risk to existing report/month behavior.

### Follow-ups
- Consider server-side global filters/search for history in a later scope.
- Consider virtualization only if measured row counts/performance require it.
- Preserve live-smoke cleanup evidence in release notes.

## Available agent types and execution staffing guidance

### Available agent types
- `explore`: repo mapping, selector/file lookup.
- `architect`: boundary/API/state design review.
- `executor`: implementation/refactor work.
- `test-engineer`: backend/E2E test strategy and fixture work.
- `verifier`: completion evidence, release/live-smoke checks.
- `code-reviewer`: final comprehensive review.
- `build-fixer`: build/lint/E2E failure diagnosis and repair.

### `$ralph` sequential path
Use one persistent execution owner:
1. Backend feed + tests.
2. Frontend state/fetch/month-jump/sort neutrality.
3. Window-scroll sentinels and anchor preservation.
4. Compact date grouping/CSS.
5. E2E helper and scenarios.
6. Hotfix sync, local verification, Jenkins/dev/live evidence.

Suggested reasoning: high for backend/frontend state and scroll anchoring; medium for CSS/helper updates; high for final verification/release.

### `$team` parallel path
Use when parallel execution is desired:
- Lane A (`executor`, high): backend history endpoint, cursor/index, pytest.
- Lane B (`executor`, high): frontend history state/fetch/month jump/sort neutrality in `App.jsx`.
- Lane C (`executor` or `designer`, medium): compact date header rendering/CSS in `TransactionSurfaceTable.jsx` and `App.css`.
- Lane D (`test-engineer`, medium): explicit-date Playwright helper, E2E scenarios, live-smoke checklist.
- Lane E (`verifier`, high, after integration): local verification, hotfix sync, Jenkins/dev/live evidence.

Shared-file risk: Lane B and Lane C both touch transaction rendering props; define the prop/input contract before parallel edits.

### Team launch hint
```bash
$team .omx/plans/prd-transaction-history-scroll.md .omx/plans/test-spec-transaction-history-scroll.md
```
