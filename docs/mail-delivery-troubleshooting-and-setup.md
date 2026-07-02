# Mail delivery setup and troubleshooting

## Deployment rule

`money-flow` deployment environments (`ENV=dev`, `ENV=prod`, `ENV=production`) fail closed for signup email verification:

- SMTP delivery is mandatory.
- `AUTH_EMAIL_VERIFICATION_REQUIRED` must remain `true`.
- `AUTH_DEBUG_RETURN_VERIFY_TOKEN` must remain `false`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM_EMAIL`, and `SMTP_ACCOUNT_LABEL` must be explicitly set.
- Authenticated SMTP must use either STARTTLS or SSL. An unauthenticated plaintext relay is only acceptable when it is an intentional internal relay path and the relay target is documented in the deployment evidence.
- `EMAIL_DELIVERY_MODE` is not a deployment switch and is not consumed by deployment compose files. Any legacy use is local/test-only.

Local and CI runs use `ENV=local` or `ENV=test`; they may use debug-token opt-in, test doubles, or internal capture without external SMTP.

## Required environment checklist

For deployed dev/prod, set:

```env
ENV=dev # or prod/production
AUTH_EMAIL_VERIFICATION_REQUIRED=true
AUTH_DEBUG_RETURN_VERIFY_TOKEN=false
SMTP_HOST=email-smtp.ap-northeast-2.amazonaws.com
SMTP_PORT=587
SMTP_STARTTLS=true
SMTP_SSL=false
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM_EMAIL=no-reply@example.com
SMTP_FROM_NAME=Money Flow Service
SMTP_ACCOUNT_LABEL=money-flow-dev # or money-flow-prod
```

If `SMTP_USER` or `SMTP_PASS` is set, keep `SMTP_STARTTLS=true` or `SMTP_SSL=true`. Do not run authenticated SMTP over plaintext.

## Production direct-provider deploy checklist

Production (`main` → `moneyflow.enmsoftware.com`) uses a direct external SMTP provider for the app route:

1. Provision Jenkins Secret file credential `moneyflow-prod-smtp-env-file`.
   - File contents are `SMTP_*` keys only.
   - Required production values: external `SMTP_HOST`, valid `SMTP_PORT`, `SMTP_STARTTLS=true` or `SMTP_SSL=true`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, and `SMTP_ACCOUNT_LABEL=money-flow-prod`.
2. Keep the base deploy credential `moneyflow-prod-env-file` for app/database secrets, not SMTP source-of-truth.
3. Jenkins overlays the SMTP credential into `.env`, runs `scripts/deploy/validate_smtp_route.py`, prints only a redacted route summary, then replaces `.env`.
4. `.env.previous` is rollback backup only. It must not fill missing prod `SMTP_*` values.
5. Production validation rejects `mailpit`, `enm-mail-smtp`, `moneyflow-smtp-local`, localhost/loopback, port `1025`, `EMAIL_DELIVERY_MODE=log`, wrong account label, missing auth, and invalid TLS shape before `docker compose up`.

Redacted route summary should resemble:

```json
{"account_label":"money-flow-prod","auth_present":true,"environment":"prod","host":"email-smtp.ap-northeast-2.amazonaws.com","host_classification":"external-provider","port":587,"source":"jenkins-prod-smtp-secret","tls_mode":"starttls"}
```

The summary must never include `SMTP_USER`, `SMTP_PASS`, `DATABASE_URL`, `SECRET_KEY`, cookies, or full verification links.

## Central relay exception checklist

The current production hotfix does **not** allow `SMTP_HOST=enm-mail-smtp`. If production later moves to a central relay, add a separate relay mode with all of the following before enabling it:

- explicit relay-mode flag;
- external `MAIL_SERVICE_RELAYHOST` proof that is not Mailpit, localhost, or `*:1025`;
- relay TLS/auth evidence;
- external mailbox smoke evidence after deploy.

The default `MAIL_SERVICE_RELAYHOST=mailpit:1025` in `docker-compose.mail-dev-services.yml` is local/dev capture only.

## Dev evidence: internal capture vs external delivery

Record which path was used during verification:

1. **Internal capture path** — for example an internal relay or Mailpit capture target such as `MAIL_SERVICE_RELAYHOST=mailpit:1025`.
   - Evidence: Mailpit/internal capture contains the verification message; opening `/#verify_token=...` completes signup.
   - Do not claim external inbox deliverability for this path.
