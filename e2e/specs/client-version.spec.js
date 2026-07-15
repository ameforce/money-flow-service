import { expect, test } from "@playwright/test";

import { assertResponsiveShell, capture, bootstrapVerifiedSession, unique } from "../support/helpers";

test("issue #282: open mobile tab surfaces reload CTA after server client version changes", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });

  let latestVersion = "0.0.0";
  await page.route("**/api/v1/system/client-version", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
        pragma: "no-cache",
        expires: "0",
      },
      body: JSON.stringify({ version: latestVersion }),
    });
  });

  const email = `${unique("client-version-user")}@example.com`;
  const displayName = unique("client-version-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await assertResponsiveShell(page);
  await expect(page.locator(".client-version-chip")).toHaveCount(0);

  latestVersion = "99.0.0";
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  const updateChip = page.locator(".client-version-chip");
  await expect(updateChip).toBeVisible();
  await expect(updateChip).toContainText("새 버전");
  await expect(page.getByRole("button", { name: "새 버전 적용" })).toBeVisible();
  await capture(page, "issue-282-client-version-update");
});
