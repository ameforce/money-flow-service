import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicHolding,
  createBasicTransaction,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

test("dashboard flow: onboarding, portfolio coherence, summary visibility", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("dashboard-user")}@example.com`;
  const displayName = unique("dashboard-name");
  const holdingName = unique("dashboard-holding");
  const txMemo = unique("dashboard-tx");

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

  await createBasicTransaction(page, { memo: txMemo });
  await createBasicHolding(page, { name: holdingName });

  await page.getByRole("button", { name: "대시보드", exact: true }).click();
  await assertResponsiveShell(page);
  await expect(page.getByRole("button", { name: "새로고침" })).toBeVisible();
  await expect(page.getByRole("button", { name: "시세 갱신" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "요약" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "월별 흐름" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "포트폴리오" })).toBeVisible();
  const dashboardPortfolioCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "포트폴리오" }),
  });
  const dashboardPortfolioSelect = dashboardPortfolioCard.getByLabel("포트폴리오 보기 기준");
  const dashboardCenterLabel = dashboardPortfolioCard.getByTestId("portfolio-donut-center-label");
  if ((await dashboardPortfolioSelect.count()) > 0) {
    await dashboardPortfolioSelect.selectOption("transaction_flow");
    await expect(dashboardPortfolioCard).toContainText("거래 유형 비중");
    await expect(dashboardCenterLabel).toBeVisible();
    await expect(dashboardCenterLabel).toContainText("%");
    await expect(dashboardCenterLabel).toHaveAttribute("aria-label", /포트폴리오 비중/);

    await openTab(page, "자산");
    const holdingSummaryCard = page.locator("details.holding-summary-card").first();
    await expect(holdingSummaryCard).toBeVisible();
    const assetsPortfolioSelect = holdingSummaryCard.getByLabel("자산 포트폴리오 보기 기준");
    const assetsCenterLabel = holdingSummaryCard.getByTestId("portfolio-donut-center-label");
    await expect(assetsPortfolioSelect).toHaveValue("transaction_flow");
    await expect(holdingSummaryCard).toContainText("거래 유형 비중");
    await expect(assetsCenterLabel).toBeVisible();
    await expect(assetsCenterLabel).toContainText("%");

    await assetsPortfolioSelect.selectOption("transaction_category");
    await expect(holdingSummaryCard).toContainText("거래 카테고리 비중");
    await expect(assetsCenterLabel).toContainText("%");

    await openTab(page, "대시보드");
    await expect(dashboardPortfolioSelect).toHaveValue("transaction_category");
    await expect(dashboardPortfolioCard).toContainText("거래 카테고리 비중");
    await expect(dashboardCenterLabel).toContainText("%");
    await capture(page, "dashboard-portfolio-view-sync");
  }
  await capture(page, "dashboard-summary-result");
});
