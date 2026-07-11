# UI/UX Data Lifecycle Trust Matrix

This matrix is the UI contract for whether users can understand where their
money data is in the lifecycle: ready to input, being validated, being saved,
synced to the household, imported, failed, or requiring action.

## Required States

| ID | Lifecycle state | User-facing surface | Trust requirement | Current evidence |
| --- | --- | --- | --- | --- |
| TX-ENTRY-READY | Transaction entry ready | Transaction quick sheet banner and primary amount/category/memo path | The repeated transaction task starts in a shallow path and explains the immediate order without opening secondary details. | `e2e/specs/transactions.spec.js` transaction primary path and issue #256/#257/#259 checks |
| TX-ENTRY-VALIDATION | Transaction input blocked by invalid data | Date and amount field helper text | Blocking errors must be tied to the exact field with `aria-invalid`, `aria-describedby`, and `role=alert`. | `e2e/specs/uiux-accessibility-gates.spec.js` issue #246 |
| TX-SAVE-COMMIT | Transaction saved or failed | Global status message plus highlighted saved/imported rows | Save success/failure must leave a visible status and keep the ledger context stable after the mutation. | `frontend/src/App.jsx`, `TransactionSurfaceTable.jsx`, transaction E2E save/edit checks |
| DASHBOARD-REALTIME | Household sync state | Topbar realtime socket chip | Realtime state must be visible, compact at mobile width, and available as a full `aria-label`. | `e2e/specs/dashboard.spec.js` realtime status check |
| PRICE-STALE-REFRESH | Price refresh and stale market data | Dashboard status card and non-blocking status surfaces | Price refresh delay must not shift the dashboard filter flow or hide primary context. | `e2e/specs/dashboard.spec.js` price refresh/status checks |
| IMPORT-PREFLIGHT | Import file selected and preflight validation | Import upload panels, disabled action helper, progress status, validation report | Users must know when a file is required, when validation is running, and what was checked before applying. | `frontend/src/pages/importing/WorkbookImportPanel.jsx` progress status; `e2e/specs/import.spec.js` no-file, dry-run, large-report checks |
| IMPORT-APPLY | Import applied to live records | Import report summary and post-apply navigation actions | Users must see exact applied transaction/holding counts and direct paths to review the affected records. | `e2e/specs/import.spec.js` workbook dry-run/apply |
| IMPORT-ISSUE-REMEDIATION | Import produced actionable issues | Import issue workbench filters, CSV copy/download, row anchors | Large issue sets must be searchable, filterable, exportable, and linked to row targets. | `e2e/specs/import.spec.js` large report workbench |
| IMPORT-TECHNICAL-DETAILS | Import technical diagnostics | Collapsed technical details | Raw diagnostics must stay collapsed by default and sanitized before disclosure. | `e2e/specs/import.spec.js` technical details sanitized check |
| AUTH-PERMISSION | Auth, invite, and permission boundary | Login/register messages, invite banners, disabled controls | Users must receive action-specific guidance instead of generic server failures when authority changes. | `frontend/src/App.jsx` error mapping and collaboration E2E |
| GLOBAL-ERROR-RECOVERY | Network/API failure and retry path | Global message and contextual helper copy | Failures must explain what happened, the next retry action, and avoid stealing layout space for passive refresh. | `frontend/src/App.jsx`, dashboard passive refresh tests |

## Review Rules

- New lifecycle states must add a row to this matrix before implementation is considered complete.
- A row is not valid unless it names a user-facing surface and at least one evidence file.
- Passive sync or refresh feedback must use persistent status surfaces; reserve dismissible global messages for errors or user-actionable states.
- Blocking form validation belongs beside the field, not only in a global message.
- Import and migration flows must separate preflight, apply, issue remediation, and technical diagnostics.
