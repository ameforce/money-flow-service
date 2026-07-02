import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  expectNoHorizontalOverflow,
  labeledField,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

async function applyFontFamily(page, fontFamily) {
  await page.addStyleTag({
    content: `html, body, button, input, select, textarea { font-family: ${fontFamily} !important; }`,
  });
}

async function expectDashboardContextVisible(page) {
  await expect(page.locator(".dashboard-hero-copy p")).toBeVisible();
  await expect(page.locator(".dashboard-market-strip")).toBeVisible();
  await expect(page.locator(".dashboard-status-card")).toBeVisible();
  await expect(page.locator(".dashboard-members-card")).toBeVisible();

  const visibleKpis = await page.locator(".dashboard-hero-card .dashboard-kpi-card").evaluateAll((cards) =>
    cards.filter((card) => getComputedStyle(card).display !== "none").length,
  );
  expect(visibleKpis).toBeGreaterThanOrEqual(6);
  await expectNoHorizontalOverflow(page);
}

test("issue #241: top-level navigation uses semantic SVG icons with selected state", async ({ page }) => {
  const email = `${unique("uiux-nav-icons")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-nav-icons-name") });
  await assertResponsiveShell(page);

  const nav = page.locator("nav.topbar-tabs");
  await expect(nav).toBeVisible();
  await capture(page, "issue-241-nav-icons");
  await expect(nav.locator("button")).toHaveCount(6);

  const iconMetrics = await nav.locator("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const icon = button.querySelector(".tab-icon");
      return {
        label: button.getAttribute("aria-label") || "",
        current: button.getAttribute("aria-current") || "",
        text: icon?.textContent?.trim() || "",
        svgCount: icon?.querySelectorAll("svg").length || 0,
        hidden: icon?.getAttribute("aria-hidden") || "",
      };
    }),
  );

  expect(iconMetrics.every((item) => item.svgCount === 1), JSON.stringify(iconMetrics)).toBe(true);
  expect(iconMetrics.every((item) => item.text === ""), JSON.stringify(iconMetrics)).toBe(true);
  expect(iconMetrics.every((item) => item.hidden === "true"), JSON.stringify(iconMetrics)).toBe(true);
  expect(iconMetrics.filter((item) => item.current === "page")).toHaveLength(1);
});

test("issue #242: mobile dashboard keeps status and market context visible", async ({ page }) => {
  const email = `${unique("uiux-mobile-dashboard")}@example.com`;
  const profiles = [
    { name: "390-apple", width: 390, height: 844, font: '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif' },
    { name: "360-malgun", width: 360, height: 740, font: '"Malgun Gothic", "Noto Sans KR", sans-serif' },
    { name: "768-noto", width: 768, height: 1024, font: '"Noto Sans KR", "Malgun Gothic", sans-serif' },
  ];

  await registerAndVerify(page, { email, displayName: unique("uiux-mobile-dashboard-name") });

  for (const profile of profiles) {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await applyFontFamily(page, profile.font);
    await openTab(page, "대시보드");
    await capture(page, `issue-242-mobile-dashboard-context-${profile.name}`);
    await expectDashboardContextVisible(page);
    await page.locator(".dashboard-status-card").scrollIntoViewIfNeeded();
    await capture(page, `issue-242-mobile-dashboard-status-${profile.name}`);
    await expectNoHorizontalOverflow(page);
  }
});

test("issue #243: mobile holding sheet closes with Escape and restores trigger focus", async ({ page }) => {
  const email = `${unique("uiux-holding-escape")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-holding-escape-name") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "자산");

  const openButton = page.getByRole("button", { name: "자산 추가" }).first();
  const holdingDialog = page.getByRole("dialog", { name: "자산 추가 레이어" });
  await expect(openButton).toBeVisible();
  await openButton.click();
  await expect(holdingDialog).toBeVisible();
  await capture(page, "issue-243-holding-sheet-open");
  await expectNoHorizontalOverflow(page);
  const selectedOwnerChipName = page.locator('[data-testid="holding-owner-quick-select"] .owner-quick-chip.selected .owner-quick-chip-name');
  await expect(selectedOwnerChipName).toBeVisible();
  const ownerChipClipping = await selectedOwnerChipName.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      clipped: element.scrollWidth > element.clientWidth,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(ownerChipClipping.clipped, JSON.stringify(ownerChipClipping)).toBe(false);
  expect(ownerChipClipping.textOverflow, JSON.stringify(ownerChipClipping)).not.toBe("ellipsis");
  expect(ownerChipClipping.whiteSpace, JSON.stringify(ownerChipClipping)).not.toBe("nowrap");

  await page.keyboard.press("Escape");
  await expect(holdingDialog).toHaveCount(0);
  await expect(openButton).toBeFocused();

  await openButton.click();
  await expect(holdingDialog).toBeVisible();
  const dirtyName = unique("uiux-dirty-holding");
  const nameInput = labeledField(holdingDialog, "자산명", "textarea");
  await nameInput.fill(dirtyName);
  await page.keyboard.press("Escape");

  const closeDraftDialog = page.getByRole("alertdialog");
  await expect(closeDraftDialog.getByRole("heading", { name: "자산 입력을 닫을까요?" })).toBeVisible();
  await closeDraftDialog.getByRole("button", { name: "취소" }).click();
  await expect(closeDraftDialog).toBeHidden();
  await expect(holdingDialog).toBeVisible();
  await expect(nameInput).toHaveValue(dirtyName);

  await page.keyboard.press("Escape");
  await expect(closeDraftDialog.getByRole("heading", { name: "자산 입력을 닫을까요?" })).toBeVisible();
  await closeDraftDialog.getByRole("button", { name: "입력 닫기" }).click();
  await expect(holdingDialog).toHaveCount(0);
  await expect(openButton).toBeFocused();
});

test("issue #244: mobile touch activation does not forcibly blur the active control", async ({ page }) => {
  const email = `${unique("uiux-mobile-focus-retention")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-mobile-focus-retention-name") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");

  const transactionTab = page.locator('nav.topbar-tabs button[aria-label="거래"]');
  await expect(transactionTab).toBeVisible();
  await transactionTab.click();

  await expect(transactionTab).toBeFocused();
  await capture(page, "issue-244-mobile-focus-retention");
  const focusState = await transactionTab.evaluate((button) => ({
    activeLabel: document.activeElement?.getAttribute("aria-label") || "",
    activeCurrent: document.activeElement?.getAttribute("aria-current") || "",
    buttonCurrent: button.getAttribute("aria-current") || "",
  }));
  expect(focusState, JSON.stringify(focusState)).toMatchObject({
    activeLabel: "거래",
    activeCurrent: "page",
    buttonCurrent: "page",
  });
});

test("issue #259: category management is outside the transaction entry sheet", async ({ page }) => {
  const email = `${unique("uiux-category-management-separated")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-category-management-separated-name") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");

  await page.getByTestId("transactions-fab").click();
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();
  await expect(transactionSheet.getByTestId("transaction-entry-category-manage")).toHaveCount(0);
  await expect(transactionSheet).toContainText("금액, 카테고리, 메모 순서로 바로 저장합니다.");
  await capture(page, "issue-259-entry-sheet-without-category-management");
  await page.getByTestId("transaction-entry-sheet-close").click();
  await expect(transactionSheet).toBeHidden();

  const support = page.locator("details.transaction-support-card").first();
  if (!(await support.evaluate((element) => element.open))) {
    await support.locator("summary").click();
  }
  const categoryManagement = support.locator(".compact-support-section", { hasText: "거래 탭 카테고리 관리" }).first();
  await expect(categoryManagement).toBeVisible();
  await categoryManagement.getByRole("button", { name: "열기" }).click();
  await expect(categoryManagement.getByText("새 카테고리 만들기")).toBeVisible();
  await capture(page, "issue-259-category-management-outside-entry-sheet");
});

test("issue #257: category search does not occupy the default transaction entry path", async ({ page }) => {
  const email = `${unique("uiux-category-search-on-demand")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-category-search-on-demand-name") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");

  await page.getByTestId("transactions-fab").click();
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();
  await expect(transactionSheet.getByTestId("transaction-quick-amount")).toBeFocused();
  await expect(transactionSheet.getByTestId("transaction-category-search")).toHaveCount(0);
  await expect(transactionSheet.getByTestId("transaction-category-search-toggle")).toBeVisible();
  await expect(transactionSheet.getByTestId("transaction-category-quick-picker")).toContainText("카테고리");
  await capture(page, "issue-257-category-search-collapsed-default");

  await transactionSheet.getByTestId("transaction-category-search-toggle").click();
  const searchInput = transactionSheet.getByTestId("transaction-category-search");
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeFocused();
  await capture(page, "issue-257-category-search-opened-on-demand");
});
