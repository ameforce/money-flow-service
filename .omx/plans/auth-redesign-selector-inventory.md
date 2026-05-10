# Auth Redesign Selector Inventory and Verification Checklist

Task: worker-5 / task-7
Scope: read-only inventory for auth/deeplink E2E selectors and current auth JSX. Product code was not modified.

## Sources inspected

- `e2e/specs/auth.spec.js` — registration validation, verification screen, logout/relogin, helper registration stability.
- `e2e/specs/deeplink.spec.js` — query-token rejection, hash verification token handling, cross-browser password setup, invite token surfacing.
- `e2e/support/helpers.js` — reusable auth mode navigation, login/register helpers, shell assertions.
- `frontend/src/App.jsx` — deep-link parsing, auth/verification handlers, and unauthenticated render branch.
- Planning context: PRD/test-spec auth constraints that existing accessible labels and button names must remain findable unless tests are intentionally updated.

## Hard selector contract to preserve

These are the selectors currently used by the focused auth/deeplink tests and helpers. The auth redesign may wrap or restyle the UI, but should not remove these accessible names, roles, or classes unless tests are intentionally updated in the same change.

| Area | Selector / locator | Required accessible copy or selector | Current source |
| --- | --- | --- | --- |
| Login mode submit | `page.getByRole("button", { name: "로그인하기" })` | `로그인하기` | `auth.spec.js:40`, `deeplink.spec.js:10`, `helpers.js:98`, `App.jsx:5521-5523` |
| Register switch | `page.getByRole("button", { name: "회원가입" })` | `회원가입` | `auth.spec.js:14`, `helpers.js:87-88`, `App.jsx:5537-5540` |
| Register submit | `page.getByRole("button", { name: "회원가입하고 시작" })` | `회원가입하고 시작` | `auth.spec.js:19,24,28`, `helpers.js:96,306`, `App.jsx:5523-5525` |
| Verify submit | `page.getByRole("button", { name: "이메일 인증 완료" })` | `이메일 인증 완료` | `auth.spec.js:35`, `deeplink.spec.js:23`, `helpers.js:74,137,313`, `App.jsx:5525-5527` |
| Password setup submit | `page.getByRole("button", { name: "비밀번호 설정하고 가입 완료" })` | `비밀번호 설정하고 가입 완료` | `deeplink.spec.js:68`, `App.jsx:5525-5527` |
| Return to login | `page.getByRole("button", { name: "로그인으로 돌아가기" })` | `로그인으로 돌아가기` | `helpers.js:84,90`, `App.jsx:5542-5554` |
| Resend verification | `button.secondary` role/name | `인증 메일 재전송` or `재전송 대기 ...` | `App.jsx:5529-5532`; test-spec focused gate expects resend copy visible |
| Email input | `page.getByLabel("이메일", { exact: true })` | Label text `이메일` attached to an input | `auth.spec.js:15`, `helpers.js:79,104,110,286`, `App.jsx:5431-5438,5461-5464` |
| Password input | `page.getByLabel("비밀번호", { exact: true })` | Label text `비밀번호` attached to password input | `auth.spec.js:16,22`, `helpers.js:80,105,111`, `App.jsx:5465-5468` |
| Password confirm input | `page.getByLabel("비밀번호 확인")` | Label text `비밀번호 확인` | `auth.spec.js:17,23,27`, `helpers.js:81,112`, `App.jsx:5471-5479` |
| Display name input | `page.getByLabel("본명")` | Label text `본명` | `auth.spec.js:18`, `helpers.js:113`, `App.jsx:5480-5483` |
| Verification code input | label-backed input | Label text `6자리 인증번호`, `inputMode="numeric"`, `pattern="[0-9]{6}"`, `maxLength={6}` | `App.jsx:5439-5455` |
| Cross-browser new password | `page.getByLabel("새 비밀번호", { exact: true })` | Label text `새 비밀번호` | `deeplink.spec.js:66`, `App.jsx:5410-5418` |
| Cross-browser password confirm | `page.getByLabel("새 비밀번호 확인")` | Label text `새 비밀번호 확인` | `deeplink.spec.js:67`, `App.jsx:5419-5427` |
| Hidden raw token guard | `page.getByLabel("인증 토큰").toHaveCount(0)` | No visible/labeled raw `인증 토큰` input by default | `auth.spec.js:30`, `deeplink.spec.js:11,22,55`, PRD/test-spec |
| Invite token input | `page.getByLabel("감지된 초대 토큰")` | Label text `감지된 초대 토큰`; value must be read-only | `deeplink.spec.js:79-82`, `App.jsx:5488-5492` |
| Auth form after logout | `page.locator("form.auth-card")` | Auth container remains a `form` with class `auth-card` | `helpers.js:283-286`, `App.jsx:5370-5372` |
| Loading shell | `main.auth-shell`, `.auth-card` | Shell/card classes can be restyled but should remain stable for low-risk CSS targeting | `App.jsx:5337-5347,5370-5372` |
| Signed-in app shell | `page.locator("main.app-shell")` | `translate="no"` after successful auth | `auth.spec.js:36,41`, `deeplink.spec.js:69`, `helpers.js:116-124,327` |
| Responsive shell | `header.topbar`, `nav.tabs` | Visible after sign-in; no horizontal overflow | `helpers.js:181-185` |

