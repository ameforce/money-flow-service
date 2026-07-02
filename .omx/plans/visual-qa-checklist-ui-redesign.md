# Visual QA Checklist — UI Redesign Hotfix v0.1.2

## Source artifacts reviewed

- Concept image: `.omx/artifacts/ui-redesign-concept-20260425.png` (1536×1024 accepted direction)
- PRD: `.omx/plans/prd-ui-redesign-hotfix-v012.md`
- Test spec: `.omx/plans/test-spec-ui-redesign-hotfix-v012.md`

This checklist is a qualitative acceptance aid, not a pixel-perfect spec. The implementation should preserve `hotfix/v0.1.2` behavior and selectors while moving the product toward the accepted Korean fintech command-center concept.

## Global visual acceptance baseline

- [ ] Brand language uses the approved blue/teal fintech palette with white/near-white surfaces; no purple/rainbow/neon drift.
- [ ] App surfaces use consistent radii, subtle shadows, calm borders, and clear spacing rather than generic dense cards.
- [ ] Typography hierarchy makes page title, KPI numbers, table rows, status copy, and secondary metadata immediately distinguishable.
- [ ] Korean copy, dates, and KRW values are legible at desktop and mobile widths with no mojibake or clipped glyphs.
- [ ] Loading, empty, error, cooldown, and success states remain visible and stylistically integrated.
- [ ] Focus states and semantic button/label affordances remain visible after visual polish.
- [ ] No viewport has unexpected horizontal overflow, especially at mobile width <= 760px.

## Desktop app shell and navigation

Use a ~1440px desktop screenshot for review.

- [ ] Left navigation reads as a premium finance side rail: logo at top, clear selected state, stable icon/text alignment, and service/status affordance at the bottom.
- [ ] Required tabs remain reachable and clearly named: 대시보드, 거래, 자산, 협업, 가져오기/데이터 가져오기, 설정.
- [ ] Top context bar shows household selector, realtime connection, refresh, price-refresh timestamp/status, and user/logout controls without crowding.
- [ ] Selected nav state is visually obvious and accessible without relying only on color.
- [ ] Collaboration unread badge/pulse remains visible where relevant.
- [ ] Desktop content max width, gutters, and card grid feel intentional rather than stretched or cramped.

## Desktop dashboard command center

- [ ] First row exposes the financial state at a glance: 총자산, 월 현금흐름, 수입, 지출, 투자/평가금액, 평가손익, 시세 정산 상태.
- [ ] KPI cards use strong number hierarchy, concise context labels, and semantic colors for gain/loss/status.
- [ ] Cashflow chart has readable axes, legends, time filters, and enough whitespace to compare 수입/지출/현금흐름.
- [ ] Asset allocation chart shows total-center context plus category percentages/amounts without overlap.
- [ ] Recent transactions and holding summaries remain table-like, scannable, and numerically aligned.
- [ ] Collaboration and import/status side panels use existing data only and are readable as secondary operational cues.
- [ ] Refresh/loading/price status states do not cause layout jumps that hide primary KPIs.

## Transaction and holding work surfaces

Capture desktop and mobile screenshots after Story 5 work.

- [ ] Transaction entry, filters, and table actions are grouped by task flow, not scattered across the page.
- [ ] Transaction rows preserve add/edit/delete/filter/sort behavior and keep category, owner, amount, and balance fields legible.
- [ ] Holding entry, list tabs, summary, column controls, and inline editor remain discoverable.
- [ ] Numeric columns are right-aligned or otherwise consistently aligned for fast comparison.
- [ ] Dense data tables avoid clipped controls and do not create horizontal overflow on desktop.
- [ ] Mobile transaction/holding flows use sheet/card/FAB patterns where implemented and remain touch-friendly.
- [ ] Keyboard/focus affordances remain visible for inline edit and destructive controls.

## Secondary surfaces: settings, collaboration, import, category manager

- [ ] Settings forms, advanced details, category/color managers, and household controls use the same tokenized card/form language as the dashboard.
- [ ] Collaboration member/invite tables preserve roles, owner/member permissions, invite actions, unread cues, and status messages.
- [ ] Import drop zone, progress, report summaries, issue lists, and mismatch messages are easy to scan and do not bury error details.
- [ ] All form labels and button names used by Playwright remain stable unless e2e was intentionally updated with rationale.
- [ ] Destructive or irreversible actions are visually distinct from neutral/primary actions.

