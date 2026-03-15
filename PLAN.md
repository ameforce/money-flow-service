# Goal

- 설정 탭에서도 현재 협업 탭과 동일하게 작업 가계를 전환할 수 있게 한다.
- 기존 협업 탭 전환 동작, 온보딩/초대 플로우, 권한 제약은 유지한다.

# Scope / Non-goals

- Scope
  - 설정 탭 UI에 작업 가계 전환 영역 추가: `frontend/src/App.jsx`
  - 설정 탭 전환 영역 스타일 추가/정렬 보완: `frontend/src/App.css`
  - 회귀/기능 검증 E2E 추가 또는 확장: `e2e/specs/settings.spec.js`
  - 협업/설정 관련 핵심 시나리오 반복 검증: `e2e/specs/collaboration.spec.js`, `e2e/specs/settings.spec.js`
- Non-goals
  - `household/select` API 스펙 변경
  - 탭 구조/정보구조 재변경
  - 권한 정책(전환 가능 조건) 변경

# Constraints / Risks

- `selectActiveHousehold`는 여러 데이터 새로고침(`loadAuthContext`, `refreshData`, `refreshCollaborationData`)을 수행하므로 중복 호출 방지가 필요하다.
- 모바일 화면에서 설정 탭 카드 추가 시 세로 길이가 늘어나므로 overflow/간격 붕괴를 점검해야 한다.
- E2E 병렬 실행에서 간헐 인증 토큰 입력 플래키가 있어 필요 시 직렬 재검증으로 판정한다.

# Validation commands

- `cmd /c npm run frontend:build`
- `cmd /c npm run e2e:raw -- --workers=1 e2e/specs/settings.spec.js e2e/specs/collaboration.spec.js`
- 필요 시 확대 검증: `cmd /c npm run e2e:raw -- --workers=1 e2e/specs/dashboard.spec.js e2e/specs/transactions.spec.js e2e/specs/holdings.spec.js`

# Completed

- 협업 탭의 작업 가계 전환 동작 위치 확인 (`selectActiveHousehold`, `householdList` 기반 select).
- 설정 탭 레이아웃과 비어있는 우측 영역 사용 가능성 확인.
- 설정 탭에 `작업 가계 전환` 카드 추가 및 `selectActiveHousehold` 재사용 연결.
- 협업 탭과 설정 탭의 가계 전환 select를 공통 핸들러(`handleHouseholdSwitchChange`)로 정리.
- E2E 확장: `e2e/specs/collaboration.spec.js`에 설정 탭 전환 검증 단계 추가.
- 검증 완료:
  - `cmd /c npm run frontend:build` 통과
  - `cmd /c npm run e2e:raw -- --workers=1 e2e/specs/settings.spec.js e2e/specs/collaboration.spec.js` 통과 (6 passed)

# Remaining

- 커밋/푸시 후 Jenkins 빌드 상태 확인.
- 사이트 반영 여부 확인.

# Next action

- 변경 파일을 커밋하고 원격 브랜치에 push한 뒤 Jenkins 빌드 상태를 확인한다.

# Decision log

- 사용자 제안에 동의: 설정 탭의 빈 공간 활용은 정보 구조상 자연스럽고 협업 탭 의존성을 줄인다.
- 기능 중복 구현 대신 기존 `selectActiveHousehold` 재사용을 선택해 회귀 위험을 최소화한다.
- 설정 탭의 전환 UI는 권한 변경이 아닌 "현재 작업 컨텍스트 전환" 기능으로 표시한다.
- E2E 판정은 플래키 리스크를 줄이기 위해 직렬(`--workers=1`) 기준을 우선 적용한다.

# Open issues / Follow-ups

- 설정 탭 진입 시 가계 전환 사용량을 추적하는 telemetry는 아직 미적용 상태다.
- 플래키 E2E 원인(인증 토큰 입력 경합)은 별도 안정화 작업 후보로 유지한다.

# Ignore / Out-of-scope files

- 백엔드 도메인 로직/마이그레이션: `backend/app`, `backend/alembic`
- 인프라/배포 스크립트 구조 변경: `infra`, `scripts`
- 메일/문서 자동화 관련 파일
