import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicHolding,
  createBasicTransaction,
  currentE2EHistoryDateIso,
  expectKeyboardReachableInOrder,
  expectNoHorizontalOverflow,
  expectWithinViewport,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

async function expectDonutTextNotClipped(labelLocator) {
  const metrics = await labelLocator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const labelBox = node.getBoundingClientRect();
      return {
        text: node.textContent?.replace(/\s+/g, " ").trim(),
        children: Array.from(node.children).map((child) => {
          const childBox = child.getBoundingClientRect();
          const style = getComputedStyle(child);
          return {
            topGap: childBox.top - labelBox.top,
            bottomGap: labelBox.bottom - childBox.bottom,
            fontSize: Number.parseFloat(style.fontSize) || 0,
            lineHeight: Number.parseFloat(style.lineHeight) || 0,
          };
        }),
      };
    }),
  );
  expect(metrics.length, "donut label should exist before checking clipping").toBeGreaterThan(0);
  for (const metric of metrics) {
    for (const child of metric.children) {
      expect(child.topGap, `${metric.text} should not clip at top`).toBeGreaterThanOrEqual(-1);
      expect(child.bottomGap, `${metric.text} should not clip at bottom`).toBeGreaterThanOrEqual(-1);
      if (child.fontSize > 0 && child.lineHeight > 0) {
        expect(child.lineHeight, `${metric.text} line-height should leave descender room`).toBeGreaterThanOrEqual(
          child.fontSize * 1.08,
        );
      }
    }
  }
}

async function readDashboardFilterLayout(filterCard) {
  return filterCard.evaluate((card) => {
    const mode = card.querySelector(".filter-modes-segmented")?.getBoundingClientRect();
    const inputs = card.querySelector(".filter-inputs-wrapper")?.getBoundingClientRect();
    const stepper = card.querySelector(".month-stepper")?.getBoundingClientRect();
    const range = card.querySelector(".range-picker")?.getBoundingClientRect();
    const dates = Array.from(card.querySelectorAll('input[type="date"]')).map((input) => input.getBoundingClientRect());
    const modeButtons = Array.from(card.querySelectorAll(".filter-modes-segmented button")).map((button) => {
      const buttonBox = button.getBoundingClientRect();
      return {
        leftInset: mode ? buttonBox.left - mode.left : 0,
        rightInset: mode ? mode.right - buttonBox.right : 0,
        topInset: mode ? buttonBox.top - mode.top : 0,
        bottomInset: mode ? mode.bottom - buttonBox.bottom : 0,
        height: buttonBox.height,
        width: buttonBox.width,
      };
    });
    const monthGroups = Array.from(card.querySelectorAll(".month-value-group")).map((group) => {
      const input = group.querySelector("input")?.getBoundingClientRect();
      const unit = group.querySelector("span")?.getBoundingClientRect();
      return {
        inputCenterY: input ? input.y + input.height / 2 : 0,
        unitCenterY: unit ? unit.y + unit.height / 2 : 0,
        inputHeight: input?.height ?? 0,
        unitHeight: unit?.height ?? 0,
      };
    });
    const stepperChildren = Array.from(card.querySelectorAll(".month-stepper .icon-btn, .month-stepper .text-btn, .month-stepper .date-inputs input")).map((item) => {
      const childBox = item.getBoundingClientRect();
      return {
        label: item.getAttribute("aria-label") || item.textContent?.trim() || item.tagName,
        height: childBox.height,
        topInset: stepper ? childBox.top - stepper.top : 0,
        bottomInset: stepper ? stepper.bottom - childBox.bottom : 0,
      };
    });
    const box = card.getBoundingClientRect();
    const modeStyle = mode ? getComputedStyle(card.querySelector(".filter-modes-segmented")) : null;
    const stepperStyle = stepper ? getComputedStyle(card.querySelector(".month-stepper")) : null;
    const rangeStyle = range ? getComputedStyle(card.querySelector(".range-picker")) : null;
    return {
      height: box.height,
      modeY: mode?.y ?? 0,
      inputsY: inputs?.y ?? 0,
      modeHeight: mode?.height ?? 0,
      stepperHeight: stepper?.height ?? 0,
      rangeHeight: range?.height ?? 0,
      modeCenterY: mode ? mode.y + mode.height / 2 : 0,
      stepperCenterY: stepper ? stepper.y + stepper.height / 2 : 0,
      rangeCenterY: range ? range.y + range.height / 2 : 0,
      dateYDelta: dates.length === 2 ? Math.abs(dates[0].y - dates[1].y) : 0,
      modeOuterInset: modeButtons.length
        ? {
            top: Math.min(...modeButtons.map((button) => button.topInset)),
            bottom: Math.min(...modeButtons.map((button) => button.bottomInset)),
            left: modeButtons[0].leftInset,
            right: modeButtons[modeButtons.length - 1].rightInset,
            minButtonHeight: Math.min(...modeButtons.map((button) => button.height)),
          }
        : null,
      monthGroups,
      stepperChildren,
      cardBoxShadow: getComputedStyle(card).boxShadow,
      modeBoxShadow: modeStyle?.boxShadow || "",
      stepperBoxShadow: stepperStyle?.boxShadow || "",
      rangeBoxShadow: rangeStyle?.boxShadow || "",
    };
  });
}

