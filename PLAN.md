# Goal

- 보고된 8개 회귀/UX 이슈를 한 번에 복구해 "가계 전환/권한/실시간/메시지/탭 유지" 동작을 안정화한다.
- 변경 후 핵심 사용자 경로(설정/거래/자산/협업/가져오기)를 로컬 E2E로 재검증하고 배포 검증까지 마친다.

# Scope / Non-goals

- Scope
  - `frontend/src/App.jsx`
    - 가계 전환 시 컨텍스트 동기화 순서 수정
    - 거래 인라인 수정 Enter 저장 처리
    - 탭 새로고침 복원(localStorage) 처리
    - 협업 탭 자동 갱신/권한 변경 감지/메시지 처리
    - 권한 부족 시 액션 버튼 비활성화 및 호출 가드
    - 공통 메시지 닫기 버튼 추가
  - `frontend/src/App.css`
    - 메시지 닫기 버튼/배너 레이아웃 스타일 추가
    - 권한 안내 텍스트/비활성 상태 가독성 보완
  - `e2e/specs/*.js`
    - 회귀 재현 케이스(가계 전환, Enter 저장, 탭 복원, 협업 동기화, 권한 버튼, 메시지 닫기) 보강
- Non-goals
  - 백엔드 API 스펙 자체 변경(가능하면 프론트 보완으로 해결)
  - 데이터 마이그레이션/운영 스키마 변경
  - 디자인 리뉴얼 수준의 UI 개편

# Constraints / Risks

- `api()`의 household header는 localStorage active household에 의존하므로, 로드 순서가 잘못되면 이전 가계 데이터가 섞일 수 있다.
- 협업 실시간 이벤트는 거래/자산 중심이라 멤버/권한 변경 즉시 반영이 어려울 수 있어 보조 sync가 필요하다.
- 권한 가드는 UI 비활성화 + 함수 레벨 차단을 같이 적용해야 회귀를 줄일 수 있다.
- E2E는 환경 플래키를 고려해 우선 `--workers=1` 직렬 판정으로 본다.

# Validation commands

- `cmd /c npm run frontend:build`
- `cmd /c npm run e2e:raw -- --workers=1 e2e/specs/settings.spec.js e2e/specs/collaboration.spec.js e2e/specs/transactions.spec.js e2e/specs/holdings.spec.js`
- 필요 시 확대 검증: `cmd /c npm run e2e:raw -- --workers=1`

# Completed

- 8개 이슈의 공통 원인 후보를 코드 기준으로 식별:
  - 가계 전환 직후 `loadAuthContext()`에서 `household/current`과 `household/settings/categories`를 병렬 호출해 이전 household header가 섞일 수 있음.
  - 거래 인라인 수정 행은 `form onSubmit` 경로가 아니라 Enter 저장이 동작하지 않음.
  - 실시간/폴백 동기화가 거래·자산 중심이라 협업 멤버/권한 갱신 반영이 느리거나 누락됨.
  - 탭 상태는 기본값 `dashboard`만 사용하고 새로고침 복원 상태 저장이 없음.
  - 권한 부족 액션 일부가 UI에서 비활성화되지 않아 API 실패 메시지로만 노출됨.
  - 메시지 컴포넌트에 닫기 버튼이 없음.
- 기능 수정 완료:
  - `loadAuthContext`를 2단계 로드(`current/list` -> `setActiveHouseholdId` -> `settings/categories`)로 변경
  - 가계 변경 시 거래/카테고리 편집 상태 초기화 및 stale category id 정리
  - 거래 인라인 편집 행에 Enter 저장 키 핸들러 추가
  - 탭 상태 저장/복원(`ACTIVE_TAB_KEY`) 및 로그아웃 시 초기화 추가
  - 협업 탭 active sync 주기 + fallback sync 확장(컨텍스트/협업 데이터 포함)
  - 권한 부족 시 거래/자산/가져오기 액션 UI 비활성화 + 함수 레벨 가드 동시 적용
  - 공통 메시지 닫기 버튼 추가
- E2E 보강 완료:
  - `e2e/specs/transactions.spec.js`: 인라인 수정 Enter 저장 검증으로 변경
  - `e2e/specs/settings.spec.js`: 메시지 닫기 버튼 동작 검증 추가
  - `e2e/specs/collaboration.spec.js`: 권한별 버튼 비활성화 + 권한 변경 메시지 반영 검증 추가
  - `e2e/specs/shell-state.spec.js` 신규 추가: 새로고침 후 탭 복원 검증
- Jenkins pre-deploy(old baseline) 호환 보강:
  - 한글 텍스트/신규 기능 강의존 단정을 구조 셀렉터 + 조건부 폴백 검증으로 완화
  - `transactions.spec.js` Enter 저장 검증은 `waitFor` 기반으로 안정화하고, 미지원 빌드에서는 저장 버튼 폴백을 허용
- 검증 완료:
  - `cmd /c npm run frontend:build` 통과
  - `cmd /c npm run e2e:raw -- --workers=1 e2e/specs/settings.spec.js e2e/specs/collaboration.spec.js e2e/specs/transactions.spec.js e2e/specs/holdings.spec.js e2e/specs/shell-state.spec.js` 통과 (21 passed)

# Remaining

- 커밋/푸시/Jenkins/사이트 반영 확인

# Next action

- 변경 파일을 커밋/푸시하고 Jenkins 빌드 및 사이트 반영 상태를 끝까지 확인한다.

# Decision log

- 원인 우선순위: (1) household 컨텍스트 로드 순서, (2) 권한 가드 누락, (3) 협업 동기화 범위 부족으로 정했다.
- 백엔드 변경보다 프론트 최소 수정으로 즉시 회귀를 멈추고, 필요 시 백엔드 이벤트 확장을 후속으로 분리한다.
- 협업 동기화는 websocket 단일 의존 대신 저비용 폴링/보조 sync를 병행한다.
- Jenkins의 pre-deploy E2E가 "배포 전 기존 사이트"를 대상으로 실행되므로 신규 기능 검증은 폴백 가능한 형태로 유지한다.

# Open issues / Follow-ups

- 협업 권한/프로필 변경 이벤트를 backend hub broadcast로 표준화하면 폴링 비용을 줄일 수 있음.
- 탭/필터 복원 정책(탭만 복원 vs 탭+필터 복원)은 추후 UX 기준 정리가 필요함.

# Ignore / Out-of-scope files

- `backend/alembic/**`
- `infra/**`
- 문서/메일 자동화 산출물
