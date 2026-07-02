# Dashboard integration audit after task-3 final commit

## Scope

- Team task: `9` — dashboard integration audit after task-3 final commit.
- Current leader HEAD audited: `3c37de6de5497e2132d65e7d6c83a7db889b24cc` (`hotfix/ui-redesign-v0.1.2`).
- Task-3 accepted dashboard commit: `ddef33aba04362d6718cb4a147523c83371a5737`.
- Files compared: `frontend/src/App.jsx`, `frontend/src/App.css`.
- Product code changes in this audit: none.

## Source requirements checked

From `.omx/plans/prd-ui-redesign-hotfix-v012.md` Story 4 and `.omx/plans/test-spec-ui-redesign-hotfix-v012.md`:

- Reorganize summary and price summary into KPI cards.
- Preserve total assets, cashflow, income, expense, investment, gain/loss, and price status visibility.
- Preserve monthly cashflow chart and portfolio chart hierarchy.
- Add/restyle side panels for collaboration members, import/status, and recent updates using existing data.
- Preserve loading, refresh, empty, chart, dashboard selector, and price-refresh states.
- Preserve dashboard/prices focused E2E selectors: `대시보드`, `시세 갱신`, `요약`, `월별 흐름`, `포트폴리오 보기 기준`, and `portfolio-donut-center-label`.
- Preserve responsive dashboard behavior with no horizontal overflow target at mobile widths.

## Comparison method

1. Compared `ddef33aba04362d6718cb4a147523c83371a5737..HEAD` for `frontend/src/App.jsx` and `frontend/src/App.css`.
2. Checked current HEAD for all accepted dashboard markers/classes/selectors from task 3.
3. Extracted dashboard-owned regions and compared hashes/line counts:
   - Dashboard JSX region from `{tab === "dashboard" && (` through before `{tab === "transactions" && (`.
   - Dashboard derived data region from `const financialSummaryRows = [` through before `const holdingFormType =`.
   - Portfolio donut data region from `const portfolioChartData = useMemo(() => {` through before dashboard loading state.
   - Dashboard primary CSS from `.dashboard-loading-banner` through before `.member-avatar`.
   - Dashboard responsive CSS fragments under the `1100px` and `760px` breakpoints.

## Findings

| Area | Status | Evidence |
| --- | --- | --- |
| Command-center shell | PASS | Current `frontend/src/App.jsx:5761` still renders `<section className="dashboard-command-center grid-2">`; dashboard JSX extraction is byte-identical to task-3 final (`293` lines, sha prefix `248b8e352626`). |
| Hero summary and KPI cards | PASS | Current `frontend/src/App.jsx:5773-5813` preserves `dashboard-hero-card`, `dashboard-hero-metric`, `dashboard-kpi-grid`, and `dashboard-market-strip`; derived financial/price summary region is byte-identical to task-3 final (`82` lines, sha prefix `d050f5a465e8`). |
| Immediate financial visibility | PASS | Current HEAD retains the six KPI labels from task 3 (`수입`, `지출`, `투자`, `순현금흐름`, `총자산(KRW)`, `평가손익(KRW)`) plus price rows (`시세 지연 건수`, `시세 갱신 상태`, `최근 시세 갱신 시각`). |
| Cashflow and portfolio chart hierarchy | PASS | Current `frontend/src/App.jsx:5881-5942` preserves `dashboard-main-grid`, `dashboard-flow-card` heading `월별 흐름`, `dashboard-portfolio-card`, selector aria-label `포트폴리오 보기 기준`, and `portfolio-donut-center-label`. Portfolio donut data extraction is byte-identical to task-3 final (`47` lines, sha prefix `4cfb9ade732d`). |
| Side panels | PASS | Current `frontend/src/App.jsx:5945-6043` preserves the task-3 side grid: `가져오기 & 상태`, `협업 멤버`, `최근 거래`, and `보유 자산` cards, including empty-state copy and existing-data mappings. |
| Dashboard selectors | PASS | Current `e2e/specs/dashboard.spec.js` expects `대시보드`, `시세 갱신`, `요약`, `월별 흐름`, `포트폴리오 보기 기준`, and `portfolio-donut-center-label`; current `App.jsx` keeps each. Later shell/nav integration adds `aria-label` to tab buttons, preserving exact accessible names despite helper text. |
| Primary dashboard CSS | PASS | Current `frontend/src/App.css:515-830` preserves task-3 dashboard styles; primary CSS extraction is byte-identical to task-3 final (`317` lines, sha prefix `836ab95313f8`). |
| Responsive dashboard behavior | PASS | Current `frontend/src/App.css:2739-2751` keeps 1100px dashboard collapse rules and `frontend/src/App.css:2965-3009` keeps the 760px dashboard spacing/KPI/chart rules. The 760px dashboard fragment is byte-identical to task-3 final (`51` lines, sha prefix `b85a96e178bd`). |
| Integration conflicts | PASS | `git diff ddef33aba04362d6718cb4a147523c83371a5737..HEAD -- frontend/src/App.jsx frontend/src/App.css` shows additional shell/nav, auth-selector, transaction, holding, and secondary-surface edits, but no dashboard JSX/primary-CSS removal. The only 1100px responsive delta in dashboard-adjacent CSS is additive `.app-shell`/`.topbar` layout rules before unchanged dashboard collapse rules. |