function expectMonthlyFilterLayout(layout) {
  expect(layout.height).toBeLessThanOrEqual(72);
  expect(Math.abs(layout.modeY - layout.inputsY)).toBeLessThanOrEqual(2);
  expect(Math.abs(layout.modeHeight - layout.stepperHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.modeCenterY - layout.stepperCenterY)).toBeLessThanOrEqual(1);
  expect(layout.cardBoxShadow).toBe("none");
  expect(layout.modeBoxShadow).toBe("none");
  expect(layout.stepperBoxShadow).toBe("none");
  expect(layout.modeOuterInset, "월별/기간 segmented buttons should stay clear of the outer border").toBeTruthy();
  expect(layout.modeOuterInset.top).toBeGreaterThanOrEqual(3.5);
  expect(layout.modeOuterInset.bottom).toBeGreaterThanOrEqual(3.5);
  expect(layout.modeOuterInset.left).toBeGreaterThanOrEqual(3.5);
  expect(layout.modeOuterInset.right).toBeGreaterThanOrEqual(3.5);
  expect(layout.modeOuterInset.minButtonHeight).toBeGreaterThanOrEqual(40);
  expect(layout.monthGroups.length).toBeGreaterThanOrEqual(2);
  expect(layout.stepperChildren.length).toBeGreaterThanOrEqual(5);
  for (const child of layout.stepperChildren) {
    expect(child.height, `${child.label} should keep a 40px mobile touch target`).toBeGreaterThanOrEqual(40);
    expect(child.topInset, `${child.label} should stay clear of the month-stepper top border`).toBeGreaterThanOrEqual(3.5);
    expect(child.bottomInset, `${child.label} should stay clear of the month-stepper bottom border`).toBeGreaterThanOrEqual(3.5);
  }
  for (const group of layout.monthGroups) {
    expect(Math.abs(group.inputCenterY - group.unitCenterY)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(group.inputHeight - group.unitHeight)).toBeLessThanOrEqual(4);
  }
}

function expectRangeFilterLayout(layout) {
  expect(layout.height).toBeLessThanOrEqual(72);
  expect(Math.abs(layout.modeY - layout.inputsY)).toBeLessThanOrEqual(2);
  expect(Math.abs(layout.modeHeight - layout.rangeHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.modeCenterY - layout.rangeCenterY)).toBeLessThanOrEqual(1);
  expect(layout.dateYDelta).toBeLessThanOrEqual(2);
  expect(layout.cardBoxShadow).toBe("none");
  expect(layout.modeBoxShadow).toBe("none");
  expect(layout.rangeBoxShadow).toBe("none");
  expect(layout.modeOuterInset, "월별/기간 segmented buttons should stay clear of the outer border").toBeTruthy();
  expect(layout.modeOuterInset.top).toBeGreaterThanOrEqual(3.5);
  expect(layout.modeOuterInset.bottom).toBeGreaterThanOrEqual(3.5);
  expect(layout.modeOuterInset.left).toBeGreaterThanOrEqual(3.5);
  expect(layout.modeOuterInset.right).toBeGreaterThanOrEqual(3.5);
  expect(layout.modeOuterInset.minButtonHeight).toBeGreaterThanOrEqual(40);
}

