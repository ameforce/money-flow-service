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

enm-server 개발 메일 스택(공유 수신 캡처용):
```cmd
cmd /c docker network inspect enm-services-mail || docker network create --driver bridge enm-services-mail
cmd /c docker compose -p money-flow-mail -f docker-compose.mail-dev-services.yml up -d
cmd /c docker compose -p money-flow-mail -f docker-compose.mail-dev-services.yml ps
cmd /c docker compose -p money-flow-mail -f docker-compose.mail-dev-services.yml down
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
- `money-flow-mail` 스택은 `enm-services-mail` 네트워크의 공유 서비스를 이용하므로, enm-server에서 `money-flow-service`(dev/prod)와 함께 실행하면 동일 메일 인프라를 재사용해 검증할 수 있습니다.

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

## 배포 자동화 (Jenkins + enm-server Docker Container)
- Jenkins가 있는 `enm-server`에서 이 레포를 Multi-pipeline(멀티 브랜치 파이프라인)으로 등록한 뒤, 이 레포의 루트 `Jenkinsfile`을 사용하면 됩니다.
- 기본 동작은 다음과 같습니다.
  - 빌드 후 `npm run ci:quality:gate` 수행
  - Docker 이미지 빌드
  - `RUN_DEPLOY=true`일 때 배포 승인(필요 시 수동 승인) → enm-server SSH 전송 후 배포
  - 원격 헬스체크(`/healthz`) 성공 확인
  - `RUN_POST_DEPLOY_E2E=true`일 때 배포 후 경량 Playwright smoke 테스트 수행(기본: false)
- 권장 Credential
  - `enm-server-ssh-key`: enm-server SSH private key
  - `moneyflow-prod-env-file`: enm-server 실행 시 사용할 `.env` 파일(비밀값 보관용)
- Jenkinsfile 파라미터 기본값
  - `RUN_DEPLOY=true`, `DEPLOY_DRY_RUN=false`
  - `RUN_POST_DEPLOY_E2E=false`
  - `POST_DEPLOY_E2E_URL=https://moneyflow.enmsoftware.com`
- `NGINX_CLIENT_MAX_BODY_SIZE=20m` (도메인 업로드 제한을 초과한 요청 시 413 방지용)
  - `POST_DEPLOY_E2E_RETRY_COUNT=8`
  - `POST_DEPLOY_E2E_RETRY_INTERVAL_SECONDS=5`
  - `DEPLOY_ALLOWED_BRANCHES=` (빈 값이면 모든 브랜치 허용)
  - `DEPLOY_COMPOSE_PROJECT=money-flow-service`
  - `DEPLOY_COMPOSE_FILE=docker-compose.deploy.yml`
  - `DEPLOY_PATH=/home/ameforce/money-flow-service`(원격 사용자 권한 확인)
  - `DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS=120`, `DEPLOY_HEALTHCHECK_INTERVAL_SECONDS=5`
- `ENM_HOST=enmsoftware.com`, `ENM_PORT=22`, `ENM_USER=ameforce` 기준으로 `enm-server` 접근 테스트 완료.
- `ENM_DEPLOY_PATH`는 `/home/ameforce/money-flow-service`로 설정하면 Jenkins 실행 시 기본 파라미터와 일치.
- 헬스체크가 동작하도록 `ENM_HEALTHCHECK_URL`은 `http://127.0.0.1:18080/healthz`로 운영에서 설정.
- Multi-pipeline 등록 후 빌드 버튼을 누르면 배포가 진행되도록 하려면 Jenkins Job에서 대상 브랜치가 보이는지 확인하고, 수동 승인 단계에서 `승인` 클릭만 진행하면 됩니다.
- 운영 반영 체크리스트
  - [ ] `/home/ameforce/money-flow-service/docker-compose.deploy.yml` 기준으로 앱이 `127.0.0.1:18080`에 바인딩되어 실행되는지 확인
  - [ ] enm-server system nginx에 `moneyflow.enmsoftware.com` vhost가 적용되어 `/ws/`와 `/`을 `127.0.0.1:18080`으로 전달하는지 확인
  - [ ] Cloudflare DNS에서 `moneyflow.enmsoftware.com`이 `enmsoftware.com` 오리진(프록시 모드)으로 정합되는지 확인
  - [ ] SSL 인증서가 `moneyflow.enmsoftware.com` 기준으로 유효하며 자동 갱신되는지 확인
  - [ ] Jenkins 멀티브랜치 Job에서 브랜치 빌드 후 `RUN_DEPLOY` 승인 시 최신 빌드가 반영되는지 확인
  - [ ] `main` 이외 브랜치는 `dev.moneyflow.enmsoftware.com`로 dev 배포가 되는지 확인

