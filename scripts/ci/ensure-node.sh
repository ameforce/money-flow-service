#!/usr/bin/env sh
# Ensure CI uses a Node.js runtime compatible with the frontend toolchain.
# Vite 7 and react-doctor require Node.js ^20.19.0 or >=22.13.0. Older Jenkins agents may
# still expose Node 18, so this script installs a pinned, user-local runtime
# without requiring sudo and prepends it to PATH for the current shell.

set -eu

CI_NODE_VERSION="${CI_NODE_VERSION:-22.13.0}"
CI_NODE_PLATFORM="${CI_NODE_PLATFORM:-linux-x64}"
CI_NODE_CACHE_DIR="${CI_NODE_CACHE_DIR:-$HOME/.cache/money-flow-node}"
CI_NODE_DIST="node-v${CI_NODE_VERSION}-${CI_NODE_PLATFORM}"
CI_NODE_HOME="${CI_NODE_CACHE_DIR}/${CI_NODE_DIST}"

node_satisfies_vite7() {
  command -v node >/dev/null 2>&1 || return 1
  node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
const ok = (major === 20 && minor >= 19) || (major === 22 && minor >= 13) || major > 22;
process.exit(ok ? 0 : 1);
' >/dev/null 2>&1
}

if node_satisfies_vite7; then
  echo "[ci-node] using existing node $(node -v) at $(command -v node)"
  return 0 2>/dev/null || exit 0
fi

mkdir -p "$CI_NODE_CACHE_DIR"

if [ ! -x "$CI_NODE_HOME/bin/node" ]; then
  archive="${CI_NODE_CACHE_DIR}/${CI_NODE_DIST}.tar.xz"
  url="https://nodejs.org/dist/v${CI_NODE_VERSION}/${CI_NODE_DIST}.tar.xz"
  echo "[ci-node] installing Node.js v${CI_NODE_VERSION} to ${CI_NODE_HOME}"
  rm -rf "$CI_NODE_HOME"
  rm -f "$archive"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$archive"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$archive" "$url"
  else
    echo "[ci-node] curl or wget is required to install Node.js v${CI_NODE_VERSION}." >&2
    exit 1
  fi
  tar -xJf "$archive" -C "$CI_NODE_CACHE_DIR"
fi

export PATH="$CI_NODE_HOME/bin:$PATH"

if ! node_satisfies_vite7; then
  echo "[ci-node] Node.js runtime is still incompatible after bootstrap: $(node -v 2>/dev/null || echo missing)" >&2
  exit 1
fi

echo "[ci-node] using bootstrapped node $(node -v) at $(command -v node)"
echo "[ci-node] npm $(npm -v) / npx $(npx -v)"