async function expectNoRefreshNoteLayoutShift(page, button, filterCard, label) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".dashboard-refresh-note")).toHaveCount(0);
  const topbar = page.locator("header.topbar");
  const beforeTopbar = await topbar.boundingBox();
  const beforePosition = await filterCard.evaluate((card) => {
    const box = card.getBoundingClientRect();
    return { viewportY: box.y, documentY: box.y + window.scrollY, scrollY: window.scrollY };
  });
  await expect(button, `${label} button should be enabled before click`).toBeEnabled();
  await expect(button, `${label} button should be visible before click`).toBeVisible();
  await button.evaluate((element) => element.click());
  await page.waitForTimeout(120);
  await expect(page.locator(".dashboard-refresh-note")).toHaveCount(0);
  const afterTopbar = await topbar.boundingBox();
  const afterPosition = await filterCard.evaluate((card) => {
    const box = card.getBoundingClientRect();
    return { viewportY: box.y, documentY: box.y + window.scrollY, scrollY: window.scrollY };
  });
  expect(
    Math.abs((afterTopbar?.height ?? 0) - (beforeTopbar?.height ?? 0)),
    `${label} should not resize the mobile topbar status surface`,
  ).toBeLessThanOrEqual(2);
  expect(Math.abs(afterPosition.documentY - beforePosition.documentY), `${label} should not push the dashboard document layout`).toBeLessThanOrEqual(2);
  expect(Math.abs(afterPosition.viewportY - beforePosition.viewportY), `${label} should not jump in the visible viewport`).toBeLessThanOrEqual(2);
  expect(Math.abs(afterPosition.scrollY - beforePosition.scrollY), `${label} should not force-scroll the page`).toBeLessThanOrEqual(2);
}

async function expectPressFeedback(page, button, label) {
  await expect(button, `${label} button should be visible before press feedback check`).toBeVisible();
  await expect(button, `${label} button should be enabled before press feedback check`).toBeEnabled();
  const before = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      transform: style.transform,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      transitionProperty: style.transitionProperty,
      transitionDuration: style.transitionDuration,
    };
  });
  const box = await button.boundingBox();
  expect(box, `${label} button should have a box before press feedback check`).not.toBeNull();
  await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  const pressed = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      transform: style.transform,
      backgroundColor: style.backgroundColor,
      boxShadow: style.boxShadow,
      transitionProperty: style.transitionProperty,
      transitionDuration: style.transitionDuration,
    };
  });
  await page.mouse.up();
  const changed =
    pressed.transform !== before.transform ||
    pressed.backgroundColor !== before.backgroundColor ||
    pressed.boxShadow !== before.boxShadow;
  const transitionsTransform = before.transitionProperty
    .split(",")
    .map((property) => property.trim())
    .includes("transform");
  const hasNonZeroTransition = before.transitionDuration
    .split(",")
    .some((duration) => Number.parseFloat(duration) > 0);
  expect(changed, `${label} should expose immediate visual press feedback`).toBeTruthy();
  expect(transitionsTransform && hasNonZeroTransition, `${label} should keep tactile transform animation configured`).toBeTruthy();
}

