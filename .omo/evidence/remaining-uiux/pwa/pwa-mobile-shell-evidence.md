# PWA Mobile Shell Evidence

## Scope

- Issue #275: mobile browser PWA installability.
- Issue #279: mobile topbar price refresh visual language.

## Implementation

- Added `frontend/public/manifest.webmanifest` with installable manifest fields, 192px and 512px PNG icons, theme/background colors, standalone display, and Korean metadata.
- Added `frontend/public/sw.js` with a narrow shell/static-asset service worker cache. API and WebSocket traffic are not intercepted.
- Registered `/sw.js` only in production via `frontend/src/main.jsx`.
- Reworked mobile `.topbar-actions` so refresh, price refresh, and logout use equal 44px icon-centered buttons with inline SVG icons.
- Kept the general refresh action's accessible name stable as `새로고침`; transient loading state now uses hidden `role="status"` copy referenced by `aria-describedby`.
- Preserved the price refresh accessible name `시세 갱신` and moved progress state to hidden `role="status"` copy referenced by `aria-describedby`.
- Updated `DESIGN.md` with the Topbar Global Actions contract.

## Failing-First Proof

- `npm run pwa:verify` failed before implementation with `index.html must link /manifest.webmanifest`.
- `npm run e2e -- e2e/specs/dashboard.spec.js --grep "dashboard mobile topbar uses compact price refresh icon action" --workers=1` failed before implementation because the price-refresh button did not expose stable `aria-label="시세 갱신"` and still followed the old visible-text contract.
- First visual QA design-system pass returned `REVISE` because CSS glyph pseudo-icons violated `DESIGN.md`; fixed by replacing pseudo glyphs with inline SVG icons and strengthening the E2E assertion.
- Final design-system review found the general refresh action still had a changing accessible name; fixed with stable `aria-label="새로고침"` plus hidden live status copy and added E2E assertions.

## Verification

- `npm run pwa:verify` passed.
- Production preview PWA runtime check passed:
  - `/manifest.webmanifest` returned 200 with `application/manifest+json`.
  - `display` was `standalone`.
  - `/icons/pwa-192.png`, `/icons/pwa-512.png`, and `/icons/maskable-512.png` returned 200 as PNGs.
  - `/sw.js` became active and controlled the page after reload.
- `npm run e2e -- e2e/specs/dashboard.spec.js --grep "dashboard mobile topbar uses compact price refresh icon action" --workers=1` passed.
- `npm run e2e -- e2e/specs/dashboard.spec.js --grep "price refresh polling releases the global busy state after status failures" --workers=1` passed.
- `npm run frontend:build` passed.
- `npm run lint --prefix frontend` passed with 0 errors and 12 pre-existing React hook warnings.

Raw logs are saved in `.omo/evidence/remaining-uiux/pwa/logs/` and mirrored to the team artifacts directory.

## Visual Evidence

- `.omo/evidence/remaining-uiux/pwa/dashboard-mobile-price-refresh-icon-action-320x568.png`
- `.omo/evidence/remaining-uiux/pwa/dashboard-mobile-price-refresh-icon-action-390x844.png`
- Mirrored to `C:\Users\enmso\.codex\worktrees\4e5e\money-flow-service\.omo\teams\team-358f7305\artifacts\PWA\`.

## Independent Review

- Design-system/functional review: `.omo/evidence/remaining-uiux/pwa/design-system-review.md` PASS.
- Visual/CJK review: `.omo/evidence/remaining-uiux/pwa/visual-cjk-review.md` PASS.

## Manual QA Matrix / Notepad

- Matrix: `.omo/evidence/remaining-uiux/pwa/manual-qa-matrix.md`
- Notepad path: `.omo/evidence/remaining-uiux/pwa/pwa-mobile-shell-evidence.md`

## Post-Write Review

- `git diff --check` passed with no whitespace errors.
- `git diff --summary --diff-filter=T` showed no mode-only drift.
- LOC review is saved at `.omo/evidence/remaining-uiux/pwa/logs/post-write-loc-check.log`.
- `frontend/src/App.jsx`, `frontend/src/App.css`, and `e2e/specs/dashboard.spec.js` exceed the OMO size ceiling as pre-existing repo debt. This slice kept edits narrow to the assigned topbar/PWA behavior; the broader `App.jsx` extraction remains outside PWA scope and is owned by the system-proof lane.

## Notes

- Full Lighthouse PWA scoring was not run; the runtime check verifies the installability metadata, icon assets, and service worker registration path directly in Chromium against the production build.
