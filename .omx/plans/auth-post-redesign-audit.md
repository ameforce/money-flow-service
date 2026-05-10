# Auth Post-Redesign Selector and Flow Audit

Task: worker-5 / task-10
Audited branch/worktree: `hotfix/ui-redesign-v0.1.2`; auth UI inspected at `3c37de6` and rechecked after leader merged this audit at `d5449ec`
Reference completed auth redesign commit: worker-1 `2198acc Preserve auth trust flows inside the redesigned shell`
Scope: read-only audit artifact. No product code was modified.

## Executive result

**Selector/flow compatibility: PASS.** Current leader HEAD still preserves the auth/deeplink selectors, labels, button names, URL-token policy, password setup fields, and invite-token field required by `e2e/specs/auth.spec.js`, `e2e/specs/deeplink.spec.js`, and `.omx/plans/auth-redesign-selector-inventory.md`.

**Post-redesign integration: MISSING on leader HEAD.** The task-2 auth redesign commit is not present in current leader HEAD. Current auth UI is still the pre-redesign single centered `form.auth-card` with minimal auth CSS. The accepted task-2 redesign exists on worker-1 commit `2198acc`, but `git diff --stat HEAD..2198acc -- frontend/src/App.jsx frontend/src/App.css` reports broad missing changes (`frontend/src/App.jsx`, `frontend/src/App.css`). This is not a tiny safe copy/selector patch, so no corrective product change was attempted here.

## Evidence snapshot

- `git worktree list --porcelain` showed leader/worker-5 auth UI at `3c37de6`; a follow-up recheck after leader merged the audit artifact at `d5449ec` still showed the same pre-redesign auth JSX/CSS and `worker1-auth-not-ancestor`.
- Current leader HEAD auth render remains around `frontend/src/App.jsx:5428-5658` with `main.auth-shell`, `form.auth-card`, and the existing labels/buttons.
- Current leader HEAD auth CSS remains minimal at `frontend/src/App.css:1-85`; it does not include the worker-1 redesign classes `auth-hero-panel`, `auth-hero-copy`, `auth-mode-pill`, or expanded auth shell styling.
- Worker-1 final commit contains redesign-specific classes (`auth-hero-panel`, `auth-mode-pill`) and a broad auth JSX/CSS diff relative to current leader HEAD.

## PASS/MISSING findings

| Area | Result | Evidence / notes |
| --- | --- | --- |
| Login CTA | PASS | `로그인하기` remains the submit button text in `frontend/src/App.jsx:5609-5618`; tests use `getByRole("button", { name: "로그인하기" })`. |
| Register switch and submit | PASS | `회원가입` switch remains in `frontend/src/App.jsx:5625-5631`; `회원가입하고 시작` remains in `frontend/src/App.jsx:5612-5616`. |
| Verification submit | PASS | `이메일 인증 완료` remains in `frontend/src/App.jsx:5616-5618`. |
| Password setup submit | PASS | `비밀번호 설정하고 가입 완료` remains in `frontend/src/App.jsx:5616-5618`. |
| Return to login | PASS | `로그인으로 돌아가기` remains in register/verify switch branches in `frontend/src/App.jsx:5633-5645`. |
| Email/password/register labels | PASS | `이메일`, exact `비밀번호`, `비밀번호 확인`, and `본명` labels remain in `frontend/src/App.jsx:5522-5574`. |
| Verification code label and input contract | PASS | `6자리 인증번호` input remains numeric with `pattern="[0-9]{6}"`, `maxLength={6}`, and clears token on code entry in `frontend/src/App.jsx:5530-5546`. |
| Hidden raw token input | PASS | No labeled raw `인증 토큰` form field is rendered; appearances of `인증 토큰` are validation/error copy only. Focused tests should continue to satisfy `page.getByLabel("인증 토큰").toHaveCount(0)`. |
| Resend copy/metadata | PASS | `인증 메일 유효기간:` and `재전송은 ... 최대 ...회` remain visible in `frontend/src/App.jsx:5487-5497`; resend button remains `인증 메일 재전송` / `재전송 대기 ...` in `frontend/src/App.jsx:5620-5623`. |
| Query-token rejection | PASS | Query `verify_token` / `invite_token` removal and `보안을 위해 URL query 토큰은 지원하지 않습니다.` remain in `frontend/src/App.jsx:2574-2615`. |
| Hash-token consumption | PASS | Hash `verify_token` and `invite_token` are parsed from `window.location.hash`, consumed, removed via `history.replaceState`, and verify-token auto-submit remains in `frontend/src/App.jsx:2574-2615`. |
| Cross-browser password setup | PASS | Exact headline/body and `새 비밀번호` / `새 비밀번호 확인` labels remain in `frontend/src/App.jsx:5473-5518`; validation copy remains in `runAuth`. |
| Invite token before login | PASS | `가계부 초대 링크를 확인했습니다.` and read-only `감지된 초대 토큰` input remain in `frontend/src/App.jsx:5465-5469` and `5579-5583`. |
| `form.auth-card` after logout | PASS | Auth controls remain in `form className="auth-card"`, preserving `helpers.js` logout expectation. |
| Signed-in shell transition | PASS | Existing auth success still targets `main.app-shell translate="no"`; task-2 E2E was reported passing by worker-1. |
| Auth visual redesign on leader HEAD | MISSING | Current leader HEAD lacks worker-1 redesign classes/structure (`auth-hero-panel`, `auth-hero-copy`, `auth-mode-pill`) and uses the pre-redesign centered card. |
| Mobile/auth shell visual polish | MISSING/RISK | Current `frontend/src/App.css:1-85` is a minimal centered single card. It may remain functional, but it does not provide the polished two-panel/card concept expected by Story 2. |

