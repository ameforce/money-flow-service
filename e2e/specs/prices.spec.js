import { expect, test } from "@playwright/test";

import { assertResponsiveShell, capture, registerAndVerify, unique } from "../support/helpers";

test("prices flow: refresh action and status endpoint", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("price-user")}@example.com`;
  const displayName = unique("price-name");

  await registerAndVerify(page, { email, displayName });
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
