import { existsSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";


export function resolveBrowserRuntime({
  environment = process.env,
  platform = process.platform,
  fileExists = existsSync,
} = {}) {
  const localAppData = String(environment.LOCALAPPDATA || "").trim();
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    localAppData
      ? path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
      : "",
  ].filter(Boolean);
  const systemChrome = platform === "win32"
    ? candidates.find((candidate) => fileExists(candidate))
    : undefined;
  const useSystemChrome = Boolean(systemChrome) && environment.E2E_USE_SYSTEM_CHROME !== "0";
  if (useSystemChrome) {
    const executablePath = path.resolve(systemChrome);
    return {
      decision: "system-chrome",
      channel: "chrome",
      executablePath,
      launchOptions: { channel: "chrome", executablePath },
    };
  }
  return {
    decision: "playwright-chromium",
    channel: null,
    executablePath: path.resolve(chromium.executablePath()),
    launchOptions: {},
  };
}
