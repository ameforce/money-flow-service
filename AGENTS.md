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

## Commit & Pull Request Guidelines
- Commit format: `<prefix>: <summary>` using only `fix`, `feat`, `chore`, or `refact`.
- Keep commit summaries short, usually Korean, e.g. `fix: 거래 구버전 폴백 보강`.
- Do **not** commit directly to `main` or `develop`.
- Default branch lanes:
  1. New feature development starts from `develop`; create a dedicated `feat/*` branch and commit there.
  2. Existing behavior fixes, improvements, and refactors start from `main`; create a versioned `hotfix/vX.Y.Z` branch, then create a scoped `fix/*` or `refact/*` branch from that hotfix branch and commit there.
  3. Use `feat` commits on `feat/*`, `fix` commits on `fix/*`, and `refact` commits on `refact/*`. Use `chore` only for supporting repository/process changes that belong to the active lane.
- Default PR/review lane:
  1. When merging `feat/*`, `fix/*`, or `refact/*`, open a GitHub PR.
  2. Request Codex bot review on the PR.
  3. In parallel, run an independent self-review from another Codex thread or equivalent reviewer lane.
  4. Merge and close the PR only after both reviews are clean or all findings are addressed.
- Feature release flow:
  1. Merge the completed `feat/*` branch into `develop` with a PR.
  2. Create a `release/vX.Y.0` branch from `develop`, incrementing the minor version by 1 and resetting the patch version to 0.
  3. Finish the release by merging the release branch back into both `develop` and `main` with `--no-ff`.
  4. Create the annotated `vX.Y.0` tag on the `main` release merge commit. Do not merge the `main` merge commit or tag back into `develop` only to make the tag reachable from `develop`.
  5. Verify `develop` contains the completed release branch tip or the release branch's final tree from the `develop` no-ff merge.
- Existing-feature fix/refactor hotfix flow:
  1. Start from `main` and create `hotfix/vX.Y.Z`.
  2. Create `fix/*` or `refact/*` from that hotfix branch and commit only the scoped work there.
  3. Merge the completed `fix/*` or `refact/*` branch back into `hotfix/vX.Y.Z` with a PR.
  4. Finish the hotfix by merging `hotfix/vX.Y.Z` into both `main` and `develop` with `--no-ff`.
  5. Create the annotated `vX.Y.Z` tag on the `main` hotfix merge commit. Do not merge the `main` merge commit or tag back into `develop` only to make the tag reachable from `develop`.
  6. Verify `develop` contains the completed hotfix branch tip or the hotfix branch's final tree from the `develop` no-ff merge.
- Before reusing any existing `hotfix/*`, `feat/*`, `fix/*`, `refact/*`, or `release/*` branch, verify that the branch scope, active PR, and linked issues match the current task. If they do not clearly match, create a new scoped branch instead of stacking unrelated work.
- Hotfix/release completion means Git-flow closure, not branch CI. Do **not** report a hotfix or release complete while the work exists only on a pushed work branch.
- Complete hotfix/release Git-flow in this repository as follows unless the user explicitly gives a different release procedure:
  1. Verify the completed work branch and confirm its scope.
  2. Verify the expected integration chain is present: `feat/* -> develop -> release/* -> main/develop`, or `fix/*`/`refact/* -> hotfix/vX.Y.Z -> main/develop`.
  3. Create the annotated version tag on the `main` merge commit.
  4. Record explicit Git evidence for the release graph because Jenkins does not prove every step: `git cat-file -t vX.Y.Z` returns `tag`, `git rev-parse vX.Y.Z^{}` equals `main` HEAD, and the completed release/hotfix branch tip is contained in `develop` after the `develop` no-ff merge.
  5. Do not require `git merge-base --is-ancestor vX.Y.Z develop`; the version tag is expected to resolve to the `main` merge commit, while `develop` must contain the release/hotfix changes rather than the `main` tag commit.
  6. Confirm `main` HEAD resolves to the exact `vX.Y.Z` tag (exact vX.Y.Z tag) before any main/prod deploy.
  7. Before cleanup, inspect `git worktree list --porcelain`, then delete only branches whose completed branch tip or final tree is confirmed integrated into both `main` and `develop`; keep unmerged work.
