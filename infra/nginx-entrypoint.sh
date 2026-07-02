#!/bin/sh
set -eu

CERT_DIR="/etc/nginx/certs"
CERT_PATH="$CERT_DIR/local.crt"
KEY_PATH="$CERT_DIR/local.key"
ALLOW_SELF_SIGNED_TLS="${ALLOW_SELF_SIGNED_TLS:-false}"
ALLOW_SELF_SIGNED_TLS_NORMALIZED="$(printf '%s' "$ALLOW_SELF_SIGNED_TLS" | tr '[:upper:]' '[:lower:]')"

mkdir -p "$CERT_DIR"

if [ ! -s "$CERT_PATH" ] || [ ! -s "$KEY_PATH" ]; then
  case "$ALLOW_SELF_SIGNED_TLS_NORMALIZED" in
    1|true|yes|on)
      ;;
    *)
      echo "[nginx-entrypoint] TLS cert/key missing at $CERT_PATH and $KEY_PATH. Refusing to start." >&2
      echo "[nginx-entrypoint] For local development only, set ALLOW_SELF_SIGNED_TLS=true to bootstrap a self-signed cert." >&2
      exit 1
      ;;
  esac
  if ! command -v openssl >/dev/null 2>&1; then
    echo "[nginx-entrypoint] openssl is required to bootstrap local TLS certs." >&2
    exit 1
  fi
  echo "[nginx-entrypoint] generating self-signed TLS certificate for local compose run"
  openssl req -x509 -nodes -newkey rsa:2048 -sha256 \
    -keyout "$KEY_PATH" \
    -out "$CERT_PATH" \
    -days 3650 \
    -subj "/CN=localhost"
fi

exec nginx -g "daemon off;"
