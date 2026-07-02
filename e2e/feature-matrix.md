# Full E2E Feature Matrix

This matrix defines the exhaustive E2E scope for local, staging, and pre-deploy Jenkins gates.

## Coverage policy

- Environments: `local` -> `staging` -> `dev.moneyflow.enmsoftware.com` smoke.
- Devices: `mobile` + `tablet` + `desktop`.
- Result format per item: pass/fail, screenshot evidence, blocking severity.

## Functional matrix

| Domain | UI Entry | Core User Flow | Backend Surface | Realtime/Mail Dependency | E2E Status |
| --- | --- | --- | --- | --- | --- |
| Auth | Login/Register panel | Register -> Verify email -> Login -> Logout -> Re-login | `POST /api/v1/auth/register`, `POST /api/v1/auth/verify-email`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/refresh`, `GET/PATCH /api/v1/auth/me`, `GET /api/v1/auth/client-config` | Email verification, cookie/CSRF path | Planned exhaustive |
| Dashboard | `dashboard` tab | Empty state -> onboarding guide -> chart load -> summary cards | `GET /api/v1/dashboard/overview`, `GET /api/v1/dashboard/portfolio` | Price/Fx dependencies can affect chart availability | Planned exhaustive |
| Transactions | `transactions` tab | Create -> Inline edit -> Delete -> Filter/search -> Owner/category linkage | `GET/POST/PATCH/DELETE /api/v1/transactions` | Owner/member consistency | Planned exhaustive |
| Holdings | `holdings` tab | Create (cash/stock/crypto) -> Inline edit -> Delete -> tab filtering | `GET/POST/PATCH/DELETE /api/v1/holdings` | Price refresh affects valuation | Planned exhaustive |
| Settings | `settings` tab | Profile save -> Household settings save -> Row colors -> Category add/edit/delete/rename-major | `GET/PATCH /api/v1/household/settings`, `GET/POST/PATCH/DELETE /api/v1/categories`, `POST /api/v1/categories/rename-major` | Cross-screen UI sync | Planned exhaustive |
| Collaboration | `collaboration` tab | Invite send -> Received invite -> Accept -> Switch household -> Role change -> Member remove guards | `GET /api/v1/household/members`, `GET /api/v1/household/invitations`, `GET /api/v1/household/invitations/received`, `POST /api/v1/household/invitations`, `POST /api/v1/household/invitations/accept`, `POST /api/v1/household/invitations/{id}/accept`, `DELETE /api/v1/household/invitations/{id}`, `PATCH /api/v1/household/members/{id}/role`, `DELETE /api/v1/household/members/{id}`, `GET /api/v1/household/current`, `GET /api/v1/household/list`, `POST /api/v1/household/select` | Invitation email + membership state | Planned exhaustive |
| Imports | `import` tab | Workbook upload -> Dry run -> Apply -> Mismatch/issue preview -> Imported rows visible | `POST /api/v1/imports/workbook`, `POST /api/v1/imports/workbook/upload` | Large payload/upload proxy limits | Planned exhaustive |
| Prices | Dashboard/Holdings refresh actions | Trigger refresh -> status polling -> reflected price/valuation | `POST /api/v1/prices/refresh`, `GET /api/v1/prices/status` | External market/Fx services | Planned exhaustive |
| WebSocket sync | Hidden runtime channel | Issue ticket -> connect websocket -> receive household change event -> enforce disconnect on access loss | `POST /api/v1/household/ws-ticket`, `GET /ws/v1/household/{household_id}` | Active session + membership permission | Planned exhaustive |
| System health | Non-UI smoke | App health before and after deploy | `GET /healthz`, `GET /readyz` | Infra/boot readiness | Planned exhaustive |

## UI/Responsive checklist (every major flow)

- No horizontal overflow on `mobile` and `tablet`.
- Primary CTA visible and enabled.
- Tab/header/content spacing does not collapse.
- Table-to-card conversion remains readable on small viewports.
- Inline edit forms preserve focus order and keyboard navigation.
- At least 3 screenshots per scenario (entry, interaction, result).

## Planned E2E spec split map

- `e2e/specs/auth.spec.js`
- `e2e/specs/dashboard.spec.js`
- `e2e/specs/transactions.spec.js`
- `e2e/specs/holdings.spec.js`
- `e2e/specs/settings.spec.js`
- `e2e/specs/collaboration.spec.js`
- `e2e/specs/import.spec.js`
- `e2e/specs/prices.spec.js`
- `e2e/specs/ws.spec.js`
- `e2e/specs/deeplink.spec.js`