2. **External relay path** — upstream SMTP relay/provider sends to a real inbox.
   - Evidence: external mailbox receives the verification message; opening `/#verify_token=...` completes signup.

Signup verification emails should render as Money Flow Service branded multipart messages:

- HTML body with the `Money Flow Service` name, CTA button, fallback URL, and 6-digit verification code.
- Plain-text fallback containing the same link and 6-digit code.
- Sender display name should be `Money Flow Service` for `no-reply@enmsoftware.com`.
- Backend logs must not include raw verification tokens, full verification links, or 6-digit codes.
- The HTML template is intentionally light-mode styled with explicit `bgcolor`/inline colors and `color-scheme` markers so Gmail/Naver dark mode keeps heading, body, CTA, code, expiry, and fallback URL readable.

## Email verification UX checklist

- Same browser: opening the verification button in the browser that started signup should complete signup and log the user in automatically.
- Different browser/mobile: opening the verification button without the original continuation cookie should show a clear message that the browser is different and require a new password before completing signup.
- Manual 6-digit code: email + code still works; if the browser is different, the same password setup requirement applies before signup completes.
- Token values should not be shown as form inputs in the signup UI. The fallback URL remains copyable only inside the email body.
- Dark-mode mailbox check: open the verification mail in Gmail/Naver light and dark modes and confirm the title, body text, blue CTA, 6-digit code, green expiry pill, fallback URL, and ignore notice are readable.

## Jenkins post-deploy smoke rule

The `Post-Deploy E2E Smoke` stage must run a lightweight Playwright smoke against the deployed URL or fail with an actionable error. It must not pass because `npx`, Playwright Chromium, or browser OS libraries are missing.

Operational notes:

- Provision Node.js/npm on the Jenkins agent or provide an equivalent maintained Playwright runner before enabling deploy jobs.
- The pipeline uses the repository-local Playwright runner when possible and attempts `npx playwright install chromium` if the browser binary is missing.
- Missing browser system libraries remain a build failure. Install the required OS packages on the Jenkins agent (for example with `npx playwright install --with-deps chromium` during node provisioning) and rerun.
- Jenkins logs should show the target URL, API base/origin, and the exact `npx playwright test e2e/specs/post-deploy-smoke.spec.js --project=desktop-chromium --workers=1` command. There is no `RUN_POST_DEPLOY_E2E` skip switch for a real deploy.

## Production external mailbox smoke and cleanup

Health checks, frontend asset freshness, SMTP app logs, and Mailpit/internal capture are not production email deliverability proof. After `main` deploy, run the deployed-domain smoke with a controlled real mailbox:

```bash
export PROD_EMAIL_SMOKE_RECIPIENT='your-controlled-smoke-recipient@example.com'
export PROD_EMAIL_SMOKE_IMAP_HOST='imap.example.com'
export PROD_EMAIL_SMOKE_IMAP_USER='your-controlled-smoke-recipient@example.com'
export PROD_EMAIL_SMOKE_IMAP_PASSWORD='app-password'
uv run python scripts/prod_email_smoke.py \
  --base-url https://moneyflow.enmsoftware.com \
  --verification-mode browser \
  --public-report .omx/reports/prod-email-smoke/public-report.json \
  --private-ledger .omx/private/prod-email-smoke/private-ledger.json
```

The public report is redacted. The private ledger may contain the raw verify link/cookies and remains under ignored `.omx/private/`.
Use `--verification-mode browser` for the strict release gate. The script also supports `auto`, which first tries the same-cookie Playwright browser verification and falls back to API verification only when the browser runtime is unavailable.

