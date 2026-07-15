import fs from "node:fs";
import path from "node:path";

import { test } from "@playwright/test";


export function ensureScreenshotDir() {
  const configured = String(process.env.E2E_SCREENSHOT_DIR || "").trim();
  const dir = configured
    ? path.resolve(configured)
    : path.resolve("output", "playwright", "e2e-flow");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function semanticCaptureIdentity(testInfo, captureLabel) {
  const project = String(testInfo?.project?.name || "").trim();
  const file = String(testInfo?.file || "").trim();
  const line = Number(testInfo?.line || 0);
  const label = String(captureLabel || "").trim();
  const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
  const titlePath = Array.isArray(testInfo?.titlePath)
    ? testInfo.titlePath.slice(1).map((title) => String(title))
    : [];
  if (!project || !file || line <= 0 || !label || !relative || relative.startsWith("../") || !titlePath.length) {
    throw new Error("active Playwright test identity is incomplete");
  }
  return {
    test_id: `${project}::${relative}:${line}::${titlePath.join(" › ")}`,
    capture_label: label,
  };
}

function activeSemanticIdentity(name) {
  try {
    return semanticCaptureIdentity(test.info(), name);
  } catch {
    return null;
  }
}

export async function capture(page, name) {
  const screenshotDir = ensureScreenshotDir();
  const namespace = ["E2E_RUN_ID", "E2E_WORKER_ID", "E2E_JOB_ID"]
    .map((key) => String(process.env[key] || "").trim())
    .filter(Boolean)
    .join("-");
  const namespacedName = namespace ? `${namespace}-${name}` : name;
  const outputPath = path.join(screenshotDir, `${Date.now()}-${namespacedName}.png`);
  const expectationJournal = String(process.env.E2E_EVIDENCE_EXPECTATIONS_FILE || "").trim();
  if (expectationJournal) {
    const semantic = activeSemanticIdentity(name);
    const record = semantic
      ? { version: 2, kind: "screenshot", filename: path.basename(outputPath), ...semantic }
      : { version: 1, kind: "screenshot", filename: path.basename(outputPath) };
    fs.mkdirSync(path.dirname(expectationJournal), { recursive: true });
    fs.appendFileSync(expectationJournal, `${JSON.stringify(record)}\n`, "utf8");
  }
  try {
    await page.screenshot({
      path: outputPath,
      fullPage: false,
      animations: "disabled",
      timeout: 15_000,
    });
  } catch {
    await page.screenshot({
      path: outputPath,
      fullPage: false,
      animations: "disabled",
      timeout: 15_000,
    });
  }
  return outputPath;
}
