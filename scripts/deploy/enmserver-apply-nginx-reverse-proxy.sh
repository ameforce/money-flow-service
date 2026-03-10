#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   sudo bash scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh [DOMAIN] [APP_PORT]
#
# Example:
#   sudo bash scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh moneyflow.enmsoftware.com 18080
#   sudo bash scripts/deploy/enmserver-apply-nginx-reverse-proxy.sh jenkins.enmsoftware.com 8080

DOMAIN="${1:-moneyflow.enmsoftware.com}"
APP_PORT="${2:-18080}"
CONF_FILE="/etc/nginx/sites-available/${DOMAIN}.conf"

if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  CERT_NAME="${DOMAIN}"
elif [ -d "/etc/letsencrypt/live/enmsoftware.com-0001" ]; then
  CERT_NAME="enmsoftware.com-0001"
else
  echo "ERROR: no matching certificate directory for ${DOMAIN}" >&2
  exit 1
fi

cat >/tmp/"${DOMAIN}".conf <<'NGINX'
server {
  listen 80;
  listen [::]:80;
  server_name __DOMAIN__;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  listen [::]:443 ssl http2;
  server_name __DOMAIN__;

  ssl_certificate /etc/letsencrypt/live/__CERT_NAME__/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/__CERT_NAME__/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:__APP_PORT__;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /ws/ {
    proxy_pass http://127.0.0.1:__APP_PORT__;
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
NGINX

sed -i -e "s#__DOMAIN__#${DOMAIN}#g" -e "s#__APP_PORT__#${APP_PORT}#g" -e "s#__CERT_NAME__#${CERT_NAME}#g" /tmp/"${DOMAIN}".conf

mv "/tmp/${DOMAIN}.conf" "$CONF_FILE"
ln -sf "$CONF_FILE" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t
systemctl reload nginx

