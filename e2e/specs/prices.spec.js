import { expect, test } from "@playwright/test";

import { assertResponsiveShell, capture, bootstrapVerifiedSession, unique } from "../support/helpers";

const completePriceStatus = () => ({
  refresh_in_progress: false,
  refresh_finished_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  holdings_count: 0,
  tracked_holdings_count: 0,
  stale_count: 0,
  snapshot_count: 0,
});

test("prices flow: refresh action and status endpoint", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("price-user")}@example.com`;
  const displayName = unique("price-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  await capture(page, "prices-entry");

  const refreshButton = page.getByRole("button", { name: /시세 갱신/ });
  await expect(refreshButton).toBeVisible();
  await refreshButton.click();

  await expect(page.locator(".socket-chip")).toBeVisible();
  await expect(page.locator(".message", { hasText: /시세 갱신/ })).toHaveCount(0);

  const apiBaseUrl = String(process.env.E2E_API_BASE_URL || "").replace(/\/$/, "");
  const statusResp = await page.request.get(`${apiBaseUrl || ""}/api/v1/prices/status`);
  expect(statusResp.ok()).toBeTruthy();
  const statusPayload = await statusResp.json();
  expect(typeof statusPayload).toBe("object");
  await capture(page, "prices-result");
});

test("prices flow: status failure does not block unrelated refresh UI", async ({ page }) => {
  test.setTimeout(180_000);

  let failStatus = false;
  await page.route("**/api/v1/prices/status", async (route) => {
    if (failStatus) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "price status temporarily unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(completePriceStatus()),
    });
  });

  const email = `${unique("price-status-user")}@example.com`;
  const displayName = unique("price-status-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);

  failStatus = true;
  const statusFailure = page.waitForResponse((response) =>
    response.url().includes("/api/v1/prices/status") && response.status() === 503
  );
  await page.getByRole("button", { name: "새로고침" }).click();
  await statusFailure;
  await page.waitForTimeout(250);

  await expect(page.getByRole("button", { name: "시세 갱신" })).toBeEnabled();
  await expect(page.locator(".message", { hasText: /요청 처리 중 오류/ })).toHaveCount(0);
});

test("prices flow: polling failures release refresh lock", async ({ page }) => {
  test.setTimeout(180_000);

  let refreshStarted = false;
  await page.route("**/api/v1/prices/refresh", async (route) => {
    refreshStarted = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ in_progress: true }),
    });
  });
  await page.route("**/api/v1/prices/status", async (route) => {
    if (refreshStarted) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ detail: "price status temporarily unavailable" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(completePriceStatus()),
    });
  });

  const email = `${unique("price-poll-user")}@example.com`;
  const displayName = unique("price-poll-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);

  const refreshButton = page.getByRole("button", { name: /시세 갱신/ });
  const priceRefreshStatus = page.locator("#topbar-price-refresh-status");
  await expect(priceRefreshStatus).toContainText("시세 갱신 대기");
  await refreshButton.click();

  await expect(refreshButton).toHaveAccessibleName("시세 갱신");
  await expect(priceRefreshStatus).toContainText("시세 갱신 중");
  await expect(refreshButton).toBeEnabled({ timeout: 8_000 });
  await expect(priceRefreshStatus).toContainText("시세 갱신 대기");
  await expect(page.locator(".message", { hasText: /요청 처리 중 오류/ })).toHaveCount(0);
  await capture(page, "prices-polling-release");
});