## Copy that must remain test-findable

Focused tests assert exact strings or regex fragments. Keep these strings intact or adjust tests deliberately if product copy intentionally changes.

### Registration and verification validation

- `비밀번호는 8자 이상이어야 합니다.` — short registration password validation (`auth.spec.js:20`, `App.jsx:2917-2921`).
- `비밀번호 확인이 일치하지 않습니다.` — registration mismatch validation (`auth.spec.js:25`, `App.jsx:2922-2925`).
- `인증 메일을 확인해 주세요.` — registration verification state headline/status (`auth.spec.js:29`, `helpers.js:135`, `App.jsx:5382-5384`).
- `인증 메일 유효기간:` — verification metadata visibility (`auth.spec.js:31`, `App.jsx:5396-5398`).
- `재전송은 ... 최대 ...회` — resend limit/cooldown guidance (`auth.spec.js:32`, `App.jsx:5399-5405`).
- `메일의 인증 링크를 열거나 6자리 인증번호를 입력해 주세요.` — verify submit without token/code (`App.jsx:2888-2890`).
- `6자리 인증번호로 인증하려면 이메일을 입력해 주세요.` — verification code requires email (`App.jsx:2892-2894`).
- `인증 토큰과 6자리 인증번호 중 하나만 입력해 주세요.` — token/code mutual exclusion (`App.jsx:2896-2898`).
- `6자리 숫자 인증번호를 입력해 주세요.` — invalid code shape (`App.jsx:2900-2902`).

### Deep-link security policy

- `보안을 위해 URL query 토큰은 지원하지 않습니다.` — query token rejection (`deeplink.spec.js:12`, `App.jsx:2601-2606`).
- `인증 토큰이 유효하지 않습니다.` OR `인증 링크를 바로 완료할 수 없습니다.` — invalid hash verify-token outcome (`deeplink.spec.js:24`, `formatApiError` near `App.jsx:1169-1188`).
- Hash `#verify_token=` must be consumed via `URLSearchParams(window.location.hash)` and removed with `history.replaceState` (`App.jsx:2574-2615`).
- Query `?verify_token=` and `?invite_token=` must be rejected/removed, not treated as valid token sources (`App.jsx:2580-2606`).

### Cross-browser password setup

- `다른 브라우저에서 인증 링크를 열었습니다.` — exact headline (`deeplink.spec.js:56`, `App.jsx:5382-5384`).
- `회원가입을 시작했던 브라우저와 현재 브라우저가 달라, 이전에 입력한 비밀번호를 보안상 그대로 사용할 수 없습니다.` — exact explanatory text (`deeplink.spec.js:57-62`, `App.jsx:5386-5388`).
- `새 비밀번호는 8자 이상이어야 합니다.` — setup short-password validation (`App.jsx:2904-2909`).
- `새 비밀번호 확인이 일치하지 않습니다.` — setup mismatch validation (`App.jsx:2911-2913`).

### Invite-token pre-login state

- `가계부 초대 링크를 확인했습니다.` — exact status headline (`deeplink.spec.js:78`, `App.jsx:5374-5377`).
- `로그인 또는 회원가입 후 협업 탭의 초대 수락 토큰 칸에 자동 입력됩니다.` — invite guidance (`App.jsx:5375-5378`).
- `감지된 초대 토큰` input must expose the hash token value and remain `readOnly` (`deeplink.spec.js:79-82`, `App.jsx:5488-5492`).

## Auth states to cover during redesign review

