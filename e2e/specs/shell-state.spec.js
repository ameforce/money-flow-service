import { expect, test } from "@playwright/test";

import { assertResponsiveShell, registerAndVerify, unique } from "../support/helpers";

test("shell tab state persists after page reload", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("shell-state-user")}@example.com`;
  const displayName = unique("shell-state-name");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);

  const settingsTabButton = page.getByRole("button", { name: "설정", exact: true });
  await settingsTabButton.click();
  await expect(page.getByRole("heading", { name: "가계 설정" })).toBeVisible();

  await page.reload();
  await page.waitForLoadState("networkidle");
  await assertResponsiveShell(page);
  await expect(settingsTabButton).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "가계 설정" })).toBeVisible();
});