async function expectDonutLabelsCenteredOnRing(card, label) {
  const geometry = await card.getByTestId("portfolio-donut-slice-label").evaluateAll((nodes) =>
    nodes.map((node) => {
      const chart = node.closest(".portfolio-donut-slice-labels")?.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      if (!chart) {
        return { text: node.textContent?.replace(/\s+/g, " ").trim(), missingChart: true };
      }
      const centerX = chart.x + chart.width / 2;
      const centerY = chart.y + chart.height / 2;
      const labelX = box.x + box.width / 2;
      const labelY = box.y + box.height / 2;
      const dx = labelX - centerX;
      const dy = labelY - centerY;
      const actualRadius = (Math.sqrt(dx * dx + dy * dy) / (Math.min(chart.width, chart.height) / 2)) * 100;
      const actualAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const expectedAngle = Number(node.dataset.donutAngle || 0);
      const expectedRadius = Number(node.dataset.donutRadius || 0);
      const angleDelta = Math.abs((((actualAngle - expectedAngle + 540) % 360) - 180));
      return {
        text: node.textContent?.replace(/\s+/g, " ").trim(),
        actualRadius,
        expectedRadius,
        angleDelta,
      };
    }),
  );
  expect(geometry.length, `${label} should expose visible slice labels`).toBeGreaterThan(0);
  for (const item of geometry) {
    expect(item.missingChart, `${label} ${item.text} should be measured against a chart`).toBeFalsy();
    expect(Math.abs(item.actualRadius - item.expectedRadius), `${label} ${item.text} should sit on ring midpoint`).toBeLessThanOrEqual(2.6);
    expect(item.angleDelta, `${label} ${item.text} should sit on slice midpoint angle`).toBeLessThanOrEqual(2.6);
  }
}

async function expectDonutLabelsClearOfMobileNav(page, card, label) {
  const navBox = await page.locator(".topbar-tabs").boundingBox();
  if (!navBox) {
    return;
  }
  const labels = await card.getByTestId("portfolio-donut-slice-label").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        text: node.textContent?.replace(/\s+/g, " ").trim(),
        bottom: box.bottom,
      };
    }),
  );
  for (const item of labels) {
    expect(item.bottom, `${label} ${item.text} should not be hidden by the bottom navigation`).toBeLessThanOrEqual(
      navBox.y - 4,
    );
  }
}

async function applyFontFamily(page, fontFamily) {
  await page.evaluate((nextFontFamily) => {
    document.documentElement.style.setProperty("--mf-font-family", nextFontFamily);
  }, fontFamily);
}

