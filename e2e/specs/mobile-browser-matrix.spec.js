import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
const MATRIX_PROFILES = {
  chromium: [
    { name: "mobile-320x568", width: 320, height: 568, font: "Malgun Gothic", touch: true },
    { name: "mobile-360x800", width: 360, height: 800, font: "Noto Sans KR", touch: true },
    { name: "landscape-800x360", width: 800, height: 360, font: "Malgun Gothic", touch: true },
    { name: "mobile-412x915", width: 412, height: 915, font: "Noto Sans KR", touch: true },
    { name: "landscape-915x412", width: 915, height: 412, font: "Noto Sans KR", touch: true },
    { name: "tablet-768x1024", width: 768, height: 1024, font: "Noto Sans KR", touch: true },
    { name: "tablet-1024x768", width: 1024, height: 768, font: "Noto Sans KR", touch: true },
    { name: "desktop-1280x720", width: 1280, height: 720, font: "Malgun Gothic", touch: false },
    { name: "desktop-1440x900", width: 1440, height: 900, font: "Malgun Gothic", touch: false },
  ],
  firefox: [
    { name: "mobile-320x568", width: 320, height: 568, font: "Malgun Gothic", touch: true },
    { name: "mobile-360x800", width: 360, height: 800, font: "Noto Sans KR", touch: true },
    { name: "landscape-800x360", width: 800, height: 360, font: "Malgun Gothic", touch: true },
    { name: "desktop-1280x720", width: 1280, height: 720, font: "Malgun Gothic", touch: false },
    { name: "desktop-1440x900", width: 1440, height: 900, font: "Malgun Gothic", touch: false },
  ],
  webkit: [
    { name: "mobile-390x844", width: 390, height: 844, font: "Apple SD Gothic Neo", touch: true },
    { name: "landscape-844x390", width: 844, height: 390, font: "Apple SD Gothic Neo", touch: true },
    { name: "tablet-768x1024", width: 768, height: 1024, font: "Apple SD Gothic Neo", touch: true },
    { name: "tablet-1024x768", width: 1024, height: 768, font: "Apple SD Gothic Neo", touch: true },
  ],
};
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
  expect.soft(metrics, `${label} must have zero horizontal overflow`).toEqual({ body: 0, document: 0 });
}

async function expectCriticalTargets(page, tabLabel, profile) {
  if (!profile.touch) return;
  const selector = `nav.topbar-tabs button, header.topbar .topbar-actions button, ${CRITICAL_SELECTORS[tabLabel]}`;
  const targets = await page.locator(selector).evaluateAll((elements) =>
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
      .filter((target) => target.rendered)
  );
  expect.soft(targets.length, `${tabLabel}/${profile.name} should expose critical controls`).toBeGreaterThan(0);
  expect.soft(
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
  expect.soft(violations, `${label} axe violations: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
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

test("cross-browser mobile matrix traverses core screens without layout or accessibility regressions", async ({ browserName, page }, testInfo) => {
  test.setTimeout(600_000);
  const profiles = MATRIX_PROFILES[browserName];
  expect(profiles, `unsupported matrix browser ${browserName}`).toBeTruthy();
  const auditProfile = profiles.find((profile) => profile.width < profile.height) || profiles[0];

  await page.setViewportSize({ width: auditProfile.width, height: auditProfile.height });
  await page.goto("/");
  await applyFont(page, auditProfile.font);
  await expect(page.locator("form.auth-card")).toBeVisible();
  await expectZeroHorizontalOverflow(page, `${browserName}/auth`);
  await expectNoAxeViolations(page, `${browserName}/auth`);
  await capture(page, `${testInfo.project.name}-auth-${auditProfile.name}`);

  await registerAndVerify(page, {
    email: `${unique(`matrix-${browserName}`)}@example.com`,
    displayName: unique(`matrix-${browserName}-name`),
  });

  for (const profile of profiles) {
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
      await capture(page, `${testInfo.project.name}-${profile.name}-core-final`);
    });
  }

  await page.setViewportSize({ width: auditProfile.width, height: auditProfile.height });
  await openTab(page, "거래");
  await page.getByTestId("transactions-fab").click();
  await expectNoAxeViolations(page, `${browserName}/transaction-entry-sheet`);
  await capture(page, `${testInfo.project.name}-transaction-sheet-interaction`);
  await page.getByTestId("transaction-entry-sheet-close").click();

  await openTab(page, "자산");
  await page.getByTestId("holdings-fab").click();
  await expectNoAxeViolations(page, `${browserName}/holding-entry-sheet`);
  await capture(page, `${testInfo.project.name}-holding-sheet-final`);
});

test("portrait-landscape transition preserves transaction task state", async ({ browserName, page }, testInfo) => {
  test.setTimeout(240_000);
  const [portrait, landscape] = ORIENTATION_PAIRS[browserName];
  const rowMemo = unique(`matrix-orientation-row-${browserName}`);
  const draftMemo = unique(`matrix-orientation-draft-${browserName}`);
  const amount = "123,456";

  await page.setViewportSize(portrait);
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
  await capture(page, `${testInfo.project.name}-orientation-portrait-before`);

  await page.setViewportSize(landscape);
  await expectOrientation(page, "landscape");
  await assertOrientationState(page, { ...expected, label: `${browserName}/landscape` });
  await capture(page, `${testInfo.project.name}-orientation-landscape`);

  await page.setViewportSize(portrait);
  await expectOrientation(page, "portrait");
  await assertOrientationState(page, { ...expected, label: `${browserName}/portrait-after` });
  await capture(page, `${testInfo.project.name}-orientation-portrait-after`);
});
