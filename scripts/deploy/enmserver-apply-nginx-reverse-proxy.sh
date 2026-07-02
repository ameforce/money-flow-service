#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sudo bash scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh [DOMAIN] [APP_PORT]
#
# Example:
#   sudo bash scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh moneyflow.enmsoftware.com 18080
#   sudo bash scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh jenkins.enmsoftware.com 8080
#   sudo bash scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh jenkins.enmsoftware.com 8080 "비밀번호"
# Optional environment variables:
# - NGINX_BASIC_AUTH_ENABLED: true/false
# - NGINX_BASIC_AUTH_USER: 사용자명 (기본 jenkins 또는 ENM_USER)
# - NGINX_BASIC_AUTH_PASSWORD: 비밀번호 (없으면 기존 파일 사용)
# - NGINX_BASIC_AUTH_FILE: 인증 파일 경로 (기본 /etc/nginx/${DOMAIN}.basic_auth)
# - NGINX_CLIENT_MAX_BODY_SIZE: 업로드 제한 크기 (예: 20m)
# - NGINX_BASIC_AUTH_REALM: 브라우저 표시용 문구 (기본 Restricted)
# - NGINX_SSL_CERT: ssl_certificate 경로 강제 지정 (선택)
# - NGINX_SSL_KEY: ssl_certificate_key 경로 강제 지정 (선택)
# - NGINX_SITES_AVAILABLE_DIR / NGINX_SITES_ENABLED_DIR: nginx site dirs (test override)
# - NGINX_TEST_COMMAND / NGINX_RELOAD_COMMAND: validation/reload commands (test override)

DOMAIN="${1:-moneyflow.enmsoftware.com}"
APP_PORT="${2:-18080}"
CLI_BASIC_AUTH_PASSWORD="${3:-}"
BASIC_AUTH_USER="${NGINX_BASIC_AUTH_USER:-${ENM_USER:-jenkins}}"
SITES_AVAILABLE_DIR="${NGINX_SITES_AVAILABLE_DIR:-/etc/nginx/sites-available}"
SITES_ENABLED_DIR="${NGINX_SITES_ENABLED_DIR:-/etc/nginx/sites-enabled}"
TMP_DIR="${NGINX_TMP_DIR:-/tmp}"

BASIC_AUTH_ENABLED_DEFAULT="false"

BASIC_AUTH_ENABLED="${NGINX_BASIC_AUTH_ENABLED:-$BASIC_AUTH_ENABLED_DEFAULT}"
BASIC_AUTH_PASSWORD="${CLI_BASIC_AUTH_PASSWORD:-${NGINX_BASIC_AUTH_PASSWORD:-${ENM_PASSWORD:-}}}"
BASIC_AUTH_REALM="${NGINX_BASIC_AUTH_REALM:-Restricted}"
CLIENT_MAX_BODY_SIZE="${NGINX_CLIENT_MAX_BODY_SIZE:-20m}"
SSL_CERT="${NGINX_SSL_CERT:-}"
SSL_KEY="${NGINX_SSL_KEY:-}"
BASIC_AUTH_DIRECTIVE=""

fail_validation() {
  local name="$1"
  local value="$2"

  echo "ERROR: invalid ${name}: ${value}" >&2
  exit 2
}

validate_domain() {
  local value="$1"

  if [[ ! "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$ ]]; then
    fail_validation "DOMAIN" "$value"
  fi
  if [[ ! "$value" =~ (^|[.])enmsoftware[.]com$ ]]; then
    fail_validation "DOMAIN" "$value"
  fi
}

validate_port() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ] || [ "$value" -gt 65535 ]; then
    fail_validation "$name" "$value"
  fi
}

validate_path() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] || [[ "$value" == *".."* ]]; then
    fail_validation "$name" "$value"
  fi
}

validate_size() {
  local value="$1"

  if [[ ! "$value" =~ ^[1-9][0-9]*[kKmMgG]?$ ]]; then
    fail_validation "NGINX_CLIENT_MAX_BODY_SIZE" "$value"
  fi
}

validate_token() {
  local name="$1"
  local value="$2"

  if [[ ! "$value" =~ ^[A-Za-z0-9._-]+$ ]]; then
    fail_validation "$name" "$value"
  fi
}

validate_no_nginx_string_breakout() {
  local name="$1"
  local value="$2"

  if [[ "$value" == *\"* ]] || [[ "$value" == *\\* ]] || [[ "$value" == *$'\n'* ]] || [[ "$value" == *$'\r'* ]]; then
    fail_validation "$name" "$value"
  fi
}

validate_domain "$DOMAIN"
validate_port "APP_PORT" "$APP_PORT"
validate_path "NGINX_SITES_AVAILABLE_DIR" "$SITES_AVAILABLE_DIR"
validate_path "NGINX_SITES_ENABLED_DIR" "$SITES_ENABLED_DIR"
validate_path "NGINX_TMP_DIR" "$TMP_DIR"
validate_size "$CLIENT_MAX_BODY_SIZE"
validate_token "NGINX_BASIC_AUTH_USER" "$BASIC_AUTH_USER"
validate_no_nginx_string_breakout "NGINX_BASIC_AUTH_REALM" "$BASIC_AUTH_REALM"

CONF_FILE="${SITES_AVAILABLE_DIR}/${DOMAIN}.conf"
BASIC_AUTH_FILE="${NGINX_BASIC_AUTH_FILE:-/etc/nginx/${DOMAIN}.basic_auth}"
validate_path "CONF_FILE" "$CONF_FILE"
validate_path "NGINX_BASIC_AUTH_FILE" "$BASIC_AUTH_FILE"

if [ -n "$SSL_CERT" ]; then
  validate_path "NGINX_SSL_CERT" "$SSL_CERT"
fi
if [ -n "$SSL_KEY" ]; then
  validate_path "NGINX_SSL_KEY" "$SSL_KEY"
fi

case "${BASIC_AUTH_ENABLED,,}" in
  1|true|yes|on) BASIC_AUTH_ENABLED_BOOL=true ;;
  *) BASIC_AUTH_ENABLED_BOOL=false ;;
