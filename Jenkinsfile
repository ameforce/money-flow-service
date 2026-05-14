pipeline {
  agent any

  options {
    disableConcurrentBuilds(abortPrevious: true)
    timeout(time: 90, unit: 'MINUTES')
  }

  parameters {
    booleanParam(
      name: 'RUN_DEPLOY',
      defaultValue: true,
      description: '빌드 성공 시 배포 스테이지 실행 여부 (기본 true)'
    )
    booleanParam(
      name: 'RUN_POST_DEPLOY_E2E',
      defaultValue: true,
      description: '배포 완료 후 배포 URL에 대해 경량 Playwright E2E를 수행'
    )
    booleanParam(
      name: 'SKIP_QUALITY_GATE',
      defaultValue: false,
      description: 'Quality Gate(ci:quality:gate) 스테이지를 건너뜀'
    )
    booleanParam(
      name: 'SKIP_DEPLOY_APPROVAL',
      defaultValue: true,
      description: '배포 전 수동 승인 단계(input) 건너뛰기'
    )
    booleanParam(
      name: 'DEPLOY_DRY_RUN',
      defaultValue: false,
      description: 'true면 승인/미리보기만 수행하고 실제 배포는 실행하지 않음'
    )
    string(
      name: 'DEPLOY_HOST',
      defaultValue: 'enmsoftware.com',
      description: '배포 대상 서버 호스트'
    )
    string(
      name: 'DEPLOY_DOMAIN',
      defaultValue: 'moneyflow.enmsoftware.com',
      description: '서비스 도메인'
    )
    string(
      name: 'DEPLOY_SSH_USER',
      defaultValue: 'ameforce',
      description: '배포 대상 SSH 계정'
    )
    string(
      name: 'DEPLOY_PATH',
      defaultValue: '/home/ameforce/money-flow-service',
      description: '서버 내 배포 경로(SSH 사용자 ameforce 권한 경로 권장)'
    )
    string(
      name: 'DEPLOY_ALLOWED_BRANCHES',
      defaultValue: '',
      description: '배포 허용 브랜치 목록(쉼표 구분). 빈 값이면 브랜치 제한 없음'
    )
    string(
      name: 'DEPLOY_COMPOSE_PROJECT',
      defaultValue: 'money-flow-service',
      description: '원격 docker compose 프로젝트명'
    )
    string(
      name: 'DEPLOY_SSH_CREDENTIALS_ID',
      defaultValue: 'enm-server-ssh-key',
      description: 'Jenkins SSH private key credentials ID'
    )
    string(
      name: 'DEPLOY_ENV_FILE_CREDENTIALS_ID',
      defaultValue: 'moneyflow-prod-env-file',
      description: 'Jenkins Secret file(.env) credentials ID'
    )
    string(
      name: 'PROD_SMTP_ENV_FILE_CREDENTIALS_ID',
      defaultValue: 'moneyflow-prod-smtp-env-file',
      description: 'main/prod 전용 SMTP Secret file credentials ID (SMTP_* only)'
    )
    string(
      name: 'PROD_SMTP_CREDENTIAL_OWNER',
      defaultValue: 'Jenkins credential moneyflow-prod-smtp-env-file owner',
      description: '로그에 남길 prod SMTP credential owner/approver 역할명(비밀값 금지)'
    )
    string(
      name: 'DEPLOY_COMPOSE_FILE',
      defaultValue: 'docker-compose.deploy.yml',
      description: '원격 배포에 사용할 compose 파일'
    )
    string(
      name: 'DEPLOY_HEALTHCHECK_URL',
      defaultValue: 'http://127.0.0.1:18080/healthz',
      description: '원격 배포 후 헬스체크 URL'
    )
    string(
      name: 'DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS',
      defaultValue: '120',
      description: '원격 헬스체크 최대 대기 시간(초)'
    )
    string(
      name: 'DEPLOY_HEALTHCHECK_INTERVAL_SECONDS',
      defaultValue: '5',
      description: '원격 헬스체크 간격(초)'
    )
    string(
      name: 'POST_DEPLOY_E2E_URL',
      defaultValue: 'https://moneyflow.enmsoftware.com',
      description: '배포 후 E2E 대상 URL'
    )
    string(
      name: 'POST_DEPLOY_E2E_API_BASE_URL',
      defaultValue: '',
      description: 'E2E API_BASE_URL(비워두면 POST_DEPLOY_E2E_URL 사용)'
    )
    string(
      name: 'POST_DEPLOY_E2E_API_REQUEST_ORIGIN',
      defaultValue: '',
      description: 'E2E API_REQUEST_ORIGIN(비워두면 POST_DEPLOY_E2E_URL 사용)'
    )
    string(
      name: 'POST_DEPLOY_E2E_RETRY_COUNT',
      defaultValue: '8',
      description: 'E2E 대상 URL 준비 확인 재시도 횟수'
    )
    string(
      name: 'POST_DEPLOY_E2E_RETRY_INTERVAL_SECONDS',
      defaultValue: '5',
      description: 'E2E 대상 URL 준비 확인 재시도 간격(초)'
    )
    string(
      name: 'DEPLOY_SSH_OPTS',
      defaultValue: '-o BatchMode=yes -o StrictHostKeyChecking=accept-new',
      description: 'ssh/scp 공통 옵션'
    )
    string(
      name: 'NGINX_CLIENT_MAX_BODY_SIZE',
      defaultValue: '20m',
      description: 'nginx client_max_body_size (예: 20m, 50m)'
    )
  }

  environment {
    PYTHONUNBUFFERED = '1'
    DOCKER_BUILDKIT = '1'
    IMAGE_NAME = 'money-flow-service'
    CI_NODE_VERSION = '22.12.0'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Resolve App Version') {
      steps {
        script {
          if (isUnix()) {
            sh 'git fetch --all --tags --prune'
          } else {
            bat 'git fetch --all --tags --prune'
          }

          def resolveBranch = (env.BRANCH_NAME ?: env.GIT_BRANCH ?: env.GIT_LOCAL_BRANCH ?: env.CHANGE_BRANCH ?: env.JOB_BASE_NAME ?: 'main').trim()
          if (resolveBranch.startsWith('origin/')) {
            resolveBranch = resolveBranch.substring('origin/'.length())
          }
          if (resolveBranch.startsWith('refs/heads/')) {
            resolveBranch = resolveBranch.substring('refs/heads/'.length())
          }

          def version = ''
          if (isUnix()) {
            version = sh(
              returnStdout: true,
              script: '''
                set -e
                latest_tag=$(git tag --list --sort=-v:refname 'v[0-9]*.[0-9]*.[0-9]*' | sed -n '1p')
                if [ -z "$latest_tag" ]; then
                  echo "NONE"
                  exit 0
                fi
                latest_count=$(git rev-list --count "${latest_tag}..HEAD")
                echo "${latest_tag},${latest_count}"
              '''
            ).trim()
          } else {
            version = powershell(
              returnStdout: true,
              script: '''
                $tagLines = git tag --list --sort=-v:refname "v[0-9]*.[0-9]*.[0-9]*"
                $latestTag = ($tagLines | Where-Object { $_ -match '^v[0-9]+[.][0-9]+[.][0-9]+$' } | Select-Object -First 1)
                if ([string]::IsNullOrWhiteSpace($latestTag)) {
                  Write-Output "NONE"
                  exit 0
                }
                $count = (git rev-list --count "$latestTag..HEAD").Trim()
                "${latestTag},${count}"
              '''
            ).trim()
          }

          def parsedVersion = ''
          def parts = version.split(',')
          if (version && version != 'NONE' && parts.size() == 2) {
            def latestTag = parts[0]?.trim()
            def commitCount = (parts[1]?.trim() ?: '0')
            def tagMatcher = (latestTag =~ /^v?([0-9]+\.[0-9]+\.[0-9]+)$/)
            if (tagMatcher.matches()) {
              def baseTag = tagMatcher[0][1]
              parsedVersion = "v${baseTag}.${commitCount}"
            }
          } else {
            def tagMatcher = (version =~ /^v([0-9]+\.[0-9]+\.[0-9]+)$/)
            if (tagMatcher.matches()) {
              def baseTag = tagMatcher[0][1]
              parsedVersion = "v${baseTag}.0"
            }
          }

          if (!parsedVersion) {
            def branchTail = resolveBranch.tokenize('/').last()
            if (branchTail ==~ /^v?[0-9]+\.[0-9]+\.[0-9]+$/) {
              def normalizedBranchTail = branchTail.startsWith('v') ? branchTail.substring(1) : branchTail
              parsedVersion = "v${normalizedBranchTail}.0"
            } else {
              parsedVersion = 'v0.1.1.0'
            }
          }

          if (parsedVersion == 'v0.0.0.0' || parsedVersion ==~ /^v0\\.0\\.0\\.[0-9]+$/) {
            parsedVersion = 'v0.1.1.0'
          }

          version = parsedVersion

          env.APP_VERSION = version
          echo "Resolved version = ${env.APP_VERSION}"
        }
      }
    }

    stage('Resolve Deploy Target') {
      steps {
        script {
          def deployBranch = (env.BRANCH_NAME ?: env.GIT_BRANCH ?: env.GIT_LOCAL_BRANCH ?: env.CHANGE_BRANCH ?: env.JOB_BASE_NAME ?: 'manual').trim()
          if (deployBranch.startsWith('origin/')) {
            deployBranch = deployBranch.substring('origin/'.length())
          }
          if (deployBranch == 'refs/heads/main') {
            deployBranch = 'main'
          }
          def isMainBranch = (deployBranch == 'main')

          env.DEPLOY_TARGET_BRANCH = deployBranch
          env.DEPLOY_TARGET_ENV = isMainBranch ? 'prod' : 'dev'
          env.DEPLOY_DOMAIN_FOR_BRANCH = isMainBranch ? (params.DEPLOY_DOMAIN?.trim() ?: 'moneyflow.enmsoftware.com') : 'dev.moneyflow.enmsoftware.com'
          env.DEPLOY_COMPOSE_FILE_RESOLVED = isMainBranch ? (params.DEPLOY_COMPOSE_FILE?.trim() ?: 'docker-compose.deploy.yml') : 'docker-compose.dev.deploy.yml'
          env.DEPLOY_COMPOSE_PROJECT_RESOLVED = isMainBranch ? (params.DEPLOY_COMPOSE_PROJECT?.trim() ?: 'money-flow-service') : 'money-flow-service-dev'
          env.DEPLOY_HEALTHCHECK_URL_RESOLVED = isMainBranch ? (params.DEPLOY_HEALTHCHECK_URL?.trim() ?: 'http://127.0.0.1:18080/healthz') : 'http://127.0.0.1:18081/healthz'
          env.POST_DEPLOY_E2E_URL_RESOLVED = isMainBranch ? (params.POST_DEPLOY_E2E_URL?.trim() ?: 'https://moneyflow.enmsoftware.com') : 'https://dev.moneyflow.enmsoftware.com'
          env.DEPLOY_ENV_FILE_NAME = isMainBranch ? '.env' : '.env.dev'
          env.SKIP_QUALITY_GATE_FOR_BRANCH = isMainBranch ? 'false' : 'true'
          env.SKIP_POST_DEPLOY_E2E_FOR_BRANCH = 'false'

          echo "Resolved deploy branch=${env.DEPLOY_TARGET_BRANCH}, target_env=${env.DEPLOY_TARGET_ENV}, domain=${env.DEPLOY_DOMAIN_FOR_BRANCH}, compose=${env.DEPLOY_COMPOSE_PROJECT_RESOLVED}/${env.DEPLOY_COMPOSE_FILE_RESOLVED}, env_file=${env.DEPLOY_ENV_FILE_NAME}"
        }
      }
    }

    stage('Install Dependencies') {
      steps {
        script {
          if (isUnix()) {
            sh '''
set -e
set -u

export PATH="$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  if command -v python3 >/dev/null 2>&1 && python3 -m pip --version >/dev/null 2>&1; then
    python3 -m pip install --user uv
  elif command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://astral.sh/uv/install.sh | sh
  else
    echo "[skip] uv bootstrap requires pip, curl, or wget; skipping backend dependency sync."
  fi
fi

export PATH="$HOME/.local/bin:$PATH"
if command -v uv >/dev/null 2>&1; then
  uv sync --extra dev
else
  echo "[skip] uv not available; skipping backend dependency sync."
fi

. ./scripts/ci/ensure-node.sh

if command -v npm >/dev/null 2>&1; then
  npm install
  npm install --prefix frontend
  if command -v npx >/dev/null 2>&1; then
    npx playwright install --with-deps chromium || npx playwright install chromium
  else
    echo "[skip] npx is not available; skipping playwright install."
  fi
else
  echo "[skip] npm is not available; skipping frontend install."
fi
'''
          } else {
            bat 'uv sync --extra dev'
            bat 'npm install'
            bat 'npm install --prefix frontend'
            bat 'npx playwright install chromium'
          }
        }
      }
    }

    stage('Quality Gate') {
      steps {
        script {
          def deployBlockingPath = params.RUN_DEPLOY && !params.DEPLOY_DRY_RUN
          def branchSkipQualityGate = (env.SKIP_QUALITY_GATE_FOR_BRANCH?.trim() == 'true')
          if (deployBlockingPath && params.SKIP_QUALITY_GATE) {
            error('RUN_DEPLOY=true 경로에서는 Quality Gate 우회가 허용되지 않습니다. SKIP_QUALITY_GATE를 해제하세요.')
          }
          def qualityGateSkipRequested = params.SKIP_QUALITY_GATE || (branchSkipQualityGate && !deployBlockingPath)
          if (deployBlockingPath && branchSkipQualityGate) {
            echo '[guard] deploy path detected -> branch quality gate skip policy ignored'
          }
          if (qualityGateSkipRequested) {
            echo '[skip] Quality gate skipped: SKIP_QUALITY_GATE or non-main branch'
          } else if (isUnix()) {
            sh '''
set -e
export PATH="$HOME/.local/bin:$PATH"
. ./scripts/ci/ensure-node.sh
if command -v npm >/dev/null 2>&1; then
  npm run ci:quality:gate
else
  echo "[skip] npm is not available."
fi
'''
          } else {
            bat 'npm run ci:quality:gate'
          }
        }
      }
    }

    stage('Build Image') {
      steps {
        script {
          if (isUnix()) {
            sh """
if command -v docker >/dev/null 2>&1; then
  docker build -t ${env.IMAGE_NAME}:${env.APP_VERSION} --build-arg APP_VERSION=${env.APP_VERSION} .
else
  echo "[skip] docker is not available on Jenkins node; skipping local image build."
fi
"""
          } else {
            bat "docker build -t ${env.IMAGE_NAME}:${env.APP_VERSION} --build-arg APP_VERSION=${env.APP_VERSION} ."
          }
        }
      }
    }

    stage('Pre-Deploy E2E (Blocking)') {
      when {
        allOf {
          expression { return params.RUN_DEPLOY }
          expression { return !params.DEPLOY_DRY_RUN }
        }
      }
      steps {
        script {
          if (!isUnix()) {
            error('Pre-Deploy E2E 단계는 Unix Jenkins agent가 필요합니다.')
          }
          def targetUrl = (env.POST_DEPLOY_E2E_URL_RESOLVED ?: 'https://moneyflow.enmsoftware.com')
          if (!targetUrl) {
            error('POST_DEPLOY_E2E_URL_RESOLVED가 비어 있습니다.')
          }
          def apiBaseUrl = (params.POST_DEPLOY_E2E_API_BASE_URL?.trim() ?: targetUrl)
          if (!apiBaseUrl) {
            apiBaseUrl = targetUrl
          }
          def apiRequestOrigin = (params.POST_DEPLOY_E2E_API_REQUEST_ORIGIN?.trim() ?: targetUrl)
          if (!apiRequestOrigin) {
            apiRequestOrigin = targetUrl
          }
          def retryCount = params.POST_DEPLOY_E2E_RETRY_COUNT.toInteger()
          def retryInterval = params.POST_DEPLOY_E2E_RETRY_INTERVAL_SECONDS.toInteger()
          if (retryCount < 1) {
            error('POST_DEPLOY_E2E_RETRY_COUNT는 1 이상이어야 합니다.')
          }
          if (retryInterval < 1) {
            error('POST_DEPLOY_E2E_RETRY_INTERVAL_SECONDS는 1 이상이어야 합니다.')
          }

          try {
            def liveSmokeCommand = 'npx playwright test --grep "auth deep-link token policy: query token rejected" e2e/specs/deeplink.spec.js --workers=1'
            withEnv([
              "TARGET_URL=${targetUrl}",
              "RETRY_COUNT=${retryCount}",
              "RETRY_INTERVAL=${retryInterval}",
              "E2E_BASE_URL=${targetUrl}",
              "E2E_API_BASE_URL=${apiBaseUrl}",
              "E2E_API_REQUEST_ORIGIN=${apiRequestOrigin}"
            ]) {
              def targetReadyStatus = sh(returnStatus: true, script: '''
set -eu
attempt=1
while true; do
  if curl -fsS "$TARGET_URL/healthz"; then
    echo "[pre-deploy-e2e] $TARGET_URL health check OK"
    exit 0
  fi

  if [ "$attempt" -ge "$RETRY_COUNT" ]; then
    echo "[pre-deploy-e2e] $TARGET_URL is unavailable after $RETRY_COUNT retries"
    exit 3
  fi

  echo "[pre-deploy-e2e] health check retry $attempt/$RETRY_COUNT: $TARGET_URL"
  attempt=$((attempt + 1))
  sleep "$RETRY_INTERVAL"
done
            ''')
              if (targetReadyStatus == 3) {
                echo "[pre-deploy-e2e] live target is unavailable; skipping live-site smoke so Deploy Execute can restore ${targetUrl}. Post-deploy smoke remains blocking."
                return
              }
              if (targetReadyStatus != 0) {
                error("[pre-deploy-e2e] unexpected health-check status: ${targetReadyStatus}")
              }
              echo "[pre-deploy-e2e] smoke policy: run lightweight live-site check only; exhaustive suite remains in ci:quality:gate."
              sh ". ./scripts/ci/ensure-node.sh\n${liveSmokeCommand}"
            }
          } finally {
            archiveArtifacts artifacts: 'playwright-report/**,test-results/**,output/playwright/e2e-flow/**', allowEmptyArchive: true, onlyIfSuccessful: false
          }
        }
      }
    }

    stage('Deploy Plan (Approval Gate)') {
      when {
        expression { return params.RUN_DEPLOY }
      }
      steps {
        script {
          def deployBranch = (env.BRANCH_NAME ?: env.GIT_BRANCH ?: env.GIT_LOCAL_BRANCH ?: env.CHANGE_BRANCH ?: env.JOB_BASE_NAME ?: 'manual').trim()
          if (deployBranch.startsWith('origin/')) {
            deployBranch = deployBranch.substring('origin/'.length())
          }
          if (deployBranch == 'refs/heads/main') {
            deployBranch = 'main'
          }
          def allowedBranches = params.DEPLOY_ALLOWED_BRANCHES.split(',').collect { it.trim() }.findAll { it }
          def canDeployBranch = deployBranch == 'manual' || allowedBranches.isEmpty() || allowedBranches.contains(deployBranch)
          env.CAN_DEPLOY_BRANCH = canDeployBranch.toString()
          env.DEPLOY_TARGET_BRANCH = deployBranch

          def imageTag = "${env.IMAGE_NAME}:${env.APP_VERSION}"
          def previewLines = [
            '[deploy-preview]',
            "run_deploy=${params.RUN_DEPLOY}",
            "dry_run=${params.DEPLOY_DRY_RUN}",
            "app_version=${env.APP_VERSION}",
            "build_number=${env.BUILD_NUMBER}",
            "build_branch=${deployBranch}",
            "deploy_allowed_branch=${params.DEPLOY_ALLOWED_BRANCHES}",
            "branch_allowed=${canDeployBranch}",
            "target_host=${params.DEPLOY_HOST}",
            "deploy_target=${env.DEPLOY_TARGET_ENV}",
            "target_domain=${env.DEPLOY_DOMAIN_FOR_BRANCH}",
            "ssh_user=${params.DEPLOY_SSH_USER}",
            "deploy_path=${params.DEPLOY_PATH}",
            "compose_file=${env.DEPLOY_COMPOSE_FILE_RESOLVED}",
            "compose_project=${env.DEPLOY_COMPOSE_PROJECT_RESOLVED}",
            "healthcheck=${env.DEPLOY_HEALTHCHECK_URL_RESOLVED}",
            "env_file=${env.DEPLOY_ENV_FILE_NAME}",
            "healthcheck_timeout_sec=${params.DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS}",
            "healthcheck_interval_sec=${params.DEPLOY_HEALTHCHECK_INTERVAL_SECONDS}",
            "image_tag=${imageTag}",
            '',
            '# remote command template',
             "mkdir -p ${params.DEPLOY_PATH}",
             "cd ${params.DEPLOY_PATH}",
             "tar -xzf deploy-${env.BUILD_NUMBER}.tgz",
             "docker compose -p ${env.DEPLOY_COMPOSE_PROJECT_RESOLVED} -f ${env.DEPLOY_COMPOSE_FILE_RESOLVED} --env-file ${env.DEPLOY_ENV_FILE_NAME} build --no-cache",
             "docker compose -p ${env.DEPLOY_COMPOSE_PROJECT_RESOLVED} -f ${env.DEPLOY_COMPOSE_FILE_RESOLVED} --env-file ${env.DEPLOY_ENV_FILE_NAME} up -d postgres",
             "docker exec <postgres-container> sh -lc 'psql ... ALTER USER ...'",
             "docker compose -p ${env.DEPLOY_COMPOSE_PROJECT_RESOLVED} -f ${env.DEPLOY_COMPOSE_FILE_RESOLVED} --env-file ${env.DEPLOY_ENV_FILE_NAME} run --rm app env PYTHONPATH=backend python -c 'from app.db.init_db import create_schema; create_schema()'",
             "docker compose -p ${env.DEPLOY_COMPOSE_PROJECT_RESOLVED} -f ${env.DEPLOY_COMPOSE_FILE_RESOLVED} --env-file ${env.DEPLOY_ENV_FILE_NAME} run --rm app env PYTHONPATH=backend python -m app.db.schema_upgrade",
             "echo SCHEMA_UPGRADE_OK",
             "docker compose -p ${env.DEPLOY_COMPOSE_PROJECT_RESOLVED} -f ${env.DEPLOY_COMPOSE_FILE_RESOLVED} --env-file ${env.DEPLOY_ENV_FILE_NAME} up -d app",
             "curl -fsS -H 'Host: ${env.DEPLOY_DOMAIN_FOR_BRANCH}' ${env.DEPLOY_HEALTHCHECK_URL_RESOLVED}"
           ]

          writeFile file: 'deploy-preview.txt', text: previewLines.join('\n').trim() + '\n'
          archiveArtifacts artifacts: 'deploy-preview.txt', onlyIfSuccessful: false

          if (!canDeployBranch) {
            echo "현재 브랜치(${deployBranch})는 DEPLOY_ALLOWED_BRANCHES(${params.DEPLOY_ALLOWED_BRANCHES})에 포함되지 않아 배포를 건너뜁니다."
            return
          }

          if (params.DEPLOY_DRY_RUN) {
            echo 'DEPLOY_DRY_RUN=true: 승인/배포는 건너뛰고 미리보기만 수행합니다.'
            return
          }

          if (!params.SKIP_DEPLOY_APPROVAL) {
            input(
              message: "배포 승인: ${env.DEPLOY_DOMAIN_FOR_BRANCH} -> ${params.DEPLOY_HOST} (branch: ${deployBranch})",
              ok: '승인'
            )
          }
        }
      }
    }

    stage('Deploy Execute') {
      when {
        allOf {
          expression { return params.RUN_DEPLOY }
          expression { return !params.DEPLOY_DRY_RUN }
        }
      }
      steps {
        script {
          def deployBranch = (env.BRANCH_NAME ?: env.GIT_BRANCH ?: env.GIT_LOCAL_BRANCH ?: env.CHANGE_BRANCH ?: env.JOB_BASE_NAME ?: 'manual').trim()
          if (deployBranch.startsWith('origin/')) {
            deployBranch = deployBranch.substring('origin/'.length())
          }
          if (deployBranch == 'refs/heads/main') {
            deployBranch = 'main'
          }
          def allowedBranches = params.DEPLOY_ALLOWED_BRANCHES.split(',').collect { it.trim() }.findAll { it }
          def canDeployBranch = deployBranch == 'manual' || allowedBranches.isEmpty() || allowedBranches.contains(deployBranch)
          if (!canDeployBranch) {
            echo "현재 브랜치(${deployBranch})는 배포 허용 브랜치 목록(${params.DEPLOY_ALLOWED_BRANCHES}) 밖입니다."
            return
          }

          if (!isUnix()) {
            error('Deploy Execute 단계는 Unix Jenkins agent가 필요합니다.')
          }
          if (!params.DEPLOY_SSH_CREDENTIALS_ID?.trim()) {
            error('DEPLOY_SSH_CREDENTIALS_ID 파라미터가 비어 있습니다.')
          }
          if (!params.DEPLOY_ENV_FILE_CREDENTIALS_ID?.trim()) {
            error('DEPLOY_ENV_FILE_CREDENTIALS_ID 파라미터가 비어 있습니다.')
          }
          if (!params.DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS?.trim()) {
            error('DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS 파라미터가 비어 있습니다.')
          }
          if (!params.DEPLOY_HEALTHCHECK_INTERVAL_SECONDS?.trim()) {
            error('DEPLOY_HEALTHCHECK_INTERVAL_SECONDS 파라미터가 비어 있습니다.')
          }
          if (!env.DEPLOY_COMPOSE_PROJECT_RESOLVED?.trim()) {
            error('DEPLOY_COMPOSE_PROJECT_RESOLVED 값이 비어 있습니다.')
          }
          if (!env.DEPLOY_COMPOSE_FILE_RESOLVED?.trim()) {
            error('DEPLOY_COMPOSE_FILE_RESOLVED 값이 비어 있습니다.')
          }
          if (!env.DEPLOY_HEALTHCHECK_URL_RESOLVED?.trim()) {
            error('DEPLOY_HEALTHCHECK_URL_RESOLVED 값이 비어 있습니다.')
          }

          def healthTimeoutSeconds = params.DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS.toInteger()
          def healthIntervalSeconds = params.DEPLOY_HEALTHCHECK_INTERVAL_SECONDS.toInteger()
          def nginxClientMaxBodySize = (params.NGINX_CLIENT_MAX_BODY_SIZE ?: '20m').trim()
          if (!nginxClientMaxBodySize) {
            error('NGINX_CLIENT_MAX_BODY_SIZE는 비워둘 수 없습니다.')
          }
          if (healthTimeoutSeconds < 1) {
            error('DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS는 1 이상이어야 합니다.')
          }
          if (healthIntervalSeconds < 1) {
            error('DEPLOY_HEALTHCHECK_INTERVAL_SECONDS는 1 이상이어야 합니다.')
          }
          def healthRetryCount = Math.max(1, (healthTimeoutSeconds / healthIntervalSeconds) as int)
          def vhostAppPort = env.DEPLOY_TARGET_ENV == 'prod' ? '18080' : '18081'

          if (!params.DEPLOY_SSH_USER?.trim()) {
            error('DEPLOY_SSH_USER 파라미터가 비어 있습니다.')
          }
          if (!params.DEPLOY_SSH_CREDENTIALS_ID?.trim()) {
            error('DEPLOY_SSH_CREDENTIALS_ID 파라미터가 비어 있습니다.')
          }
          if (!params.DEPLOY_ENV_FILE_CREDENTIALS_ID?.trim()) {
            error('DEPLOY_ENV_FILE_CREDENTIALS_ID 파라미터가 비어 있습니다.')
          }
          if (env.DEPLOY_TARGET_ENV == 'prod' && !params.PROD_SMTP_ENV_FILE_CREDENTIALS_ID?.trim()) {
            error('PROD_SMTP_ENV_FILE_CREDENTIALS_ID 파라미터가 비어 있습니다.')
          }
          def remote = "${params.DEPLOY_SSH_USER}@${params.DEPLOY_HOST}"
          def bundle = "deploy-${env.APP_VERSION}-${env.BUILD_NUMBER}.tgz"
          def prodSmtpCredentialOwner = (params.PROD_SMTP_CREDENTIAL_OWNER?.trim() ?: "Jenkins credential ${params.PROD_SMTP_ENV_FILE_CREDENTIALS_ID} owner")
          def credentialBindings = [
            file(credentialsId: params.DEPLOY_ENV_FILE_CREDENTIALS_ID, variable: 'DEPLOY_ENV_FILE'),
            sshUserPrivateKey(
              credentialsId: params.DEPLOY_SSH_CREDENTIALS_ID,
              keyFileVariable: 'DEPLOY_SSH_KEY',
              usernameVariable: 'DEPLOY_SSH_USER_FROM_CRED'
            )
          ]
          if (env.DEPLOY_TARGET_ENV == 'prod') {
            credentialBindings.add(file(credentialsId: params.PROD_SMTP_ENV_FILE_CREDENTIALS_ID, variable: 'PROD_SMTP_ENV_FILE'))
          }

          withCredentials(credentialBindings) {
            withEnv([
              "DEPLOY_HOST=${params.DEPLOY_HOST}",
              "DEPLOY_REMOTE=${remote}",
              "BUNDLE=${bundle}",
              "REMOTE_DEPLOY_PATH=${params.DEPLOY_PATH}",
              "COMPOSE_FILE=${env.DEPLOY_COMPOSE_FILE_RESOLVED}",
              "COMPOSE_PROJECT=${env.DEPLOY_COMPOSE_PROJECT_RESOLVED}",
              "DOMAIN=${env.DEPLOY_DOMAIN_FOR_BRANCH}",
              "HEALTHCHECK_URL=${env.DEPLOY_HEALTHCHECK_URL_RESOLVED}",
              "ENV_FILE_PATH=${env.DEPLOY_ENV_FILE_NAME}",
              "APP_VERSION=${env.APP_VERSION}",
              "NGINX_CLIENT_MAX_BODY_SIZE=${nginxClientMaxBodySize}",
              "PUBLIC_BASE_URL=${env.POST_DEPLOY_E2E_URL_RESOLVED}",
              "DEPLOY_SSH_OPTS=${params.DEPLOY_SSH_OPTS}",
              "HEALTH_RETRY_MAX=${healthRetryCount}",
              "HEALTH_RETRY_INTERVAL=${healthIntervalSeconds}",
              "DEPLOY_TMP_KEY_DIR=${env.WORKSPACE ?: '/tmp'}/.jenkins-deploy-key",
              "VHOST_APP_PORT=${vhostAppPort}",
              "PROD_SMTP_ENV_FILE_CREDENTIALS_ID=${params.PROD_SMTP_ENV_FILE_CREDENTIALS_ID ?: ''}",
              "PROD_SMTP_CREDENTIAL_OWNER=${prodSmtpCredentialOwner}",
              "SSH_RETRY_MAX=3",
              "SSH_RETRY_DELAY_SECONDS=2"
            ]) {
              sh '''#!/usr/bin/env bash
set -euo pipefail

if [ -z "${DEPLOY_SSH_KEY:-}" ]; then
  echo "[deploy] DEPLOY_SSH_KEY is empty. credential binding failed."
  exit 10
fi
if [ ! -r "$DEPLOY_SSH_KEY" ]; then
  echo "[deploy] DEPLOY_SSH_KEY file is not readable: $DEPLOY_SSH_KEY"
  exit 11
fi
if [ -f "${DEPLOY_TMP_KEY_DIR}/id_rsa" ]; then
  rm -f "${DEPLOY_TMP_KEY_DIR}/id_rsa"
fi
mkdir -p "$DEPLOY_TMP_KEY_DIR"
cp "$DEPLOY_SSH_KEY" "$DEPLOY_TMP_KEY_DIR/id_rsa"
chmod 600 "$DEPLOY_TMP_KEY_DIR/id_rsa"

echo "[deploy] key file prepared: $(ls -l \"$DEPLOY_TMP_KEY_DIR/id_rsa\")"

if [ ! -f "$DEPLOY_TMP_KEY_DIR/id_rsa" ]; then
  echo "[deploy] copied key file not found: $DEPLOY_TMP_KEY_DIR/id_rsa"
  exit 12
fi

REMOTE="${DEPLOY_REMOTE}"
BUNDLE_NAME="${BUNDLE}"
REMOTE_DEPLOY_PATH="${REMOTE_DEPLOY_PATH}"
COMPOSE_FILE="${COMPOSE_FILE}"
COMPOSE_PROJECT="${COMPOSE_PROJECT}"
DOMAIN="${DOMAIN}"
HEALTHCHECK_URL="${HEALTHCHECK_URL}"
SSH_OPTS="${DEPLOY_SSH_OPTS} -i ${DEPLOY_TMP_KEY_DIR}/id_rsa -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no"
HEALTH_RETRY_MAX="${HEALTH_RETRY_MAX}"
HEALTH_RETRY_INTERVAL="${HEALTH_RETRY_INTERVAL}"
ENV_FILE_PATH="${ENV_FILE_PATH}"
APP_VERSION="${APP_VERSION}"
SSH_RETRY_MAX="${SSH_RETRY_MAX}"
SSH_RETRY_DELAY_SECONDS="${SSH_RETRY_DELAY_SECONDS}"
VHOST_APP_PORT="${VHOST_APP_PORT:-18080}"
NGINX_CLIENT_MAX_BODY_SIZE="${NGINX_CLIENT_MAX_BODY_SIZE}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL}"
export APP_VERSION

fail_validation() {
  local name="$1"
  local value="$2"

  echo "[deploy] invalid ${name}: ${value}" >&2
  exit 20
}

validate_domain() {
  local value="$1"

  if [[ ! "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$ ]]; then
    fail_validation "DOMAIN" "$value"
  fi
  case "$value" in
    moneyflow.enmsoftware.com|dev.moneyflow.enmsoftware.com) ;;
    *) fail_validation "DOMAIN" "$value" ;;
  esac
}

validate_port() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    fail_validation "$name" "$value"
  fi
}

validate_token() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
    fail_validation "$name" "$value"
  fi
}

validate_deploy_path() {
  local value="$1"

  if [[ ! "$value" =~ ^/home/[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+$ ]] || [[ "$value" == *".."* ]]; then
    fail_validation "REMOTE_DEPLOY_PATH" "$value"
  fi
}

validate_file_name() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$value" == *".."* ]]; then
    fail_validation "$name" "$value"
  fi
}

validate_size() {
  local value="$1"

  if [[ ! "$value" =~ ^[1-9][0-9]*[kKmMgG]?$ ]]; then
    fail_validation "NGINX_CLIENT_MAX_BODY_SIZE" "$value"
  fi
}

validate_healthcheck_url() {
  local value="$1"

  if [[ ! "$value" =~ ^http://127[.]0[.]0[.]1:[0-9]{1,5}/healthz$ ]]; then
    fail_validation "HEALTHCHECK_URL" "$value"
  fi
}

validate_public_base_url() {
  local value="$1"

  if [[ ! "$value" =~ ^https://(dev[.])?moneyflow[.]enmsoftware[.]com/?$ ]]; then
    fail_validation "PUBLIC_BASE_URL" "$value"
  fi
}

validate_remote() {
  local value="$1"

  if [[ ! "$value" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$ ]]; then
    fail_validation "DEPLOY_REMOTE" "$value"
  fi
}

case "$COMPOSE_FILE" in
  docker-compose.deploy.yml|docker-compose.dev.deploy.yml) ;;
  *) fail_validation "COMPOSE_FILE" "$COMPOSE_FILE" ;;
esac
case "$ENV_FILE_PATH" in
  .env|.env.dev) ;;
  *) fail_validation "ENV_FILE_PATH" "$ENV_FILE_PATH" ;;
esac
case "$COMPOSE_PROJECT" in
  money-flow-service|money-flow-service-dev) ;;
  *) validate_token "COMPOSE_PROJECT" "$COMPOSE_PROJECT" ;;
esac
validate_domain "$DOMAIN"
validate_port "VHOST_APP_PORT" "$VHOST_APP_PORT"
validate_port "HEALTH_RETRY_MAX" "$HEALTH_RETRY_MAX"
validate_port "HEALTH_RETRY_INTERVAL" "$HEALTH_RETRY_INTERVAL"
validate_port "SSH_RETRY_MAX" "$SSH_RETRY_MAX"
validate_port "SSH_RETRY_DELAY_SECONDS" "$SSH_RETRY_DELAY_SECONDS"
validate_deploy_path "$REMOTE_DEPLOY_PATH"
validate_file_name "BUNDLE_NAME" "$BUNDLE_NAME"
validate_file_name "APP_VERSION" "$APP_VERSION"
validate_size "$NGINX_CLIENT_MAX_BODY_SIZE"
validate_healthcheck_url "$HEALTHCHECK_URL"
validate_public_base_url "$PUBLIC_BASE_URL"
validate_remote "$REMOTE"
INCOMING_ENV_FILE_PATH="${ENV_FILE_PATH}.incoming.${APP_VERSION}.${BUILD_NUMBER:-manual}"
INCOMING_PROD_SMTP_ENV_FILE_PATH="${ENV_FILE_PATH}.prod-smtp.${APP_VERSION}.${BUILD_NUMBER:-manual}"
validate_file_name "INCOMING_ENV_FILE_PATH" "$INCOMING_ENV_FILE_PATH"
validate_file_name "INCOMING_PROD_SMTP_ENV_FILE_PATH" "$INCOMING_PROD_SMTP_ENV_FILE_PATH"

trap 'rm -rf "$DEPLOY_TMP_KEY_DIR"' EXIT

run_ssh() {
  local command_name="$1"
  local command="$2"
  local attempt=1

  while true; do
    if ssh $SSH_OPTS "$REMOTE" "$command"; then
      return 0
    fi

    if [ "$attempt" -ge "$SSH_RETRY_MAX" ]; then
      echo "[deploy] ssh command failed (${command_name}) after ${SSH_RETRY_MAX} attempts"
      return 1
    fi

    echo "[deploy] retry ${attempt}/${SSH_RETRY_MAX} for ${command_name}"
    attempt=$((attempt + 1))
    sleep "${SSH_RETRY_DELAY_SECONDS}"
  done
}

run_scp() {
  local command_name="$1"
  local source="$2"
  local destination="$3"
  local attempt=1

  while true; do
    if scp $SSH_OPTS "$source" "$destination"; then
      return 0
    fi

    if [ "$attempt" -ge "$SSH_RETRY_MAX" ]; then
      echo "[deploy] scp failed (${command_name}) after ${SSH_RETRY_MAX} attempts"
      return 1
    fi

    echo "[deploy] retry ${attempt}/${SSH_RETRY_MAX} for ${command_name}"
    attempt=$((attempt + 1))
    sleep "${SSH_RETRY_DELAY_SECONDS}"
  done
}

echo "[deploy] preflight to $REMOTE"
run_ssh "preflight" "set -e; hostnamectl || true; whoami; id; df -h; free -h; docker --version; docker compose version; ss -lntp | head -n 10"
run_ssh "ensure-remote-dir" "set -e; mkdir -p '$REMOTE_DEPLOY_PATH'"

        if command -v git >/dev/null 2>&1; then
          git archive --format=tgz -o "$BUNDLE_NAME" HEAD
        else
          tar \
            --warning=no-file-changed \
            --exclude='.git' \
            --exclude='.venv' \
            --exclude='node_modules' \
            --exclude='frontend/node_modules' \
            --exclude='playwright-report' \
            --exclude='test-results' \
            --exclude='.runtime' \
            -czf "$BUNDLE_NAME" .
        fi
run_scp "upload-bundle" "$BUNDLE_NAME" "$REMOTE:$REMOTE_DEPLOY_PATH/$BUNDLE_NAME"
if [ -s "$DEPLOY_ENV_FILE" ] && [ "$(head -c 1 "$DEPLOY_ENV_FILE")" != "<" ]; then
  run_ssh "prepare-env-upload" "set -e; cd '$REMOTE_DEPLOY_PATH'; rm -f '$INCOMING_ENV_FILE_PATH' '$INCOMING_PROD_SMTP_ENV_FILE_PATH'"
  run_scp "upload-env-file" "$DEPLOY_ENV_FILE" "$REMOTE:$REMOTE_DEPLOY_PATH/$INCOMING_ENV_FILE_PATH"
else
  if [ "$ENV_FILE_PATH" = ".env" ]; then
    echo "[deploy] prod base env credential file is invalid or empty"
    exit 21
  fi
  echo "[deploy] skipped copying env file (invalid or empty credential file)"
fi
if [ "$ENV_FILE_PATH" = ".env" ]; then
  if [ -z "${PROD_SMTP_ENV_FILE:-}" ] || [ ! -s "$PROD_SMTP_ENV_FILE" ] || [ "$(head -c 1 "$PROD_SMTP_ENV_FILE")" = "<" ]; then
    echo "[deploy] dedicated prod SMTP credential file is missing or invalid: ${PROD_SMTP_ENV_FILE_CREDENTIALS_ID}"
    exit 22
  fi
  run_scp "upload-prod-smtp-env-file" "$PROD_SMTP_ENV_FILE" "$REMOTE:$REMOTE_DEPLOY_PATH/$INCOMING_PROD_SMTP_ENV_FILE_PATH"
fi
rm -f "$BUNDLE_NAME"

remote_script_name=".jenkins-remote-deploy-${APP_VERSION}-${BUILD_NUMBER:-manual}.sh"
validate_file_name "REMOTE_SCRIPT_NAME" "$remote_script_name"
remote_deploy_script="$(mktemp)"
cat >"$remote_deploy_script" <<'REMOTE_DEPLOY'
#!/usr/bin/env bash
set -euo pipefail

cd "$REMOTE_DEPLOY_PATH"
if [ -f "$ENV_FILE_PATH" ]; then cp "$ENV_FILE_PATH" "$ENV_FILE_PATH.previous"; fi
if [ -f "$BUNDLE_NAME" ]; then tar -xzf "$BUNDLE_NAME"; fi
rm -f "$BUNDLE_NAME"

validate_env_has_assignments() {
  local env_path="$1"

  if [ ! -f "$env_path" ] || ! grep -qEq '^[A-Za-z_][A-Za-z0-9_]*=' "$env_path"; then
    echo "[deploy] invalid env file detected: ${env_path}"
    return 1
  fi
}

validate_env_required_keys() {
  local env_path="$1"
  shift
  local missing_keys=''
  local key=''
  local current_value=''

  for key in "$@"; do
    current_value="$(grep -E "^${key}=" "$env_path" | tail -n 1 | cut -d= -f2- || true)"
    if [ -z "$current_value" ]; then
      missing_keys="${missing_keys} ${key}"
    fi
  done
  if [ -n "$missing_keys" ]; then
    echo "[deploy] missing required env keys:${missing_keys}"
    return 1
  fi
}

if [ "$ENV_FILE_PATH" = '.env' ]; then
  if [ -z "${INCOMING_ENV_FILE_PATH:-}" ] || [ ! -f "$INCOMING_ENV_FILE_PATH" ]; then
    echo '[deploy] missing uploaded prod base env file from Jenkins credential'
    exit 1
  fi
  if [ -z "${INCOMING_PROD_SMTP_ENV_FILE_PATH:-}" ] || [ ! -f "$INCOMING_PROD_SMTP_ENV_FILE_PATH" ]; then
    echo '[deploy] missing uploaded dedicated prod SMTP env file from Jenkins credential'
    exit 1
  fi
  validated_env_path="$INCOMING_ENV_FILE_PATH"
  chmod u+w "$validated_env_path"
  validate_env_has_assignments "$validated_env_path"
  validate_env_has_assignments "$INCOMING_PROD_SMTP_ENV_FILE_PATH"
  python3 "$REMOTE_DEPLOY_PATH/scripts/deploy/validate_smtp_route.py" \
    "$validated_env_path" \
    --smtp-env-file "$INCOMING_PROD_SMTP_ENV_FILE_PATH" \
    --env prod \
    --source jenkins-prod-smtp-secret \
    --source-owner "${PROD_SMTP_CREDENTIAL_OWNER:-Jenkins credential owner}" \
    --write-normalized
  mv "$validated_env_path" "$ENV_FILE_PATH"
  rm -f "$INCOMING_PROD_SMTP_ENV_FILE_PATH"
elif [ -n "${INCOMING_ENV_FILE_PATH:-}" ] && [ -f "$INCOMING_ENV_FILE_PATH" ]; then
  validated_env_path="$INCOMING_ENV_FILE_PATH"
  chmod u+w "$validated_env_path"
  validate_env_has_assignments "$validated_env_path"
  mv "$validated_env_path" "$ENV_FILE_PATH"
fi
if [ ! -f "$ENV_FILE_PATH" ] && [ "$ENV_FILE_PATH" != '.env' ] && [ -f "$ENV_FILE_PATH.previous" ]; then
  cp "$ENV_FILE_PATH.previous" "$ENV_FILE_PATH"
fi
if [ -f "$ENV_FILE_PATH" ] && ! validate_env_has_assignments "$ENV_FILE_PATH" && [ "$ENV_FILE_PATH" != '.env' ] && [ -f "$ENV_FILE_PATH.previous" ]; then
  echo '[deploy] invalid env file detected; restoring previous env file'
  cp "$ENV_FILE_PATH.previous" "$ENV_FILE_PATH"
fi
if [ ! -f "$REMOTE_DEPLOY_PATH/scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh" ]; then
  echo '[deploy] reverse-proxy script not found after bundle extraction.'
  exit 1
fi
if ! sudo -n /usr/bin/env NGINX_CLIENT_MAX_BODY_SIZE="$NGINX_CLIENT_MAX_BODY_SIZE" /usr/bin/bash "$REMOTE_DEPLOY_PATH/scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh" "$DOMAIN" "$VHOST_APP_PORT"; then
  echo '[deploy] vhost sync failed. sudo 권한 또는 nginx 설정 경로를 확인해 주세요.'
  exit 1
fi
echo '[deploy] vhost sync complete'
if [ -r "/etc/nginx/sites-enabled/${DOMAIN}.conf" ]; then
  if ! grep -q 'client_max_body_size' "/etc/nginx/sites-enabled/${DOMAIN}.conf"; then
    echo "[deploy] ${DOMAIN}: client_max_body_size is missing in /etc/nginx/sites-enabled/${DOMAIN}.conf"
    exit 1
  fi
  echo "[deploy] ${DOMAIN}: client_max_body_size is configured in /etc/nginx/sites-enabled/${DOMAIN}.conf."
elif [ -r "/etc/nginx/sites-available/${DOMAIN}.conf" ]; then
  if ! grep -q 'client_max_body_size' "/etc/nginx/sites-available/${DOMAIN}.conf"; then
    echo "[deploy] ${DOMAIN}: client_max_body_size is missing in /etc/nginx/sites-available/${DOMAIN}.conf"
    exit 1
  fi
  echo "[deploy] ${DOMAIN}: client_max_body_size is configured in /etc/nginx/sites-available/${DOMAIN}.conf."
else
  echo "[deploy] ${DOMAIN}: nginx site config file is not readable."
  exit 1
fi
if [ "$ENV_FILE_PATH" = '.env.dev' ]; then
  if [ -f "$ENV_FILE_PATH" ]; then
    grep -v -E '^(ENV|POSTGRES_DB|CORS_ORIGINS|FRONTEND_BASE_URL|DATABASE_URL|AUTH_DEBUG_RETURN_VERIFY_TOKEN|AUTH_EMAIL_VERIFICATION_REQUIRED)=' "$ENV_FILE_PATH" > "$ENV_FILE_PATH.tmp" || true
    mv "$ENV_FILE_PATH.tmp" "$ENV_FILE_PATH"
  fi
  printf '\nENV=dev\nPOSTGRES_DB=moneyflow_dev\nCORS_ORIGINS=https://dev.moneyflow.enmsoftware.com\nFRONTEND_BASE_URL=https://dev.moneyflow.enmsoftware.com\nDATABASE_URL=\nAUTH_DEBUG_RETURN_VERIFY_TOKEN=false\nAUTH_EMAIL_VERIFICATION_REQUIRED=true\n' >> "$ENV_FILE_PATH"

  # Jenkins dev env credentials may predate strict SMTP enforcement.
  # Keep deployment fail-closed while preserving server-local SMTP relay settings.
  smtp_fallback_file=''
  for candidate in '.env.dev.smtp' '.env'; do
    if [ -f "$candidate" ]; then
      smtp_fallback_file="$candidate"
      break
    fi
  done
  if [ -n "$smtp_fallback_file" ]; then
    # Server-local SMTP settings must win over Jenkins' legacy dev env file.
    # The Jenkins secret file can predate strict SMTP enforcement and may contain
    # stale values such as SMTP_STARTTLS=false; leaving those in place causes
    # fail-closed config validation to reject dev deploys.
    grep -v -E '^(SMTP_HOST|SMTP_PORT|SMTP_SSL|SMTP_STARTTLS|SMTP_USER|SMTP_PASS|SMTP_FROM_EMAIL|SMTP_FROM_NAME|SMTP_ACCOUNT_LABEL)=' "$ENV_FILE_PATH" > "$ENV_FILE_PATH.tmp" || true
    mv "$ENV_FILE_PATH.tmp" "$ENV_FILE_PATH"
    for key in SMTP_HOST SMTP_PORT SMTP_SSL SMTP_STARTTLS SMTP_USER SMTP_PASS SMTP_FROM_EMAIL SMTP_FROM_NAME SMTP_ACCOUNT_LABEL; do
      fallback_line="$(grep -E "^${key}=" "$smtp_fallback_file" | tail -n 1 || true)"
      if [ -n "$fallback_line" ]; then
        printf '%s\n' "$fallback_line" >> "$ENV_FILE_PATH"
      fi
    done
  fi
  grep -v '^EMAIL_DELIVERY_MODE=' "$ENV_FILE_PATH" > "$ENV_FILE_PATH.tmp" || true
  mv "$ENV_FILE_PATH.tmp" "$ENV_FILE_PATH"

  missing_smtp=''
  for key in SMTP_HOST SMTP_PORT SMTP_SSL SMTP_STARTTLS SMTP_FROM_EMAIL SMTP_ACCOUNT_LABEL; do
    current_value="$(grep -E "^${key}=" "$ENV_FILE_PATH" | tail -n 1 | cut -d= -f2- || true)"
    if [ -z "$current_value" ]; then
      missing_smtp="${missing_smtp} ${key}"
    fi
  done
  if [ -n "$missing_smtp" ]; then
    echo "[deploy] missing dev SMTP env:${missing_smtp}"
    exit 1
  fi
else
  if [ ! -f "$ENV_FILE_PATH" ]; then
    echo "[deploy] ${ENV_FILE_PATH} is missing."
    exit 1
  fi
  validate_env_required_keys "$ENV_FILE_PATH" POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL SECRET_KEY SMTP_HOST SMTP_PORT SMTP_SSL SMTP_STARTTLS SMTP_USER SMTP_PASS SMTP_FROM_EMAIL SMTP_ACCOUNT_LABEL
fi
if [ -f "$ENV_FILE_PATH" ]; then
  grep -v '^APP_VERSION=' "$ENV_FILE_PATH" > "$ENV_FILE_PATH.tmp" || true
  mv "$ENV_FILE_PATH.tmp" "$ENV_FILE_PATH"
fi
printf '\nAPP_VERSION=%s\n' "$APP_VERSION" >> "$ENV_FILE_PATH"
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" down --remove-orphans || true
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" build --no-cache
echo '[deploy] starting postgres for schema upgrade'
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" up -d postgres
postgres_health=''
attempt=1
while [ "$attempt" -le "$HEALTH_RETRY_MAX" ]; do
  postgres_container="$(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" ps -q postgres)"
  if [ -n "$postgres_container" ]; then
    postgres_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$postgres_container" 2>/dev/null || true)"
  else
    postgres_health='missing'
  fi
  if [ "$postgres_health" = 'healthy' ]; then
    break
  fi
  if [ "$attempt" -ge "$HEALTH_RETRY_MAX" ]; then
    echo "[deploy] postgres did not become healthy: $postgres_health"
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" logs --tail=100 postgres
    exit 1
  fi
  echo "[deploy] waiting for postgres health ($attempt/$HEALTH_RETRY_MAX): $postgres_health"
  attempt=$((attempt + 1))
  sleep "$HEALTH_RETRY_INTERVAL"
done
postgres_container="$(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" ps -q postgres)"
if [ -z "$postgres_container" ]; then
  echo '[deploy] postgres container is missing before schema upgrade'
  exit 1
fi
docker exec "$postgres_container" sh -lc 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -v db_user="$POSTGRES_USER" -v db_password="$POSTGRES_PASSWORD" <<'"'"'SQL'"'"'
ALTER USER :"db_user" WITH PASSWORD :'"'"'db_password'"'"';
SQL'
echo '[deploy] postgres password synchronized with env'
docker exec "$postgres_container" sh -lc 'case "$POSTGRES_DB" in ""|*[!A-Za-z0-9_]*) echo "invalid POSTGRES_DB: $POSTGRES_DB" >&2; exit 1;; esac; if ! psql -U "$POSTGRES_USER" -d postgres -Atc "SELECT datname FROM pg_database" | grep -Fxq "$POSTGRES_DB"; then createdb -U "$POSTGRES_USER" "$POSTGRES_DB"; fi'
echo '[deploy] postgres database presence verified'
echo '[deploy] ensuring schema exists before schema upgrade'
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" run --rm app env PYTHONPATH=backend python -c "from app.db.init_db import create_schema; create_schema()"
echo '[deploy] running schema upgrade before app exposure'
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" run --rm app env PYTHONPATH=backend python -m app.db.schema_upgrade
echo '[deploy] SCHEMA_UPGRADE_OK'
echo '[deploy] starting app after schema upgrade'
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" up -d app
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" ps
assert_frontend_asset_version() {
  local base_url="$1"
  local expected_app_version="$2"
  local host_header="${3:-}"
  local expected_frontend_version="${expected_app_version#v}"
  local root_html=''
  local asset_path=''
  local asset_url=''
  local asset_body=''
  local asset_attempt=1

  if [ -n "$host_header" ]; then
    root_html="$(curl -fsS -H "Host: $host_header" "${base_url%/}/")"
  else
    root_html="$(curl -fsS "${base_url%/}/")"
  fi
  asset_path="$(printf '%s' "$root_html" | grep -oE '/assets/[^"]+[.]js' | sed -n '1p' || true)"
  if [ -z "$asset_path" ]; then
    echo "[deploy] frontend asset path not found at ${base_url%/}/"
    exit 1
  fi
  case "$asset_path" in
    http://*|https://*) asset_url="$asset_path" ;;
    /*) asset_url="${base_url%/}${asset_path}" ;;
    *) asset_url="${base_url%/}/${asset_path}" ;;
  esac
  while [ "$asset_attempt" -le "$HEALTH_RETRY_MAX" ]; do
    if [ -n "$host_header" ]; then
      asset_body="$(curl -fsS -H "Host: $host_header" "$asset_url")"
    else
      asset_body="$(curl -fsS "$asset_url")"
    fi
    if grep -Fq "$expected_frontend_version" <<<"$asset_body"; then
      echo "[deploy] frontend asset version matched: ${expected_frontend_version} (${asset_url})"
      return 0
    fi
    echo "[deploy] waiting for frontend asset version (${asset_attempt}/${HEALTH_RETRY_MAX}): expected ${expected_frontend_version} at ${asset_url}"
    asset_attempt=$((asset_attempt + 1))
    sleep "$HEALTH_RETRY_INTERVAL"
  done
  echo "[deploy] frontend asset version mismatch: expected ${expected_frontend_version} at ${asset_url}"
  exit 1
}
if ! curl --fail --retry-all-errors --retry "$HEALTH_RETRY_MAX" --retry-delay "$HEALTH_RETRY_INTERVAL" -H "Host: $DOMAIN" "$HEALTHCHECK_URL"; then
  echo '[deploy] health check failed after retries'
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE_PATH" logs --tail=200
  exit 1
fi
echo '[deploy] health check success'
server_base_url="${HEALTHCHECK_URL%/healthz}"
assert_frontend_asset_version "$server_base_url" "$APP_VERSION" "$DOMAIN"
REMOTE_DEPLOY

run_scp "upload-remote-deploy-script" "$remote_deploy_script" "$REMOTE:$REMOTE_DEPLOY_PATH/$remote_script_name"
rm -f "$remote_deploy_script"
run_ssh "remote-deploy" "set -euo pipefail; cd '$REMOTE_DEPLOY_PATH'; chmod 700 '$remote_script_name'; if REMOTE_DEPLOY_PATH='$REMOTE_DEPLOY_PATH' ENV_FILE_PATH='$ENV_FILE_PATH' INCOMING_ENV_FILE_PATH='$INCOMING_ENV_FILE_PATH' INCOMING_PROD_SMTP_ENV_FILE_PATH='$INCOMING_PROD_SMTP_ENV_FILE_PATH' PROD_SMTP_CREDENTIAL_OWNER='$PROD_SMTP_CREDENTIAL_OWNER' BUNDLE_NAME='$BUNDLE_NAME' NGINX_CLIENT_MAX_BODY_SIZE='$NGINX_CLIENT_MAX_BODY_SIZE' DOMAIN='$DOMAIN' VHOST_APP_PORT='$VHOST_APP_PORT' APP_VERSION='$APP_VERSION' COMPOSE_PROJECT='$COMPOSE_PROJECT' COMPOSE_FILE='$COMPOSE_FILE' HEALTH_RETRY_MAX='$HEALTH_RETRY_MAX' HEALTH_RETRY_INTERVAL='$HEALTH_RETRY_INTERVAL' HEALTHCHECK_URL='$HEALTHCHECK_URL' /usr/bin/env bash '$remote_script_name'; then rm -f '$remote_script_name'; else exit 1; fi"

assert_frontend_asset_version() {
  local base_url="$1"
  local expected_app_version="$2"
  local expected_frontend_version="${expected_app_version#v}"
  local root_html=''
  local asset_path=''
  local asset_url=''
  local asset_body=''
  local asset_attempt=1

  root_html="$(curl -fsS "${base_url%/}/")"
  asset_path="$(printf '%s' "$root_html" | grep -oE '/assets/[^"]+[.]js' | sed -n '1p' || true)"
  if [ -z "$asset_path" ]; then
    echo "[deploy] frontend asset path not found at ${base_url%/}/"
    exit 1
  fi
  case "$asset_path" in
    http://*|https://*) asset_url="$asset_path" ;;
    /*) asset_url="${base_url%/}${asset_path}" ;;
    *) asset_url="${base_url%/}/${asset_path}" ;;
  esac
  while [ "$asset_attempt" -le "$HEALTH_RETRY_MAX" ]; do
    asset_body="$(curl -fsS "$asset_url")"
    if grep -Fq "$expected_frontend_version" <<<"$asset_body"; then
      echo "[deploy] public frontend asset version matched: ${expected_frontend_version} (${asset_url})"
      return 0
    fi
    echo "[deploy] waiting for frontend asset version (${asset_attempt}/${HEALTH_RETRY_MAX}): expected ${expected_frontend_version} at ${asset_url}"
    asset_attempt=$((asset_attempt + 1))
    sleep "$HEALTH_RETRY_INTERVAL"
  done
  echo "[deploy] frontend asset version mismatch: expected ${expected_frontend_version} at ${asset_url}"
  exit 1
}
assert_frontend_asset_version "$PUBLIC_BASE_URL" "$APP_VERSION"

tmp_probe_file="$(mktemp)"
tmp_probe_body="$(mktemp)"
cleanup_probe() {
  rm -f "$tmp_probe_file" "$tmp_probe_body"
}
trap 'cleanup_probe; rm -rf "$DEPLOY_TMP_KEY_DIR"' EXIT
dd if=/dev/zero of="$tmp_probe_file" bs=1M count=2 >/dev/null 2>&1
probe_url="${PUBLIC_BASE_URL%/}/api/v1/imports/workbook/upload?mode=dry_run"
probe_status="$(curl -sS -o "$tmp_probe_body" -w '%{http_code}' -X POST -F "file=@${tmp_probe_file};filename=upload-probe.xlsx;type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" "$probe_url" || true)"
case "$probe_status" in
  400|401|403)
    echo "[deploy] upload-limit probe passed with HTTP $probe_status"
    ;;
  413)
    echo "[deploy] upload-limit probe failed: public domain rejected multipart body with HTTP 413"
    sed -n '1,20p' "$tmp_probe_body" || true
    exit 1
    ;;
  *)
    echo "[deploy] upload-limit probe returned unexpected HTTP $probe_status"
    sed -n '1,40p' "$tmp_probe_body" || true
    exit 1
    ;;
esac
              '''
            }
          }
        }
      }
    }

    stage('Post-Deploy E2E Smoke') {
      when {
        allOf {
          expression { return params.RUN_DEPLOY }
          expression { return !params.DEPLOY_DRY_RUN }
          expression { return params.RUN_POST_DEPLOY_E2E }
          expression { return env.SKIP_POST_DEPLOY_E2E_FOR_BRANCH?.trim() != 'true' }
        }
      }
      steps {
        script {
          def deployBranch = (env.BRANCH_NAME ?: env.GIT_BRANCH ?: env.GIT_LOCAL_BRANCH ?: env.CHANGE_BRANCH ?: env.JOB_BASE_NAME ?: 'manual').trim()
          if (deployBranch.startsWith('origin/')) {
            deployBranch = deployBranch.substring('origin/'.length())
          }
          if (deployBranch == 'refs/heads/main') {
            deployBranch = 'main'
          }
          def allowedBranches = params.DEPLOY_ALLOWED_BRANCHES.split(',').collect { it.trim() }.findAll { it }
          def canDeployBranch = deployBranch == 'manual' || allowedBranches.isEmpty() || allowedBranches.contains(deployBranch)
          if (!canDeployBranch) {
            echo "현재 브랜치(${deployBranch})는 배포 허용 브랜치 목록(${params.DEPLOY_ALLOWED_BRANCHES}) 밖이므로 Post-Deploy E2E를 건너뜁니다."
            return
          }
          if (!isUnix()) {
            error('Post-Deploy E2E 단계는 Unix Jenkins agent가 필요합니다.')
          }
          def targetUrl = (env.POST_DEPLOY_E2E_URL_RESOLVED ?: 'https://moneyflow.enmsoftware.com')
          if (!targetUrl) {
            error('POST_DEPLOY_E2E_URL_RESOLVED가 비어 있습니다.')
          }
          def apiBaseUrl = (params.POST_DEPLOY_E2E_API_BASE_URL?.trim() ?: targetUrl)
          if (!apiBaseUrl) {
            apiBaseUrl = targetUrl
          }
          def apiRequestOrigin = (params.POST_DEPLOY_E2E_API_REQUEST_ORIGIN?.trim() ?: targetUrl)
          if (!apiRequestOrigin) {
            apiRequestOrigin = targetUrl
          }
          def retryCount = params.POST_DEPLOY_E2E_RETRY_COUNT.toInteger()
          def retryInterval = params.POST_DEPLOY_E2E_RETRY_INTERVAL_SECONDS.toInteger()
          if (retryCount < 1) {
            error('POST_DEPLOY_E2E_RETRY_COUNT는 1 이상이어야 합니다.')
          }
          if (retryInterval < 1) {
            error('POST_DEPLOY_E2E_RETRY_INTERVAL_SECONDS는 1 이상이어야 합니다.')
          }

          withEnv([
            "TARGET_URL=${targetUrl}",
            "RETRY_COUNT=${retryCount}",
            "RETRY_INTERVAL=${retryInterval}",
            "E2E_BASE_URL=${targetUrl}",
            "E2E_API_BASE_URL=${apiBaseUrl}",
            "E2E_API_REQUEST_ORIGIN=${apiRequestOrigin}"
          ]) {
            sh '''
set -eu
attempt=1
while true; do
if curl -fsS "$TARGET_URL/healthz"; then
    echo "[deploy-e2e] $TARGET_URL health check OK"
    break
  fi

  if [ "$attempt" -ge "$RETRY_COUNT" ]; then
    echo "[deploy-e2e] health check failed after $RETRY_COUNT retries"
    exit 1
  fi

  echo "[deploy-e2e] health check retry $attempt/$RETRY_COUNT: $TARGET_URL"
  attempt=$((attempt + 1))
  sleep "$RETRY_INTERVAL"
done
            '''
            sh '''
set -eu
. ./scripts/ci/ensure-node.sh
if ! command -v npm >/dev/null 2>&1; then
  echo "[deploy-e2e] npm/npx runner is required for post-deploy smoke. Provision Node.js/npm on the Jenkins agent or run the Playwright smoke in a maintained container."
  exit 1
fi

if [ ! -x ./node_modules/.bin/playwright ]; then
  echo "[deploy-e2e] local Playwright runner missing; installing repository npm dependencies before smoke."
  npm install
fi

if [ ! -x ./node_modules/.bin/playwright ]; then
  echo "[deploy-e2e] Playwright runner was not created at ./node_modules/.bin/playwright."
  exit 1
fi

browser_path=$(find "$HOME/.cache/ms-playwright" -type f -path "*chrome-headless-shell" | head -n 1 || true)
if [ -z "$browser_path" ]; then
  echo "[deploy-e2e] Playwright Chromium binary missing; installing chromium before post-deploy smoke."
  npx playwright install chromium
  browser_path=$(find "$HOME/.cache/ms-playwright" -type f -path "*chrome-headless-shell" | head -n 1 || true)
fi
if [ -z "$browser_path" ]; then
  echo "[deploy-e2e] Playwright Chromium binary not found after install."
  exit 1
fi

missing_libs=$(ldd "$browser_path" 2>/dev/null | awk '/not found/ {print $1}' | tr '\n' ' ' | sed 's/[[:space:]]*$//')
if [ -n "$missing_libs" ]; then
  echo "[deploy-e2e] Playwright browser dependency missing: $missing_libs"
  echo "[deploy-e2e] Install OS browser dependencies on the Jenkins agent (for example: npx playwright install --with-deps chromium) and rerun."
  exit 1
fi

echo "[deploy-e2e] target=$E2E_BASE_URL api_base=$E2E_API_BASE_URL origin=$E2E_API_REQUEST_ORIGIN"
echo "[deploy-e2e] command: npx playwright test --grep 'auth deep-link token policy: query token rejected' e2e/specs/deeplink.spec.js --workers=1"
npx playwright test --grep "auth deep-link token policy: query token rejected" e2e/specs/deeplink.spec.js --workers=1
echo "[deploy-e2e] post-deploy Playwright smoke completed"
            '''
          }
        }
      }
    }
  }

  post {
    always {
      script {
        if (isUnix()) {
          sh '''
if command -v docker >/dev/null 2>&1; then
  docker compose -f docker-compose.mail-local.yml down || true
else
  echo "[skip] docker is not available; skipping local mail compose cleanup."
fi
'''
        } else {
          bat 'docker compose -f docker-compose.mail-local.yml down || exit 0'
        }
      }
    }
  }
}
