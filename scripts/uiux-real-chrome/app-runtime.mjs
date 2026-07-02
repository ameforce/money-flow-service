import { spawn, spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export { delay };

async function isHttpReady(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHttpReady(url)) {
      return true;
    }
    await delay(500);
  }
  return false;
}

async function pickFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

function spawnOrchestrator(options = {}) {
  const command = process.platform === "win32" ? "cmd" : "uv";
  const orchestratorArgs = ["run", "python", "orchestrator.py"];
  if (options.backendPort) orchestratorArgs.push("--backend-host", "127.0.0.1", "--backend-port", String(options.backendPort));
  if (options.frontendPort) orchestratorArgs.push("--frontend-host", "127.0.0.1", "--frontend-port", String(options.frontendPort));
  if (options.databaseUrl) orchestratorArgs.push("--database-url", options.databaseUrl);
  const args = process.platform === "win32" ? ["/c", "uv", ...orchestratorArgs] : orchestratorArgs;
  const child = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const logs = [];
  const collect = (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 80) logs.shift();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  return { child, command: `${command} ${args.join(" ")}`, logs };
}

export function terminateStartedProcess(started) {
  if (!started?.child || started.child.exitCode !== null) {
    return { attempted: false, alreadyExited: true, exitCode: started?.child?.exitCode ?? null };
  }
  if (process.platform === "win32") {
    const result = spawnSync("cmd", ["/c", "taskkill", "/PID", String(started.child.pid), "/T", "/F"], { cwd: process.cwd(), windowsHide: true });
    return { attempted: true, method: "taskkill", pid: started.child.pid, status: result.status, stderrBytes: result.stderr?.length ?? 0, stdoutBytes: result.stdout?.length ?? 0 };
  }
  started.child.kill("SIGTERM");
  return { attempted: true, method: "SIGTERM", pid: started.child.pid };
}

export function cleanupDatabase(dbPath) {
  if (!dbPath) return { attempted: false, removed: false };
  if (!existsSync(dbPath)) return { attempted: true, removed: false, missing: true, path: dbPath };
  try {
    unlinkSync(dbPath);
    return { attempted: true, removed: true, path: dbPath };
  } catch (error) {
    return { attempted: true, removed: false, path: dbPath, error: error instanceof Error ? error.message : String(error) };
  }
}

export function currentIsoDate() {
  const date = new Date();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

async function startIsolatedApp() {
  const backendPort = await pickFreePort();
  const frontendPort = await pickFreePort();
  const dbPath = resolve(".omo", "evidence", `uiux-real-chrome-${process.pid}-${Date.now()}.db`);
  const databaseUrl = `sqlite:///./.omo/evidence/${dbPath.split(/[\\/]/u).pop()}`;
  const started = spawnOrchestrator({
    backendPort,
    frontendPort,
    databaseUrl,
    env: {
      ENV: "test",
      SECRET_KEY: "test-secret-key-for-uiux-real-chrome-qa-1234567890",
      AUTH_COOKIE_SECURE: "false",
      AUTH_DEBUG_RETURN_VERIFY_TOKEN: "true",
      VITE_DEBUG_TOKEN_OPT_IN: "true",
      CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
      FRONTEND_BASE_URL: `http://127.0.0.1:${frontendPort}`,
    },
  });
  const url = `http://127.0.0.1:${frontendPort}`;
  const ready = await waitForHttp(url, 90_000);
  if (!ready) {
    const cleanup = terminateStartedProcess(started);
    const dbCleanup = cleanupDatabase(dbPath);
    throw new Error(`isolated orchestrator did not expose ${url}; cleanup=${JSON.stringify(cleanup)}; dbCleanup=${JSON.stringify(dbCleanup)}; logs=${started.logs.join("").slice(-3000)}`);
  }
  return { url, source: "isolated-orchestrator", started, dbPath, backendPort, frontendPort };
}

export async function resolveBaseUrl(options = {}) {
  if (options.isolated) return startIsolatedApp();
  const envUrl = process.env.UIUX_QA_BASE_URL || process.env.E2E_BASE_URL || process.env.FRONTEND_URL;
  if (envUrl) return { url: envUrl.replace(/\/$/u, ""), source: "environment", started: null };
  const localUrl = "http://127.0.0.1:5173";
  if (await isHttpReady(localUrl)) return { url: localUrl, source: "existing-server", started: null };
  const started = spawnOrchestrator();
  const ready = await waitForHttp(localUrl, 90_000);
  if (!ready) {
    const cleanup = terminateStartedProcess(started);
    throw new Error(`orchestrator did not expose ${localUrl}; cleanup=${JSON.stringify(cleanup)}; logs=${started.logs.join("").slice(-3000)}`);
  }
  return { url: localUrl, source: "started-orchestrator", started, dbPath: null };
}