## Marker parity check

All task-3 dashboard markers remain present in current HEAD with matching counts across `App.jsx`/`App.css`:

| Marker | HEAD count | Task-3 count |
| --- | ---: | ---: |
| `dashboard-command-center` | 4 | 4 |
| `dashboard-hero-card` | 6 | 6 |
| `dashboard-kpi-grid` | 4 | 4 |
| `dashboard-market-strip` | 11 | 11 |
| `dashboard-filter-card` | 6 | 6 |
| `dashboard-main-grid` | 4 | 4 |
| `dashboard-side-grid` | 4 | 4 |
| `dashboard-status-list` | 11 | 11 |
| `dashboard-member-stack` | 2 | 2 |
| `dashboard-activity-list` | 3 | 3 |
| `portfolio-donut-center-label` | 6 | 6 |
| `aria-label="포트폴리오 보기 기준"` | 1 | 1 |
| `<h2>월별 흐름</h2>` | 1 | 1 |
| `<h2>가져오기 & 상태</h2>` | 1 | 1 |
| `<h2>협업 멤버</h2>` | 1 | 1 |
| `<h2>최근 거래</h2>` | 1 | 1 |
| `<h2>보유 자산</h2>` | 1 | 1 |

## Missing / corrective patch decision

- MISSING findings: none.
- Corrective product patch: not applied. The accepted dashboard JSX, dashboard data derivations, primary dashboard CSS, mobile dashboard CSS, and selectors are preserved in current HEAD.
- Residual integration note: current HEAD is a detached worktree checkout decorated as `hotfix/ui-redesign-v0.1.2`; App files differ from task-3 final because later workers integrated shell/nav, auth-selector, transaction, holding, and secondary-surface work. Those differences are additive or outside the dashboard-owned regions checked here.

## Verification results for task 9

Commands run after producing this audit:

| Command | Result |
| --- | --- |
| `git diff --check` | PASS — no whitespace errors in unstaged diff. |
| `git diff --cached --check` | PASS — no whitespace errors in staged audit artifact. |
| `npm run frontend:build` | PASS — Vite build completed in 1.01s; existing chunk-size warning reported for the main JS bundle. |
| `npm run lint --prefix frontend` | PASS with warnings — ESLint returned 0 errors and 11 existing `react-hooks/exhaustive-deps` warnings in `frontend/src/App.jsx`. |

Focused dashboard/prices E2E was not rerun for this audit because no product code changed. The task-3 final implementation already passed `E2E_BASE_URL=http://127.0.0.1:5173 E2E_API_BASE_URL=http://127.0.0.1:8013 npm run e2e:raw -- --workers=1 e2e/specs/dashboard.spec.js e2e/specs/prices.spec.js` with 6 passing tests before integration.