esac

if [ "$BASIC_AUTH_ENABLED_BOOL" = true ]; then
  if [ -n "$BASIC_AUTH_PASSWORD" ]; then
    if ! command -v openssl >/dev/null 2>&1; then
      echo "ERROR: openssl is required to generate nginx basic auth file" >&2
      exit 1
    fi

    auth_hash="$(openssl passwd -apr1 "$BASIC_AUTH_PASSWORD")"
    mkdir -p "$(dirname "$BASIC_AUTH_FILE")"
    printf '%s:%s\n' "$BASIC_AUTH_USER" "$auth_hash" > "$BASIC_AUTH_FILE"
    chmod 640 "$BASIC_AUTH_FILE"
  fi

  if [ ! -s "$BASIC_AUTH_FILE" ]; then
    echo "ERROR: basic auth is enabled but no credentials are configured." >&2
    echo "Set NGINX_BASIC_AUTH_PASSWORD or pre-create a non-empty basic auth file at ${BASIC_AUTH_FILE}." >&2
    exit 1
  fi

  BASIC_AUTH_DIRECTIVE="    auth_basic \"${BASIC_AUTH_REALM}\";
    auth_basic_user_file ${BASIC_AUTH_FILE};"
fi

if [ -z "$SSL_CERT" ] || [ -z "$SSL_KEY" ]; then
  if [ -f "$CONF_FILE" ]; then
    if [ -z "$SSL_CERT" ]; then
      SSL_CERT="$(awk 'match($0, /^[[:space:]]*ssl_certificate[[:space:]]+([^;[:space:]]+)/, m) {print m[1]; exit}' "$CONF_FILE")"
    fi
    if [ -z "$SSL_KEY" ]; then
      SSL_KEY="$(awk 'match($0, /^[[:space:]]*ssl_certificate_key[[:space:]]+([^;[:space:]]+)/, m) {print m[1]; exit}' "$CONF_FILE")"
    fi
  fi
fi

if [ -z "$SSL_CERT" ] || [ -z "$SSL_KEY" ]; then
  CERT_NAME=""
  if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    CERT_NAME="${DOMAIN}"
  elif [[ "${DOMAIN}" == *"moneyflow.enmsoftware.com" ]] && [ -d "/etc/letsencrypt/live/moneyflow.enmsoftware.com" ]; then
    CERT_NAME="moneyflow.enmsoftware.com"
  elif [ -d "/etc/letsencrypt/live/enmsoftware.com-0001" ]; then
    CERT_NAME="enmsoftware.com-0001"
  fi

  if [ -z "$CERT_NAME" ]; then
    echo "ERROR: no matching certificate directory for ${DOMAIN}" >&2
    exit 1
  fi

  SSL_CERT="/etc/letsencrypt/live/${CERT_NAME}/fullchain.pem"
  SSL_KEY="/etc/letsencrypt/live/${CERT_NAME}/privkey.pem"
fi

validate_path "NGINX_SSL_CERT" "$SSL_CERT"
validate_path "NGINX_SSL_KEY" "$SSL_KEY"
mkdir -p "$SITES_AVAILABLE_DIR" "$SITES_ENABLED_DIR" "$TMP_DIR"

TMP_CONF_FILE="$(mktemp "${TMP_DIR%/}/${DOMAIN}.conf.XXXXXX")"
cat >"$TMP_CONF_FILE" <<NGINX
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};
  return 301 https://\${host}\${request_uri};
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name ${DOMAIN};
  client_max_body_size ${CLIENT_MAX_BODY_SIZE};

  ssl_certificate ${SSL_CERT};
  ssl_certificate_key ${SSL_KEY};

  location / {
${BASIC_AUTH_DIRECTIVE}
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_set_header Host \${host};
    proxy_set_header X-Real-IP \${remote_addr};
    proxy_set_header X-Forwarded-For \${proxy_add_x_forwarded_for};
    proxy_set_header X-Forwarded-Proto \${scheme};
  }

  location /ws/ {
${BASIC_AUTH_DIRECTIVE}
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \${http_upgrade};
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \${host};
    proxy_set_header X-Real-IP \${remote_addr};
    proxy_set_header X-Forwarded-For \${proxy_add_x_forwarded_for};
    proxy_set_header X-Forwarded-Proto \${scheme};
    proxy_read_timeout 3600s;
  }
}
NGINX

mv "$TMP_CONF_FILE" "$CONF_FILE"
chmod 644 "$CONF_FILE"
ln -sf "$CONF_FILE" "${SITES_ENABLED_DIR}/${DOMAIN}.conf"
${NGINX_TEST_COMMAND:-nginx -t}
${NGINX_RELOAD_COMMAND:-systemctl reload nginx}
