# Mobile UX Recheck Audit — 2026-05-02

## Evidence
- Live mobile screenshots captured from `https://dev.moneyflow.enmsoftware.com` at 390x844 using credentials from `.omx/.env` without printing secrets.
- Screenshot directory: `/tmp/money-flow-mobile-audit-1777721796950`
- Focus files: `dashboard-2026-02-top/full.png`, `transactions-2026-02-top.png`, `transactions-2026-03-scroll.png`, `settings-top.png`.

## Confirmed gaps before the next correction pass
1. **Transactions sticky header is visually broken.** At top of the transaction tab, the list title is sticky/offset over the month stepper, leaving a large blank area and translucent overlap. When scrolled, the heading/ledger header is not reliably visible like an Excel frozen row.
2. **Transactions FAB collides with row actions.** The plus FAB sits over the right edge of visible transaction rows and competes with the row detail chevron.
3. **Global toast/message blocks mobile content.** Login/success messages remain fixed over the portfolio area and bottom nav, making the content look obstructed.
4. **Dashboard portfolio still has redundant visual labels.** The donut has slice labels and the chart legend, so the mobile card still feels cluttered; the legend color bars are the visual element the user objected to.
5. **Transaction filters are too bulky for “Excel header filter” intent.** The filter block is visually a large card between controls and rows, taking too much vertical space.
6. **Bottom nav label truncation remains.** “데이터 …” hides the function name on mobile.
7. **Mobile topbar actions are icon-only and visually heavy.** Refresh/price/logout consume vertical and horizontal attention; at minimum touch hints/labels need clearer affordance while keeping 44px targets.
8. **Safe bottom spacing is still weak in settings/list screens.** Last content can sit under the bottom nav unless additional padding is guaranteed per tab/card.

## Correction priority
1. Fix transaction sticky/overlap and row/FAB collision.
2. Move/auto-dismiss mobile toast so it cannot cover content/nav.
3. Simplify dashboard portfolio legend/labels.
4. Compact transaction title-row filters and nav labels.
5. Re-capture live screenshots and run targeted/full regression.

## 2026-05-02 20:56 KST — 2차 보정 후 로컬 검증

- 거래 FAB: 고정 오버레이에서 원장 제목행 내부 액션으로 이동하여 행 액션/하단 내비게이션/메시지와 직접 겹치지 않게 보정.
- 거래 스티키 헤더: 제목행과 모바일 원장 헤더가 겹치지 않고 스크롤 시 유지되도록 E2E에서 `expectStickyStack`로 검증.
- 거래 행 가시성: 유형별 행 배경 대비 강화, 유형/카테고리/소유자 표식이 축약 상태에서도 보이도록 보정.
- 메시지: 전역 메시지를 모바일에서 fixed overlay가 아닌 sticky in-flow로 바꾸고 일반 성공 메시지는 자동 종료되게 보정.
- 대시보드 포트폴리오: 모바일 chart.js legend를 숨기고 커스텀 slice label 막대는 모바일에서 숨김 유지.
- 모바일 포커스/확대: viewport maximum-scale 및 coarse-pointer focus override를 추가해 터치 후 PC hover/focus 잔상과 입력 확대를 줄임.

근거:
- PASS: `CI=1 uv run python scripts/run_e2e_with_orchestrator.py e2e/specs/transactions.spec.js --project=mobile-chromium --grep "transactions list affordance"`
- PASS: `CI=1 uv run python scripts/run_e2e_with_orchestrator.py e2e/specs/dashboard.spec.js --project=mobile-chromium`
- PASS: `npm run lint --prefix frontend` (기존 hook warning 11건, error 0)
- 스크린샷: `output/playwright/e2e-flow/1777722924352-transactions-mobile-summary.png`, `output/playwright/e2e-flow/1777722966477-dashboard-mobile-portfolio-sync.png`

## 2026-05-02 21:04 KST final local regression pass

- Patched holdings E2E to validate the new in-flow message contract: the message must sit above the holdings heading and must not overlap the list/header area.
- Targeted holdings mobile check: PASS — `CI=1 uv run python scripts/run_e2e_with_orchestrator.py e2e/specs/holdings.spec.js --project=mobile-chromium --grep "holdings flow"`.
- Full E2E: PASS — `npm run e2e` => `54 passed (1.3m)`, screenshot capture `135 files`.
- Frontend lint: PASS — `npm run lint --prefix frontend` => 0 errors, existing 11 hook warnings.
- Frontend build: PASS — `npm run frontend:build` => Vite build completed, chunk-size warning only.
- Backend pytest: PASS — `uv run python -m pytest -q` => exit 0.

