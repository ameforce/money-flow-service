import { renameSync, writeFileSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";
import { resolveBrowserRuntime } from "./browser_runtime.mjs";


const engine = String(process.env.E2E_BROWSER_ENGINE || "chromium").trim();
const browserTypes = { chromium, firefox, webkit };
const browserType = browserTypes[engine];
if (!browserType) {
  throw new Error(`unsupported E2E browser engine: ${engine}`);
}
const launchOptions = engine === "chromium"
  ? resolveBrowserRuntime().launchOptions
  : {};
const browserServer = await browserType.launchServer(launchOptions);
const endpointPayload = `${JSON.stringify({ wsEndpoint: browserServer.wsEndpoint() })}\n`;
const endpointFile = String(process.env.E2E_BROWSER_ENDPOINT_FILE || "").trim();

if (endpointFile) {
  const temporaryEndpointFile = `${endpointFile}.tmp`;
  writeFileSync(temporaryEndpointFile, endpointPayload, "utf8");
  renameSync(temporaryEndpointFile, endpointFile);
}
process.stdout.write(endpointPayload);
process.stdin.resume();

let closing = false;
let exitAfterClose = false;
async function closeBrowserServer(exitProcess = false) {
  exitAfterClose ||= exitProcess;
  if (closing) {
    return;
  }
  closing = true;
  try {
    await browserServer.close();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    process.stdin.pause();
    if (exitAfterClose) {
      process.exit(process.exitCode ?? 0);
    }
  }
}

process.stdin.on("end", () => void closeBrowserServer());
process.stdin.on("close", () => void closeBrowserServer());
process.on("SIGINT", () => void closeBrowserServer(true));
process.on("SIGTERM", () => void closeBrowserServer(true));