## Mobile app acceptance

Use at least one <=390px-wide screenshot and one <=760px responsive screenshot.

- [ ] Mobile layout feels native, not a shrunken desktop: summary-first hierarchy, card stack, compact metadata, and bottom navigation.
- [ ] Top mobile area shows household context plus notification/user affordances without crowding.
- [ ] Total assets hero card appears prominently with KRW value, period comparison, and an obvious drill/action affordance.
- [ ] KPI cards wrap into a readable two-column or single-column layout with no clipped values.
- [ ] Recent transactions and holdings remain readable; secondary columns collapse or summarize intentionally.
- [ ] Bottom nav has clear text or aria-labels for dashboard, transactions, add/quick action, assets, and collaboration/settings as applicable.
- [ ] Primary quick action is reachable without covering critical content or hiding navigation.
- [ ] Touch targets are comfortably sized and have visible active/focus states.

## Auth and onboarding acceptance

Capture login, register, verification/resend, password setup, and invite-token states after Story 2 work.

- [ ] Auth screens share the product language from the dashboard concept: clean white surface, blue brand mark, soft shadow, structured form card.
- [ ] Login preserves accessible labels and button names including `로그인하기`.
- [ ] Register preserves `회원가입하고 시작` and validation visibility for short password and mismatch states.
- [ ] Registration still routes to the email verification screen with `인증 메일을 확인해 주세요.` visible.
- [ ] Raw `인증 토큰` input remains hidden by default where the hotfix tests expect it.
- [ ] Verification by 6-digit code and email/hash-link guidance is readable and not visually de-emphasized.
- [ ] Resend cooldown/limit copy and `인증 메일 재전송` remain visible, readable, and disabled/enabled correctly.
- [ ] Cross-browser password setup states clearly show `새 비밀번호`, `새 비밀번호 확인`, and `비밀번호 설정하고 가입 완료`.
- [ ] Invite-token pending/login messaging remains surfaced before login and read-only.
- [ ] Query-token rejection and hash-token consumption leave no confusing stale token UI.

## Screenshot review guidance

1. Generate or collect screenshots for the staged gates in the test spec:
   - Auth/deeplink after auth redesign.
   - Shell/nav and mobile viewport after app-shell redesign.
   - Dashboard/prices after dashboard redesign.
   - Transactions/holdings after work-surface redesign.
   - Settings/collaboration/import after secondary-surface redesign.
   - Full `output/playwright/e2e-flow` set before completion.
2. Compare each screenshot against the concept by intent:
   - Structure: side rail/top context/mobile bottom nav/summary-first mobile hierarchy.
   - Visual tone: blue/teal fintech, restrained surfaces, no unauthorized color drift.
   - Density: enough operational detail without cramped controls.
   - Behavior preservation: labels, statuses, buttons, badges, and data states still present.
3. Mark every screenshot as one of:
   - **Pass** — matches the concept direction and preserves required behavior.
   - **Needs polish** — behavior is intact but spacing, hierarchy, color, or responsive layout misses the concept.
   - **Fail** — required behavior, selector, state visibility, or mobile usability regressed.
4. Treat behavior regressions as blockers before visual polish. Do not broaden to full visual approval until focused e2e for the changed story passes.
5. Record any accepted deviation from the concept with rationale, especially if it protects hotfix auth behavior or existing finance workflow usability.

## Minimum final visual evidence package

- [ ] Desktop dashboard screenshot at ~1440px.
- [ ] Mobile dashboard screenshot at phone width.
- [ ] Login screenshot.
- [ ] Register screenshot.
- [ ] Email verification/resend screenshot.
- [ ] Password setup screenshot if cross-browser hash verification path is exercised.
- [ ] Transaction desktop and mobile screenshots.
- [ ] Holding desktop and mobile screenshots.
- [ ] Collaboration/import/settings screenshots.
- [ ] `uv run python scripts/verify_e2e_screenshots.py` result or documented blocker.
- [ ] `uv run python scripts/check_mojibake.py` result or documented blocker.
