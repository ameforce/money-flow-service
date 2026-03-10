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
  - `POST_DEPLOY_E2E_RETRY_COUNT=8`
  - `POST_DEPLOY_E2E_RETRY_INTERVAL_SECONDS=5`
- `DEPLOY_ALLOWED_BRANCHES=main`
  - `DEPLOY_COMPOSE_PROJECT=money-flow-service`
  - `DEPLOY_COMPOSE_FILE=docker-compose.deploy.yml`
  - `DEPLOY_PATH=/home/ameforce/money-flow-service`(원격 사용자 권한 확인)
  - `DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS=120`, `DEPLOY_HEALTHCHECK_INTERVAL_SECONDS=5`
- `ENM_HOST=enmsoftware.com`, `ENM_PORT=22`, `ENM_USER=ameforce` 기준으로 `enm-server` 접근 테스트 완료.
- `ENM_DEPLOY_PATH`는 `/home/ameforce/money-flow-service`로 설정하면 Jenkins 실행 시 기본 파라미터와 일치.
- 헬스체크가 동작하도록 `ENM_HEALTHCHECK_URL`은 `http://127.0.0.1:18080/healthz`로 운영에서 설정.
- Multi-pipeline 등록 후 빌드 버튼을 누르면 배포가 진행되도록 하려면 Jenkins Job 생성 시 `main` 브랜치가 감지되도록 설정하고, 수동 승인 단계에서 `승인` 클릭만 진행하면 됩니다.
- 운영 반영 체크리스트
  - [ ] `/home/ameforce/money-flow-service/docker-compose.deploy.yml` 기준으로 앱이 `127.0.0.1:18080`에 바인딩되어 실행되는지 확인
  - [ ] enm-server system nginx에 `moneyflow.enmsoftware.com` vhost가 적용되어 `/ws/`와 `/`을 `127.0.0.1:18080`으로 전달하는지 확인
  - [ ] Cloudflare DNS에서 `moneyflow.enmsoftware.com`이 `enmsoftware.com` 오리진(프록시 모드)으로 정합되는지 확인
  - [ ] SSL 인증서가 `moneyflow.enmsoftware.com` 기준으로 유효하며 자동 갱신되는지 확인
  - [ ] Jenkins 멀티브랜치 Job에서 `main` 브랜치 빌드 후 `RUN_DEPLOY` 승인 시 최신 빌드가 반영되는지 확인

### enm-server nginx reverse proxy(금액관리 서비스: moneyflow.enmsoftware.com)
- enm-server가 이미 80/443을 점유 중이므로, 서비스 컨테이너는 내부에서 `127.0.0.1:18080`로만 열어둡니다(`docker-compose.deploy.yml` 기준).
- enm-server의 system nginx에서 `moneyflow.enmsoftware.com`을 다음 업스트림으로 연결합니다.
  - `http://127.0.0.1:18080` (WebSocket 업스트림 포함)
- 권장 서버 블록 스니펫 (`/etc/nginx/sites-available/moneyflow.enmsoftware.com.conf`, `sites-enabled` 연결 후 Reload)

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name moneyflow.enmsoftware.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name moneyflow.enmsoftware.com;

  ssl_certificate /etc/letsencrypt/live/moneyflow.enmsoftware.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/moneyflow.enmsoftware.com/privkey.pem;

  # 앱 본문
  location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # WebSocket 경로
  location /ws/ {
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
  }
}
```

- 실행 예시(루트 권한 필요):
  - `sudo bash scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh moneyflow.enmsoftware.com 18080`

- Cloudflare 대시보드에서 `moneyflow.enmsoftware.com`을 `enmsoftware.com`과 동일한 Cloudflare DNS/SSL 오리진 정책으로 둔 뒤, enm-server Nginx가 위 블록을 읽도록 설정해 주세요.

보안 권장(운영):
- `ENV=prod`, `AUTH_COOKIE_SECURE=true`, `AUTH_DEBUG_RETURN_VERIFY_TOKEN=false`로 실행
- 세션 쿠키(`Secure`) 사용을 위해 외부 접속은 HTTPS(TLS 종단) 경로를 사용

### enm-server nginx reverse proxy(젠킨스: jenkins.enmsoftware.com)

- Jenkins는 enm-server에서 별도 컨테이너로 실행되며 `127.0.0.1:8080`에서만 바인딩하세요.
- Cloudflare DNS는 `jenkins.enmsoftware.com`이 `enmsoftware.com`의 오리진 정책(또는 동일 TLS/리버스 프록시 정책)을 따르도록 등록하세요.
- enm-server 시스템 Nginx에 아래 스니펫을 적용하면 도메인 접근이 가능합니다.

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name jenkins.enmsoftware.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name jenkins.enmsoftware.com;

  ssl_certificate /etc/letsencrypt/live/enmsoftware.com-0001/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/enmsoftware.com-0001/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
  }
}
```

- 실행 예시(루트 권한 필요):
  - `sudo bash scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh jenkins.enmsoftware.com 8080`
- Jenkins 초기 비밀번호는 컨테이너 로그 또는 아래 파일에서 확인:
  - `docker logs --tail 40 jenkins | tail -n 5`
  - `/home/ameforce/jenkins_home/secrets/initialAdminPassword`
- 현재 Jenkins 실행은 enm-server의 OS 계정(`ENM_USER`, 기본 `jenkins`)을 생성/재설정하고, 그 사용자 UID/GID로 컨테이너를 기동합니다.
- Jenkins 웹 로그인 계정도 동일하게 `ENM_USER` / `ENM_PASSWORD`로 맞추며, 이전에 잘못 만든 웹 계정(`jenkins`)은 실행 시 정리합니다.
- 로컬/원격에서 동일 설정을 반영할 때:

```bash
export ENM_USER=<ENM_USER>
export ENM_PASSWORD=<ENM_PASSWORD>
bash /home/ameforce/money-flow-service/scripts/deploy/jenkins/deploy-jenkins-container.sh
```

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
