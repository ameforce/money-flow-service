#!/usr/bin/env bash
# Run Jenkins container as a host OS user on enm-server.
# Optional env:
# - JENKINS_TZ: Java/OS timezone passed to container (default Asia/Seoul)
# - JENKINS_JAVA_OPTS: Additional JAVA_OPTS merged with defaults
set -euo pipefail

HOST_USER="${ENM_USER:-${JENKINS_HOST_USER:-jenkins}}"
HOST_USER_PASSWORD="${ENM_PASSWORD:-${JENKINS_HOST_USER_PASSWORD:?JENKINS_HOST_USER_PASSWORD is required}}"
JENKINS_WEB_USER="${ENM_USER:-${JENKINS_WEB_USER:-jenkins}}"
JENKINS_WEB_PASSWORD="${ENM_PASSWORD:-${JENKINS_WEB_PASSWORD:-$HOST_USER_PASSWORD}}"
JENKINS_WEB_LEGACY_USER="${JENKINS_WEB_LEGACY_USER:-jenkins}"
HOST_HOME="${JENKINS_HOST_HOME:-/home/${HOST_USER}}"
JENKINS_HOME="${JENKINS_HOME:-${HOST_HOME}/jenkins_home}"
CONTAINER_NAME="${JENKINS_CONTAINER_NAME:-jenkins}"
IMAGE="${JENKINS_IMAGE:-jenkins/jenkins:lts}"
INIT_SCRIPT_PATH="${INIT_SCRIPT_PATH:-/home/ameforce/money-flow-service/scripts/deploy/jenkins/jenkins-web-admin-init.groovy}"
JENKINS_TZ="${JENKINS_TZ:-${TZ:-Asia/Seoul}}"
JENKINS_JAVA_OPTS="${JENKINS_JAVA_OPTS:-}"
JAVA_OPTS_VALUE="-Djenkins.install.runSetupWizard=false -Duser.timezone=${JENKINS_TZ}"
if [ -n "$JENKINS_JAVA_OPTS" ]; then
  JAVA_OPTS_VALUE="${JAVA_OPTS_VALUE} ${JENKINS_JAVA_OPTS}"
fi

if id "$HOST_USER" >/dev/null 2>&1; then
  :
else
  useradd --create-home --shell /bin/bash "$HOST_USER"
fi

printf '%s:%s\n' "$HOST_USER" "$HOST_USER_PASSWORD" | chpasswd

HOST_UID="$(id -u "$HOST_USER")"
HOST_GID="$(id -g "$HOST_USER")"
if [ ! -f "$INIT_SCRIPT_PATH" ]; then
  echo "ERROR: missing init script: $INIT_SCRIPT_PATH" >&2
  exit 1
fi
mkdir -p "$JENKINS_HOME"
chown -R "${HOST_UID}:${HOST_GID}" "$JENKINS_HOME"
mkdir -p "$JENKINS_HOME/init.groovy.d"
cp "$INIT_SCRIPT_PATH" "$JENKINS_HOME/init.groovy.d/00-create-jenkins-admin.groovy"

rm -f "$JENKINS_HOME/secrets/initialAdminPassword"

if docker ps -aq --filter "name=^/${CONTAINER_NAME}$" | grep -q .; then
  docker rm -f "$CONTAINER_NAME"
fi

docker run -d \
  --name "$CONTAINER_NAME" \
  --user "${HOST_UID}:${HOST_GID}" \
  --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -p 127.0.0.1:50000:50000 \
  -v "$JENKINS_HOME:/var/jenkins_home" \
  -e TZ="$JENKINS_TZ" \
  -e JAVA_OPTS="$JAVA_OPTS_VALUE" \
  -e JENKINS_WEB_ADMIN_USER="$JENKINS_WEB_USER" \
  -e JENKINS_WEB_ADMIN_PASSWORD="$JENKINS_WEB_PASSWORD" \
  -e JENKINS_WEB_LEGACY_USER="$JENKINS_WEB_LEGACY_USER" \
  "$IMAGE"

echo "Jenkins container restarted with host account '${HOST_USER}'."
