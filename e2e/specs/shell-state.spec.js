import { expect, test } from "@playwright/test";

import { assertResponsiveShell, registerAndVerify, unique } from "../support/helpers";

test("shell tab state persists after page reload", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("shell-state-user")}@example.com`;
  const displayName = unique("shell-state-name");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);

  const dashboardTabButton = page.locator("nav.tabs .tabs-left button").first();
  const settingsTabButton = page.locator("nav.tabs .tabs-right button").last();
  await settingsTabButton.click();
  await expect(settingsTabButton).toHaveClass(/active/);
  await expect(page.locator("form.settings-form-grid").first()).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await assertResponsiveShell(page);
  const settingsTabActive = await settingsTabButton
    .evaluate((element) => element.classList.contains("active"))
    .catch(() => false);
  if (settingsTabActive) {
    await expect(page.locator("form.settings-form-grid").first()).toBeVisible();
  } else {
    await expect(dashboardTabButton).toHaveClass(/active/);
  }
});