Expected smoke evidence:

1. registration returns `verification_required`;
2. response body has no `debug_verification_token`;
3. mailbox message UID/timestamp is after the smoke boundary and recipient matches exactly;
4. verification link origin is `https://moneyflow.enmsoftware.com` and token is in the hash fragment;
5. the same-cookie browser flow follows the prod hash link and `/api/v1/auth/me` returns the exact smoke user with `email_verified=true`;
6. public report leak-scan contains no raw token, full link, cookie value, SMTP credential, DB URL, or `SECRET_KEY`.

Cleanup must target the exact smoke email only. First dry-run, then execute:

```bash
uv run python scripts/prod_email_cleanup.py \
  --email 'your-controlled-smoke-recipient@example.com' \
  --database-url "$DATABASE_URL" \
  --output .omx/private/prod-email-smoke/cleanup-dry-run.json

uv run python scripts/prod_email_cleanup.py \
  --email 'your-controlled-smoke-recipient@example.com' \
  --database-url "$DATABASE_URL" \
  --execute \
  --output .omx/private/prod-email-smoke/cleanup-executed.json
```

The cleanup ledger records before/after counts for users, email verification tokens, household memberships, orphan households, and exact email throttle rows. Do not use wildcard deletes.

## Rollback guidance

Validation runs before app replacement. If the dedicated SMTP credential is missing or points to internal capture, Jenkins should fail before replacing the running app. If the provider accepts deploy but later rejects mail, roll back the deployment/config for availability, fix the provider credential/sender identity, rerun route validation, rerun external mailbox smoke, then perform exact cleanup.

## Amazon SES checklist

- Use an SES SMTP endpoint and port with a TLS-capable client.
- Use SES SMTP credentials; they are different from normal AWS access keys or console credentials.
- Verify the sender email address or, preferably, the sender domain identity before production use.
- Enable DKIM for the domain identity.
- If using a custom MAIL FROM domain, publish the required MX and SPF TXT records.
- Prepare DMARC alignment. DMARC can pass with aligned SPF or aligned DKIM; using both is stronger.

Official references:

- SES SMTP sending: <https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html>
- SES SMTP credentials: <https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html>
- SES identities: <https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html>
- SES Easy DKIM: <https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy.html>
- SES SPF/custom MAIL FROM: <https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-spf.html>, <https://docs.aws.amazon.com/ses/latest/dg/mail-from.html>
- SES DMARC: <https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html>

## Google Workspace SMTP relay checklist

- Configure Google Workspace SMTP relay for either allowed source IPs or SMTP Authentication.
- Use TLS for authenticated relay; Google documents `smtp-relay.gmail.com` on port `587` for TLS.
- Account for relay limits, including recipients per transaction and daily quotas.
- For Gmail recipient deliverability, configure SPF or DKIM at minimum. For high-volume Gmail sending, Google requires SPF, DKIM, DMARC, TLS, and valid forward/reverse DNS.

Official references:

- Google Workspace SMTP relay: <https://support.google.com/a/answer/2956491>
- Gmail sender guidelines: <https://support.google.com/a/answer/81126>
- Google authentication methods: <https://support.google.com/a/answer/10583557>

## Troubleshooting

- **Application fails at startup in dev/prod**: check missing `SMTP_*` variables, disabled email verification, debug token setting, or authenticated plaintext SMTP.
- **Signup returns `AUTH_EMAIL_DELIVERY_FAILED`**: inspect SMTP host/port/TLS/user/pass and provider rejection logs. The app should not leave a newly valid verification token for the failed send.
- **Mail not in Gmail but present in Mailpit**: this is internal capture evidence only. Configure an upstream relay for external inbox validation.
- **Provider accepts SMTP but mail lands in spam/rejected**: verify SPF/DKIM/DMARC, sender identity, reverse DNS/PTR where applicable, and provider quotas.
