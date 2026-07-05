export function normalizeClientVersion(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "0.0.0";
  }
  return text.startsWith("v") ? text.substring(1) : text;
}

export function resolveClientVersionState({ bundledVersion, serverVersion }) {
  const bundled = normalizeClientVersion(bundledVersion);
  const server = normalizeClientVersion(serverVersion);
  if (server && server !== bundled) {
    return {
      kind: "update_available",
      bundledVersion: bundled,
      serverVersion: server,
    };
  }
  return {
    kind: "current",
    bundledVersion: bundled,
    serverVersion: server,
  };
}
