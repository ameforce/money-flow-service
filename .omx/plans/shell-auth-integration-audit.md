# Shell/Auth Integration Audit — worker-1 final commits

Task: worker-1 / task-11
Leader branch audited: `hotfix/ui-redesign-v0.1.2` at `3c37de6`
Worker-1 source commits: `464b32f` (token/shell baseline), `2198acc` (auth shell redesign)

## Sources inspected

- PRD: `.omx/plans/prd-ui-redesign-hotfix-v012.md`
- Test spec: `.omx/plans/test-spec-ui-redesign-hotfix-v012.md`
- Auth selector inventory: `.omx/plans/auth-redesign-selector-inventory.md`
- Leader files:
  - `frontend/src/App.jsx`
  - `frontend/src/App.css`
  - `frontend/src/index.css`
- Comparison commands:
  - `git -C <leader> merge-base --is-ancestor 464b32f HEAD`
  - `git -C <leader> merge-base --is-ancestor 2198acc HEAD`
  - `git -C <leader> diff --stat 2198acc..HEAD -- frontend/src/App.jsx frontend/src/App.css frontend/src/index.css`
  - Focused greps for shell, auth, token, and selector markers.

## Summary verdict

| Area | Verdict | Notes |
| --- | --- | --- |
| App token baseline | PASS | `frontend/src/index.css` carries the worker-1 token variables; no `index.css` diff exists between `2198acc` and leader HEAD. |
| Desktop app shell/nav | PASS | Leader HEAD preserves `TAB_NAV_META`, tab `aria-label`, `nav.tabs.topbar-tabs`, nav brand/status, `app-content`, and shell CSS grid/nav rail. |
| Mobile app shell/nav | PASS | Leader HEAD preserves fixed mobile `.topbar-tabs` bottom navigation and hides nav brand/status on mobile. |
| Auth/deeplink functional selectors | PASS | Existing exact labels/buttons remain visible in leader HEAD: login/register/verify/resend/password setup/invite-token selectors are intact. |
| Auth visual two-panel redesign | MISSING | Leader HEAD does **not** contain the `2198acc` auth visual shell (`auth-layout`, `auth-hero-panel`, `auth-card-header`, auth mode pill, mobile auth layout CSS). |
| Tiny safe fix feasibility | NO | Restoring the missing auth visual shell would touch broad `App.jsx` unauthenticated markup plus ~250 CSS lines. That is not a tiny non-overlapping fix, so this audit does not patch product code. |

## Detailed findings

### 1. Commit ancestry / integration shape

- `git -C <leader> merge-base --is-ancestor 464b32f HEAD` returned non-zero.
- `git -C <leader> merge-base --is-ancestor 2198acc HEAD` returned non-zero.
- Leader HEAD appears to contain some worker-1 shell/token changes via OMX auto-checkpoint/merge commits, not by direct ancestry of the final Lore commits.
- Diff scope from worker final auth commit to leader HEAD:
  - `frontend/src/App.css`: substantial differences because later dashboard/work-surface/secondary changes exist and the auth redesign CSS is absent.
  - `frontend/src/App.jsx`: substantial differences because later feature-lane changes exist and the auth redesign JSX wrapper is absent.
  - `frontend/src/index.css`: no diff in the focused comparison, so token variables are integrated.

### 2. App token baseline — PASS

Leader HEAD contains the worker-1 app token baseline in `frontend/src/index.css`:

- `--mf-font-family`
- `--mf-color-blue-700`
- `--mf-color-blue-600`
- `--mf-surface-panel`
- `--mf-shadow-panel`
- `--mf-focus-ring`

This satisfies PRD Story 1 token baseline expectations and gives later surfaces a shared palette/radius/shadow vocabulary.

### 3. Desktop app shell/nav — PASS

Leader HEAD preserves the shell/nav structure from `464b32f`:

- `frontend/src/App.jsx:54` — `TAB_NAV_META`
- `frontend/src/App.jsx:5673` — tab buttons keep `aria-label={TAB_LABELS[item] || item}` so exact nav accessible names remain findable.
- `frontend/src/App.jsx:5714` — `<nav className="tabs topbar-tabs" aria-label="주요 메뉴">`
- `frontend/src/App.jsx:5715` — `.nav-brand`
- `frontend/src/App.jsx:5734` — `.app-content`
- `frontend/src/App.css:132` — `.app-shell` uses `grid-template-columns: var(--app-shell-nav-width) minmax(0, 1fr)`.
- `frontend/src/App.css:240-258` — `.topbar-tabs` desktop nav rail styles are present.

Selector preservation notes:

- `nav.tabs` remains present for `assertResponsiveShell`.
- `.tabs-left` and `.tabs-right` remain present for existing E2E locators.
- All six tab names remain backed by `TAB_LABELS` and exact button accessible names.

### 4. Mobile app shell/nav — PASS

Leader HEAD preserves the mobile shell baseline:

- `frontend/src/App.css:2871-2886` — `.topbar-tabs` becomes fixed bottom navigation with safe-area-aware `bottom: max(0.55rem, env(safe-area-inset-bottom))`.
- `frontend/src/App.css:2892-2895` — `.nav-brand` and `.nav-status-card` are hidden on mobile.
- `frontend/src/App.css:2924-2940` — mobile tab buttons become compact vertical icon/label items.
- `frontend/src/App.css:2955-2960` — mobile tab badge is positioned inside the bottom nav item.

