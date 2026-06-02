import { expect, test } from "@playwright/test";

import {
  capture,
  createBasicHolding,
  createTransactionViaApi,
  expectNoHorizontalOverflow,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

const MOBILE_VIEWPORTS = [
  { name: "m320", width: 320, height: 568 },
  { name: "m360", width: 360, height: 780 },
  { name: "m390", width: 390, height: 844 },
  { name: "m414", width: 414, height: 896 },
];

async function readToggleMetrics(page, { selector, label }) {
  return page.locator(selector).first().evaluate((button, metricLabel) => {
    const box = button.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    const style = getComputedStyle(button);
    return {
      label: metricLabel,
      text: button.textContent?.replace(/\s+/g, " ").trim() || button.getAttribute("aria-label") || "",
      width: box.width,
      height: box.height,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      display: style.display,
      visibility: style.visibility,
      hitVisible: Boolean(topElement && (topElement === button || button.contains(topElement))),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, label);
}

test("issue 225: mobile transaction and holding detail toggles expose 44px hit targets", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("issue-225-touch")}@example.com`;
  const displayName = unique("issue-225-touch-owner");
  const txMemo = unique("issue-225-touch-transaction");
  const holdingName = unique("issue-225-touch-holding");

  await registerAndVerify(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo: txMemo,
    amount: "22500",
    ownerName: displayName,
  });
  await page.setViewportSize({ width: 1366, height: 960 });
  await createBasicHolding(page, {
    name: holdingName,
    category: unique("터치영역"),
    marketValue: "225000",
  });

  const allMetrics = [];
  for (const viewport of MOBILE_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    await openTab(page, "거래");
    const transactionRow = page.locator("tr.transaction-row", { hasText: txMemo }).first();
    await expect(transactionRow).toBeVisible();
    await transactionRow.scrollIntoViewIfNeeded();
    const transactionToggle = transactionRow.locator(".mobile-toggle-btn").first();
    await expect(transactionToggle).toBeVisible();
    allMetrics.push(
      await readToggleMetrics(page, {
        selector: `tr.transaction-row:has-text("${txMemo}") .mobile-toggle-btn`,
        label: `${viewport.name} transaction detail toggle`,
      })
    );
    await expectNoHorizontalOverflow(page, 12);

    await openTab(page, "자산");
    const holdingRow = page.locator("tr.holding-row", { hasText: holdingName }).first();
    await expect(holdingRow).toBeVisible();
    await holdingRow.scrollIntoViewIfNeeded();
    const holdingToggle = holdingRow.locator(".mobile-toggle-btn").first();
    await expect(holdingToggle).toBeVisible();
    allMetrics.push(
      await readToggleMetrics(page, {
        selector: `tr.holding-row:has-text("${holdingName}") .mobile-toggle-btn`,
        label: `${viewport.name} holding detail toggle`,
      })
    );
    await expectNoHorizontalOverflow(page, 12);
  }

  const undersizedTargets = allMetrics.filter((metric) => metric.width < 44 || metric.height < 44);
  const blockedCenters = allMetrics.filter((metric) => !metric.hitVisible);
  expect(undersizedTargets, `mobile row detail toggles should be at least 44x44px: ${JSON.stringify(allMetrics)}`).toEqual(
    []
  );
  expect(blockedCenters, `mobile row detail toggle centers should be directly tappable: ${JSON.stringify(allMetrics)}`).toEqual(
    []
  );
  await capture(page, "issue-225-mobile-row-detail-touch-targets");
});
