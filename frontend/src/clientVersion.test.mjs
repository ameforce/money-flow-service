import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const appShellSource = readFileSync(new URL("./components/AppShell.jsx", import.meta.url), "utf8");
const clientVersionModuleUrl = new URL("./clientVersion.js", import.meta.url);

test("client version helper reports update_available when server version differs", async () => {
  const { resolveClientVersionState } = await import(clientVersionModuleUrl);

  const result = resolveClientVersionState({
    bundledVersion: "1.2.3",
    serverVersion: "v1.2.4",
  });

  assert.deepEqual(result, {
    kind: "update_available",
    bundledVersion: "1.2.3",
    serverVersion: "1.2.4",
  });
});

test("client version helper stays current when server version matches bundled version", async () => {
  const { resolveClientVersionState } = await import(clientVersionModuleUrl);

  const result = resolveClientVersionState({
    bundledVersion: "1.2.3",
    serverVersion: "v1.2.3",
  });

  assert.deepEqual(result, {
    kind: "current",
    bundledVersion: "1.2.3",
    serverVersion: "1.2.3",
  });
});

test("client version helper normalizes empty and prefixed versions", async () => {
  const { normalizeClientVersion, resolveClientVersionState } = await import(clientVersionModuleUrl);

  assert.equal(normalizeClientVersion("v2.0.1"), "2.0.1");
  assert.equal(normalizeClientVersion(""), "0.0.0");
  assert.deepEqual(
    resolveClientVersionState({ bundledVersion: "", serverVersion: "" }),
    { kind: "current", bundledVersion: "0.0.0", serverVersion: "0.0.0" }
  );
});

test("App wires client version checks to endpoint, focus, visibility, interval, and topbar CTA", () => {
  assert.match(appSource, /system\/client-version/u);
  assert.match(appSource, /visibilitychange/u);
  assert.match(appSource, /window\.addEventListener\("focus"/u);
  assert.match(appSource, /setInterval/u);
  assert.match(appSource, /clientUpdateAvailable/u);
  assert.match(appShellSource, /새 버전 적용/u);
  assert.match(appShellSource, /client-version-reload-button/u);
});
