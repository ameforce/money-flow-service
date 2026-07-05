# VER/client-version Notepad

## Bootstrap
- Worktree: `C:\Users\enmso\.codex\worktrees\4e5e\money-flow-service\.omo\teams\team-358f7305\worktrees\VER`
- Branch: `team/team-358f7305/VER`
- Scope: GitHub issue #282 only; no transaction ledger or PWA installability scope except cache-control/service-worker boundaries.
- Issue source: `gh issue view 282` returned `state=OPEN`, title `모바일 열린 탭이 배포 후 새 프론트엔드 번들을 감지하지 못함`, URL `https://github.com/ameforce/money-flow-service/issues/282`.

## Skills
- `using-superpowers`: process discipline.
- `test-driven-development`: RED before production code.
- `omo:programming`: Python/JS edit discipline.
- `omo:frontend`: existing `DESIGN.md` and topbar/status UI constraints.
- `omo:visual-qa`: browser evidence after UI change.
- `verification-before-completion`: evidence before completion/commit claims.

## Tier
- HEAVY: cache invalidation/static cache-control and open SPA runtime version detection can overlap with PWA boundaries.

## Success Criteria
1. Backend exposes a no-store/no-cache current client version contract and static cache-control separates HTML/version surfaces from hashed assets.
2. Frontend compares bundled `APP_VERSION` to the latest server version on visibility/focus/interval and exposes a persistent topbar/status CTA or safe idle reload.
3. Focused tests prove RED -> GREEN, and browser evidence shows an already-open mobile SPA detects a newer server version.

## Scenario Plan
- Backend API/cache policy: `uv run --extra dev python -m pytest backend/tests/test_client_version.py -q`.
- Frontend unit/source contract: `node --test ./frontend/src/clientVersion.test.mjs`.
- Open mobile tab E2E: `npm run e2e:raw -- e2e/specs/client-version.spec.js --project=desktop-chromium`.
- HTTP surface: `curl -i http://127.0.0.1:<port>/api/v1/system/client-version` and `/assets/...`.

## Evidence Log
- Initial command mistakes saved in `red-backend.txt` and `red-frontend-unit.txt`; they are not counted as RED because files were not yet in VER.
- Pending valid RED after VER-only test files are added.