This satisfies the Story 3 mobile-native navigation requirement without breaking `nav.tabs` selectors.

### 5. Auth/deeplink functional selectors — PASS

Leader HEAD still preserves the hard selector contract from `.omx/plans/auth-redesign-selector-inventory.md`:

- `frontend/src/App.jsx:5462` — `form.auth-card` remains the auth form container.
- `frontend/src/App.jsx:5474` — exact verification/cross-browser headline remains: `인증 메일을 확인해 주세요.` / `다른 브라우저에서 인증 링크를 열었습니다.`
- `frontend/src/App.jsx:5502-5511` — password setup labels remain: `새 비밀번호`, `새 비밀번호 확인`.
- `frontend/src/App.jsx:5581` — invite token label remains: `감지된 초대 토큰`.
- `frontend/src/App.jsx:5613-5618` — primary CTA names remain: `로그인하기`, `회원가입하고 시작`, `비밀번호 설정하고 가입 완료`, `이메일 인증 완료`.
- `frontend/src/App.jsx:5622` — resend button copy remains: `인증 메일 재전송` / `재전송 대기 ...`.
- Focused grep found no labeled raw `인증 토큰` input in the unauthenticated render branch; the visible guard remains aligned with the auth/deeplink tests.

### 6. Auth visual shell — MISSING

Leader HEAD is missing the Story 2 visual structure from worker commit `2198acc`.

Missing JSX markers from `frontend/src/App.jsx`:

- `authModeTitle`
- `authModeKicker`
- `<div className="auth-layout">`
- `<section className="auth-hero-panel" aria-hidden="true">`
- `.auth-brand-lockup`
- `.auth-hero-copy`
- `.auth-proof-grid`
- `<form className={`auth-card auth-card-${authMode}`} ...>`
- `.auth-card-header`
- `.auth-mode-pill`

Current leader HEAD instead has the simpler pre-task-2 auth structure:

```jsx
<main className="auth-shell" translate="no">
  <form className="auth-card" onSubmit={runAuth}>
    <h1>money-flow</h1>
    <p>{authDescription}</p>
```

Missing CSS markers from `frontend/src/App.css`:

- `.auth-layout`
- `.auth-hero-panel` plus its pseudo-elements
- `.auth-brand-lockup`
- `.auth-brand-mark`
- `.auth-hero-copy`
- `.auth-hero-kicker`
- `.auth-proof-grid`
- `.auth-card-header`
- `.auth-mode-pill`
- auth-card focus/input/CTA refinements from `2198acc`
- mobile auth ordering under `@media (max-width: 760px)` for `.auth-layout`, `.auth-card`, and `.auth-hero-panel`

Current leader HEAD has only the task-1 tokenized card baseline for auth:

```css
.auth-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1.25rem;
}
```

### 7. Recommendation

Do **not** apply an automatic corrective patch from this audit task. Restoring Story 2 would require a non-trivial merge of the `2198acc` auth JSX and CSS across files now touched by other workers. Recommended integration path:

1. Re-apply only the `2198acc` unauthenticated render branch changes around the current `if (!token)` branch.
2. Re-apply only the top-of-file auth CSS block and mobile auth media block from `2198acc`.
3. Preserve all later dashboard/transaction/holding/secondary additions already present in leader HEAD.
4. Re-run:
   - `npm run frontend:build`
   - `npm run lint --prefix frontend`
   - `npm run e2e:raw -- --workers=1 e2e/specs/auth.spec.js e2e/specs/deeplink.spec.js`
   - `npm run e2e:raw -- --workers=1 e2e/specs/shell-state.spec.js`

## Verification evidence for this audit

- PASS: task state read and task 11 claimed via `omx team api claim-task`.
- PASS: mailbox assignment `3616c458-d856-4f8c-8233-30ae11e8ab8f` marked delivered.
- PASS: PRD/test spec/auth inventory inspected.
- PASS: leader shell/token markers checked with focused grep.
- PASS: worker expected auth markers checked against `2198acc` worktree.
- PASS: leader-vs-worker diff inspected for `frontend/src/App.jsx`, `frontend/src/App.css`, `frontend/src/index.css`.

## Command verification run after artifact creation

- PASS: `git -C /home/enmso/workspace/daeng/git/money-flow-service.omx-worktrees/ui-redesign-hotfix-v012 diff --check` returned clean for leader HEAD.
- SETUP: initial leader `npm run frontend:build` / `npm run lint --prefix frontend` failed because `vite` and `eslint` were not installed in that worktree; resolved with `npm ci --prefix frontend`.
- PASS: leader `npm run frontend:build` completed successfully (Vite chunk-size warning only).
- PASS: leader `npm run lint --prefix frontend` completed with 0 errors and 11 existing React hook warnings.
- PASS: artifact `git diff --cached --check` returned clean after trimming trailing whitespace.
- NOT RUN: focused shell-state/auth/deeplink E2E because this task made no product-code changes; the audit recommends those gates if the missing auth visual shell is restored.
