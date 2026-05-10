import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicHolding,
  expectBackgroundNotPlainWhite,
  expectCompactHeader,
  expectCompactLedgerRow,
  expectNoHorizontalOverflow,
  expectSingleLineText,
  expectStableButtonPosition,
  expectTransparentBackground,
  labeledField,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

test("holdings flow: create, inline edit, delete, responsive", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("holding-user")}@example.com`;
  const displayName = unique("holding-name");
  const holdingName = unique("holding");
  const holdingCategory = unique("holding-category");
  const editedHoldingName = `${holdingName}-edited`;

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  await openTab(page, "자산");
  const holdingCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "자산 입력" }),
  });
  const holdingToggleButton = holdingCard.getByRole("button", { name: /자산 추가|입력 닫기/ }).first();
  const hasToggleButton = (await holdingToggleButton.count()) > 0;
  if (hasToggleButton) {
    await expect(holdingToggleButton).toContainText("자산 추가");
    await expect(holdingCard.locator("form.holdings-form-grid")).toHaveCount(0);
  } else {
    await expect(holdingCard.locator("form.holdings-form-grid")).toHaveCount(1);
  }
  const holdingSummaryCard = page.locator("details.holding-summary-card").first();
  if ((await holdingSummaryCard.count()) > 0) {
    await expect(holdingSummaryCard).toBeVisible();
    const isOpen = await holdingSummaryCard.evaluate((element) => element.hasAttribute("open"));
    if (!isOpen) {
      await holdingSummaryCard.locator("summary").click();
    }
    await expect(holdingSummaryCard).toHaveAttribute("open", "");
    await expect(holdingSummaryCard.getByText("자산 포트폴리오 요약")).toBeVisible();
    const assetsPortfolioSelect = holdingSummaryCard.getByLabel("자산 포트폴리오 보기 기준");
    await expect(assetsPortfolioSelect).toBeVisible();
    await assetsPortfolioSelect.selectOption("transaction_flow");
    await expect(holdingSummaryCard).toContainText("거래 유형 비중");
    await expect(holdingSummaryCard).toContainText("표시할 포트폴리오 데이터가 없습니다.");
    const emptyPortfolioChartHeight = await holdingSummaryCard
      .locator(".compact-support-section")
      .first()
      .locator(".chart-wrap")
      .first()
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(emptyPortfolioChartHeight).toBeLessThanOrEqual(120);
    await assetsPortfolioSelect.selectOption("holding_category");
    await expect(assetsPortfolioSelect).toHaveValue("holding_category");
    await expect(holdingSummaryCard).toContainText("보유 카테고리 비중");
    const holdingSummarySelect = holdingSummaryCard.getByLabel("자산 요약 보기 기준");
    await expect(holdingSummarySelect).toBeVisible();
    await holdingSummarySelect.selectOption("category");
    await expect(holdingSummaryCard).toContainText("카테고리 비중");
  }
  await capture(page, "holdings-entry");

  const createdRow = await createBasicHolding(page, { name: holdingName, category: holdingCategory });
  await expect(createdRow).toContainText(holdingName);
  await capture(page, "holdings-created");

  await createdRow.locator("td").last().getByRole("button", { name: "수정" }).click();
  const editorForm = page.locator("tr.holding-inline-editor-row form").first();
  await expect(editorForm).toBeVisible();
  const editorNameTextarea = labeledField(editorForm, "자산명", "textarea");
  if ((await editorNameTextarea.count()) > 0) {
    await editorNameTextarea.fill(editedHoldingName);
  } else {
    await labeledField(editorForm, "자산명", "input").fill(editedHoldingName);
  }
  await labeledField(editorForm, "평가금액", "input").fill("987654");
  await editorForm.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("자산을 수정했습니다.")).toBeVisible();

  const editedRow = page.locator("tr.holding-row", { hasText: editedHoldingName }).first();
  await expect(editedRow).toBeVisible();

  for (let index = 0; index < 4; index += 1) {
    await createBasicHolding(page, {
      name: unique(`holding-ledger-${index}`),
      category: index < 2 ? holdingCategory : `${holdingCategory}-extra`,
    });
    await openTab(page, "자산");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "자산");
  await page.waitForLoadState("networkidle");
  await expect(holdingSummaryCard).toBeVisible();
  const holdingsJumpCue = page.getByTestId("holdings-summary-jump-cue");
  const holdingEntryCard = page.locator(".holding-entry-card").first();
  const holdingsFab = page.getByTestId("holdings-fab");
  const holdingSheet = page.getByTestId("holding-entry-sheet");
  const holdingSheetClose = page.getByTestId("holding-entry-sheet-close");
  const holdingListCard = page.locator(".holding-list-card").first();
  const summaryBox = await holdingSummaryCard.boundingBox();
  const listBox = await holdingListCard.boundingBox();
  expect(summaryBox, "holding summary card should have a bounding box").not.toBeNull();
  expect(listBox, "holding list card should have a bounding box").not.toBeNull();
  const mobileTopbarBox = await page.locator("header.topbar").boundingBox();
  const holdingHeadingBox = await page.locator(".holding-list-card > .surface-list-heading").first().boundingBox();
  await expect(page.locator(".holding-list-card > .surface-control-strip").first()).toBeHidden();
  const holdingJumpBox = await holdingsJumpCue.boundingBox();
  const holdingSubTabsBox = await page.locator(".holding-list-card > .sub-tabs").first().boundingBox();
  const holdingLedgerBoxInitial = await page.locator(".holdings-mobile-ledger-head").boundingBox();
  const holdingTableBoxInitial = await page.locator(".holdings-surface-table").boundingBox();
  const inFlowMessage = page.locator(".app-content > .message, .app-shell > .message").first();
  const inFlowMessageVisible =
    (await inFlowMessage.count()) > 0 && (await inFlowMessage.isVisible().catch(() => false));
  const inFlowMessageBox = inFlowMessageVisible ? await inFlowMessage.boundingBox() : null;
  expect(mobileTopbarBox, "mobile topbar should have a bounding box").not.toBeNull();
  expect(holdingHeadingBox, "holding heading should have a bounding box").not.toBeNull();
  expect(holdingJumpBox, "holding summary jump should have a bounding box").not.toBeNull();
  expect(holdingSubTabsBox, "holding sub tabs should have a bounding box").not.toBeNull();
  expect(holdingLedgerBoxInitial, "holding ledger head should have a bounding box").not.toBeNull();
  expect(holdingTableBoxInitial, "holding table should have a bounding box").not.toBeNull();
  expect(mobileTopbarBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(88);
  if (inFlowMessageBox) {
    expect(inFlowMessageBox.y + inFlowMessageBox.height).toBeLessThanOrEqual((holdingHeadingBox?.y ?? 0) + 8);
    expect(holdingHeadingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      inFlowMessageBox.y + inFlowMessageBox.height + 80,
    );
  } else {
    expect(holdingHeadingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      Math.max(0, (mobileTopbarBox?.y ?? 0) + (mobileTopbarBox?.height ?? 0)) + 96,
    );
  }
  expect(holdingHeadingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(holdingJumpBox?.y ?? 0);
  expect(holdingJumpBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(holdingSubTabsBox?.y ?? 0);
  expect(holdingSubTabsBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(holdingLedgerBoxInitial?.y ?? 0);
  expect(holdingLedgerBoxInitial?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(holdingTableBoxInitial?.y ?? 0);
  await expect(holdingEntryCard).toBeHidden();
  await expect(holdingsFab).toBeVisible();
  const activeTabBeforeHoldingSheet = await page.locator("nav.tabs button.active").first().innerText();
  await holdingsFab.click();
  await expect(holdingSheet).toBeVisible();
  await expect(labeledField(holdingSheet, "자산명", "textarea")).toBeVisible();
  await holdingSheetClose.click();
  await expect(holdingSheet).toBeHidden();
  await expect(page.locator("nav.tabs button.active").first()).toHaveText(activeTabBeforeHoldingSheet);
  expect(summaryBox?.y ?? 0).toBeGreaterThanOrEqual((listBox?.y ?? 0) - 1);
  await expect(holdingsJumpCue).toBeVisible();
  const summaryTopBeforeJump = summaryBox?.y ?? Number.POSITIVE_INFINITY;
  await holdingsJumpCue.click();
  await page.waitForTimeout(250);
  const summaryBoxAfterJump = await holdingSummaryCard.boundingBox();
  expect(summaryBoxAfterJump, "holding summary card should have a bounding box after jump").not.toBeNull();
  expect(summaryTopBeforeJump).toBeGreaterThan((summaryBoxAfterJump?.y ?? Number.POSITIVE_INFINITY));
  expect(summaryBoxAfterJump?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(220);
  await expect(page.locator(".holdings-mobile-ledger-head")).toBeVisible();
  await expect(holdingSummaryCard.getByLabel("자산 포트폴리오 보기 기준")).toBeVisible();
  await expect(holdingSummaryCard.getByLabel("자산 요약 보기 기준")).toBeVisible();
  const mobileEditedRow = page.locator("tr.holding-row", { hasText: editedHoldingName }).first();
  await expect(mobileEditedRow).toBeVisible();
  await expect(mobileEditedRow).not.toHaveClass(/mobile-row-expanded/);
  await expect(mobileEditedRow.locator(".holding-col-type")).toContainText(holdingCategory);
  await expectCompactLedgerRow(mobileEditedRow, 62);
  await expectSingleLineText(mobileEditedRow.locator(".holding-col-name").first());
  await expectBackgroundNotPlainWhite(mobileEditedRow);
  await expectTransparentBackground(mobileEditedRow.locator(".holding-col-name").first());
  await expectCompactHeader(page.locator(".section-header-cell").first(), 30);
  await capture(page, "holdings-mobile-summary");
  await holdingListCard.evaluate((element) => element.scrollIntoView({ block: "start", inline: "nearest" }));
  await page.waitForTimeout(250);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const ledgerBox = await page.locator(".holdings-mobile-ledger-head").boundingBox();
    if ((ledgerBox?.y ?? Number.POSITIVE_INFINITY) <= 92) {
      break;
    }
    await page.evaluate((delta) => window.scrollBy(0, delta), Math.max((ledgerBox?.y ?? 0) - 80, 80));
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(250);
  const holdingHeading = page.locator(".holding-list-card > .surface-list-heading").first();
  const holdingLedgerHead = page.locator(".holdings-mobile-ledger-head");
  const headingBox = await holdingHeading.boundingBox();
  const ledgerBox = await holdingLedgerHead.boundingBox();
  const rowBox = await mobileEditedRow.boundingBox();
  expect(headingBox, "holding heading should have a bounding box").not.toBeNull();
  expect(ledgerBox, "holding ledger head should have a bounding box").not.toBeNull();
  expect(rowBox, "mobile holding row should have a bounding box").not.toBeNull();
  expect(ledgerBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(rowBox?.y ?? 0);
  expect((ledgerBox?.y ?? 0) - ((headingBox?.y ?? 0) + (headingBox?.height ?? 0))).toBeGreaterThanOrEqual(-14);
  await mobileEditedRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const mobileToggleButton = mobileEditedRow.locator(".mobile-toggle-btn").first();
  await expectStableButtonPosition(mobileToggleButton, async () => {
    await mobileToggleButton.click({ force: true });
  });
  await expect(mobileEditedRow).toHaveClass(/mobile-row-expanded/);
  const expandedActionRow = mobileEditedRow.locator("xpath=following-sibling::tr[1][contains(@class,'holding-mobile-expanded-actions-row')]");
  await expect(expandedActionRow).toBeVisible();
  await expect(expandedActionRow.getByRole("button", { name: "수정" })).toBeVisible();
  await expect(expandedActionRow.getByRole("button", { name: "삭제" })).toBeVisible();
  await expect(mobileEditedRow.locator(".holding-col-actions .row-delete-btn")).toBeHidden();
  await mobileEditedRow.locator("td").last().getByRole("button", { name: "자산 세부 접기" }).click();
  await expect(mobileEditedRow).not.toHaveClass(/mobile-row-expanded/);
  await assertResponsiveShell(page, 12);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "holdings-tablet");

  await page.setViewportSize({ width: 1366, height: 960 });
  await openTab(page, "자산");
  const cleanupRow = page.locator("tr.holding-row", { hasText: editedHoldingName }).first();
  await cleanupRow.locator("td").last().getByRole("button", { name: "삭제" }).click();
  const confirmDialog = page.locator(".confirm-dialog");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByText("자산을 삭제했습니다.")).toBeVisible();
  await expect(page.locator("tr.holding-row", { hasText: editedHoldingName })).toHaveCount(0);
});

test("holdings stock fields keep grouped decimals", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("holding-format")}@example.com`;
  const displayName = unique("holding-format-name");
  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "자산");
  const holdingEmptyState = page.getByTestId("holdings-empty-state");
  await expect(holdingEmptyState).toBeVisible();
  await expect(holdingEmptyState).toContainText("자산 내역이 없습니다.");
  const holdingEmptyBorder = await holdingEmptyState.evaluate((element) => getComputedStyle(element).borderTopStyle);
  expect(holdingEmptyBorder).toBe("none");
  await expect(page.getByTestId("holdings-fab")).toBeVisible();

  await page.setViewportSize({ width: 1366, height: 960 });
  await openTab(page, "자산");

  const holdingCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "자산 입력" }),
  });
  const holdingToggleButton = holdingCard.getByRole("button", { name: /자산 추가|입력 닫기/ }).first();
  await expect(holdingToggleButton).toContainText("자산 추가");
  await expect(holdingCard.locator("form.holdings-form-grid")).toHaveCount(0);
  const holdingToggleVisible = await holdingToggleButton.isVisible().catch(() => false);
  if (holdingToggleVisible) {
    const holdingToggleText = String((await holdingToggleButton.textContent()) || "");
    if (holdingToggleText.includes("자산 추가")) {
      await holdingToggleButton.click();
    }
  }
  const typeSelect = labeledField(holdingCard, "유형", "select");
  const hasStockOption = (await typeSelect.locator("option[value='stock']").count()) > 0;
  if (hasStockOption) {
    await typeSelect.selectOption("stock");
  } else {
    await typeSelect.selectOption({ index: 0 });
  }
  const quantityInput = labeledField(holdingCard, "수량", "input");
  const unitCostInput = labeledField(holdingCard, "평균단가", "input");
  await quantityInput.fill("12345.6789");
  await unitCostInput.fill("9876543.21");
  await expect(quantityInput).toHaveValue("12,345.6789");
  await expect(unitCostInput).toHaveValue("9,876,543.21");
});
