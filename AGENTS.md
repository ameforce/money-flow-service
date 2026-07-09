# Repository Guidelines

## Project Structure & Module Organization
- `backend/app/`: FastAPI application code. Key areas include `api/routes/` for endpoints, `db/` for SQLAlchemy models/session setup, `services/` for business logic, and `core/` for config/security.
- `backend/tests/`: backend regression tests such as `test_api_v1.py` and orchestration helpers.
- `frontend/src/`: React + Vite UI (`App.jsx`, `App.css`, `main.jsx`).
- `e2e/specs/`: Playwright end-to-end flows for auth, dashboard, transactions, holdings, collaboration, and import.
- `scripts/`: local runners and verification utilities.
- `infra/` and `docker-compose*.yml`: deployment, mail, and environment support files.

## Build, Test, and Development Commands
- `uv run python orchestrator.py`: start backend + frontend together for local development.
- `npm run frontend:dev`: run the Vite frontend only.
- `npm run frontend:build`: build the frontend production bundle.
- `uv run python -m pytest -q`: run backend tests.
- `npm run e2e`: run the Playwright suite through the orchestrator.
- `npm run e2e:raw -- --help`: inspect raw Playwright CLI options.
- `npm run quality:gate`: run pytest, E2E, screenshot verification, and mojibake checks.

## Coding Style & Naming Conventions
- Python: use 4-space indentation, type hints where practical, and keep service/router responsibilities separated.
- React/JSX/CSS: follow the existing 2-space indentation and component-first structure in `frontend/src/`.
- Test files use `test_*.py`; Playwright specs use `*.spec.js`.
- Prefer small, reversible changes and reuse existing helpers before adding abstractions.

## Testing Guidelines
- Backend coverage is driven by `pytest`; add narrow regression tests when fixing bugs.
- UI and workflow validation use Playwright in `e2e/specs/`.
- For changes affecting local verification, rerun at least: `uv run python -m pytest -q`, `npm run frontend:build`, `npm run lint --prefix frontend`, and `npm run e2e`.
- For mobile UI work, verify at more than one viewport/font condition before claiming the UX is stable. At minimum cover Chrome DevTools-style mobile width around 390px, a narrower iPhone-sized viewport, a taller/wider Android-sized viewport, and Korean font fallbacks such as Apple SD Gothic Neo, Malgun Gothic, and Noto Sans KR.
- Do not fix mobile visual alignment by hard-coding one captured coordinate. Prefer layout invariants that survive font/device changes: shared control heights, center-line alignment, tabular numeric line boxes, chart cutout/ring-derived label positions, and no horizontal overflow.
- Dashboard passive refresh feedback must not insert or remove document-flow banners after user taps filter/month controls. Reuse persistent status surfaces such as the topbar real-time chip for non-blocking sync state, and reserve dismissible fixed-position messages for errors, permission issues, or user-actionable notices.
- For donut charts, labels should be positioned from the chart geometry and slice midpoint, not from screenshot-specific offsets. E2E should assert both text clipping and geometric placement against the chart ring.

## Commit, PR, Release, and Deployment Addendum
- Follow the global Git Flow, PR review, finding-resolution, and hotfix/release deployment-evidence gates. This section only adds `money-flow-service` specifics and preserves the repo-specific hard gates below.
- If the global contract is unavailable or unclear, stop release/hotfix completion work until the global Git Flow, PR review, finding-resolution, and deployment-evidence gates are recovered. Do not treat this addendum as a weaker replacement.
- Commit format in this repo is `<prefix>: <summary>` using only `fix`, `feat`, `chore`, or `refact`; keep summaries short, usually Korean, e.g. `fix: 거래 구버전 폴백 보강`.
- Treat existing behavior fixes, improvements, and refactors in this repo as hotfix-scope unless the user explicitly selects a different lane.
- For hotfix-scope work, branch from the latest `origin/main` using `hotfix/vX.Y.Z`, then create task branches from that hotfix branch.
- Hotfix-scope PRs must target the active `hotfix/vX.Y.Z` branch as the base branch; do not open them directly to `main` or `develop`.
- UI PRs should include affected areas, verification commands, and screenshots or equivalent visual evidence for the changed surface.
- PR merge gate in this repository is `LOW` and above findings resolved to zero (`LOW/MEDIUM/HIGH/CRITICAL = 0`) unless the user explicitly approves a temporary exception.
- Hotfix/release completion still requires PR merge/closure, no-ff integration into both `main` and `develop`, an annotated `vX.Y.Z` tag on the `main` merge commit, and explicit Git evidence that the tag resolves to `main` HEAD while `develop` contains the completed hotfix/release tree.
- Jenkins must pass for every pushed SHA that belongs to the release chain: task branch, `main` merge/tag, and `develop` integration merge, unless the user supplies a release procedure that explicitly omits `develop`.
- After hotfix/release finish gates pass, deploy in this fixed order: first confirm Jenkins green and deploy/verify `dev.moneyflow.enmsoftware.com` for the expected non-`main` SHA/version using `$enm-jenkins` and `$enm-server-ops`; only when that dev target is judged healthy, proceed to production.
- Production deploy is part of the same finish flow once dev is healthy: Jenkins must run with `ALLOW_PROD_DEPLOY=true`, verify the exact `vX.Y.Z` tag on `main` HEAD, and the deployed target must be directly verified at `moneyflow.enmsoftware.com`.
- If dev deploy/verification fails or looks unhealthy, stop and do not deploy production.
- Production email delivery must use `moneyflow-prod-smtp-env-file`, overlay only `SMTP_*` values, run `scripts/deploy/validate_smtp_route.py` before `docker compose up`, and fail closed on `mailpit`, `enm-mail-smtp`, `moneyflow-smtp-local`, localhost/loopback, port `1025`, `EMAIL_DELIVERY_MODE=log`, missing auth, wrong `SMTP_ACCOUNT_LABEL`, or invalid TLS.
- Production deployment email proof is the redacted SMTP route validation summary plus deployed health/version checks. Do not require external mailbox IMAP credentials, real-mailbox receipt automation, or production email-authentication E2E as a release blocker.
- Email-authentication E2E belongs in dev/staging or an explicitly controlled internal test mailbox path. `scripts/prod_email_smoke.py` is optional manual diagnostics only, and requires an explicit security decision before using a real external mailbox.
- Shared reports, PRs, and handoff evidence must be redacted and must not include raw cookies, session headers, auth headers, tokens, full hash/magic links, mailbox secrets, SMTP credentials, DB URLs, or `SECRET_KEY`.

## Security & Configuration Tips
- Do not commit secrets or copied `.env` files.
- Prefer `uv run` for Python entrypoints so local dependencies stay in sync.
- If Playwright system libs are missing on Linux/WSL, the repo auto-detects vendored libs under `.omx/local-libs/...` during E2E runs.
- WSL/Windows cross-checkout hygiene: avoid accidental executable-bit drift. Do not run `chmod`, copy tools, or formatter steps that change file modes unless the mode change is intentional. Before finalizing work, check for mode-only diffs with `git diff --summary --diff-filter=T` and `git status --short`; revert unintended `100755 ↔ 100644` changes instead of committing them. In Windows-native forks where the filesystem reports unstable executable bits, use local-only `git config core.filemode false`.