| State | How it is reached today | Preservation checklist |
| --- | --- | --- |
| Initial auth loading | `!authReady` render branch | Keep `main.auth-shell translate="no"`; loading card can be visually redesigned but should not impersonate login/register controls. |
| Login | default unauthenticated `authMode === "login"` | Keep `이메일`, exact `비밀번호`, `로그인하기`, `회원가입`, remember/save checkboxes. |
| Register | click `회원가입` | Keep `이메일`, exact `비밀번호`, `비밀번호 확인`, `본명`, `회원가입하고 시작`, and short/mismatch validation messages. |
| Verification after register | register response `status === "verification_required"` | Keep `인증 메일을 확인해 주세요.`, no labeled `인증 토큰` input, visible validity/resend copy, `이메일 인증 완료`, resend button/cooldown. |
| Verification by hash link | open `/#verify_token=...` | Hash token sets verify mode, auto-verifies once, removes token from URL, never exposes raw token input. |
| Query token rejection | open `/?verify_token=...` | Query token is removed from URL, login button remains visible, security warning is visible, raw token input remains absent. |
| Cross-browser verification | backend returns `AUTH_REGISTRATION_PASSWORD_SETUP_REQUIRED` | Show exact cross-browser headline/body, `새 비밀번호`, `새 비밀번호 확인`, submit `비밀번호 설정하고 가입 완료`, then signed-in `main.app-shell`. |
| Invite deep-link before login | open `/#invite_token=...` | Show invite status, read-only `감지된 초대 토큰` value, remove hash token from URL, keep login/register paths available. |
| Logout then relogin | helper clicks `로그아웃` | Return to `form.auth-card`, expose `이메일`, then sign-in returns to `main.app-shell translate="no"`, `header.topbar`, `nav.tabs`. |

## Redesign risks and guardrails

1. **Breaking accessible labels by moving text out of `<label>` elements.**
   The tests use `getByLabel(...)` heavily. If markup changes to floating labels/placeholders, preserve an actual accessible name via `<label htmlFor>`, wrapping label, or `aria-label` with the same Korean text.

2. **Accidentally exposing a raw `인증 토큰` field.**
   Debug tokens may be stored in state, but focused tests require `page.getByLabel("인증 토큰").toHaveCount(0)` for register, query-token, hash-token, and password-setup paths.

3. **Changing button names while only doing visual polish.**
   Primary CTAs are role/name locators. Keep the visible names above even if iconography, layout, or button hierarchy changes.

4. **Merging verify-token and verification-code UX incorrectly.**
   Current behavior allows hidden token submission or 6-digit code, but prevents both simultaneously and clears the token when a code is typed (`App.jsx:5446-5451`). Preserve that state rule.

5. **Treating query tokens as valid.**
   Only hash parameters are accepted. Query token policy is a security boundary and must keep replacing the URL to remove rejected tokens.

6. **Losing resend metadata visibility in a polished card.**
   The PRD/test-spec require validity and resend limit/cooldown guidance to remain readable. Avoid burying this copy in collapsed/hover-only UI.

7. **Password setup copy drift.**
   `deeplink.spec.js` asserts exact cross-browser headline and first explanatory sentence. If the design adds supporting copy, keep those exact strings visible.

8. **Invite token input becoming editable or hidden.**
   The invite hash path requires a visible read-only input labeled `감지된 초대 토큰`; styling must not remove the readonly attribute or accessible label.

9. **Replacing `form.auth-card` with non-form markup.**
   Logout helper expects `form.auth-card` after logout. If the redesign adds panels around the card, keep the actionable auth controls inside a `form.auth-card`.

10. **Signed-in shell regression from auth success.**
    Auth/deeplink tests assert `main.app-shell translate="no"`, then helper checks `header.topbar`, `nav.tabs`, and no horizontal overflow. Auth success transitions should not skip shell bootstrap.

## Focused verification command for Story 2

Run after auth shell work lands:

```bash
npm run e2e:raw -- e2e/specs/auth.spec.js e2e/specs/deeplink.spec.js
```

Suggested quick review before running the full focused gate:

- Inspect auth screenshots with names containing `auth-flow-*` and `deeplink-*` in `output/playwright/e2e-flow`.
- Confirm browser URL no longer contains `verify_token=` or `invite_token=` after deep-link consumption/rejection.
- Confirm mobile width still has no horizontal overflow through `assertResponsiveShell` after sign-in.
