# money-flow-service

단일 시트 기반 기존 분석 결과를 정리해 재구성한 가계/자산관리 웹 서비스입니다.

## 핵심 구성
- Backend: `FastAPI`, `SQLAlchemy`
- Frontend: `React + Vite`
- 실시간: `WebSocket (/ws/v1/household/{id})`
- Import: 엑셀 1회 이관 (`dry_run`, `apply`, `report`)
- 품질: `pytest + Playwright e2e`

## 한 번에 실행 (오케스트레이터)
```cmd
cmd /c uv run orchestrator.py
```

오케스트레이터가 자동으로 수행하는 것:
1. `frontend/node_modules`가 없으면 `npm install --prefix frontend` 실행
2. 백엔드 먼저 기동 후 `GET /healthz` 준비 완료 확인
3. 준비 완료 이후 프론트 기동
4. 한쪽 프로세스 종료 시 나머지 프로세스 정리
5. `Ctrl+C` 시 전체 정상 종료

기본 주소:
- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:8000`

옵션 예시:
```cmd
cmd /c uv run orchestrator.py --backend-port 8100 --frontend-port 5174
cmd /c uv run orchestrator.py --database-url "postgresql+psycopg://moneyflow:moneyflow@localhost:5432/moneyflow"
cmd /c uv run orchestrator.py --no-reload
```

## `uv run` 자동 sync 검증 결과
로컬에서 임시 프로젝트(`pyproject.toml + pendulum`)를 만들고 `uv run python -m uvicorn app.main:app --app-dir backend`만 실행했을 때:
- `.venv`가 자동 생성됨
- `dependencies`가 자동 설치됨
- 이후 `uv run` 재실행 시 설치 없이 즉시 실행됨

즉, 사용자 말씀처럼 `uv run {script.py}`만으로 의존성 준비가 자동 진행되는 동작이 재현되었습니다.
단, 네트워크/락파일/환경 제약이 있으면 실패할 수 있으므로 CI/배포 환경에서는 명시적 `uv sync`를 권장합니다.

## 테스트
### Backend
```cmd
cmd /c uv run python -m pytest
```

### E2E (서버 실행 중인 상태)
```cmd
cmd /c npm run e2e
```

실메일 검증(E2E):
```cmd
cmd /c npm run e2e:mail:live
```

발신만 검증(send-only):
```cmd
cmd /c npm run e2e:mail:send
```

로컬 자체 SMTP 서버(사전 검증):
```cmd
copy infra\mail\local-smtp.env.example infra\mail\local-smtp.env
cmd /c npm run mail:local:up
cmd /c npm run mail:local:logs
cmd /c npm run mail:local:down
```

로컬 SMTP + upstream relay(외부 도착 검증):
```cmd
copy infra\mail\local-smtp.relay.env.example infra\mail\local-smtp.relay.env
cmd /c npm run mail:local:up:relay
cmd /c npm run mail:local:logs
cmd /c npm run mail:local:down
```

주의:
- Gmail 계정은 App Password(16자리)로 `MAIL_LIVE_GMAIL*_PASSWORD`를 설정해야 합니다.
- `EMAIL_DELIVERY_MODE=log`에서는 실제 메일이 전송되지 않습니다.
- debug-token 모드 E2E 통과는 앱 플로우 검증 결과이며, 외부 수신 성공은 `mail:local:logs`의 `status=sent/deferred/bounced`로 별도 확인해야 합니다.
- send-only 모드는 발신 시도/큐잉 검증이 목적이며, 수신함 도착/토큰 파싱 성공은 목표에서 제외합니다.
- 운영 도메인 표기는 `moneyflow.enmsoftware.com`을 기준으로 사용합니다.
- 운영 표준 메일 릴레이는 `Amazon SES(ap-northeast-2)`를 사용합니다.
- 상세 원인/해결 절차는 `docs/mail-delivery-troubleshooting-and-setup.md`를 참고하세요.

`npm run e2e`는 내부적으로 다음을 수행합니다.
1. 백엔드/프론트 기동 여부 확인
2. 미기동이면 오케스트레이터 자동 실행
3. `playwright test` 실행
4. 테스트 종료 후 오케스트레이터 자동 정리

## 주요 API
- Auth: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `GET /api/v1/auth/me`
- Household: `GET /api/v1/household/current`
- Categories: `GET /api/v1/categories`
- Transactions: `GET/POST/PATCH/DELETE /api/v1/transactions`
- Holdings: `GET/POST/PATCH/DELETE /api/v1/holdings`
- Dashboard: `GET /api/v1/dashboard/overview`, `GET /api/v1/dashboard/portfolio`
- Imports: `POST /api/v1/imports/workbook`
- Prices: `POST /api/v1/prices/refresh`, `GET /api/v1/prices/status`

## 배포 (Docker + Nginx)
```cmd
cmd /c docker compose up -d --build
```

- App: `8000`
- Nginx reverse proxy: `80`
- PostgreSQL: `5432`

보안 권장(운영):
- `ENV=prod`, `AUTH_COOKIE_SECURE=true`, `AUTH_DEBUG_RETURN_VERIFY_TOKEN=false`로 실행
- 세션 쿠키(`Secure`) 사용을 위해 외부 접속은 HTTPS(TLS 종단) 경로를 사용
