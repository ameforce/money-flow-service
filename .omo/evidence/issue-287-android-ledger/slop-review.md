# Issue 287 Programming and AI Slop Review

Scope: #287 branch diff against `hotfix/v0.1.38`.

Behavior lock:

- `test_transaction_list_supports_offset_pagination_in_order`
- `test_transaction_list_rejects_excessive_offset`
- `issue 287: monthly transaction ledger loads every paged row`
- `issue 287: monthly transaction ledger loads every paged row` also asserts latest-row initial anchoring.
- `mobile transaction row selection, touch scroll, and sticky ledger head survive Korean font viewports` covers sticky header geometry after the latest-row anchor fix.
- `issue 287: stale monthly transaction refresh cannot replace the active month`
- `import flow: workbook dry-run and apply` covers import reveal after a different-month workbook applies.
- `import flow: workbook dry-run and apply` also covers targeted import reveal priority by adding newer same-month rows and asserting the imported row stays in view.
- `issue 197: transaction month direct input clearly marks unapplied changes until Enter` now also covers latest-row anchoring after an applied month switch with many target rows.
- `issue 287: Android PWA transaction ledger uses monthly dense rows` covers compact `Space` expansion and `Shift+Space` selection
- Existing Android/PWA monthly ledger and mobile selection E2E coverage

Cleanup plan:

- `backend/app/api/routes/transactions.py`: boundary control only. Keep offset pagination, add server-side cap.
- `frontend/src/App.jsx`: root-cause fix at the shared refresh seam. Keep one request/filter guard instead of per-call stale checks.
- `frontend/src/components/worksurface/TransactionSurfaceTable.jsx`: keep compact Space/Shift+Space handlers and unmount cleanup. No extra abstraction.
- `e2e/specs/transactions.spec.js`: add observable regressions only; no snapshot or implementation-only assertions beyond the API pagination contract.

Slop review results:

- Obvious comments: none added.
- Over-defensive code: no duplicate null guards or broad catches added.
- Excessive complexity: request guard is two small helpers reused by both refresh paths; no public API change.
- Needless abstraction: no new module/dependency or pass-through wrapper.
- Boundary violations: none. Backend offset validation remains at FastAPI query boundary.
- Dead code/debug leftovers: none found in the changed hunks.
- Duplication: stale-request logic centralized in `beginTransactionLedgerRequest` / `isTransactionLedgerRequestCurrent`.
- Performance risk: API offset is capped server-side; frontend page loop remains capped.
- Oversized modules: legacy debt acknowledged, not expanded into unrelated extraction.

Quality gates:

- pytest: PASS.
- frontend build: PASS.
- frontend lint: PASS with existing App.jsx warnings only.
- focused #287 E2E: PASS.
- full transactions E2E: PASS.
- static/security scan: covered by review and boundary tests; no project scanner configured for this slice.

Final status: CLEAN for #287 hotfix scope.
