import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  capture,
  createTransactionViaApi,
  labeledField,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const NAV_TABS = ["대시보드", "거래", "자산", "설정", "협업", "데이터 가져오기"];
const MOBILE_PROFILES = [
  { name: "mobile-320x568", width: 320, height: 568, font: "Malgun Gothic", touch: true },
  { name: "landscape-568x320", width: 568, height: 320, font: "Malgun Gothic", touch: true },
  { name: "mobile-360x800", width: 360, height: 800, font: "Noto Sans KR", touch: true },
  { name: "landscape-800x360", width: 800, height: 360, font: "Noto Sans KR", touch: true },
  { name: "mobile-390x844", width: 390, height: 844, font: "Apple SD Gothic Neo", touch: true },
  { name: "landscape-844x390", width: 844, height: 390, font: "Apple SD Gothic Neo", touch: true },
  { name: "mobile-412x915", width: 412, height: 915, font: "Noto Sans KR", touch: true },
  { name: "landscape-915x412", width: 915, height: 412, font: "Noto Sans KR", touch: true },
  { name: "tablet-768x1024", width: 768, height: 1024, font: "Noto Sans KR", touch: true },
  { name: "tablet-1024x768", width: 1024, height: 768, font: "Noto Sans KR", touch: true },
];
const DESKTOP_PROFILES = [
  { name: "desktop-1280x720", width: 1280, height: 720, font: "Malgun Gothic", touch: false },
  { name: "desktop-1440x900", width: 1440, height: 900, font: "Malgun Gothic", touch: false },
];
const ORIENTATION_PAIRS = {
  chromium: [{ width: 412, height: 915 }, { width: 915, height: 412 }],
  firefox: [{ width: 360, height: 800 }, { width: 800, height: 360 }],
  webkit: [{ width: 390, height: 844 }, { width: 844, height: 390 }],
};
const CRITICAL_SELECTORS = {
  대시보드: ".dashboard-filter-card button, .dashboard-filter-card input",
  거래: "[data-testid='transactions-fab'], [data-testid='transactions-desktop-add-action'], .month-stepper button, .month-stepper input",
  자산: "[data-testid='holdings-fab']",
  설정: ".settings-profile-card input, .settings-profile-card button",
  협업: "#collaboration-household-select, .collaboration-command-card input, .collaboration-command-card button",
  "데이터 가져오기": ".import-excel-panel button, .import-mode-panel button",
};
const MOBILE_USER_AGENTS = {
  chromium: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  firefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  webkit: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};
const TESTED_SHA = process.env.GITHUB_SHA || process.env.GIT_COMMIT || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const EVIDENCE_METADATA_BY_TEST = new Map();

test.afterEach(async ({}, testInfo) => {
  const metadataPaths = EVIDENCE_METADATA_BY_TEST.get(testInfo.testId) || [];
  const result = testInfo.status === testInfo.expectedStatus ? "passed" : "failed";
  for (const metadataPath of metadataPaths) {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    writeFileSync(metadataPath, `${JSON.stringify({ ...metadata, result }, null, 2)}\n`, "utf8");
  }
  EVIDENCE_METADATA_BY_TEST.delete(testInfo.testId);
});

async function newMatrixPage(browser, browserName, profile) {
  const mobile = Boolean(profile.touch);
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5173",
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: mobile ? 2 : 1,
    hasTouch: mobile,
    ...(mobile && browserName !== "firefox" ? { isMobile: true } : {}),
    ...(mobile ? { userAgent: MOBILE_USER_AGENTS[browserName] } : {}),
  });
  return { context, page: await context.newPage() };
}

