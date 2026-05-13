#!/usr/bin/env bash
# 일회성: enm-server 배포 디렉터리에서 dev 스택 Postgres(moneyflow_dev 등) 덤프를
# 운영 스택 Postgres(moneyflow)로 복원한다. 운영 DB 기존 내용은 삭제된다.
#
# 전제:
#   - 같은 호스트에서 docker compose로 두 스택이 떠 있음
#   - 기본 프로젝트명: money-flow-service-dev / money-flow-service
#   - 환경파일: .env.dev / .env (Jenkins와 동일)
#
# 실행 (enm-server, 배포 사용자 홈의 money-flow-service 등):
#   cd /home/ameforce/money-flow-service
#   I_CONFIRM_ONE_SHOT_DEV_PG_TO_PROD_DB=1 bash scripts/deploy/one-shot-dev-pg-to-prod.sh
#
# 선택 환경변수:
#   ONE_SHOT_DEPLOY_DIR          기본: 현재 디렉터리
#   DEV_COMPOSE_PROJECT          기본: money-flow-service-dev
#   PROD_COMPOSE_PROJECT         기본: money-flow-service
#   DEV_COMPOSE_FILE             기본: docker-compose.dev.deploy.yml
#   PROD_COMPOSE_FILE            기본: docker-compose.deploy.yml
#   DEV_ENV_FILE                 기본: .env.dev
#   PROD_ENV_FILE                기본: .env
#   DEV_POSTGRES_DB              기본: .env.dev 의 POSTGRES_DB, 없으면 moneyflow_dev(환경변수로 덮어쓰기 가능)
#   PROD_POSTGRES_DB             기본: .env 의 POSTGRES_DB, 없으면 moneyflow(환경변수로 덮어쓰기 가능)

set -euo pipefail

if [[ "${I_CONFIRM_ONE_SHOT_DEV_PG_TO_PROD_DB:-}" != "1" ]]; then
  echo "거부: 운영 DB를 덮어쓰려면 환경변수 I_CONFIRM_ONE_SHOT_DEV_PG_TO_PROD_DB=1 을 설정하세요." >&2
  exit 2
fi

ROOT="${ONE_SHOT_DEPLOY_DIR:-$(pwd)}"
cd "$ROOT"

DEV_COMPOSE_PROJECT="${DEV_COMPOSE_PROJECT:-money-flow-service-dev}"
PROD_COMPOSE_PROJECT="${PROD_COMPOSE_PROJECT:-money-flow-service}"
DEV_COMPOSE_FILE="${DEV_COMPOSE_FILE:-docker-compose.dev.deploy.yml}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-docker-compose.deploy.yml}"
DEV_ENV_FILE="${DEV_ENV_FILE:-.env.dev}"
PROD_ENV_FILE="${PROD_ENV_FILE:-.env}"

for f in "$DEV_ENV_FILE" "$PROD_ENV_FILE" "$DEV_COMPOSE_FILE" "$PROD_COMPOSE_FILE"; do
  if [[ ! -f "$f" ]]; then
    echo "오류: 필수 파일이 없습니다: $f (cwd=$ROOT)" >&2
    exit 3
  fi
done

read_env_tail() {
  local file="$1" key="$2"
  local line
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo ""
    return 0
  fi
  printf '%s' "${line#*=}"
}

POSTGRES_USER_DEV="$(read_env_tail "$DEV_ENV_FILE" POSTGRES_USER)"
POSTGRES_USER_PROD="$(read_env_tail "$PROD_ENV_FILE" POSTGRES_USER)"
if [[ -z "$POSTGRES_USER_DEV" || -z "$POSTGRES_USER_PROD" ]]; then
  echo "오류: POSTGRES_USER 가 ${DEV_ENV_FILE} 또는 ${PROD_ENV_FILE}에 없습니다." >&2
  exit 4
fi
if [[ "$POSTGRES_USER_DEV" != "$POSTGRES_USER_PROD" ]]; then
  echo "오류: dev와 prod의 POSTGRES_USER가 다릅니다. 수동으로 맞춘 뒤 다시 실행하세요." >&2
  echo "  dev=$POSTGRES_USER_DEV prod=$POSTGRES_USER_PROD" >&2
  exit 5
fi

POSTGRES_USER="$POSTGRES_USER_PROD"

