# Jenkins Dev Build 9 Evidence

- Job: `money-flow-service/fix%2Fissue-287-android-ledger`
- Build: `#9`
- URL: `https://jenkins.enmsoftware.com/job/money-flow-service/job/fix%252Fissue-287-android-ledger/9/`
- Result: `SUCCESS`
- Commit: `b6c3aa0fcf16dc75ec348b5046fa1569250e2d22`
- App version: `v0.1.37.9`
- Target: `dev`
- Domain: `dev.moneyflow.enmsoftware.com`
- Compose project: `money-flow-service-dev`
- Compose file: `docker-compose.dev.deploy.yml`
- Image tag: `money-flow-service:v0.1.37.9`

## Guardrails

- `RUN_DEPLOY=true`
- `RUN_DEPLOY_EFFECTIVE=true`
- `DEPLOY_DRY_RUN=false`
- `RUN_ASYNC_QUALITY_GATE=false`
- `RUN_PRE_DEPLOY_E2E=false`
- Guardrails recorded in deploy evidence: schema upgrade, healthcheck, frontend asset version, upload limit probe, post-deploy smoke, prod SMTP route validation.

## Live endpoint checks

- `https://dev.moneyflow.enmsoftware.com/healthz`: `{"status":"ok"}`
- `https://dev.moneyflow.enmsoftware.com/api/v1/system/client-version`: `{"version":"0.1.37.9"}`

No production external-mailbox proof was used or required for this dev build.
