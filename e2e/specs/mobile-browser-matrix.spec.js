import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  capture,
  createHoldingViaApi,
  createTransactionViaApi,
  expectDonutLabelsCenteredOnRing,
  expectDonutLabelsInsideChart,
  expectDonutTextNotClipped,
  expectPortfolioLabelsClearOfBottomNav,
  labeledField,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const TARGET_SIZE_EPSILON_PX = 0.001;
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
  자산: "[data-testid='holdings-fab'], .holding-entry-card .work-surface-header button",
  설정: ".settings-profile-card input, .settings-profile-card button",
  협업: "#collaboration-household-select, .collaboration-command-card input, .collaboration-command-card button",
  "데이터 가져오기": ".import-excel-panel button, .import-mode-panel button",
};
const MOBILE_USER_AGENTS = {
  chromium: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  firefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  webkit: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};
const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]:visible",
  "button:not([disabled]):visible",
  "input:not([disabled]):visible",
  "select:not([disabled]):visible",
  "textarea:not([disabled]):visible",
  "[tabindex]:not([tabindex='-1']):visible",
].join(", ");
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

async function newMatrixPage(browser, browserName, profile, { blockServiceWorkers = false } = {}) {
  const mobile = Boolean(profile.touch);
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:5173",
    ...(blockServiceWorkers ? { serviceWorkers: "block" } : {}),
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

async function expectBrandSubtitleOnOneLine(page, label) {
  const subtitle = page.locator(".nav-brand small");
  await expect(subtitle, `${label} brand subtitle should be visible`).toBeVisible();
  const metrics = await subtitle.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const lineTops = new Set(
      Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => Math.round(rect.top * 10) / 10)
    );
    return {
      clientWidth: element.clientWidth,
      lineCount: lineTops.size,
      scrollWidth: element.scrollWidth,
      text: element.textContent?.trim() || "",
    };
  });
  expect(metrics.lineCount, `${label} brand subtitle must not leave a CJK orphan line: ${JSON.stringify(metrics)}`).toBe(1);
  expect(metrics.scrollWidth, `${label} brand subtitle must fit its available width: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.clientWidth + 1
  );
}

async function expectCriticalTargets(page, tabLabel, profile) {
  if (!profile.touch) return;
  if (tabLabel === "거래") {
    const transactionScroller = page.locator(".transactions-surface-scroll").first();
    const metrics = await transactionScroller.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      tabIndex: element.getAttribute("tabindex"),
    }));
    expect(
      metrics.scrollWidth,
      `${profile.name} transaction ledger must preserve its overflow-free layout contract: ${JSON.stringify(metrics)}`
    ).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.tabIndex, `${profile.name} overflow-free transaction ledger must not add an inert keyboard stop`).toBeNull();
  }
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
    targets.filter((target) => target.width + TARGET_SIZE_EPSILON_PX < 44 || target.height + TARGET_SIZE_EPSILON_PX < 44),
    `${tabLabel}/${profile.name} critical targets must be at least 44x44px: ${JSON.stringify(targets)}`
  ).toEqual([]);
}

async function expectMinimumTargetSize(locator, label) {
  const metrics = await locator.evaluateAll((elements) =>
    elements
      .map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          height: box.height,
          label: element.getAttribute("aria-label") || element.textContent?.replace(/\s+/g, " ").trim() || "",
          rendered: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
          width: box.width,
        };
      })
      .filter((target) => target.rendered)
  );
  expect(metrics.length, `${label} should expose rendered targets`).toBeGreaterThan(0);
  expect(
    metrics.filter((target) => target.width + TARGET_SIZE_EPSILON_PX < 44 || target.height + TARGET_SIZE_EPSILON_PX < 44),
    `${label} targets must be at least 44x44px: ${JSON.stringify(metrics)}`
  ).toEqual([]);
}

async function expectMinimumControlFontSize(locator, label, { renderedOnly = true } = {}) {
  if (renderedOnly) {
    await locator.first().scrollIntoViewIfNeeded();
    await expect(locator.first(), `${label} should render its first form control`).toBeVisible();
  } else {
    await expect(locator.first(), `${label} should expose its first form control`).toBeAttached();
  }
  const metrics = await locator.evaluateAll((elements, shouldFilterRendered) =>
    elements
      .map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          label: element.getAttribute("aria-label") || element.textContent?.replace(/\s+/g, " ").trim() || element.id,
          rendered: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
        };
      })
      .filter((control) => !shouldFilterRendered || control.rendered),
    renderedOnly
  );
  expect(metrics.length, `${label} should expose applicable form controls`).toBeGreaterThan(0);
  expect(
    metrics.filter((control) => control.fontSize < 16),
    `${label} form control text must be at least 16px: ${JSON.stringify(metrics)}`
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

async function expectModalFocusWrap(page, modal, label) {
  const focusables = modal.locator(MODAL_FOCUSABLE_SELECTOR);
  const count = await focusables.count();
  expect(count, `${label} should expose at least two focusable controls`).toBeGreaterThanOrEqual(2);
  const first = focusables.first();
  const last = focusables.last();

  await last.focus();
  await expect(last, `${label} should allow focusing its last control`).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first, `${label} Tab should wrap from the last control to the first`).toBeFocused();

  await first.focus();
  await expect(first, `${label} should allow focusing its first control`).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last, `${label} Shift+Tab should wrap from the first control to the last`).toBeFocused();
}

async function expectElementInert(locator, label) {
  const inertState = await locator.evaluate((element) => {
    let current = element;
    while (current) {
      if (current.hasAttribute("inert")) {
        return { inert: true, tagName: current.tagName, testId: current.getAttribute("data-testid") || "" };
      }
      current = current.parentElement;
    }
    return { inert: false, tagName: "", testId: "" };
  });
  expect(inertState.inert, `${label} should be isolated behind an inert ancestor: ${JSON.stringify(inertState)}`).toBe(true);
}

async function expectBackgroundInert(page, modal, label) {
  await expectElementInert(page.locator("header.topbar"), `${label} topbar`);
  await expectElementInert(page.locator("nav.topbar-tabs"), `${label} primary navigation`);
  await page.locator("header.topbar .topbar-actions button").first().evaluate((element) => element.focus());
  const activeElementState = await modal.evaluate((element) => ({
    activeTestId: document.activeElement?.getAttribute("data-testid") || "",
    activeTagName: document.activeElement?.tagName || "",
    modalOwnsFocus: element.contains(document.activeElement),
  }));
  expect(activeElementState.modalOwnsFocus, `${label} background focus attempt must stay inside the modal: ${JSON.stringify(activeElementState)}`).toBe(true);
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
          if (profile.width === 1024 && profile.height === 768) {
            await expectBrandSubtitleOnOneLine(page, `${browserName}/${profile.name}`);
            await captureFinding(page, testInfo, "MUI-007", "tablet-1024x768-brand-subtitle", [
              "brand-subtitle-single-line",
              "no-cjk-orphan",
              "no-overflow",
            ]);
          }
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
            ...(profile.width === 1024 && profile.height === 768 ? ["brand-subtitle-single-line"] : []),
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

test("MUI-006 transaction sheet owns keyboard focus and restores its trigger", async ({ browser, browserName }, testInfo) => {
  test.setTimeout(120_000);
  const profile = MOBILE_PROFILES.find((candidate) => candidate.width === 390 && candidate.height === 844);
  const { context, page } = await newMatrixPage(browser, browserName, profile);
  try {
    await registerAndVerify(page, {
      email: `${unique(`mui-006-transaction-${browserName}`)}@example.com`,
      displayName: unique(`mui-006-transaction-${browserName}-name`),
    });
    await openTab(page, "거래");
    const trigger = page.getByTestId("transactions-fab");
    await trigger.click();

    const sheet = page.getByTestId("transaction-entry-sheet");
    const amountInput = sheet.getByTestId("transaction-quick-amount");
    await expect(sheet).toBeVisible();
    await expect(amountInput, `${browserName} transaction amount should receive initial focus`).toBeFocused();
    await captureFinding(page, testInfo, "MUI-006", "transaction-modal-initial-focus", [
      "initial-focus",
      "background-inert",
      "focus-trap",
      "return-focus",
    ]);

    await expectBackgroundInert(page, sheet, `${browserName} transaction sheet`);
    await expectModalFocusWrap(page, sheet, `${browserName} transaction sheet`);
    await captureFinding(page, testInfo, "MUI-006", "transaction-modal-focus-wrap", ["tab-wrap", "shift-tab-wrap"]);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger, `${browserName} transaction sheet should restore its FAB trigger`).toBeFocused();
    await captureFinding(page, testInfo, "MUI-006", "transaction-modal-return-focus", ["escape-close", "trigger-focus-restored"]);
  } finally {
    await context.close();
  }
});

test("MUI-006 holding sheet owns keyboard focus and restores its trigger", async ({ browser, browserName }, testInfo) => {
  test.setTimeout(120_000);
  const profile = MOBILE_PROFILES.find((candidate) => candidate.width === 390 && candidate.height === 844);
  const { context, page } = await newMatrixPage(browser, browserName, profile);
  try {
    await registerAndVerify(page, {
      email: `${unique(`mui-006-holding-${browserName}`)}@example.com`,
      displayName: unique(`mui-006-holding-${browserName}-name`),
    });
    await openTab(page, "자산");
    const trigger = page.getByTestId("holdings-fab");
    await trigger.click();

    const sheet = page.getByTestId("holding-entry-sheet");
    const nameInput = labeledField(sheet, "자산명", "textarea");
    await expect(sheet).toBeVisible();
    await expect(nameInput, `${browserName} holding name should receive initial focus`).toBeFocused();
    await captureFinding(page, testInfo, "MUI-006", "holding-modal-initial-focus", [
      "initial-focus",
      "background-inert",
      "focus-trap",
      "return-focus",
    ]);

    await expectBackgroundInert(page, sheet, `${browserName} holding sheet`);
    await expectModalFocusWrap(page, sheet, `${browserName} holding sheet`);
    await captureFinding(page, testInfo, "MUI-006", "holding-modal-focus-wrap", ["tab-wrap", "shift-tab-wrap"]);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(trigger, `${browserName} holding sheet should restore its FAB trigger`).toBeFocused();
    await captureFinding(page, testInfo, "MUI-006", "holding-modal-return-focus", ["escape-close", "trigger-focus-restored"]);
  } finally {
    await context.close();
  }
});

test("MUI-006 dirty sheet keeps the nested alertdialog topmost", async ({ browser, browserName }, testInfo) => {
  test.setTimeout(120_000);
  const profile = MOBILE_PROFILES.find((candidate) => candidate.width === 390 && candidate.height === 844);
  const { context, page } = await newMatrixPage(browser, browserName, profile);
  try {
    await registerAndVerify(page, {
      email: `${unique(`mui-006-nested-${browserName}`)}@example.com`,
      displayName: unique(`mui-006-nested-${browserName}-name`),
    });
    await openTab(page, "거래");
    const trigger = page.getByTestId("transactions-fab");
    await trigger.click();

    const sheet = page.getByTestId("transaction-entry-sheet");
    const closeButton = sheet.getByTestId("transaction-entry-sheet-close");
    const amountInput = sheet.getByTestId("transaction-quick-amount");
    await amountInput.fill("12345");
    await closeButton.click();

    const dialog = page.getByRole("alertdialog");
    const cancelButton = dialog.getByRole("button", { name: "취소" });
    await expect(dialog.getByRole("heading", { name: "거래 입력을 닫을까요?" })).toBeVisible();
    await expect(cancelButton, `${browserName} nested confirm should focus the non-destructive action`).toBeFocused();
    await expectElementInert(sheet, `${browserName} parent transaction sheet`);
    await amountInput.evaluate((element) => element.focus());
    await expect(cancelButton, `${browserName} parent focus attempt must remain in the nested confirm`).toBeFocused();
    await expectModalFocusWrap(page, dialog, `${browserName} nested confirm`);
    await captureFinding(page, testInfo, "MUI-006", "nested-confirm-topmost", [
      "non-destructive-initial-focus",
      "parent-inert",
      "topmost-focus-trap",
    ]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(amountInput).toHaveValue("12,345");
    await expect(closeButton, `${browserName} nested confirm should restore its invoking close button`).toBeFocused();
    await captureFinding(page, testInfo, "MUI-006", "nested-confirm-escape-return", [
      "escape-closes-topmost-only",
      "draft-preserved",
      "invoker-focus-restored",
    ]);

    await closeButton.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "입력 닫기" }).click();
    await expect(sheet).toBeHidden();
    await expect(trigger, `${browserName} confirmed sheet close should restore the transaction FAB`).toBeFocused();
    await captureFinding(page, testInfo, "MUI-006", "nested-confirm-final-return", ["confirmed-close", "parent-trigger-focus-restored"]);
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

test("W1 MUI-001 keeps user zoom enabled in Chromium and WebKit", async ({ browser, browserName }, testInfo) => {
  test.skip(!["chromium", "webkit"].includes(browserName), "Zoom evidence is required for Chromium and WebKit.");
  const { context, page } = await newMatrixPage(browser, browserName, {
    width: 390,
    height: 844,
    touch: true,
  });
  try {
    await page.goto("/");
    const viewportContract = await page.locator('meta[name="viewport"]').getAttribute("content");
    const directives = new Map(
      String(viewportContract || "")
        .split(",")
        .map((entry) => entry.trim().split("=").map((part) => part.trim().toLowerCase()))
        .filter(([key]) => key)
    );
    expect(directives.get("user-scalable"), "viewport must not disable user scaling").not.toBe("no");
    const maximumScale = Number.parseFloat(directives.get("maximum-scale") || "");
    expect(
      Number.isNaN(maximumScale) || maximumScale >= 5,
      `viewport maximum-scale must be absent or at least 5: ${viewportContract}`
    ).toBe(true);
    const touchAction = await page.locator("html").evaluate((element) => getComputedStyle(element).touchAction);
    expect(
      touchAction === "auto" || touchAction === "manipulation" || touchAction.split(/\s+/u).includes("pinch-zoom"),
      `root touch-action must preserve pinch zoom: ${touchAction}`
    ).toBe(true);
    await captureFinding(page, testInfo, "MUI-001", `${browserName}-zoom`, ["zoom-enabled"]);
  } finally {
    await context.close();
  }
});

test("W1 MUI-005 keeps short-landscape form text at 16px in WebKit", async ({ browser, browserName }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(browserName !== "webkit", "The iOS focus-zoom regression is verified in WebKit.");
  const profiles = [
    { width: 915, height: 412 },
    { width: 844, height: 390 },
  ];
  const authenticatedSurfaces = [
    { label: "dashboard filters", tab: "대시보드", selector: ".dashboard-filter-card :is(input, select, textarea)" },
    { label: "settings", tab: "설정", selector: ".settings-profile-card :is(input, select, textarea), #settings-household-select" },
    { label: "collaboration", tab: "협업", selector: ".collaboration-command-card :is(input, select, textarea)" },
  ];

  for (const profile of profiles) {
    const { context, page } = await newMatrixPage(
      browser,
      browserName,
      { ...profile, touch: true },
      { blockServiceWorkers: true }
    );
    try {
      await page.goto("/");
      await expectMinimumControlFontSize(
        page.locator("form.auth-card :is(input, select, textarea)"),
        `auth ${profile.width}x${profile.height}`
      );
      await captureFinding(page, testInfo, "MUI-005", "auth-form-text", ["font-size-16"]);

      await registerAndVerify(page, {
        email: `${unique(`w1-form-${profile.width}`)}@example.com`,
        displayName: unique(`w1-form-${profile.width}-name`),
      });
      for (const surface of authenticatedSurfaces) {
        await openTab(page, surface.tab);
        await expectMinimumControlFontSize(
          page.locator(surface.selector),
          `${surface.label} ${profile.width}x${profile.height}`,
          { renderedOnly: surface.renderedOnly !== false }
        );
        await captureFinding(
          page,
          testInfo,
          "MUI-005",
          `${surface.label.replaceAll(" ", "-")}-form-text`,
          ["font-size-16"]
        );
      }

      await page.route("**/api/v1/imports/workbook/upload?mode=dry_run", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            workbook_path: "w1-visible-controls.xlsx",
            sheets: 1,
            transaction_rows: 1,
            holding_rows: 0,
            applied_transactions: 0,
            applied_holdings_added: 0,
            applied_holdings_updated: 0,
            monthly_formula_mismatch_count: 0,
            detected_mismatch_cells: [],
            issues: [{ code: "MISSING_REQUIRED_VALUE", severity: "error", sheet: "거래내역", row: 1, message: "메모 확인 필요" }],
          }),
        });
      });
      await openTab(page, "데이터 가져오기");
      await page.getByLabel("엑셀 파일 업로드").setInputFiles({
        name: "w1-visible-controls.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from("w1-visible-controls"),
      });
      await page.getByRole("button", { name: "미리 검증", exact: true }).click();
      const importToolbarControls = page.locator(".import-report-toolbar :is(input, select, textarea)");
      await expectMinimumControlFontSize(
        importToolbarControls,
        `import report toolbar ${profile.width}x${profile.height}`
      );
      await captureFinding(page, testInfo, "MUI-005", "import-form-text", ["font-size-16", "visible-controls"]);
    } finally {
      await context.close();
    }
  }
});

test("W1 MUI-005 keeps 1024px touch form text readable without flattening hierarchy in WebKit", async ({ browser, browserName }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(browserName !== "webkit", "The tablet touch typography regression is verified in WebKit.");
  const profile = { width: 1024, height: 768, touch: true };
  const { context, page } = await newMatrixPage(browser, browserName, profile, { blockServiceWorkers: true });
  try {
    await page.goto("/");
    const touchCapability = await page.evaluate(() => ({
      anyPointerCoarse: window.matchMedia("(any-pointer: coarse)").matches,
      hoverNone: window.matchMedia("(hover: none)").matches,
      pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
    }));
    expect(
      touchCapability.anyPointerCoarse || touchCapability.pointerCoarse || touchCapability.hoverNone,
      `WebKit touch profile 1024x768 must activate a touch-capability media query: ${JSON.stringify(touchCapability)}`
    ).toBe(true);
    await expectMinimumControlFontSize(page.locator("form.auth-card :is(input, select, textarea)"), "auth 1024x768");

    await registerAndVerify(page, {
      email: `${unique("w1-tablet-form-1024")}@example.com`,
      displayName: unique("w1-tablet-form-1024-name"),
    });

    await openTab(page, "대시보드");
    await expectMinimumControlFontSize(
      page.locator(".dashboard-filter-card :is(input, select, textarea)"),
      "dashboard filters 1024x768"
    );
    await expectZeroHorizontalOverflow(page, "dashboard filters 1024x768");
    await captureFinding(page, testInfo, "MUI-005", "tablet-1024x768-dashboard-form-text", ["font-size-16", "no-overflow"]);

    await openTab(page, "거래");
    await page.getByTestId("transactions-desktop-add-action").click();
    const transactionSheet = page.getByTestId("transaction-entry-sheet");
    await expect(transactionSheet).toBeVisible();
    await expectMinimumControlFontSize(transactionSheet.locator(":is(input, select, textarea)"), "transaction entry 1024x768");
    const quickAmountFontSize = await transactionSheet.getByTestId("transaction-quick-amount").evaluate((input) =>
      Number.parseFloat(getComputedStyle(input).fontSize)
    );
    expect(quickAmountFontSize, "transaction amount must preserve its emphasized type hierarchy").toBeGreaterThanOrEqual(20);
    await expectZeroHorizontalOverflow(page, "transaction entry 1024x768");
    await captureFinding(page, testInfo, "MUI-005", "tablet-1024x768-transaction-entry-form-text", [
      "font-size-16",
      "amount-hierarchy",
      "no-overflow",
    ]);
    await page.getByTestId("transaction-entry-sheet-close").click();

    const transactionMemo = unique("w1-tablet-inline-editor");
    await createTransactionViaApi(page, { memo: transactionMemo });
    await page.reload();
    await openTab(page, "거래");
    const transactionRow = page.locator("tr.transaction-row", { hasText: transactionMemo }).first();
    await expect(transactionRow).toBeVisible();
    await transactionRow.locator(".transaction-col-memo").dblclick();
    const inlineEditor = page.locator("tr.transaction-inline-editor-row").first();
    await expect(inlineEditor).toBeVisible();
    await expectMinimumControlFontSize(inlineEditor.locator(":is(input, select, textarea)"), "transaction inline editor 1024x768");
    await expectZeroHorizontalOverflow(page, "transaction inline editor 1024x768");
    await captureFinding(page, testInfo, "MUI-005", "tablet-1024x768-transaction-inline-form-text", ["font-size-16", "no-overflow"]);
    await inlineEditor.getByRole("button", { name: "취소" }).click();

    await openTab(page, "자산");
    await page.locator(".holding-entry-card").getByRole("button", { name: "자산 추가" }).click();
    const holdingForm = page.locator(".holding-entry-card .holdings-form-grid");
    await expect(holdingForm).toBeVisible();
    await expectMinimumControlFontSize(holdingForm.locator(":is(input, select, textarea)"), "holding entry 1024x768");
    await expectZeroHorizontalOverflow(page, "holding entry 1024x768");
    await captureFinding(page, testInfo, "MUI-005", "tablet-1024x768-holding-entry-form-text", ["font-size-16", "no-overflow"]);

    await openTab(page, "설정");
    await expectMinimumControlFontSize(
      page.locator(".settings-profile-card :is(input, select, textarea), #settings-household-select"),
      "settings primary controls 1024x768"
    );
    const assetRules = page.locator("details.settings-asset-rules-card");
    await assetRules.locator("summary").click();
    await expect(assetRules).toHaveAttribute("open", "");
    await expectMinimumControlFontSize(assetRules.locator(":is(input, select, textarea)"), "settings asset rules 1024x768");
    await expectMinimumControlFontSize(
      page.locator(".category-manager-card :is(input, select, textarea)"),
      "settings category controls 1024x768"
    );
    await expectZeroHorizontalOverflow(page, "settings advanced controls 1024x768");
    await captureFinding(page, testInfo, "MUI-005", "tablet-1024x768-settings-form-text", ["font-size-16", "no-overflow"]);

    await openTab(page, "협업");
    await expectMinimumControlFontSize(
      page.locator(".collaboration-command-card :is(input, select, textarea)"),
      "collaboration 1024x768"
    );
    await expectZeroHorizontalOverflow(page, "collaboration 1024x768");
    await captureFinding(page, testInfo, "MUI-005", "tablet-1024x768-collaboration-form-text", ["font-size-16", "no-overflow"]);

    await page.route("**/api/v1/imports/workbook/upload?mode=dry_run", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          workbook_path: "w1-tablet-visible-controls.xlsx",
          sheets: 1,
          transaction_rows: 1,
          holding_rows: 0,
          applied_transactions: 0,
          applied_holdings_added: 0,
          applied_holdings_updated: 0,
          monthly_formula_mismatch_count: 0,
          detected_mismatch_cells: [],
          issues: [{ code: "MISSING_REQUIRED_VALUE", severity: "error", sheet: "거래내역", row: 1, message: "메모 확인 필요" }],
        }),
      });
    });
    await openTab(page, "데이터 가져오기");
    await page.getByLabel("엑셀 파일 업로드").setInputFiles({
      name: "w1-tablet-visible-controls.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("w1-tablet-visible-controls"),
    });
    await page.getByRole("button", { name: "미리 검증", exact: true }).click();
    const importToolbarControls = page.locator(".import-report-toolbar :is(input, select, textarea)");
    await expectMinimumControlFontSize(
      importToolbarControls,
      "import report toolbar 1024x768"
    );
    await expectZeroHorizontalOverflow(page, "import report controls 1024x768");
    await captureFinding(page, testInfo, "MUI-005", "tablet-1024x768-import-form-text", [
      "font-size-16",
      "visible-report-controls",
      "no-overflow",
    ]);

    await captureFinding(page, testInfo, "MUI-005", "tablet-1024x768-form-text", [
      "touch-capability",
      "font-size-16",
      "amount-hierarchy",
      "all-core-form-surfaces",
      "no-overflow",
    ]);
  } finally {
    await context.close();
  }
});

test("W1 status groups do not add inert keyboard stops", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Static status-group focus inventory runs once in Chromium.");
  const { context, page } = await newMatrixPage(browser, browserName, {
    width: 390,
    height: 844,
    touch: true,
  });
  try {
    await registerAndVerify(page, {
      email: `${unique("w1-status-groups")}@example.com`,
      displayName: unique("w1-status-groups-name"),
    });
    for (const tab of ["거래", "자산", "설정", "협업", "데이터 가져오기"]) {
      await openTab(page, tab);
      await expect(
        page.locator(".surface-control-strip[tabindex]"),
        `${tab} static status groups must not create inert tab stops`
      ).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

test("W1 MUI-007 exposes 44px core targets across mobile work surfaces", async ({ browser, browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "The target inventory runs once in the Chromium mobile lane.");
  const { context, page } = await newMatrixPage(browser, browserName, {
    width: 390,
    height: 844,
    touch: true,
  });
  const transactionMemo = unique("w1-target-transaction");
  const holdingName = unique("w1-target-holding");
  try {
    await registerAndVerify(page, {
      email: `${unique("w1-targets")}@example.com`,
      displayName: unique("w1-targets-name"),
    });
    await createTransactionViaApi(page, { memo: transactionMemo, amount: "44000" });
    await createHoldingViaApi(page, { name: holdingName });
    await page.reload();

    await openTab(page, "거래");
    const transactionRow = page.locator("tr.transaction-row", { hasText: transactionMemo }).first();
    await expect(transactionRow).toBeVisible();
    await transactionRow.focus();
    await page.keyboard.press("Shift+Space");
    await expect(transactionRow).toHaveAttribute("data-row-selected", "true");
    await expectMinimumTargetSize(page.locator(".transaction-selection-summary .transaction-selection-action"), "transaction selection");
    await captureFinding(page, testInfo, "MUI-007", "transaction-targets", ["target-size-44"]);

    await openTab(page, "자산");
    const holdingRow = page.locator("tr.holding-row", { hasText: holdingName }).first();
    await expect(holdingRow).toBeVisible();
    await expectMinimumTargetSize(holdingRow.locator(".mobile-toggle-btn"), "holding detail");
    await captureFinding(page, testInfo, "MUI-007", "holding-targets", ["target-size-44"]);

    await openTab(page, "설정");
    const assetRules = page.locator("details.settings-asset-rules-card").first();
    await assetRules.scrollIntoViewIfNeeded();
    if (!(await assetRules.evaluate((element) => element.hasAttribute("open")))) {
      await assetRules.locator("summary").click();
    }
    const assetRuleFields = assetRules.locator(".settings-form-grid :is(input:not([type='checkbox']), select)");
    await expectMinimumTargetSize(assetRuleFields, "settings asset rule fields");
    await expectMinimumTargetSize(assetRules.locator(".settings-type-order-btn"), "settings type order");
    await captureFinding(page, testInfo, "MUI-007", "settings-targets", ["target-size-44"]);

    await page.setViewportSize({ width: 844, height: 390 });
    await expectMinimumTargetSize(assetRuleFields, "short-landscape settings asset rule fields");
    await expectMinimumTargetSize(page.locator("nav.topbar-tabs button"), "landscape navigation");
    await captureFinding(page, testInfo, "MUI-007", "landscape-navigation-targets", ["target-size-44"]);

    await page.setViewportSize({ width: 915, height: 412 });
    await openTab(page, "설정");
    await expectMinimumTargetSize(assetRuleFields, "wide short-landscape settings asset rule fields");
    await openTab(page, "자산");
    const holdingSummaryCard = page.locator("details.holding-summary-card").first();
    const holdingSummary = holdingSummaryCard.locator("summary").first();
    await expect(holdingSummaryCard).toBeVisible();
    if (!(await holdingSummaryCard.evaluate((element) => element.hasAttribute("open")))) {
      await holdingSummary.click();
    }
    await holdingSummaryCard.getByLabel("자산 요약 보기 기준").selectOption("type");
    await expect(holdingSummaryCard.getByTestId("portfolio-donut-slice-label")).toHaveCount(1);
    await holdingSummary.click();
    await expect(holdingSummaryCard).not.toHaveAttribute("open", "");
    await holdingSummary.evaluate((summary) => {
      const summaryTop = window.scrollY + summary.getBoundingClientRect().top;
      window.scrollTo({ top: Math.max(0, summaryTop - window.innerHeight + 68), behavior: "auto" });
    });
    await holdingSummary.click();
    await expect(holdingSummaryCard).toHaveAttribute("open", "");
    await expectPortfolioLabelsClearOfBottomNav(
      page,
      holdingSummaryCard,
      "915x412 reopened holding portfolio chart"
    );
    await captureFinding(page, testInfo, "MUI-007", "holding-summary-landscape-clearance", [
      "short-landscape-compact",
      "bottom-nav-clearance",
    ]);

    await page.setViewportSize({ width: 1024, height: 768 });
    const navigationLineMetrics = await page.locator("nav.topbar-tabs .tab-label").evaluateAll((labels) =>
      labels.map((label) => {
        const style = getComputedStyle(label);
        const lineHeight = Number.parseFloat(style.lineHeight);
        return {
          label: label.textContent?.replace(/\s+/g, " ").trim(),
          lines: label.getBoundingClientRect().height / lineHeight,
        };
      })
    );
    expect(
      navigationLineMetrics.filter((metric) => metric.lines > 2.01),
      `tablet navigation labels must use at most two lines: ${JSON.stringify(navigationLineMetrics)}`
    ).toEqual([]);
    await captureFinding(page, testInfo, "MUI-007", "tablet-navigation-labels", ["maximum-two-lines"]);
  } finally {
    await context.close();
  }
});

test("W1 MUI-011 keeps the first dashboard task visible and charts readable in landscape", async ({ browser, browserName }, testInfo) => {
  const profiles = [
    { width: 800, height: 360 },
    { width: 844, height: 390 },
    { width: 915, height: 412 },
  ];
  const { context, page } = await newMatrixPage(browser, browserName, { ...profiles[0], touch: true });
  try {
    await registerAndVerify(page, {
      email: `${unique("w1-dashboard-landscape")}@example.com`,
      displayName: unique("w1-dashboard-landscape-name"),
    });
    await createTransactionViaApi(page, {
      memo: unique("w1-dashboard-income"),
      amount: "44000",
      flowType: "income",
    });
    await createHoldingViaApi(page, { name: unique("w1-dashboard-asset") });
    await createHoldingViaApi(page, {
      name: unique("w1-dashboard-investment"),
      category: "투자",
      assetType: "stock",
      typeKey: "stock",
      symbol: "W1LANDSCAPE",
      marketSymbol: "W1LANDSCAPE",
    });
    await page.reload();

    for (const profile of profiles) {
      await page.setViewportSize(profile);
      await openTab(page, "대시보드");
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
      const metrics = await page.evaluate(() => {
        const task = document.querySelector(".dashboard-filter-card");
        const lineChart = document.querySelector(".dashboard-line-chart-wrap");
        const donutChart = document.querySelector(".dashboard-donut-wrap");
        const nav = document.querySelector("nav.topbar-tabs");
        const taskBox = task?.getBoundingClientRect();
        const navBox = nav?.getBoundingClientRect();
        const lineBox = lineChart?.getBoundingClientRect();
        const donutBox = donutChart?.getBoundingClientRect();
        const sliceLabels = Array.from(document.querySelectorAll(".portfolio-donut-slice-label")).map((label) => ({
          fontSize: Number.parseFloat(getComputedStyle(label.querySelector("small") || label).fontSize),
          share: Number(label.dataset.donutShare),
          text: label.textContent?.replace(/\s+/g, " ").trim() || "",
        }));
        return {
          donutHeight: donutBox?.height ?? 0,
          lineHeight: lineBox?.height ?? 0,
          navTop: navBox?.top ?? window.innerHeight,
          sliceLabels,
          taskBottom: taskBox?.bottom ?? Number.POSITIVE_INFINITY,
          taskTop: taskBox?.top ?? Number.NEGATIVE_INFINITY,
        };
      });
      expect(metrics.taskTop, `${profile.width}x${profile.height} dashboard task must start in the viewport`).toBeGreaterThanOrEqual(0);
      expect(metrics.taskBottom, `${profile.width}x${profile.height} dashboard task must clear fixed navigation`).toBeLessThanOrEqual(metrics.navTop);
      expect(metrics.lineHeight, `${profile.width}x${profile.height} line chart must use a short-landscape budget`).toBeLessThanOrEqual(160);
      expect(metrics.donutHeight, `${profile.width}x${profile.height} donut chart must use a short-landscape budget`).toBeLessThanOrEqual(190);
      expect(metrics.sliceLabels.length, `${profile.width}x${profile.height} should exercise the equal-value two-slice geometry`).toBe(2);
      expect(
        metrics.sliceLabels.filter((label) => !Number.isFinite(label.share) || Math.abs(label.share - 50) > 0.01),
        `${profile.width}x${profile.height} should keep both clipping probes at 50%: ${JSON.stringify(metrics.sliceLabels)}`
      ).toEqual([]);
      expect(
        metrics.sliceLabels.filter((label) => label.fontSize < 11),
        `${profile.width}x${profile.height} slice labels must remain readable: ${JSON.stringify(metrics.sliceLabels)}`
      ).toEqual([]);
      const lineCard = page.locator(".dashboard-flow-card");
      const donutCard = page.locator(".dashboard-portfolio-card");
      await expect(lineCard.locator("canvas")).toBeVisible();
      await expect(donutCard.locator("canvas")).toBeVisible();
      await lineCard.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
      await capture(page, `${testInfo.project.name}-dashboard-landscape-${profile.width}x${profile.height}-line-chart`);
      await donutCard.locator(".dashboard-donut-wrap").evaluate((element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" })
      );
      const donutLabel = `${profile.width}x${profile.height} short-landscape dashboard donut`;
      await expectDonutTextNotClipped(donutCard.getByTestId("portfolio-donut-center-label"));
      await expectDonutTextNotClipped(donutCard.getByTestId("portfolio-donut-slice-label"));
      await expectDonutLabelsInsideChart(donutCard, donutLabel);
      await expectDonutLabelsCenteredOnRing(donutCard, donutLabel);
      await expectPortfolioLabelsClearOfBottomNav(page, donutCard, donutLabel);
      await captureFinding(page, testInfo, "MUI-011", "dashboard-landscape", [
        "first-task-visible",
        "chart-readable",
        "donut-text-not-clipped",
        "donut-ring-midpoint",
      ]);
      await capture(page, `${testInfo.project.name}-dashboard-landscape-${profile.width}x${profile.height}-donut-chart`);
    }
  } finally {
    await context.close();
  }
});
