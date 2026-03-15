pipeline {
  agent any

  options {
    disableConcurrentBuilds()
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

if ! command -v uv >/dev/null 2>&1; then
  if command -v python3 >/dev/null 2>&1; then
    python3 -m pip install --user uv
  else
    echo "[skip] python3 is not installed; skip uv bootstrap and dependency sync."
  fi
fi

export PATH="$HOME/.local/bin:$PATH"
if command -v uv >/dev/null 2>&1; then
  uv sync --extra dev
else
  echo "[skip] uv not available; skipping backend dependency sync."
fi

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
            withEnv([
              "TARGET_URL=${targetUrl}",
              "RETRY_COUNT=${retryCount}",
              "RETRY_INTERVAL=${retryInterval}",
              "E2E_BASE_URL=${targetUrl}",
              "E2E_API_BASE_URL=${apiBaseUrl}",
              "E2E_API_REQUEST_ORIGIN=${apiRequestOrigin}"
            ]) {
              sh '''
set -euo pipefail
attempt=1
while true; do
if curl -fsS "$TARGET_URL/healthz"; then
    echo "[pre-deploy-e2e] $TARGET_URL health check OK"
    break
  fi

  if [ "$attempt" -ge "$RETRY_COUNT" ]; then
    echo "[pre-deploy-e2e] health check failed after $RETRY_COUNT retries"
    exit 1
  fi

  echo "[pre-deploy-e2e] health check retry $attempt/$RETRY_COUNT: $TARGET_URL"
  attempt=$((attempt + 1))
  sleep "$RETRY_INTERVAL"
done
              '''
              sh 'npx playwright test --workers=1'
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
             "docker compose -p ${env.DEPLOY_COMPOSE_PROJECT_RESOLVED} -f ${env.DEPLOY_COMPOSE_FILE_RESOLVED} --env-file ${env.DEPLOY_ENV_FILE_NAME} up -d",
             "docker compose -p ${env.DEPLOY_COMPOSE_PROJECT_RESOLVED} -f ${env.DEPLOY_COMPOSE_FILE_RESOLVED} --env-file ${env.DEPLOY_ENV_FILE_NAME} exec -T app env PYTHONPATH=backend python -m app.db.schema_upgrade",
             "echo SCHEMA_UPGRADE_OK",
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
          def remote = "${params.DEPLOY_SSH_USER}@${params.DEPLOY_HOST}"
          def bundle = "deploy-${env.APP_VERSION}-${env.BUILD_NUMBER}.tgz"

          withCredentials([
            file(credentialsId: params.DEPLOY_ENV_FILE_CREDENTIALS_ID, variable: 'DEPLOY_ENV_FILE'),
            sshUserPrivateKey(
              credentialsId: params.DEPLOY_SSH_CREDENTIALS_ID,
              keyFileVariable: 'DEPLOY_SSH_KEY',
              usernameVariable: 'DEPLOY_SSH_USER_FROM_CRED'
            )
          ]) {
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
              "SSH_RETRY_MAX=3",
              "SSH_RETRY_DELAY_SECONDS=2"
            ]) {
              sh '''
#!/usr/bin/env bash
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
export APP_VERSION

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
run_ssh "apply-nginx-reverse-proxy" "set -e; \
  if [ ! -f '$REMOTE_DEPLOY_PATH/scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh' ]; then \
    echo '[deploy] reverse-proxy script not found.'; \
    exit 1; \
  fi; \
  if ! sudo -n /usr/bin/env NGINX_CLIENT_MAX_BODY_SIZE='$NGINX_CLIENT_MAX_BODY_SIZE' /usr/bin/bash '$REMOTE_DEPLOY_PATH/scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh' '$DOMAIN' '${VHOST_APP_PORT:-18080}'; then \
    echo '[deploy] vhost sync failed. sudo 권한 또는 nginx 설정 경로를 확인해 주세요.'; \
    exit 1; \
  fi; \
  echo '[deploy] vhost sync complete'"

run_ssh "check-nginx-client-max-body-size" "set -e; \
  if [ -r '/etc/nginx/sites-enabled/$DOMAIN.conf' ]; then \
    if ! grep -q 'client_max_body_size' '/etc/nginx/sites-enabled/$DOMAIN.conf'; then \
      echo '[deploy] $DOMAIN: client_max_body_size is missing in /etc/nginx/sites-enabled/$DOMAIN.conf'; \
      exit 1; \
    fi; \
    echo '[deploy] $DOMAIN: client_max_body_size is configured in /etc/nginx/sites-enabled/$DOMAIN.conf.'; \
  elif [ -r '/etc/nginx/sites-available/$DOMAIN.conf' ]; then \
    if ! grep -q 'client_max_body_size' '/etc/nginx/sites-available/$DOMAIN.conf'; then \
      echo '[deploy] $DOMAIN: client_max_body_size is missing in /etc/nginx/sites-available/$DOMAIN.conf'; \
      exit 1; \
    fi; \
    echo '[deploy] $DOMAIN: client_max_body_size is configured in /etc/nginx/sites-available/$DOMAIN.conf.'; \
  else \
    echo '[deploy] $DOMAIN: nginx site config file is not readable.'; \
    exit 1; \
  fi"

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
  run_scp "upload-env-file" "$DEPLOY_ENV_FILE" "$REMOTE:$REMOTE_DEPLOY_PATH/$ENV_FILE_PATH"
else
  echo "[deploy] skipped copying env file (invalid or empty credential file)"
fi
rm -f "$BUNDLE_NAME"

run_ssh "remote-deploy" "set -euo pipefail; \
  cd '$REMOTE_DEPLOY_PATH'; \
  if [ -f '$ENV_FILE_PATH' ]; then cp '$ENV_FILE_PATH' '$ENV_FILE_PATH.previous'; fi; \
  if [ -f '$BUNDLE_NAME' ]; then tar -xzf '$BUNDLE_NAME'; fi; \
  rm -f '$BUNDLE_NAME'; \
  if [ -f '$ENV_FILE_PATH' ] && ! grep -qEq '^[A-Za-z_][A-Za-z0-9_]*=' '$ENV_FILE_PATH' && [ -f '$ENV_FILE_PATH.previous' ]; then \
    echo '[deploy] invalid env file detected; restoring previous env file'; \
    cp '$ENV_FILE_PATH.previous' '$ENV_FILE_PATH'; \
  fi; \
  if [ \"$ENV_FILE_PATH\" = '.env.dev' ]; then \
    printf '\nENV=dev\nPOSTGRES_DB=moneyflow_dev\nCORS_ORIGINS=https://dev.moneyflow.enmsoftware.com\nFRONTEND_BASE_URL=https://dev.moneyflow.enmsoftware.com\nDATABASE_URL=\nAUTH_DEBUG_RETURN_VERIFY_TOKEN=true\n' >> '$ENV_FILE_PATH'; \
  fi; \
  if [ -f \"$ENV_FILE_PATH\" ] && grep -q '^APP_VERSION=' \"$ENV_FILE_PATH\"; then \
    grep -v '^APP_VERSION=' \"$ENV_FILE_PATH\" > \"$ENV_FILE_PATH.tmp\"; \
    mv \"$ENV_FILE_PATH.tmp\" \"$ENV_FILE_PATH\"; \
  fi; \
   printf '\nAPP_VERSION=%s\n' \"$APP_VERSION\" >> \"$ENV_FILE_PATH\"; \
   if [ ! -f '$ENV_FILE_PATH' ] && [ -f '$ENV_FILE_PATH.previous' ]; then \
     cp '$ENV_FILE_PATH.previous' '$ENV_FILE_PATH'; \
   fi; \
   docker compose -p '$COMPOSE_PROJECT' -f '$COMPOSE_FILE' --env-file '$ENV_FILE_PATH' down --remove-orphans || true; \
   docker compose -p '$COMPOSE_PROJECT' -f '$COMPOSE_FILE' --env-file '$ENV_FILE_PATH' build --no-cache; \
   docker compose -p '$COMPOSE_PROJECT' -f '$COMPOSE_FILE' --env-file '$ENV_FILE_PATH' up -d; \
   echo '[deploy] running schema upgrade'; \
   docker compose -p '$COMPOSE_PROJECT' -f '$COMPOSE_FILE' --env-file '$ENV_FILE_PATH' exec -T app env PYTHONPATH=backend python -m app.db.schema_upgrade; \
   echo '[deploy] SCHEMA_UPGRADE_OK'; \
   docker compose -p '$COMPOSE_PROJECT' -f '$COMPOSE_FILE' --env-file '$ENV_FILE_PATH' ps; \
   if ! curl --fail --retry-all-errors --retry \"$HEALTH_RETRY_MAX\" --retry-delay \"$HEALTH_RETRY_INTERVAL\" -H 'Host: $DOMAIN' '$HEALTHCHECK_URL'; then \
     echo '[deploy] health check failed after retries'; \
     docker compose -p '$COMPOSE_PROJECT' -f '$COMPOSE_FILE' --env-file '$ENV_FILE_PATH' logs --tail=200; \
    exit 1; \
  fi; \
  echo '[deploy] health check success'"

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
set -euo pipefail
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
            if (sh(script: 'command -v npx >/dev/null 2>&1', returnStatus: true) == 0) {
              def browserPrecheckStatus = sh(
                script: '''
set +e
browser_path=$(find "$HOME/.cache/ms-playwright" -type f -path "*chrome-headless-shell" | head -n 1)
if [ -z "$browser_path" ]; then
  echo "[skip] Playwright Chromium binary not found; skip post-deploy browser smoke."
  exit 2
fi
missing_libs=$(ldd "$browser_path" 2>/dev/null | awk '/not found/ {print $1}' | tr '\n' ' ' | sed 's/[[:space:]]*$//')
if [ -n "$missing_libs" ]; then
  echo "[skip] Playwright browser dependency missing: $missing_libs"
  exit 2
fi
exit 0
''',
                returnStatus: true
              )
              if (browserPrecheckStatus == 0) {
                sh 'npx playwright test --grep "auth deep-link token policy: query token rejected" e2e/specs/deeplink.spec.js --workers=1'
              } else if (browserPrecheckStatus != 2) {
                error("Playwright precheck failed with exit code ${browserPrecheckStatus}")
              }
            } else {
              echo "[skip] npx is unavailable; skip post-deploy smoke test."
            }
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
