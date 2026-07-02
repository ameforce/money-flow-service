# Email Verification UX v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let a verification email fallback URL finish signup and log the user in directly, while simplifying the signup verification UI, surfacing expiry/resend limits, and brightening the Money Flow Service email body.

**Architecture:** Store pending registration credentials on the email verification challenge, not in the URL or as an active user password. A same-browser HttpOnly continuation cookie must match the challenge before token/code-only verification can finalize the account, preventing email pre-registration takeover. The verify-email endpoint accepts token-only or email+6-digit-code verification, consumes the challenge, applies the pending password/display name, marks email verified, and issues cookies. The frontend keeps the token internal, removes manual token/password fields from the verification screen, auto-submits token links, and shows expiry/resend limit guidance.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, React/Vite, pytest, Playwright.

---

### Task 1: Backend direct verification contract

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/api/routes/auth.py`
- Test: `backend/tests/test_api_v1.py`

- [x] Write failing tests for token-only verify and code-only verify using the pending password hash created during registration.
- [x] Run the targeted tests and confirm they fail because `VerifyEmailRequest.password` is required and verify-email re-hashes the submitted password.
- [x] Make `VerifyEmailRequest.password` optional and require it only when no server-side pending hash can be used.
- [x] Keep unverified users on a random placeholder password while storing the chosen password hash/display name on the verification challenge.
- [x] In `verify_email`, require the same-browser continuation cookie for pending credentials, consume the challenge, mark the account verified, apply the pending hash/display name, and issue auth cookies.
- [x] Run targeted backend tests until green.

### Task 2: Verification response metadata and copy

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/api/routes/auth.py`
- Test: `backend/tests/test_api_v1.py`

- [x] Add response fields for `verification_resend_limit`, `verification_resend_window_seconds`, and `verification_resend_cooldown_seconds`.
- [x] Replace the awkward generic acceptance copy with friendly verified-registration guidance for the normal path.
- [x] Keep enumeration-safe generic behavior for resend requests where the account may not exist or may already be verified.
- [x] Add/adjust tests to assert metadata and improved message.

### Task 3: Frontend signup verification UX

**Files:**
- Modify: `frontend/src/App.jsx`

- [x] Remove the visible token input from the verification UI.
- [x] Remove password/display-name fields from the verification UI after initial registration; keep the original registration data in state only for debug/backward compatibility.
- [x] Auto-submit `#verify_token=...` links so the user lands authenticated after clicking the email button.
- [x] Keep manual 6-digit code entry with email only.
- [x] Show email expiry and resend policy in the verification card.
- [x] Disable/respect resend cooldown on the client side and improve resend error/copy mapping.

### Task 4: Brighter email template

**Files:**
- Modify: `backend/app/services/email_service.py`
- Test: `backend/tests/test_api_v1.py`

- [x] Rewrite the verification email HTML body using the approved bright mockup: white card, light sky/mint accents, clear CTA, large 6-digit code, visible 30-minute validity, muted fallback URL/footer.
- [x] Keep text-only alternative accurate and non-phishy.
- [x] Add assertions for key copy/style markers without relying on fragile full HTML snapshots.

### Task 5: Verification and release flow

**Files:**
- All changed files above

- [x] Run targeted pytest for auth verification tests.
- [x] Run full backend pytest.
- [x] Run frontend lint and build.
- [x] Run e2e suite through the orchestrator and fix regressions.
- [x] Get architect/security sign-off.
- [x] Commit, push `hotfix/email-verification-ux-v2`, trigger/inspect Jenkins, and confirm dev health/UI/mail behavior.
