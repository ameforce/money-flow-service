import { defineConfig, devices } from "@playwright/test";

const runProjectMatrix = process.env.E2E_PROJECT_MATRIX === "1";
const reporters = [["list"]];
if (process.env.E2E_HTML_REPORT === "1") {
  reporters.push(["html", { open: "never" }]);
}
const projects = [
  {
    name: "desktop-chromium",
    use: { ...devices["Desktop Chrome"] },
  },
];

if (runProjectMatrix) {
  projects.push(
    {
      name: "tablet-chromium",
      use: { ...devices["iPad Pro 11"], browserName: "chromium" },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
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
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects,
});
