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
- When implementation is complete, always work from a dedicated `hotfix/*` or task branch before finalizing. If the current branch is `main` or `develop`, create a dedicated branch first, then commit and push there.
- Before reusing an existing `hotfix/*` branch, verify that the branch scope, active PR, and linked issues match the current task. If they do not clearly match, create a new task branch instead of stacking unrelated fixes.
- Hotfix completion is a hard gate. Do **not** report hotfix completion until all of the following are true:
  1. Branch scope is confirmed and the work is on a dedicated `hotfix/*` or task branch.
  2. Only intended files are staged and committed; any remaining dirty worktree state is explicitly classified as unrelated, generated evidence, or a blocker.
  3. The branch is pushed to origin.
  4. Jenkins build for the pushed SHA succeeds.
  5. Deployment reflects the pushed SHA/version.
  6. `dev.moneyflow.enmsoftware.com` is directly verified after deployment.
  7. A GitHub PR exists or is updated for the branch.
  8. The PR links the relevant GitHub issues or RCA evidence.
  9. The PR includes purpose, affected areas, verification commands, Jenkins/dev deployment evidence, and screenshots for UI changes.
- Do not report a hotfix as complete without a PR URL unless the user explicitly says PR creation is not required.
- For non-`main` branch commit/push work, use `$enm-jenkins` and `$enm-server` to confirm Jenkins builds, deploys, and reflects correctly at `dev.moneyflow.enmsoftware.com`.

## Security & Configuration Tips
- Do not commit secrets or copied `.env` files.
- Prefer `uv run` for Python entrypoints so local dependencies stay in sync.
- If Playwright system libs are missing on Linux/WSL, the repo auto-detects vendored libs under `.omx/local-libs/...` during E2E runs.
- WSL/Windows cross-checkout hygiene: avoid accidental executable-bit drift. Do not run `chmod`, copy tools, or formatter steps that change file modes unless the mode change is intentional. Before finalizing work, check for mode-only diffs with `git diff --summary --diff-filter=T` and `git status --short`; revert unintended `100755 ↔ 100644` changes instead of committing them. In Windows-native forks where the filesystem reports unstable executable bits, use local-only `git config core.filemode false`.