test("dashboard flow: onboarding, portfolio coherence, summary visibility", async ({ page }, testInfo) => {
  test.setTimeout(180_000);

  const email = `${unique("dashboard-user")}@example.com`;
  const displayName = unique("dashboard-name");
  const holdingName = unique("dashboard-holding");
  const txMemo = unique("dashboard-tx");
  const incomeMemo = unique("dashboard-income");
  const previousMonthMemo = unique("dashboard-prev-month");
  const currentListIso = currentE2EHistoryDateIso();
  const previousMonthDate = new Date();
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  previousMonthDate.setDate(15);
  const previousMonthIso = previousMonthDate.toISOString().slice(0, 10);

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

  await createBasicTransaction(page, { memo: txMemo, amount: "12000", flowType: "expense", occurredOn: currentListIso });
  await createBasicTransaction(page, { memo: incomeMemo, amount: "34000", flowType: "income", occurredOn: currentListIso });
  await createBasicTransaction(page, {
    memo: previousMonthMemo,
    amount: "5600",
    flowType: "expense",
    occurredOn: previousMonthIso,
  });
  await createBasicHolding(page, { name: holdingName });

  await page.getByRole("button", { name: "대시보드", exact: true }).click();
  await assertResponsiveShell(page);
  await expect(page.getByRole("button", { name: "새로고침" })).toBeVisible();
  await expect(page.getByRole("button", { name: "시세 갱신" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "요약" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "월별 흐름" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "포트폴리오 및 거래내역 차트" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "가져오기 & 상태" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "협업 멤버" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "최근 거래" })).toBeVisible();
  const dashboardPortfolioCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "포트폴리오 및 거래내역 차트" }),
  });
  const dashboardPortfolioSelect = dashboardPortfolioCard.getByLabel("포트폴리오 보기 기준");
  const dashboardCenterLabel = dashboardPortfolioCard.getByTestId("portfolio-donut-center-label");
  const dashboardSliceLabels = dashboardPortfolioCard.getByTestId("portfolio-donut-slice-label");
  const gainKpiCard = page.locator(".dashboard-kpi-card", { hasText: "평가손익(KRW)" }).first();
  await expect(gainKpiCard.locator(".dashboard-kpi-value-meta")).toContainText(/[+-]\d+(\.\d+)?%/);
  if ((await dashboardPortfolioSelect.count()) > 0) {
    await expect(dashboardPortfolioSelect).toHaveValue("holding_type");
    await expect(dashboardPortfolioSelect.locator("option")).toHaveText(["자산 유형", "거래 유형"]);
    await expect(dashboardPortfolioCard.locator(".portfolio-view-summary")).toHaveCount(0);
    await expect(dashboardSliceLabels).toHaveCount(1);
    await expect(dashboardSliceLabels.first()).toContainText("%");
    await expect(dashboardCenterLabel).toContainText("총 자산");
    await expect(dashboardCenterLabel).not.toContainText("%");
    await expectDonutTextNotClipped(dashboardCenterLabel);
    await expectDonutTextNotClipped(dashboardSliceLabels);
    const assetTypeLabelBox = await dashboardSliceLabels.first().boundingBox();
    const dashboardChartBox = await dashboardPortfolioCard.locator(".dashboard-donut-wrap").boundingBox();
    expect(assetTypeLabelBox, "asset type label should have a bounding box").not.toBeNull();
    expect(dashboardChartBox, "dashboard donut chart should have a bounding box").not.toBeNull();
    expect(assetTypeLabelBox.y).toBeGreaterThanOrEqual(dashboardChartBox.y + 12);
    expect(assetTypeLabelBox.y + assetTypeLabelBox.height).toBeLessThanOrEqual(dashboardChartBox.y + dashboardChartBox.height - 12);
    await dashboardPortfolioSelect.selectOption("transaction_flow");
    await expect(dashboardCenterLabel).toBeVisible();
    await expect(dashboardCenterLabel).not.toContainText("분포");
    await expect(dashboardCenterLabel).toContainText(/\d{1,2}월 거래/);
    await expect(dashboardCenterLabel).not.toContainText("%");
    await expect(dashboardCenterLabel).toHaveAttribute("aria-label", /거래 유형/);
    await expectDonutTextNotClipped(dashboardCenterLabel);
    await expectDonutTextNotClipped(dashboardSliceLabels);

    await openTab(page, "자산");
    const holdingSummaryCard = page.locator("details.holding-summary-card").first();
    await expect(holdingSummaryCard).toBeVisible();
    const assetsCenterLabel = holdingSummaryCard.getByTestId("portfolio-donut-center-label");
    await expect(holdingSummaryCard.getByLabel("자산 포트폴리오 보기 기준")).toHaveCount(0);
    await expect(holdingSummaryCard.getByText("자산 포트폴리오 차트")).toBeVisible();
    await expect(holdingSummaryCard.getByRole("heading", { name: "자산 포트폴리오" })).toBeVisible();
    await expect(holdingSummaryCard).not.toContainText("총자산");
    await expect(holdingSummaryCard).not.toContainText("현재 보유 자산");
    await expect(holdingSummaryCard).not.toContainText("평가금액 기준");
    await expect(holdingSummaryCard).toContainText("현금성");
    await expect(holdingSummaryCard).not.toContainText("보유 카테고리 비중");
    await expect(holdingSummaryCard).not.toContainText("거래 카테고리 비중");
    await expect(holdingSummaryCard).not.toContainText("거래 유형 비중");
    await expect(holdingSummaryCard.locator(".compact-support-section .chart-wrap")).toHaveCount(1);
    await expect(holdingSummaryCard.getByTestId("holding-donut-slice-label")).toHaveCount(0);
    await expect(holdingSummaryCard.getByTestId("portfolio-donut-slice-label")).toHaveCount(1);
    await expect(assetsCenterLabel).toBeVisible();
    await expect(assetsCenterLabel).toContainText("총 자산");
    await expect(assetsCenterLabel).not.toContainText("%");
    const assetSummarySelect = holdingSummaryCard.getByLabel("자산 요약 보기 기준");
    await expect(assetSummarySelect).toBeVisible();
    await assetSummarySelect.selectOption("category");
    await expect(assetsCenterLabel).toContainText("총 자산");
    await expect(holdingSummaryCard.getByTestId("holding-donut-slice-label")).toHaveCount(0);

    await openTab(page, "대시보드");
    await expect(dashboardPortfolioSelect).toHaveValue("transaction_flow");
    await expect(dashboardCenterLabel).not.toContainText("분포");
    await expect(dashboardCenterLabel).toContainText(/\d{1,2}월 거래/);
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
  expectMonthlyFilterLayout(await readDashboardFilterLayout(mobileFilterCard));
  await expect(mobileFilterCard.getByRole("button", { name: "조회 적용" })).toHaveCount(0);
  await expectPressFeedback(page, mobileFilterCard.getByRole("button", { name: "월별" }), "월별");
  await expectPressFeedback(page, mobileFilterCard.getByRole("button", { name: "기간" }), "기간");
  await expect(mobileFilterCard.getByRole("button", { name: "조회 적용" })).toHaveCount(0);
  await expect(mobileFilterCard.locator('input[type="date"]')).toHaveCount(2);
  expectRangeFilterLayout(await readDashboardFilterLayout(mobileFilterCard));
  await expectNoHorizontalOverflow(page, 12);
  await expectPressFeedback(page, mobileFilterCard.getByRole("button", { name: "월별" }), "월별 복귀");
  expectMonthlyFilterLayout(await readDashboardFilterLayout(mobileFilterCard));
  await expectPressFeedback(page, mobileFilterCard.getByRole("button", { name: "이전 달" }), "이전 달");
  await expectPressFeedback(page, mobileFilterCard.getByRole("button", { name: "다음 달" }), "다음 달");
  await expectPressFeedback(page, mobileFilterCard.getByRole("button", { name: "이번 달" }), "이번 달");
  await expectNoRefreshNoteLayoutShift(page, mobileFilterCard.getByRole("button", { name: "월별" }), mobileFilterCard, "월별");
  await expectNoRefreshNoteLayoutShift(page, mobileFilterCard.getByRole("button", { name: "기간" }), mobileFilterCard, "기간");
  await expectNoRefreshNoteLayoutShift(page, mobileFilterCard.getByRole("button", { name: "월별" }), mobileFilterCard, "월별 복귀");
  await expectNoRefreshNoteLayoutShift(page, mobileFilterCard.getByRole("button", { name: "이전 달" }), mobileFilterCard, "이전 달");
  await expectNoRefreshNoteLayoutShift(page, mobileFilterCard.getByRole("button", { name: "다음 달" }), mobileFilterCard, "다음 달");
  await expectNoRefreshNoteLayoutShift(page, mobileFilterCard.getByRole("button", { name: "이번 달" }), mobileFilterCard, "이번 달");
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
  const messageShiftFilterY = (await mobileFilterCard.boundingBox())?.y ?? 0;
  const priceRefreshButton = page.getByRole("button", { name: /시세 갱신/ });
  if (await priceRefreshButton.isEnabled().catch(() => false)) {
    await priceRefreshButton.click();
    await expect(page.locator("main.app-shell > .message, .app-content > .message", { hasText: /시세 갱신/ })).toHaveCount(0);
    const afterMessageFilterY = (await mobileFilterCard.boundingBox())?.y ?? 0;
    expect(Math.abs(afterMessageFilterY - messageShiftFilterY)).toBeLessThanOrEqual(2);
  }
  const mobileGlobalMessageVisible = await mobileGlobalMessage.isVisible().catch(() => false);
  if (mobileGlobalMessageVisible) {
    await expect(mobileGlobalMessage).toHaveCSS("position", "fixed");
    await mobileGlobalMessage.getByRole("button", { name: "닫기" }).click();
    await expect(mobileGlobalMessage).toBeHidden();
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
    await dashboardPortfolioCard.evaluate((card) => card.scrollIntoView({ block: "start", inline: "nearest" }));
    await page.waitForTimeout(80);
    await expectWithinViewport(dashboardPortfolioSelect);
    const mobileSelectLayout = await dashboardPortfolioCard.evaluate((card) => {
      const group = card.querySelector(".dashboard-portfolio-chart-select")?.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      return {
        rightGap: group ? cardBox.right - group.right : Number.POSITIVE_INFINITY,
      };
    });
    expect(mobileSelectLayout.rightGap).toBeLessThanOrEqual(18);
    await dashboardPortfolioSelect.selectOption("holding_type");
    await expect(dashboardCenterLabel).toContainText("총 자산");
    await expectDonutTextNotClipped(dashboardCenterLabel);
    await expectDonutLabelsCenteredOnRing(dashboardPortfolioCard, "mobile dashboard asset type");
    await dashboardPortfolioSelect.selectOption("transaction_flow");
    await expect(dashboardSliceLabels).toHaveCount(2);
    await expect(dashboardSliceLabels.first()).toContainText("%");
    await expect(dashboardCenterLabel).not.toContainText("분포");
    await expect(dashboardCenterLabel).toContainText(/\d{1,2}월 거래/);
    await expectDonutTextNotClipped(dashboardCenterLabel);
    await expectDonutTextNotClipped(dashboardSliceLabels);
    await expectDonutLabelsCenteredOnRing(dashboardPortfolioCard, "mobile dashboard transaction flow");
    await expectDonutLabelsClearOfMobileNav(page, dashboardPortfolioCard, "mobile dashboard transaction flow");
    await expectWithinViewport(dashboardCenterLabel);
    await expect(priceRefreshButton).toBeEnabled({ timeout: 10_000 });
    await expectKeyboardReachableInOrder(page, [
      page.getByRole("button", { name: "새로고침" }),
      page.getByRole("button", { name: "시세 갱신" }),
      dashboardPortfolioSelect,
    ]);
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, "dashboard-mobile-portfolio-sync");
  }

  const shouldRunMobileLayoutProfiles =
    testInfo.project.name === "mobile-chromium" || process.env.E2E_PROJECT_MATRIX !== "1";
  if (shouldRunMobileLayoutProfiles) {
    const mobileLayoutProfiles = [
      {
        name: "chrome-devtools-390-system",
        viewport: { width: 390, height: 844 },
        fontFamily: '"Pretendard", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif',
      },
      {
        name: "iphone-se-compact-apple",
        viewport: { width: 375, height: 667 },
        fontFamily: '"Apple SD Gothic Neo", -apple-system, BlinkMacSystemFont, sans-serif',
      },
      {
        name: "iphone-pro-393-fallback",
        viewport: { width: 393, height: 852 },
        fontFamily: '-apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif',
      },
      {
        name: "android-wide-412-noto",
        viewport: { width: 412, height: 915 },
        fontFamily: '"Noto Sans KR", "Segoe UI", sans-serif',
      },
    ];

    for (const profile of mobileLayoutProfiles) {
      await page.setViewportSize(profile.viewport);
      await applyFontFamily(page, profile.fontFamily);
      await openTab(page, "대시보드");
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectNoHorizontalOverflow(page, 12);
      await expectMonthlyFilterLayout(await readDashboardFilterLayout(mobileFilterCard));
      await dashboardPortfolioCard.evaluate((card) => card.scrollIntoView({ block: "start", inline: "nearest" }));
      await page.waitForTimeout(80);
      await dashboardPortfolioSelect.selectOption("transaction_flow");
      await expect(dashboardCenterLabel).not.toContainText("분포");
      await expect(dashboardCenterLabel).toContainText(/\d{1,2}월 거래/);
      await expectDonutTextNotClipped(dashboardCenterLabel);
      await expectDonutTextNotClipped(dashboardSliceLabels);
      await expectDonutLabelsCenteredOnRing(dashboardPortfolioCard, profile.name);
      await expectDonutLabelsClearOfMobileNav(page, dashboardPortfolioCard, profile.name);
      await expectNoHorizontalOverflow(page, 12);
      await capture(page, `dashboard-mobile-layout-${profile.name}`);
    }
  }
});
