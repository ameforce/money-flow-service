import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import "./scripts/e2e_scheduler/windows_hide_node_children.cjs";
import { resolveBrowserRuntime } from "./scripts/e2e_scheduler/browser_runtime.mjs";

const runProjectMatrix = process.env.E2E_PROJECT_MATRIX === "1";
const reporters = [["list"]];
if (process.env.E2E_HTML_REPORT === "1") {
  reporters.push(["html", { open: "never" }]);
}
const chromiumRuntime = resolveBrowserRuntime().launchOptions;
const connectWsEndpoint = String(process.env.PW_TEST_CONNECT_WS_ENDPOINT || "").trim();
const connectOptions = connectWsEndpoint ? { wsEndpoint: connectWsEndpoint } : undefined;
const ffmpegPath =
  process.platform === "win32" && process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\ms-playwright\\ffmpeg-1011\\ffmpeg-win64.exe`
    : "";
const videoMode = process.platform === "win32" && ffmpegPath && !existsSync(ffmpegPath) ? "off" : "retain-on-failure";
const projects = [
  {
    name: "desktop-chromium",
    testIgnore: "**/mobile-browser-matrix.spec.js",
    use: { ...devices["Desktop Chrome"], ...chromiumRuntime },
  },
];

if (runProjectMatrix) {
  projects.push(
    {
      name: "tablet-chromium",
      testIgnore: "**/mobile-browser-matrix.spec.js",
      use: { ...devices["iPad Pro 11"], browserName: "chromium", ...chromiumRuntime },
    },
    {
      name: "mobile-chromium",
      testIgnore: "**/mobile-browser-matrix.spec.js",
      use: { ...devices["Pixel 5"], ...chromiumRuntime },
    },
    {
      name: "matrix-chromium",
      testMatch: "**/mobile-browser-matrix.spec.js",
      use: { browserName: "chromium", viewport: { width: 1280, height: 720 }, ...chromiumRuntime },
    },
    {
      name: "matrix-firefox",
      testMatch: "**/mobile-browser-matrix.spec.js",
      use: { browserName: "firefox", viewport: { width: 1280, height: 720 } },
    },
    {
      name: "matrix-webkit",
      testMatch: "**/mobile-browser-matrix.spec.js",
      use: { browserName: "webkit", viewport: { width: 1280, height: 720 } },
    }
  );
}

export default defineConfig({
  testDir: "./e2e/specs",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: reporters,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5173",
    connectOptions,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: videoMode,
  },
  projects,
});
