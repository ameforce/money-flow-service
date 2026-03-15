import { expect, test } from "@playwright/test";

import { assertResponsiveShell, capture, registerAndVerify, unique } from "../support/helpers";

test("dashboard flow: onboarding, tab transition, summary visibility", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("dashboard-user")}@example.com`;
  const displayName = unique("dashboard-name");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);

  await expect(page.getByRole("button", { name: "대시보드", exact: true })).toHaveClass(/active/);
  await expect(page.locator(".onboarding-guide")).toBeVisible();
  await capture(page, "dashboard-onboarding-entry");

  await page.getByRole("button", { name: "바로 입력하기" }).click();
  await expect(page.getByRole("button", { name: "거래", exact: true })).toHaveClass(/active/);
  await expect(page.locator(".tx-entry-banner")).toBeVisible();
  await capture(page, "dashboard-onboarding-to-transactions");

  await page.getByRole("button", { name: "대시보드", exact: true }).click();
  await assertResponsiveShell(page);
  await expect(page.getByRole("button", { name: "새로고침" })).toBeVisible();
  await expect(page.getByRole("button", { name: "시세 갱신" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "요약" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "월별 흐름" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "포트폴리오" })).toBeVisible();
  await capture(page, "dashboard-summary-result");
});