async function captureFinding(page, testInfo, findingId, scenario, assertions) {
  const screenshotPath = await capture(page, `${testInfo.project.name}-${scenario}`);
  const viewport = page.viewportSize();
  const orientation = viewport && viewport.width > viewport.height ? "landscape" : "portrait";
  const evidenceDir = path.resolve(".omo", "evidence", "mobile-uiux-v0.1.49", findingId);
  const artifactStem = `${Date.now()}-${testInfo.project.name}-${scenario}`.replace(/[^a-zA-Z0-9._-]+/gu, "-");
  const evidenceScreenshot = path.join(evidenceDir, `${artifactStem}.png`);
  mkdirSync(evidenceDir, { recursive: true });
  copyFileSync(screenshotPath, evidenceScreenshot);
  const metadataPath = path.join(evidenceDir, `${artifactStem}.json`);
  writeFileSync(metadataPath, `${JSON.stringify({
    schemaVersion: 1,
    findingId,
    testedSha: TESTED_SHA,
    command: "npm run e2e:matrix",
    browser: testInfo.project.name.replace("matrix-", ""),
    viewport,
    orientation,
    scenario,
    assertions,
    result: "pending",
    artifact: path.basename(evidenceScreenshot),
    capturedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  const metadataPaths = EVIDENCE_METADATA_BY_TEST.get(testInfo.testId) || [];
  metadataPaths.push(metadataPath);
  EVIDENCE_METADATA_BY_TEST.set(testInfo.testId, metadataPaths);
}

async function applyFont(page, font) {
  await page.addStyleTag({
    content: `html, body, button, input, select, textarea { font-family: "${font}", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif !important; }`,
  });
}

async function expectZeroHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(metrics, `${label} must have zero horizontal overflow`).toEqual({ body: 0, document: 0 });
}

async function expectCriticalTargets(page, tabLabel, profile) {
  if (!profile.touch) return;
  const collectRenderedTargets = (elements) =>
    elements
      .map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          height: box.height,
          label: element.getAttribute("aria-label") || element.textContent?.replace(/\s+/g, " ").trim() || element.id,
          rendered: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
          width: box.width,
        };
      })
      .filter((target) => target.rendered);
  const surfaceTargets = await page.locator(CRITICAL_SELECTORS[tabLabel]).evaluateAll(collectRenderedTargets);
  const chromeTargets = await page.locator("nav.topbar-tabs button, header.topbar .topbar-actions button").evaluateAll(collectRenderedTargets);
  expect(surfaceTargets.length, `${tabLabel}/${profile.name} should expose tab-specific critical controls`).toBeGreaterThan(0);
  const targets = [...chromeTargets, ...surfaceTargets];
  expect(
    targets.filter((target) => target.width < 44 || target.height < 44),
    `${tabLabel}/${profile.name} critical targets must be at least 44x44px: ${JSON.stringify(targets)}`
  ).toEqual([]);
}

async function expectNoAxeViolations(page, label) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).include("body").analyze();
  const violations = results.violations.map((violation) => ({
    help: violation.help,
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.slice(0, 5).map((node) => node.target),
  }));
  expect(violations, `${label} axe violations: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
}

async function expectOrientation(page, orientation) {
  await expect.poll(() => page.evaluate((value) => matchMedia(`(orientation: ${value})`).matches, orientation)).toBe(true);
}

async function assertOrientationState(page, expected) {
  await expect(page.getByRole("button", { name: "거래", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("tr.transaction-row", { hasText: expected.rowMemo }).first()).toHaveAttribute("data-row-selected", "true");
  await expect(page.locator(".transaction-list-card").first().getByLabel("월")).toHaveValue(expected.pendingMonth);
  await expect(page.getByTestId("transaction-month-pending-status")).toBeVisible();
  const sheet = page.getByTestId("transaction-entry-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("transaction-quick-amount")).toHaveValue(expected.amount);
  const memoInput = labeledField(sheet, "메모", "input");
  await expect(memoInput).toHaveValue(expected.draftMemo);
  await expect(memoInput).toBeFocused();
  await expectZeroHorizontalOverflow(page, expected.label);
}

test("cross-browser mobile matrix traverses core screens without layout or accessibility regressions", async ({ browser, browserName }, testInfo) => {
  test.setTimeout(600_000);
  for (const profileGroup of [MOBILE_PROFILES, DESKTOP_PROFILES]) {
    const auditProfile = profileGroup[0];
    const { context, page } = await newMatrixPage(browser, browserName, auditProfile);
    try {
      await page.goto("/");
      await applyFont(page, auditProfile.font);
      await expect(page.locator("form.auth-card")).toBeVisible();
      await expectZeroHorizontalOverflow(page, `${browserName}/${auditProfile.name}/auth`);
      await expectNoAxeViolations(page, `${browserName}/${auditProfile.name}/auth`);
      await captureFinding(page, testInfo, "MUI-004", `auth-${auditProfile.name}`, ["engine-matrix", "zero-overflow", "axe"]);

      await registerAndVerify(page, {
        email: `${unique(`matrix-${browserName}-${auditProfile.name}`)}@example.com`,
        displayName: unique(`matrix-${browserName}-${auditProfile.name}-name`),
      });

      for (const profile of profileGroup) {
        await test.step(profile.name, async () => {
          await page.setViewportSize({ width: profile.width, height: profile.height });
          await applyFont(page, profile.font);
          for (const tabLabel of NAV_TABS) {
            await openTab(page, tabLabel);
            await expect(page.getByRole("button", { name: tabLabel, exact: true }).first()).toHaveAttribute("aria-current", "page");
            await expectZeroHorizontalOverflow(page, `${browserName}/${profile.name}/${tabLabel}`);
            await expectCriticalTargets(page, tabLabel, profile);
            if (profile === auditProfile) await expectNoAxeViolations(page, `${browserName}/${tabLabel}`);
          }
          await captureFinding(page, testInfo, "MUI-004", `${profile.name}-core-final`, [
            "engine-matrix",
            "zero-overflow",
            ...(profile.touch ? ["target-size-44"] : []),
          ]);
        });
      }
    } finally {
      await context.close();
    }
  }

  const auditProfile = MOBILE_PROFILES.find((profile) => profile.width === 390 && profile.height === 844);
  const { context, page } = await newMatrixPage(browser, browserName, auditProfile);
  try {
    await registerAndVerify(page, {
      email: `${unique(`matrix-dialog-${browserName}`)}@example.com`,
      displayName: unique(`matrix-dialog-${browserName}-name`),
    });
    await openTab(page, "거래");
    await page.getByTestId("transactions-fab").click();
    await expectNoAxeViolations(page, `${browserName}/transaction-entry-sheet`);
    await captureFinding(page, testInfo, "MUI-004", "transaction-sheet-interaction", ["engine-matrix", "dialog-axe"]);
    await page.getByTestId("transaction-entry-sheet-close").click();

    await openTab(page, "자산");
    await page.getByTestId("holdings-fab").click();
    await expectNoAxeViolations(page, `${browserName}/holding-entry-sheet`);
    await captureFinding(page, testInfo, "MUI-004", "holding-sheet-final", ["engine-matrix", "dialog-axe"]);
    await captureFinding(page, testInfo, "MUI-004", "matrix-complete", ["matrix-complete"]);
  } finally {
    await context.close();
  }
});

test("portrait-landscape transition preserves transaction task state", async ({ browser, browserName }, testInfo) => {
  test.setTimeout(240_000);
  const [portrait, landscape] = ORIENTATION_PAIRS[browserName];
  const rowMemo = unique(`matrix-orientation-row-${browserName}`);
  const draftMemo = unique(`matrix-orientation-draft-${browserName}`);
  const amount = "123,456";

  const { context, page } = await newMatrixPage(browser, browserName, { ...portrait, touch: true });
  try {
    await registerAndVerify(page, {
      email: `${unique(`matrix-orientation-${browserName}`)}@example.com`,
      displayName: unique(`matrix-orientation-${browserName}-name`),
    });
  await createTransactionViaApi(page, { memo: rowMemo, amount: "77777" });
  await page.reload();
  await openTab(page, "거래");

  const row = page.locator("tr.transaction-row", { hasText: rowMemo }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.focus();
  await page.keyboard.press("Shift+Space");
  await expect(row).toHaveAttribute("data-row-selected", "true");

  const monthInput = page.locator(".transaction-list-card").first().getByLabel("월");
  const currentMonth = Number(await monthInput.inputValue());
  const pendingMonth = String(currentMonth === 1 ? 2 : currentMonth - 1);
  await monthInput.fill(pendingMonth);
  await expect(page.getByTestId("transaction-month-pending-status")).toBeVisible();

  await page.getByTestId("transactions-fab").click();
  const sheet = page.getByTestId("transaction-entry-sheet");
  await sheet.getByTestId("transaction-quick-amount").fill(amount.replace(",", ""));
  const memoInput = labeledField(sheet, "메모", "input");
  await memoInput.fill(draftMemo);
  await memoInput.focus();

  const expected = { amount, draftMemo, pendingMonth, rowMemo };
  await expectOrientation(page, "portrait");
  await assertOrientationState(page, { ...expected, label: `${browserName}/portrait-before` });
    await captureFinding(page, testInfo, "MUI-004", "orientation-portrait-before", ["engine-matrix", "orientation-state-preservation"]);

  await page.setViewportSize(landscape);
  await expectOrientation(page, "landscape");
  await assertOrientationState(page, { ...expected, label: `${browserName}/landscape` });
    await captureFinding(page, testInfo, "MUI-004", "orientation-landscape", ["engine-matrix", "orientation-state-preservation"]);

  await page.setViewportSize(portrait);
  await expectOrientation(page, "portrait");
  await assertOrientationState(page, { ...expected, label: `${browserName}/portrait-after` });
    await captureFinding(page, testInfo, "MUI-004", "orientation-portrait-after", ["engine-matrix", "orientation-state-preservation"]);
  } finally {
    await context.close();
  }
});
