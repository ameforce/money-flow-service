# Manual QA Matrix - PWA Mobile Shell

## Current Revision

- Worktree: `C:\Users\enmso\.codex\worktrees\4e5e\money-flow-service\.omo\teams\team-358f7305\worktrees\PWA`
- Branch: `team/team-358f7305/PWA`
- Scope: issues #275 and #279 only.

| Area | Viewport / Surface | State | Evidence | Result |
| --- | --- | --- | --- | --- |
| Mobile topbar | 320x568, Korean font fallback | Dashboard loaded, default price-refresh idle | `dashboard-mobile-price-refresh-icon-action-320x568.png`; `e2e-topbar-icon-action.log` | PASS |
| Mobile topbar | 390x844, Korean font fallback | Dashboard loaded, default price-refresh idle | `dashboard-mobile-price-refresh-icon-action-390x844.png`; `e2e-topbar-icon-action.log` | PASS |
| Mobile topbar | 320x568 and 390x844 | Topbar action contract | E2E asserts stable `aria-label="시세 갱신"`, hidden status description, no visible price-refresh text, equal widths, >=44px hit target, inline SVG icons, no CSS pseudo glyphs, and no horizontal overflow | PASS |
| Price refresh status | 390x844 | Polling status failures after manual refresh | `e2e-price-refresh-polling.log` | PASS |
| PWA metadata | Production build preview | Manifest/icon/service-worker runtime | `pwa-runtime-chromium.log`; `pwa-verify.log` | PASS |
| Build and lint | Frontend | Production bundle and lint | `frontend-build.log`; `frontend-lint.log` | PASS, lint has 0 errors and existing hook warnings |

## Visual Notes

- The 320px and 390px captures show three equal compact topbar actions: refresh, price refresh, and logout.
- `시세 갱신` is not visible as a mobile text button; the action remains available by accessible name and described status.
- No horizontal overflow, topbar collision, or CJK clipping is visible in the reviewed topbar and first dashboard sections.

## Notepad / Handoff Path

- Primary note: `.omo/evidence/remaining-uiux/pwa/pwa-mobile-shell-evidence.md`
- Shared team handoff: `C:\Users\enmso\.codex\worktrees\4e5e\money-flow-service\.omo\teams\team-358f7305\artifacts\PWA\pwa-mobile-shell-evidence.md`
