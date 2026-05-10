import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicHolding,
  createBasicTransaction,
  expectKeyboardReachableInOrder,
  expectNoHorizontalOverflow,
  expectWithinViewport,
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
  const incomeMemo = unique("dashboard-income");

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

  await createBasicTransaction(page, { memo: txMemo, amount: "12000", flowType: "expense" });
  await createBasicTransaction(page, { memo: incomeMemo, amount: "34000", flowType: "income" });
  await createBasicHolding(page, { name: holdingName });

  await page.getByRole("button", { name: "대시보드", exact: true }).click();
  await assertResponsiveShell(page);
  await expect(page.getByRole("button", { name: "새로고침" })).toBeVisible();
  await expect(page.getByRole("button", { name: "시세 갱신" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "요약" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "월별 흐름" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "포트폴리오" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "가져오기 & 상태" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "협업 멤버" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "최근 거래" })).toBeVisible();
  const dashboardPortfolioCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "포트폴리오" }),
  });
  const dashboardPortfolioSelect = dashboardPortfolioCard.getByLabel("포트폴리오 보기 기준");
  const dashboardCenterLabel = dashboardPortfolioCard.getByTestId("portfolio-donut-center-label");
  const dashboardSliceLabels = dashboardPortfolioCard.getByTestId("portfolio-donut-slice-label");
  if ((await dashboardPortfolioSelect.count()) > 0) {
    await expect(dashboardPortfolioSelect).toHaveValue("transaction_flow");
    await expect(dashboardPortfolioCard.locator(".portfolio-view-summary")).toHaveCount(0);
    await expect(dashboardSliceLabels).toHaveCount(2);
    await expect(dashboardSliceLabels.first()).toContainText("%");
    await dashboardPortfolioSelect.selectOption("transaction_flow");
    await expect(dashboardPortfolioCard).not.toContainText("보기 기준");
    await expect(dashboardCenterLabel).toBeVisible();
    await expect(dashboardCenterLabel).toContainText("분포");
    await expect(dashboardCenterLabel).not.toContainText("%");
    await expect(dashboardCenterLabel).toHaveAttribute("aria-label", /포트폴리오 비중/);

    await openTab(page, "자산");
    const holdingSummaryCard = page.locator("details.holding-summary-card").first();
    await expect(holdingSummaryCard).toBeVisible();
    const assetsPortfolioSelect = holdingSummaryCard.getByLabel("자산 포트폴리오 보기 기준");
    const assetsCenterLabel = holdingSummaryCard.getByTestId("portfolio-donut-center-label");
    await expect(assetsPortfolioSelect).toHaveValue("holding_category");
    await expect(holdingSummaryCard).toContainText("보유 카테고리 비중");
    await expect(assetsCenterLabel).toBeVisible();
    await expect(assetsCenterLabel).toContainText("분포");
    await expect(assetsCenterLabel).not.toContainText("%");

    await assetsPortfolioSelect.selectOption("transaction_category");
    await expect(holdingSummaryCard).toContainText("거래 카테고리 비중");
    await expect(assetsCenterLabel).toContainText("분포");

    await openTab(page, "대시보드");
    await expect(dashboardPortfolioSelect).toHaveValue("transaction_flow");
    await expect(dashboardPortfolioCard).not.toContainText("보기 기준");
    await expect(dashboardCenterLabel).toContainText("분포");
    await capture(page, "dashboard-portfolio-view-sync");
  }
  await capture(page, "dashboard-summary-result");

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "대시보드");
  await page.evaluate(() => window.scrollTo(0, 0));
  await assertResponsiveShell(page);
  await expectNoHorizontalOverflow(page, 12);
  await expectWithinViewport(page.getByRole("button", { name: "새로고침" }));
  await expectWithinViewport(page.getByRole("button", { name: "시세 갱신" }));
  await expect(page.locator(".dashboard-hero-card")).toBeVisible();
  const mobileFilterCard = page.locator(".dashboard-filter-card");
  await expect(mobileFilterCard).toBeVisible();
  await expect(mobileFilterCard.getByRole("button", { name: "조회 적용" })).toHaveCount(0);
  await mobileFilterCard.getByRole("button", { name: "기간" }).click();
  await expect(mobileFilterCard.getByRole("button", { name: "조회 적용" })).toHaveCount(0);
  await expect(mobileFilterCard.locator('input[type="date"]')).toHaveCount(2);
  await expectNoHorizontalOverflow(page, 12);
  await mobileFilterCard.getByRole("button", { name: "월별" }).click();
  await expect(page.getByRole("heading", { name: "가져오기 & 상태" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "협업 멤버" })).toHaveCount(0);
  const mobileTopbarBox = await page.locator("header.topbar").boundingBox();
  const mobileTopbarActions = await page.locator(".topbar-actions button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { height: box.height, width: box.width };
    }),
  );
  const mobileGlobalMessage = page.locator("main.app-shell > .message, .app-content > .message").first();
  const mobileGlobalMessageVisible = await mobileGlobalMessage.isVisible().catch(() => false);
  if (mobileGlobalMessageVisible) {
    await expect(mobileGlobalMessage).toHaveCSS("position", "fixed");
  }
  const mobilePortfolioBox = await dashboardPortfolioCard.boundingBox();
  const mobileHeroBox = await page.locator(".dashboard-hero-card").boundingBox();
  const mobileFilterBox = await page.locator(".dashboard-filter-card").boundingBox();
  expect(mobileTopbarBox, "mobile topbar should have a bounding box").not.toBeNull();
  expect(mobileTopbarActions.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
  expect(mobileFilterBox, "mobile monthly report card should have a bounding box").not.toBeNull();
  expect(mobilePortfolioBox, "mobile portfolio card should have a bounding box").not.toBeNull();
  expect(mobileHeroBox, "mobile hero card should have a bounding box").not.toBeNull();
  expect(mobileTopbarBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(88);
  expect(mobileFilterBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(mobileHeroBox?.y ?? 0);
  expect(mobileHeroBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(mobilePortfolioBox?.y ?? 0);
  await capture(page, "dashboard-mobile-summary");

  if ((await dashboardPortfolioSelect.count()) > 0) {
    await dashboardPortfolioCard.scrollIntoViewIfNeeded();
    await expectWithinViewport(dashboardPortfolioSelect);
    await dashboardPortfolioSelect.selectOption("transaction_flow");
    await expect(dashboardPortfolioCard).not.toContainText("보기 기준");
    await expect(dashboardSliceLabels).toHaveCount(2);
    await expect(dashboardSliceLabels.first()).toContainText("%");
    await expectWithinViewport(dashboardCenterLabel);
    await expectKeyboardReachableInOrder(page, [
      page.getByRole("button", { name: "새로고침" }),
      page.getByRole("button", { name: "시세 갱신" }),
      dashboardPortfolioSelect,
    ]);
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, "dashboard-mobile-portfolio-sync");
  }
});
