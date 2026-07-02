pipeline {
  agent any

  options {
    timestamps()
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
      defaultValue: false,
      description: '배포 완료 후 배포 URL에 대해 경량 Playwright E2E를 수행'
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
      defaultValue: 'main',
      description: '배포 허용 브랜치 목록(쉼표 구분)'
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

          def version = ''
          if (isUnix()) {
            version = sh(
              returnStdout: true,
              script: "git describe --tags --match 'v[0-9]*.[0-9]*.[0-9]*' --dirty --always --abbrev=7"
            ).trim()
          } else {
            version = powershell(
              returnStdout: true,
              script: '''
                $version = git describe --tags --match "v[0-9]*.[0-9]*.[0-9]*" --dirty --always --abbrev=7
                if ([string]::IsNullOrWhiteSpace($version)) {
                  $version = "v0.0.0-$env:BUILD_NUMBER"
                }
                $version.Trim()
              '''
            ).trim()
          }

          if (!version) {
            version = "v0.0.0-${env.BUILD_NUMBER}"
          }

          env.APP_VERSION = version
          echo "Resolved version = ${env.APP_VERSION}"
        }
      }
    }

    stage('Install Dependencies') {
      steps {
        script {
          if (isUnix()) {
            sh 'uv sync --extra dev'
            sh 'npm install'
            sh 'npm install --prefix frontend'
            sh 'npx playwright install --with-deps chromium'
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
          if (isUnix()) {
            sh 'npm run ci:quality:gate'
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
            sh "docker build -t ${env.IMAGE_NAME}:${env.APP_VERSION} ."
          } else {
            bat "docker build -t ${env.IMAGE_NAME}:${env.APP_VERSION} ."
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
          def deployBranch = (env.BRANCH_NAME ?: 'manual').trim()
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
            "target_domain=${params.DEPLOY_DOMAIN}",
            "ssh_user=${params.DEPLOY_SSH_USER}",
            "deploy_path=${params.DEPLOY_PATH}",
            "compose_file=${params.DEPLOY_COMPOSE_FILE}",
            "compose_project=${params.DEPLOY_COMPOSE_PROJECT}",
            "healthcheck=${params.DEPLOY_HEALTHCHECK_URL}",
            "healthcheck_timeout_sec=${params.DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS}",
            "healthcheck_interval_sec=${params.DEPLOY_HEALTHCHECK_INTERVAL_SECONDS}",
            "image_tag=${imageTag}",
            '',
            '# remote command template',
            "mkdir -p ${params.DEPLOY_PATH}",
            "cd ${params.DEPLOY_PATH}",
            "tar -xzf deploy-${env.BUILD_NUMBER}.tgz",
            "docker compose -p ${params.DEPLOY_COMPOSE_PROJECT} -f ${params.DEPLOY_COMPOSE_FILE} --env-file .env up -d --build",
            "curl -fsS -H 'Host: ${params.DEPLOY_DOMAIN}' ${params.DEPLOY_HEALTHCHECK_URL}"
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

          input(
            message: "배포 승인: ${params.DEPLOY_DOMAIN} -> ${params.DEPLOY_HOST} (branch: ${deployBranch})",
            ok: '승인'
          )
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
          def deployBranch = (env.BRANCH_NAME ?: 'manual').trim()
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
          if (!params.DEPLOY_COMPOSE_FILE?.trim()) {
            error('DEPLOY_COMPOSE_FILE 파라미터가 비어 있습니다.')
          }
          if (!params.DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS?.trim()) {
            error('DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS 파라미터가 비어 있습니다.')
          }
          if (!params.DEPLOY_HEALTHCHECK_INTERVAL_SECONDS?.trim()) {
            error('DEPLOY_HEALTHCHECK_INTERVAL_SECONDS 파라미터가 비어 있습니다.')
          }
          if (!params.DEPLOY_COMPOSE_PROJECT?.trim()) {
            error('DEPLOY_COMPOSE_PROJECT 파라미터가 비어 있습니다.')
          }

          def healthTimeoutSeconds = params.DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS.toInteger()
          def healthIntervalSeconds = params.DEPLOY_HEALTHCHECK_INTERVAL_SECONDS.toInteger()
          if (healthTimeoutSeconds < 1) {
            error('DEPLOY_HEALTHCHECK_TIMEOUT_SECONDS는 1 이상이어야 합니다.')
          }
          if (healthIntervalSeconds < 1) {
            error('DEPLOY_HEALTHCHECK_INTERVAL_SECONDS는 1 이상이어야 합니다.')
          }
          def healthRetryCount = Math.max(1, (healthTimeoutSeconds / healthIntervalSeconds) as int)

          def remote = "${params.DEPLOY_SSH_USER}@${params.DEPLOY_HOST}"
          def bundle = "deploy-${env.APP_VERSION}-${env.BUILD_NUMBER}.tgz"

          withCredentials([
            file(credentialsId: params.DEPLOY_ENV_FILE_CREDENTIALS_ID, variable: 'DEPLOY_ENV_FILE')
          ]) {
            sshagent(credentials: [params.DEPLOY_SSH_CREDENTIALS_ID]) {
              sh """
set -euo pipefail
REMOTE="${remote}"
BUNDLE="${bundle}"
REMOTE_DEPLOY_PATH="${params.DEPLOY_PATH}"
COMPOSE_FILE="${params.DEPLOY_COMPOSE_FILE}"
COMPOSE_PROJECT="${params.DEPLOY_COMPOSE_PROJECT}"
DOMAIN="${params.DEPLOY_DOMAIN}"
HEALTHCHECK_URL="${params.DEPLOY_HEALTHCHECK_URL}"
SSH_OPTS="${params.DEPLOY_SSH_OPTS}"
HEALTH_RETRY_MAX="${healthRetryCount}"
HEALTH_RETRY_INTERVAL="${healthIntervalSeconds}"

echo "[deploy] preflight to \$REMOTE"
ssh \$SSH_OPTS "\$REMOTE" "set -e; hostnamectl || true; whoami; id; df -h; free -h; docker --version; docker compose version; ss -lntp | head -n 10"
ssh \$SSH_OPTS "\$REMOTE" "set -e; mkdir -p '\$REMOTE_DEPLOY_PATH'"

tar \
  --exclude='.git' \
  --exclude='.venv' \
  --exclude='node_modules' \
  --exclude='frontend/node_modules' \
  --exclude='playwright-report' \
  --exclude='test-results' \
  --exclude='.runtime' \
  -czf "\$BUNDLE" .
scp \$SSH_OPTS "\$BUNDLE" "\$REMOTE:\$REMOTE_DEPLOY_PATH/\$BUNDLE"
scp \$SSH_OPTS "\$DEPLOY_ENV_FILE" "\$REMOTE:\$REMOTE_DEPLOY_PATH/.env"
rm -f "\$BUNDLE"

ssh \$SSH_OPTS "\$REMOTE" "set -euo pipefail; \
  cd '\$REMOTE_DEPLOY_PATH'; \
  if [ -f '.env' ]; then cp '.env' '.env.previous'; fi; \
  if [ -f '\$BUNDLE' ]; then tar -xzf '\$BUNDLE'; fi; \
  rm -f '\$BUNDLE'; \
  docker compose -p '\$COMPOSE_PROJECT' -f '\$COMPOSE_FILE' --env-file .env down --remove-orphans || true; \
  docker compose -p '\$COMPOSE_PROJECT' -f '\$COMPOSE_FILE' --env-file .env up -d --build; \
  docker compose -p '\$COMPOSE_PROJECT' -f '\$COMPOSE_FILE' --env-file .env ps; \
  attempt=1; \
  while true; do \
    if curl -fsS -H 'Host: \$DOMAIN' '\$HEALTHCHECK_URL'; then \
      echo '[deploy] health check success'; \
      break; \
    fi; \
    if [ \$attempt -ge \$HEALTH_RETRY_MAX ]; then \
      echo '[deploy] health check failed after retries'; \
      docker compose -p '\$COMPOSE_PROJECT' -f '\$COMPOSE_FILE' --env-file .env logs --tail=200; \
      exit 1; \
    fi; \
    echo "[deploy] health check retry \$attempt/\$HEALTH_RETRY_MAX"; \
    attempt=$((attempt + 1)); \
    sleep \$HEALTH_RETRY_INTERVAL; \
  done"
              """
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
        }
      }
      steps {
        script {
          def deployBranch = (env.BRANCH_NAME ?: 'manual').trim()
          def allowedBranches = params.DEPLOY_ALLOWED_BRANCHES.split(',').collect { it.trim() }.findAll { it }
          def canDeployBranch = deployBranch == 'manual' || allowedBranches.isEmpty() || allowedBranches.contains(deployBranch)
          if (!canDeployBranch) {
            echo "현재 브랜치(${deployBranch})는 배포 허용 브랜치 목록(${params.DEPLOY_ALLOWED_BRANCHES}) 밖이므로 Post-Deploy E2E를 건너뜁니다."
            return
          }
          if (!isUnix()) {
            error('Post-Deploy E2E 단계는 Unix Jenkins agent가 필요합니다.')
          }
          def targetUrl = params.POST_DEPLOY_E2E_URL?.trim() ?: 'https://moneyflow.enmsoftware.com'
          if (!targetUrl) {
            error('POST_DEPLOY_E2E_URL 파라미터가 비어 있습니다.')
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

          sh """
set -euo pipefail
TARGET_URL="${targetUrl}"
RETRY_COUNT="${retryCount}"
RETRY_INTERVAL="${retryInterval}"

attempt=1
while true; do
  if curl -fsS "${TARGET_URL}/healthz"; then
    echo "[deploy-e2e] ${TARGET_URL} health check OK"
    break
  fi

  if [ "\${attempt}" -ge "\${RETRY_COUNT}" ]; then
    echo "[deploy-e2e] health check failed after \${RETRY_COUNT} retries"
    exit 1
  fi

  echo "[deploy-e2e] health check retry \$attempt/\${RETRY_COUNT}: \$TARGET_URL"
  attempt=\$((attempt + 1))
  sleep "\${RETRY_INTERVAL}"
done
          """

          withEnv([
            "E2E_BASE_URL=${targetUrl}",
            "E2E_API_BASE_URL=${apiBaseUrl}",
            "E2E_API_REQUEST_ORIGIN=${apiRequestOrigin}"
          ]) {
            sh "npx playwright test --grep \"auth deep-link token policy: query token rejected\" e2e/app.spec.js"
          }
        }
      }
    }
  }

  post {
    always {
      script {
        if (isUnix()) {
          sh 'docker compose -f docker-compose.mail-local.yml down || true'
        } else {
          bat 'docker compose -f docker-compose.mail-local.yml down || exit 0'
        }
      }
    }
  }
}
