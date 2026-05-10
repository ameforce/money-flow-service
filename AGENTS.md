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

## Commit & Pull Request Guidelines
- Commit format: `<prefix>: <summary>` using only `fix`, `feat`, `chore`, or `refact`.
- Keep commit summaries short, usually Korean, e.g. `fix: 거래 구버전 폴백 보강`.
- Do **not** commit directly to `main` or `develop`.
- When implementation is complete, always work from a dedicated `hotfix/*` or task branch before finalizing. If the current branch is `main` or `develop`, create a dedicated branch first, then commit and push there.
- After completing work, always follow this release verification flow before reporting done: `commit -> push -> Jenkins build 확인 -> 정상 배포 확인 -> dev.moneyflow.enmsoftware.com 직접 확인`.
- For non-`main` branch commit/push work, use `$enm-jenkins` and `$enm-server` to confirm Jenkins builds, deploys, and reflects correctly at `dev.moneyflow.enmsoftware.com`.
- PRs should include: purpose, affected areas, verification commands run, and screenshots for UI changes.

## Security & Configuration Tips
- Do not commit secrets or copied `.env` files.
- Prefer `uv run` for Python entrypoints so local dependencies stay in sync.
- If Playwright system libs are missing on Linux/WSL, the repo auto-detects vendored libs under `.omx/local-libs/...` during E2E runs.
