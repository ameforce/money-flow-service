# Goal

- 22개 UX/UI 피드백을 프론트엔드 중심으로 모두 반영하고, 로컬 검증 + dev 배포 확인까지 끝낸다.
- 사용자의 최종 확인은 **모든 항목 반영 후 dev 사이트 1회 확인**으로 제한한다.

# Scope / Non-goals

- Scope
  - `frontend/src/App.jsx`
    - 대시보드/거래/자산/설정/협업 탭 UX 정리
    - 포트폴리오/거래 상세/카테고리 관리/협업 초대 반응성/모바일 condensed UI 반영
    - 자산 유형/색상/정렬/카테고리 집계/표시 규칙 반영
  - `frontend/src/App.css`
    - clutter 감소, 모바일 condensed row, 상세 토글, 초대 반응성/배지/보조 패널 접힘 스타일 반영
  - `e2e/specs/*.js`, `e2e/support/helpers.js`
    - round-trip 회귀 케이스와 responsive 검증 보강
- Non-goals
  - backend API 스펙 변경
  - DB schema / migration 변경
  - 디자인 시스템 전면 교체

# Constraints / Risks

- 브라운필드 구조상 핵심 write hotspot이 `frontend/src/App.jsx`, `frontend/src/App.css`에 집중되어 merge 충돌과 회귀 위험이 높다.
- Jenkins pre-deploy / post-deploy E2E는 dev 실제 데이터와 완전히 같지 않으므로, 최종 가독성 평가는 dev 사이트에서 확인해야 한다.
- Playwright flow screenshot은 긴 페이지에서 지연될 수 있어 viewport 중심으로 안정화한다.

# 22-item audit

| # | 피드백 | 상태 | 구현 근거 |
|---|---|---|---|
| 1 | 거래 탭에 포트폴리오 그래프 | 구현됨 | `details.transaction-support-card` 내 `포트폴리오 보기 기준` + doughnut |
| 2 | 수입/지출/투자 세부내역 expandable | 구현됨 | `txFlowBreakdownExpanded`, 카테고리별 summary/details |
| 3 | 포트폴리오를 여러 카테고리 기준으로 보기 | 구현됨 | `PORTFOLIO_VIEW_OPTIONS`, dashboard/거래/자산 summary selector sync |
| 4 | 선택한 행 합계 표시 | 구현됨 | `selectedTransactionIds`, 선택 합계 배너 |
| 5 | 카테고리 관리 입력 의미/드롭다운/수정삭제 개선 | 구현됨 | 기존 카테고리 quick select, 가이드, 선택 수정/삭제 |
| 6 | 카테고리 사용 n건 → 월별 리스트 | 구현됨 | usage details + 월별 `<details>` |
| 7 | 거래 탭에서도 카테고리 관리 | 구현됨 | `showTxCategoryManager` 보조 패널 |
| 8 | 자산 목록에도 포트폴리오 대시보드 | 구현됨 | `holdingSummarySource`, 자산 요약 카드 |
| 9 | 자산 순서 변경 / 색상 기준 정렬 | 구현됨 | `moveHoldingOrder`, `display_order`, color settings 기반 grouping/sort |
| 10 | 자산 목록 보유자/카테고리 색상 | 구현됨 | `owner_colors`, `category_colors`, `type_colors` 적용 |
| 11 | 자산 목록 카테고리별 총액 | 구현됨 | `holdingCategoryTotals`, 자산 요약/그룹 summary |
| 12 | 자산 입력에서 카테고리 제거, 유형 기준 분류 | 구현됨 | `holdingTypeOptions`, 유형 중심 입력/표시 |
| 13 | cell width 조절 + 최대 2줄 | 구현됨 | `column_widths`, resize handle, 2-line clamp 스타일 |
| 14 | 예적금 등 평균단가/손익 미표시 시 `-` | 구현됨 | `show_average_cost`, `show_gain_loss`, row render `-` |
| 15 | 자산 카테고리 전체 순서 조정 | 구현됨 | `category_order`, 카테고리 순서 저장/반영 |
| 16 | 모바일 거래/자산 row 한 줄 요약 + 상세 토글 | 구현됨 | condensed row + `상세` 토글 |
| 17 | 거래/자산 입력 UI 기본 접힘 | 구현됨 | `showTransactionForm`, `showHoldingForm` |
| 18 | 협업 탭에서 내가 보낸 초대만 표시 | 구현됨 | `mySentInvites = invites.filter(inviter_user_id === currentUserId)` |
| 19 | 초대 도착 시 반응형 UI/애니메이션 | 구현됨 | `invite-arrival-banner`, `tab-badge`, `tab-invite-pulse`, `invite-row-new` |
| 20 | 이전/새 초대 탭 분리 + 새 초대 우선 | 구현됨 | `receivedInviteTab`, `sentInviteTab`, 신규/이전 탭 |
| 21 | 거래 목록 열 순서 일자/유형/카테고리/메모/금액 | 구현됨 | 거래 table column order 정렬 |
| 22 | 일자 기본 오름차순 + 내림차순 전환 | 구현됨 | `txSortDirection`, sort header |

# Validation commands

- `npm run frontend:build`
- `npm run lint --prefix frontend`
- `npm run e2e:raw -- --workers=1 e2e/specs/dashboard.spec.js e2e/specs/collaboration.spec.js e2e/specs/transactions.spec.js e2e/specs/holdings.spec.js e2e/specs/settings.spec.js`

# Completed

- 거래/자산/설정/협업 탭 clutter 감소 반영
- dashboard ↔ transaction ↔ holdings 포트폴리오 보기 기준 sync 반영
- 협업 신규 초대 강조/배지/탭 우선순위/신규 행 강조 반영
- settings 보조 패널(거래 행 색상, 자산 유형/색상 설정) 기본 접힘 반영
- e2e screenshot helper를 viewport 중심으로 안정화해 긴 페이지 hang 제거
- 로컬 검증 통과:
  - `npm run frontend:build`
  - `npm run lint --prefix frontend` (warning 11, error 0)
  - 24 Playwright tests pass (`dashboard/collaboration/transactions/holdings/settings`)

# Remaining

- Jenkins 운영성 개선 반영 확인
- 최종 사용자 확인 1회 요청

# Execution reconciliation log

- Keep (no-op): `PLAN.md`의 22개 항목 구현 자체는 현재 `hotfix/v0.1.2` 기준선에서 유지한다.
- Polish: 로컬 Playwright 검증 경로는 `.omx/local-libs/...` vendored runtime을 자동 인식하도록 보강한다.
- Discard: rogue `main`에서 가져온 planning/evidence 성격 변경과 shadcn 신규 의존성 도입은 이번 hotfix 범위에서 제외한다.

# Next action

- Jenkins 운영성 옵션과 런타임 산출물 ignore를 반영하고, 실제 Jenkins 배포까지 재검증한다.

# Decision log

- 팀 모드는 `App.jsx/App.css` hotspot 충돌만 키워 stalled 되었으므로 종료하고 단독 completion loop로 복귀했다.
- 긴 페이지 full-page screenshot은 Playwright 흐름을 불안정하게 만들어 viewport screenshot으로 낮은 위험 안정화를 선택했다.
- settings/협업 보조 패널은 기본 접힘을 유지하되 E2E는 summary를 열어 검증하도록 바꿨다.