## 2026-05-02 21:32 KST — 거래 스티키 헤더 재보정 로컬 검증

- 원인: 모바일에서 `#root`와 `.app-content`의 `overflow-x: hidden`이 계산상 세로 overflow 컨테이너를 만들어 `position: sticky` 기준을 깨고 있었음.
- 보정: 모바일 루트/앱 콘텐츠 overflow를 `overflow-x: clip; overflow-y: visible;`로 전환하고, 거래 카드 내부 제목행/모바일 원장 헤더의 sticky top 간격을 실제 높이에 맞춰 조정.
- 회귀 강화: 거래 E2E가 9개 추가 행을 생성해 실제 페이지 스크롤을 만든 뒤, `window.scrollBy(0, 620)` 상태에서 거래 제목행과 모바일 원장 헤더가 계속 보이는지 검증하도록 변경.

근거:
- PASS: `CI=1 uv run python scripts/run_e2e_with_orchestrator.py e2e/specs/transactions.spec.js --project=mobile-chromium --grep "transactions list affordance"` => `1 passed (22.1s)`
- PASS: `npm run lint --prefix frontend` => error 0, 기존 React hook warning 11건
- PASS: `npm run frontend:build` => Vite build completed, chunk-size warning only
- PASS: `uv run python -m pytest -q` => exit 0
- PASS: `npm run e2e` => `54 passed (1.5m)`, screenshot capture `135 files`

## 2026-05-02 21:45 KST — Jenkins #240 실패 원인 및 메시지 오버레이 보정

- Jenkins #240은 배포 전 품질 게이트에서 `holdings flow` 2건이 실패했고, 제품 동작 실패가 아니라 모바일 전역 메시지가 sticky 상태로 보유 자산 제목 영역을 일부 덮을 수 있음을 드러낸 회귀였다.
- 보정: 모바일 전역 메시지를 `position: sticky` overlay가 아닌 `position: relative` in-flow 배너로 전환하여 카드/제목/목록/FAB/하단 내비게이션을 덮지 않게 변경.
- 근거: `CI=1 uv run python scripts/run_e2e_with_orchestrator.py e2e/specs/holdings.spec.js --project=mobile-chromium --project=tablet-chromium --grep "holdings flow"` => `2 passed (28.2s)`.
- 스크린샷: `output/playwright/e2e-flow/1777725971835-holdings-mobile-summary.png`에서 메시지 잔상 없이 보유 자산 요약/포트폴리오 카드가 가려지지 않음.

## 2026-05-02 21:51 KST — 메시지 오버레이 보정 후 전체 로컬 회귀

- PASS: `CI=1 uv run python scripts/run_e2e_with_orchestrator.py e2e/specs/holdings.spec.js --project=mobile-chromium --project=tablet-chromium --grep "holdings flow"` => `2 passed (28.2s)`.
- PASS: `npm run lint --prefix frontend` => error 0, 기존 React hook warning 11건 유지.
- PASS: `npm run frontend:build` => Vite build completed, chunk-size warning only.
- PASS: `uv run python -m pytest -q` => exit 0.
- PASS: `npm run e2e` => `54 passed (1.5m)`, screenshot capture `135 files`.

## 2026-05-02 22:13 KST — 기간 필터 즉시 적용 잔여 보정

- 발견: 월별 모드에서는 `조회 적용`이 사라졌지만, 기간 모드 전환 시 동일 버튼이 남아 있어 사용자 9번/13번의 “선택 즉시 적용” 원칙을 완전히 만족하지 못했다.
- 보정: 월별/기간 모드 전환을 모두 즉시 데이터 refresh에 연결하고, 기간 시작일/종료일 변경도 값이 유효하면 바로 range query로 반영되도록 변경. `조회 적용` 버튼과 dead CSS를 제거했다.
- 근거: `CI=1 uv run python scripts/run_e2e_with_orchestrator.py e2e/specs/dashboard.spec.js --project=mobile-chromium --grep "dashboard flow"` => `1 passed (13.2s)`.

## 2026-05-02 22:16 KST — 기간 필터 보정 후 전체 로컬 회귀

- PASS: `npm run lint --prefix frontend` => error 0, 기존 React hook warning 11건 유지.
- PASS: `npm run frontend:build` => Vite build completed, chunk-size warning only.
- PASS: `uv run python -m pytest -q` => exit 0.
- PASS: `npm run e2e` => `54 passed (1.5m)`, screenshot capture `135 files`.
