# Issue 287 Manual QA Matrix

| Area | Scenario | Expected result | Evidence |
| --- | --- | --- | --- |
| Android monthly ledger | Tap a compact transaction row | Row expands details and does not select the row | `focused-e2e.txt`, `transactions-spec-e2e.txt` |
| Android monthly ledger | Long-press a compact row | Row selection toggles without opening the detail area | `focused-e2e.txt`, `transactions-spec-e2e.txt` |
| Android monthly ledger | Long-press then drag | Gesture cleanup prevents stuck auto-scroll or stale selection timers | `focused-e2e.txt`, `transactions-spec-e2e.txt` |
| Android monthly ledger | Touch scroll through the ledger | Monthly list scrolls normally and no history sentinel/date chrome appears | `focused-e2e.txt`, `transactions-spec-e2e.txt` |
| Keyboard accessibility | Focus compact row and press Space | Row details open and close; selection remains false | `focused-e2e.txt`, `transactions-spec-e2e.txt` |
| Keyboard accessibility | Focus compact row and press Shift+Space | Row selection toggles without opening the detail area | `compact-keyboard-selection-e2e.txt` |
| Large month | Load 1001 monthly rows | Frontend requests offset 0 and 1000 and renders row 1001 | `paged-ledger-e2e.txt`, `transactions-spec-e2e.txt` |
| Rapid month switch | Slow previous-month response arrives after returning to current month | Current month row remains visible and stale previous-month row is ignored | `stale-refresh-e2e.txt`, `focused-e2e.txt`, `transactions-spec-e2e.txt` |
| Backend pagination | Request `limit=2&offset=1` | API returns the second and third rows in stable order | `backend-offset-pagination.txt`, `pytest.txt` |
| Backend pagination cap | Request `offset=60001` | API rejects the request before reaching an unbounded DB offset | `backend-offset-pagination.txt`, `pytest.txt` |
