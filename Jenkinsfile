pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    booleanParam(
      name: 'RUN_DEPLOY',
      defaultValue: false,
      description: '배포 스테이지 실행 여부 (기본 false)'
    )
    booleanParam(
      name: 'DEPLOY_DRY_RUN',
      defaultValue: true,
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
      defaultValue: '/srv/money-flow-service',
      description: '서버 내 배포 경로'
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
      defaultValue: 'docker-compose.yml',
      description: '원격 배포에 사용할 compose 파일'
    )
    string(
      name: 'DEPLOY_HEALTHCHECK_URL',
      defaultValue: 'http://127.0.0.1/healthz',
      description: '원격 배포 후 헬스체크 URL'
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
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install Dependencies') {
      steps {
        script {
          if (isUnix()) {
            sh 'uv sync --extra dev'
            sh 'npm ci'
            sh 'npx playwright install --with-deps chromium'
          } else {
            bat 'uv sync --extra dev'
            bat 'npm ci'
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
            sh 'docker build -t money-flow-service:${BUILD_NUMBER} .'
          } else {
            bat 'docker build -t money-flow-service:%BUILD_NUMBER% .'
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
          def imageTag = "money-flow-service:${env.BUILD_NUMBER}"
          def preview = """
[deploy-preview]
target_host=${params.DEPLOY_HOST}
target_domain=${params.DEPLOY_DOMAIN}
ssh_user=${params.DEPLOY_SSH_USER}
deploy_path=${params.DEPLOY_PATH}
image_tag=${imageTag}

# remote command template (manual wiring before production)
mkdir -p ${params.DEPLOY_PATH}
cd ${params.DEPLOY_PATH}
tar -xzf deploy-${env.BUILD_NUMBER}.tgz
docker compose -f ${params.DEPLOY_COMPOSE_FILE} --env-file .env up -d --build
curl -fsS -H 'Host: ${params.DEPLOY_DOMAIN}' ${params.DEPLOY_HEALTHCHECK_URL}

# nginx vhost expectation
server_name ${params.DEPLOY_DOMAIN};

# required Jenkins credentials
ssh_key_credentials_id=${params.DEPLOY_SSH_CREDENTIALS_ID}
env_file_credentials_id=${params.DEPLOY_ENV_FILE_CREDENTIALS_ID}
"""
          writeFile file: 'deploy-preview.txt', text: preview.stripIndent().trim() + '\n'
          archiveArtifacts artifacts: 'deploy-preview.txt', onlyIfSuccessful: false
          if (!params.DEPLOY_DRY_RUN) {
            input(
              message: "배포 승인: ${params.DEPLOY_DOMAIN} -> ${params.DEPLOY_HOST}",
              ok: '승인'
            )
          } else {
            echo 'DEPLOY_DRY_RUN=true: 승인 게이트 및 미리보기만 수행합니다.'
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
          if (!isUnix()) {
            error('Deploy Execute 단계는 Unix Jenkins agent를 필요로 합니다.')
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

          def remote = "${params.DEPLOY_SSH_USER}@${params.DEPLOY_HOST}"
          def bundle = "deploy-${env.BUILD_NUMBER}.tgz"

          withCredentials([
            file(credentialsId: params.DEPLOY_ENV_FILE_CREDENTIALS_ID, variable: 'DEPLOY_ENV_FILE')
          ]) {
            sshagent(credentials: [params.DEPLOY_SSH_CREDENTIALS_ID]) {
              sh """
set -euo pipefail
REMOTE="${remote}"
BUNDLE="${bundle}"
DEPLOY_PATH="${params.DEPLOY_PATH}"
COMPOSE_FILE="${params.DEPLOY_COMPOSE_FILE}"
DOMAIN="${params.DEPLOY_DOMAIN}"
HEALTHCHECK_URL="${params.DEPLOY_HEALTHCHECK_URL}"
SSH_OPTS="${params.DEPLOY_SSH_OPTS}"

ssh \$SSH_OPTS "\$REMOTE" "set -e; mkdir -p '\$DEPLOY_PATH'"
ssh \$SSH_OPTS "\$REMOTE" "set -e; if [ -f '\$DEPLOY_PATH/.env' ]; then cp '\$DEPLOY_PATH/.env' '\$DEPLOY_PATH/.env.previous'; fi"
tar \
  --exclude='.git' \
  --exclude='.venv' \
  --exclude='node_modules' \
  --exclude='frontend/node_modules' \
  --exclude='playwright-report' \
  --exclude='test-results' \
  --exclude='.runtime' \
  -czf "\$BUNDLE" .
scp \$SSH_OPTS "\$BUNDLE" "\$REMOTE:\$DEPLOY_PATH/\$BUNDLE"
scp \$SSH_OPTS "\$DEPLOY_ENV_FILE" "\$REMOTE:\$DEPLOY_PATH/.env"
rm -f "\$BUNDLE"

ssh \$SSH_OPTS "\$REMOTE" "set -euo pipefail; cd '\$DEPLOY_PATH'; tar -xzf '\$BUNDLE'; rm -f '\$BUNDLE'; docker compose -f '\$COMPOSE_FILE' --env-file .env up -d --build; docker compose -f '\$COMPOSE_FILE' --env-file .env ps; curl -fsS -H 'Host: \$DOMAIN' '\$HEALTHCHECK_URL'"
"""
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
          sh 'docker compose -f docker-compose.mail-local.yml down || true'
        } else {
          bat 'docker compose -f docker-compose.mail-local.yml down'
        }
      }
    }
  }
}
