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

DOMAIN="${1:-moneyflow.enmsoftware.com}"
APP_PORT="${2:-18080}"
CLI_BASIC_AUTH_PASSWORD="${3:-}"
CONF_FILE="/etc/nginx/sites-available/${DOMAIN}.conf"
BASIC_AUTH_FILE="${NGINX_BASIC_AUTH_FILE:-/etc/nginx/${DOMAIN}.basic_auth}"
BASIC_AUTH_USER="${NGINX_BASIC_AUTH_USER:-${ENM_USER:-jenkins}}"

BASIC_AUTH_ENABLED_DEFAULT="false"

BASIC_AUTH_ENABLED="${NGINX_BASIC_AUTH_ENABLED:-$BASIC_AUTH_ENABLED_DEFAULT}"
BASIC_AUTH_PASSWORD="${CLI_BASIC_AUTH_PASSWORD:-${NGINX_BASIC_AUTH_PASSWORD:-${ENM_PASSWORD:-}}}"
BASIC_AUTH_REALM="${NGINX_BASIC_AUTH_REALM:-Restricted}"
CLIENT_MAX_BODY_SIZE="${NGINX_CLIENT_MAX_BODY_SIZE:-20m}"
SSL_CERT="${NGINX_SSL_CERT:-}"
SSL_KEY="${NGINX_SSL_KEY:-}"
BASIC_AUTH_DIRECTIVE=""

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

cat >/tmp/"${DOMAIN}".conf <<NGINX
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

mv "/tmp/${DOMAIN}.conf" "$CONF_FILE"
ln -sf "$CONF_FILE" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t
systemctl reload nginx