### enm-server nginx reverse proxy(금액관리 서비스: moneyflow.enmsoftware.com)
 - 이 프로젝트의 배포 실행은 Jenkinsfile을 통해 정의합니다.
 - Nginx vhost, TLS, Cloudflare 오리진 정책, 도메인 라우팅은 운영 기준 환경에서 별도 관리합니다.
 - Jenkinsfile의 배포 단계에서 필요한 환경값(`ENM_*`, `DEPLOY_*`)을 통해 라우팅/포트/도메인 정책을 적용하세요.
 - Jenkinsfile이 실제 배포 소스 오브 트루스이므로, 서버 레벨 블록 전체를 리포지토리에 풀어서 노출하지 않습니다.

### enm-server dev 도메인 분리 운영
 - `develop/hotfix` 기반 배포는 `hotfix`/`dev` 정책 대상에서 `dev.moneyflow.enmsoftware.com`로 라우팅하도록 Jenkins를 통해 통제합니다.
 - `money-flow-service-dev` 프로젝트/환경값은 Jenkins 파이프라인에서 관리합니다. (로컬 스냅샷/임시 실행은 별도 운영 절차에서만 허용)

보안 권장(운영):
- `ENV=prod`, `AUTH_COOKIE_SECURE=true`, `AUTH_DEBUG_RETURN_VERIFY_TOKEN=false`로 실행
- 세션 쿠키(`Secure`) 사용을 위해 외부 접속은 HTTPS(TLS 종단) 경로를 사용

### enm-server Jenkins 운영 원칙

- Jenkins 자체 접근/운영은 오케스트레이션 경로(해당 서버 접근 정책)에서 처리하고, 운영 계정/비밀번호는 비밀 저장소에서 관리합니다.
- Jenkins 초기 설정/실행 파라미터도 가능하면 infra repo에서 관리하고, 여기에 민감 값이 노출되지 않게 합니다.

### Jenkins 멀티 브랜치 Job 자동 등록 (수동 빌드 트리거)
- `money-flow-service` 레포를 Jenkins 멀티 브랜치 Pipeline으로 등록/갱신하려면 다음 스크립트를 실행합니다.
- 대상 브랜치는 SCM 탐색으로 감지되며, `Jenkinsfile`이 없는 브랜치는 생성되지 않습니다.

```bash
cd C:/Workspace/Daeng/Git/Project/money-flow-service
export JENKINS_URL=https://jenkins.enmsoftware.com
export JENKINS_JOB_NAME=money-flow-service
export MONEYFLOW_REPO_URL=https://github.com/ameforce/money-flow-service.git
export JENKINSFILE_PATH=Jenkinsfile
export ENM_USER=<ENM_USER>
export ENM_PASSWORD=<ENM_PASSWORD>
bash scripts/deploy/jenkins/register-jenkins-multibranch-job.sh
```

- 실행 후 확인:
  - `https://jenkins.enmsoftware.com/job/money-flow-service/`
  - `main` 브랜치가 보이는지 확인
  - `main` 브랜치 페이지에서 `Build Now`로 버튼 배포를 트리거 가능
- 선택적으로 주기 스캔이 필요하면 아래 변수로 분기/푸시 감시 간격을 추가합니다.

```bash
export JENKINS_MULTI_BRANCH_SCAN_SPEC="H/15 * * * *"
bash scripts/deploy/jenkins/register-jenkins-multibranch-job.sh
```

## 커밋 컨벤션

- 커밋 메시지는 가능하면 한글로 작성한다.
- 접두사는 `fix`, `feat`, `chore`, `refact` 중 하나를 사용한다.
- 포맷: `<prefix>: <요약>` (예: `fix: 품질 게이트 우회 옵션 추가`)
- Cursor로 생성한 커밋에 자동 첨부되는 `Made-with: Cursor` 트레일러는 커밋 전에 제거한다.
- `main`, `develop` 브랜치에는 직접 커밋하지 않는다.
- 이미 원격 푸시된 커밋도 컨벤션에 맞지 않으면 개선한다.