- Hotfix/release completion is a hard gate. Do **not** report hotfix/release completion until all of the following are true:
  1. Branch scope is confirmed and the work is on a dedicated `hotfix/*` or task branch.
  2. Only intended files are staged and committed; any remaining dirty state in every linked worktree is explicitly classified as unrelated, generated evidence, or a blocker.
  3. The branch is pushed to origin, the Git-flow merge/tag/integration graph above is complete, and explicit annotated-tag plus develop-integration Git evidence is recorded.
  4. Jenkins every pushed SHA check must pass for the release: the hotfix/task branch SHA, the `main` merge/tag SHA, and the `develop` integration merge SHA, unless the user explicitly supplied a different release procedure that omits `develop`.
  5. Main/prod deployment is never implied by a tag or `main` build alone; when prod deployment is explicitly requested, Jenkins must run with `ALLOW_PROD_DEPLOY=true` and verify the exact `vX.Y.Z` tag (exact vX.Y.Z tag) on `main` HEAD.
  6. When production deployment is explicitly requested, Jenkins must use `moneyflow-prod-smtp-env-file`, overlay only `SMTP_*` values, run `scripts/deploy/validate_smtp_route.py` before `docker compose up`, and fail closed on `mailpit`, `enm-mail-smtp`, `moneyflow-smtp-local`, localhost/loopback, port `1025`, `EMAIL_DELIVERY_MODE=log`, missing auth, wrong `SMTP_ACCOUNT_LABEL`, or invalid TLS; record only the redacted route summary, never SMTP secrets.
  7. Deployment reflects the expected pushed SHA/version, and the deployed target is directly verified after deployment: `dev.moneyflow.enmsoftware.com` for dev, and `moneyflow.enmsoftware.com` plus the production smoke below for prod.
  8. When production deployment is explicitly requested, run `uv run python scripts/prod_email_smoke.py --verification-mode browser` and record real mailbox receipt plus same-cookie verification of the actual prod hash link; shared reports, PRs, and handoff evidence must be redacted and must not include raw cookies, session headers, auth headers, tokens, full hash/magic links, mailbox secrets, SMTP credentials, DB URLs, or `SECRET_KEY`.
  9. A GitHub PR exists or is updated, links the relevant GitHub issues or RCA evidence, and includes purpose, affected areas, verification commands, Jenkins/dev deployment evidence, prod email smoke evidence when production is deployed, and screenshots for UI changes.
  10. The PR is merged or otherwise explicitly closed by the requested release procedure (PR merged/closed); an open PR is not hotfix/release completion unless the user explicitly asks for PR-only delivery.
  11. Temporary release branches, merged hotfix/task branches, and generated recovery artifacts are cleaned up or explicitly preserved with a reason.
- Do not report a hotfix/release as complete without a PR URL and merge/closure status unless the user explicitly says PR creation or PR merge is not required.
- For non-`main` branch commit/push work, use `$enm-jenkins` and `$enm-server-ops` to confirm Jenkins builds, deploys, and reflects correctly at `dev.moneyflow.enmsoftware.com`.

## Security & Configuration Tips
- Do not commit secrets or copied `.env` files.
- Prefer `uv run` for Python entrypoints so local dependencies stay in sync.
- If Playwright system libs are missing on Linux/WSL, the repo auto-detects vendored libs under `.omx/local-libs/...` during E2E runs.
- WSL/Windows cross-checkout hygiene: avoid accidental executable-bit drift. Do not run `chmod`, copy tools, or formatter steps that change file modes unless the mode change is intentional. Before finalizing work, check for mode-only diffs with `git diff --summary --diff-filter=T` and `git status --short`; revert unintended `100755 ↔ 100644` changes instead of committing them. In Windows-native forks where the filesystem reports unstable executable bits, use local-only `git config core.filemode false`.