validate_sql_identifier() {
  local name="$1" ctx="$2"
  case "$name" in
    '' | *[!a-zA-Z0-9_]*)
      echo "오류: ${ctx} 식별자가 허용 형식이 아닙니다(영문·숫자·밑줄만): ${name}" >&2
      exit 9
      ;;
  esac
}

validate_sql_identifier "$POSTGRES_USER" "POSTGRES_USER"

DEV_DB="${DEV_POSTGRES_DB:-$(read_env_tail "$DEV_ENV_FILE" POSTGRES_DB)}"
PROD_DB="${PROD_POSTGRES_DB:-$(read_env_tail "$PROD_ENV_FILE" POSTGRES_DB)}"
DEV_DB="${DEV_DB:-moneyflow_dev}"
PROD_DB="${PROD_DB:-moneyflow}"
validate_sql_identifier "$DEV_DB" "DEV_POSTGRES_DB/POSTGRES_DB"
validate_sql_identifier "$PROD_DB" "PROD_POSTGRES_DB/POSTGRES_DB"

echo "[one-shot] deploy_dir=$ROOT"
echo "[one-shot] dev  project=$DEV_COMPOSE_PROJECT db=$DEV_DB"
echo "[one-shot] prod project=$PROD_COMPOSE_PROJECT db=$PROD_DB"

dev_pg="$(docker compose -p "$DEV_COMPOSE_PROJECT" -f "$DEV_COMPOSE_FILE" --env-file "$DEV_ENV_FILE" ps -q postgres)"
prod_pg="$(docker compose -p "$PROD_COMPOSE_PROJECT" -f "$PROD_COMPOSE_FILE" --env-file "$PROD_ENV_FILE" ps -q postgres)"
if [[ -z "$dev_pg" ]]; then
  echo "오류: dev postgres 컨테이너를 찾을 수 없습니다." >&2
  exit 6
fi
if [[ -z "$prod_pg" ]]; then
  echo "오류: prod postgres 컨테이너를 찾을 수 없습니다." >&2
  exit 7
fi

echo "[one-shot] stopping prod app (postgres 유지)"
docker compose -p "$PROD_COMPOSE_PROJECT" -f "$PROD_COMPOSE_FILE" --env-file "$PROD_ENV_FILE" stop app || true

echo "[one-shot] dropping and recreating prod database ${PROD_DB} (FORCE)"
docker exec -i "$prod_pg" psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 <<EOF
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${PROD_DB}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${PROD_DB} WITH (FORCE);
CREATE DATABASE ${PROD_DB} OWNER ${POSTGRES_USER};
EOF

echo "[one-shot] streaming pg_dump(dev) -> psql(prod) (may take several minutes)"
docker compose -p "$DEV_COMPOSE_PROJECT" -f "$DEV_COMPOSE_FILE" --env-file "$DEV_ENV_FILE" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" --no-owner --no-acl --if-exists --clean --dbname="$DEV_DB" |
  docker exec -i "$prod_pg" psql -U "$POSTGRES_USER" -d "$PROD_DB" -v ON_ERROR_STOP=1

echo "[one-shot] aligning prod role password with ${PROD_ENV_FILE} (same as Jenkins deploy)"
prod_pw="$(read_env_tail "$PROD_ENV_FILE" POSTGRES_PASSWORD)"
if [[ -z "$prod_pw" ]]; then
  echo "오류: ${PROD_ENV_FILE} 에 POSTGRES_PASSWORD 가 없습니다." >&2
  exit 8
fi
docker exec -i "$prod_pg" psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -v db_user="$POSTGRES_USER" -v "db_password=$prod_pw" <<'SQL'
ALTER USER :"db_user" WITH PASSWORD :'db_password';
SQL

echo "[one-shot] running schema upgrade against prod (idempotent)"
docker compose -p "$PROD_COMPOSE_PROJECT" -f "$PROD_COMPOSE_FILE" --env-file "$PROD_ENV_FILE" run --rm app \
  env PYTHONPATH=backend python -m app.db.schema_upgrade

echo "[one-shot] starting prod app"
docker compose -p "$PROD_COMPOSE_PROJECT" -f "$PROD_COMPOSE_FILE" --env-file "$PROD_ENV_FILE" up -d app

echo "[one-shot] done. 검증: curl -fsS http://127.0.0.1:18080/readyz 및 https://moneyflow.enmsoftware.com/readyz"