## Exact missing integration surface

The missing auth redesign is broad and should be integrated from worker-1/task-2 rather than hand-patched by this audit task:

```bash
git diff --stat HEAD..2198acc4f882a57cee72690168eaf0977c56c309 -- frontend/src/App.jsx frontend/src/App.css
# frontend/src/App.css | 844 changed lines
# frontend/src/App.jsx | 473 changed lines
```

Representative missing redesign markers from worker-1 final commit:

- `frontend/src/App.jsx`: `auth-hero-panel`, `auth-hero-copy`, `auth-hero-kicker`, `auth-mode-pill`.
- `frontend/src/App.css`: expanded `auth-shell`, `auth-hero-panel`, hero pseudo-elements, `auth-mode-pill`, and responsive auth layout styling.

Because this is a broad task-2 integration gap, not a one-line selector/copy defect, this audit did **not** modify product code.

## Screenshot review notes

When the accepted auth redesign is integrated into leader HEAD, review the focused auth/deeplink screenshots from:

```bash
npm run e2e:raw -- --workers=1 e2e/specs/auth.spec.js e2e/specs/deeplink.spec.js
```

Required screenshot checks:

- `auth-flow-entry`: login/auth shell should look like the accepted concept language, not the old narrow single-card layout.
- `auth-flow-verify-screen`: verification guidance, validity, and resend-limit copy must remain readable without exposing a raw `인증 토큰` field.
- `deeplink-query-token-rejected-result`: query-token security warning must be visible and the URL must not retain `verify_token=`.
- `deeplink-hash-token-accepted-result`: hash token must be consumed/removed and show an invalid-link or context-required message without raw token UI.
- `deeplink-cross-browser-password-setup-entry`: exact cross-browser headline/body plus `새 비밀번호` and `새 비밀번호 확인` must be visible.
- `deeplink-invite-token-result`: invite notice and read-only `감지된 초대 토큰` value must be visible.
- Mobile width: auth shell should avoid horizontal overflow and preserve touch-friendly spacing.

## Recommendation

1. Integrate worker-1 task-2 final commit `2198acc` (or a conflict-resolved equivalent) into `hotfix/ui-redesign-v0.1.2` before declaring Story 2 visually complete.
2. Re-run the focused auth/deeplink E2E gate after integration.
3. Re-run this audit checklist after task-2 is present on leader HEAD; the current selector contract should remain safe, but the visual redesign gap should then resolve.
