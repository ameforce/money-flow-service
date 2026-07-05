# Issue #282 Code Review

codeQualityStatus: WATCH
recommendation: APPROVE
reportPath: .omo/evidence/issue-282-code-review.md
blockers: []

## Scope Reviewed

- Worktree: `C:\Users\enmso\.codex\worktrees\4e5e\money-flow-service\.omo\teams\team-358f7305\worktrees\VER`
- Scope: GitHub issue #282 only, mobile/open SPA tab detects a newly deployed frontend bundle.
- Explicitly excluded: transaction ledger issues #274/#276/#277/#278 and PWA/topbar issues #275/#279 except cache-control/service-worker boundary risks.
- Source diff reviewed: `backend/app/api/routes/system.py`, `backend/app/main.py`, `frontend/src/App.css`, `frontend/src/App.jsx`, plus untracked issue-scoped files `backend/tests/test_client_version.py`, `e2e/specs/client-version.spec.js`, `frontend/src/clientVersion.js`, `frontend/src/clientVersion.test.mjs`.
- Evidence reviewed: all requested files under `.omo/evidence/remaining-uiux/version/`, plus `notepad.md`, `http-server.log`, and `output/playwright/e2e-flow/1783220092967-issue-282-client-version-update.png`.

## Skill Perspective Check

- `omo:remove-ai-slops` consulted: yes. Applied review pass for overfit/slop in production code and tests.
- `omo:programming` consulted: yes. Also loaded Python and TypeScript reference README files before judging maintainability/test relevance.
- Skill-perspective result: no blocking violation. One LOW test-quality issue remains: a source-regex frontend test mirrors implementation strings rather than behavior. One LOW line-ending issue remains on a new file.

## CRITICAL

None.

## HIGH

None.

## MEDIUM

None.

## LOW

1. `frontend/src/clientVersion.test.mjs:40` uses a brittle source-regex test to assert `App.jsx` contains endpoint/focus/visibility/interval/CTA strings. This is implementation-mirroring coverage and would pass or fail on textual coincidences/refactors rather than observable behavior. It is not blocking because the Playwright E2E drives the actual mobile surface and the helper unit tests cover version comparison.

2. `frontend/src/clientVersion.js:1` is a new CRLF file while the touched tracked source files are LF and local Git is configured with `core.eol=lf`, `core.autocrlf=false`. This is a low line-ending hygiene risk, not whole-file churn in existing tracked files.

## Contract Review

- Server client-version endpoint: PASS. `backend/app/api/routes/system.py:16` sets `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`, `Pragma: no-cache`, and `Expires: 0`; `backend/app/api/routes/system.py:35` exposes `/api/v1/system/client-version`; `backend/app/api/routes/system.py:37` returns normalized `APP_VERSION`.
- Frontend version comparison: PASS. `frontend/src/App.jsx:33` computes bundled `APP_VERSION`, `frontend/src/App.jsx:8855` fetches `/api/v1/system/client-version` with `cache: "no-store"` and request `Cache-Control: no-cache`, and `frontend/src/App.jsx:8892`/`:8900`/`:8902` schedule interval, visibility, and focus checks.
- Visible topbar CTA / reload: PASS. `frontend/src/App.jsx:10782` renders the chip only when newer server version is available; `frontend/src/App.jsx:10790` provides a user-triggered `window.location.reload()` CTA. Screenshot evidence shows the mobile topbar chip and `새 버전 적용` button.
- Static cache-control: PASS. `backend/app/main.py:276` uses `no-cache, must-revalidate` for `/` and SPA fallback, `backend/app/main.py:277` uses `public, max-age=31536000, immutable` for `/assets`, and `http-cache-headers.txt` confirms `/`, `/definitely-spa-fallback`, `/api/v1/system/client-version`, and a hashed asset response.
- Offline/PWA boundary: PASS. No service-worker, Workbox, CacheStorage, or broad offline-first caching edits were found in the reviewed diff.
- Sensitive response caching: PASS. The diff does not add caching to authenticated API data; the only immutable cache path is the static `/assets` mount.
- Churn/mode risk: PASS with LOW note. `git diff --summary --diff-filter=T` is empty and tracked files are `w/lf`; no whole-file churn detected in tracked source.

## Evidence Review

- `red-backend.txt`: expected pre-fix failures for missing endpoint/cache/static helper.
- `red-frontend-unit.txt`: expected pre-fix failures for missing helper/module and missing app wiring.
- `red-e2e.txt`: expected pre-fix failure where `.client-version-chip` was not found.
- `green-backend.txt`: backend focused tests pass.
- `green-frontend-unit.txt`: frontend focused unit/source tests pass.
- `green-e2e.txt`: Playwright issue #282 scenario passes in 390x844 viewport; screenshot capture recorded.
- `frontend-build.txt`: `npm run frontend:build` exits 0.
- `frontend-lint.txt`: eslint exits 0 with 12 warnings, none introduced by the new client-version effect.
- `http-cache-headers.txt`: confirms no-cache/no-store/static immutable headers on the requested HTTP surfaces.

## Final Verdict

PASS. Recommendation is APPROVE with WATCH status for the two LOW cleanup notes above.
