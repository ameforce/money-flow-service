import { expect, test } from "@playwright/test";

import {
  capture,
  createTransactionViaApi,
  currentE2EHistoryDateIso,
  expectNoHorizontalOverflow,
  labeledField,
  openTab,
  bootstrapVerifiedSession,
  unique,
} from "../support/helpers";

function installAdvancingDateMock(page, isoInstant) {
  return page.addInitScript((startIso) => {
    const OriginalDate = Date;
    const startReal = OriginalDate.now();
    const startMock = OriginalDate.parse(startIso);

    class AdvancingMockDate extends OriginalDate {
      constructor(...args) {
        if (args.length === 0) {
          super(startMock + (OriginalDate.now() - startReal));
        } else {
          super(...args);
        }
      }

      static now() {
        return startMock + (OriginalDate.now() - startReal);
      }
    }

    AdvancingMockDate.parse = OriginalDate.parse;
    AdvancingMockDate.UTC = OriginalDate.UTC;
    Object.setPrototypeOf(AdvancingMockDate, OriginalDate);
    window.Date = AdvancingMockDate;
  }, isoInstant);
}

test("issue #265: transaction tab rolls local date at midnight and refreshes the current monthly ledger", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const monthlyRequests = [];
  let historyRequestCount = 0;
  await page.route("**/api/v1/transactions/history**", async (route) => {
    historyRequestCount += 1;
    await route.continue();
  });
  await page.route("**/api/v1/transactions?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/api/v1/transactions") && route.request().method() === "GET") {
      monthlyRequests.push({
        year: url.searchParams.get("year"),
        month: url.searchParams.get("month"),
      });
    }
    await route.continue();
  });

  const email = `${unique("tx-midnight-rollover")}@example.com`;
  const displayName = unique("tx-midnight-rollover-name");
  await bootstrapVerifiedSession(page, { email, displayName });
  await installAdvancingDateMock(page, "2026-07-31T14:59:55.500Z");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await expect.poll(() => monthlyRequests.some((request) => request.year === "2026" && request.month === "7")).toBe(true);

  await page.getByTestId("transactions-fab").click();
  const sheet = page.getByTestId("transaction-entry-sheet");
  await expect(sheet).toBeVisible();
  const dateInput = labeledField(sheet, "일자", "input");
  await expect(dateInput).toHaveValue("2026-07-31");

  await expect.poll(async () => dateInput.inputValue(), { timeout: 8_000 }).toBe("2026-08-01");
  await expect.poll(() => monthlyRequests.some((request) => request.year === "2026" && request.month === "8"), {
    timeout: 8_000,
  }).toBe(true);
  await expect(page.locator(".transaction-list-card").first().getByLabel("월")).toHaveValue("8");

  const rolloverMemo = unique("tx-midnight-visible-row");
  await page.getByTestId("transaction-quick-amount").fill("12345");
  await labeledField(sheet, "메모", "input").fill(rolloverMemo);
  await page.getByTestId("transaction-quick-save").click();
  await expect(page.locator("tr.transaction-row", { hasText: rolloverMemo }).first()).toBeVisible({
    timeout: 30_000,
  });
  expect(historyRequestCount, "monthly transaction tab should not call retired history API").toBe(0);
  await expectNoHorizontalOverflow(page, 12);
});

test("issues #265/#268: transaction tab opens at latest rows and price refresh preserves scroll", async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.route("**/api/v1/prices/refresh", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, in_progress: false, updated: 0, failed: 0 }),
    });
  });

  const email = `${unique("tx-latest-anchor")}@example.com`;
  const displayName = unique("tx-latest-anchor-name");
  const memoPrefix = unique("tx-latest-anchor-row");
  const anchorMemo = `${memoPrefix}-scroll-anchor`;
  const latestMemo = `${memoPrefix}-latest`;

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 540 });

  const currentLedgerDate = currentE2EHistoryDateIso();
  for (let index = 34; index > 0; index -= 1) {
    await createTransactionViaApi(page, {
      memo: index === 14 ? anchorMemo : `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(20_000 + index),
      occurredOn: currentLedgerDate,
      ownerName: displayName,
    });
  }
  await createTransactionViaApi(page, {
    memo: latestMemo,
    amount: "77777",
    occurredOn: currentLedgerDate,
    ownerName: displayName,
  });

  await page.reload();
  await openTab(page, "거래");
  const latestRow = page.locator("tr.transaction-row", { hasText: latestMemo }).first();
  await expect(latestRow).toBeVisible({ timeout: 30_000 });

  const beforeRefresh = await page.evaluate((memo) => {
    const row = Array.from(document.querySelectorAll("tr.transaction-row")).find((candidate) =>
      candidate.textContent?.includes(memo)
    );
    const box = row?.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
      rowBottom: box?.bottom ?? 0,
      viewportHeight: window.innerHeight,
    };
  }, latestMemo);
  expect(beforeRefresh.scrollY, `latest row should require and keep bottom-oriented scroll: ${JSON.stringify(beforeRefresh)}`).toBeGreaterThan(0);
  expect(beforeRefresh.rowBottom, `latest row should stay visible: ${JSON.stringify(beforeRefresh)}`).toBeLessThanOrEqual(
    beforeRefresh.viewportHeight + 1
  );

  await expect(latestRow).toBeVisible();
  await capture(page, "transactions-latest-anchor");
  await expectNoHorizontalOverflow(page, 8);

  const anchorRow = page.locator("tr.transaction-row", { hasText: anchorMemo }).first();
  await expect(anchorRow).toBeVisible({ timeout: 30_000 });
  await anchorRow.evaluate((row) => row.scrollIntoView({ block: "center", inline: "nearest" }));

  const before = await page.evaluate((memo) => {
    const row = Array.from(document.querySelectorAll("tr.transaction-row")).find((candidate) =>
      candidate.textContent?.includes(memo)
    );
    const box = row?.getBoundingClientRect();
    return { scrollY: window.scrollY, rowTop: box?.top ?? 0 };
  }, anchorMemo);
  expect(before.scrollY, `setup should place the ledger away from the page top: ${JSON.stringify(before)}`).toBeGreaterThan(0);
  await page.evaluate((snapshot) => {
    window.__txRefreshScrollBefore = snapshot.scrollY;
    window.__txRefreshRowTopBefore = snapshot.rowTop;
  }, before);

  const refreshResponse = page.waitForResponse(
    (response) => response.url().includes("/api/v1/prices/refresh") && response.status() === 200
  );
  await page.locator(".topbar-price-refresh-action").evaluate((button) => button.click());
  await refreshResponse;

  await expect.poll(async () => {
    return page.evaluate((memo) => {
      const row = Array.from(document.querySelectorAll("tr.transaction-row")).find((candidate) =>
        candidate.textContent?.includes(memo)
      );
      const box = row?.getBoundingClientRect();
      return Math.max(
        Math.abs(window.scrollY - window.__txRefreshScrollBefore),
        Math.abs((box?.top ?? 0) - window.__txRefreshRowTopBefore)
      );
    }, anchorMemo);
  }).toBeLessThanOrEqual(2);
});
