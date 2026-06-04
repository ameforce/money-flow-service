import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicHolding,
  expectBackgroundNotPlainWhite,
  expectCompactHeader,
  expectCompactLedgerRow,
  expectNoOrphanTextLine,
  expectNoHorizontalOverflow,
  expectPortfolioLabelsClearOfBottomNav,
  expectSingleLineText,
  expectStableButtonPosition,
  expectTransparentBackground,
  labeledField,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

async function expectMobileHoldingDetailLabels(row) {
  for (const label of ["보유자", "수량", "평균단가", "손익", "최종 수정일"]) {
    await expect(row.locator(".holding-mobile-detail-label", { hasText: label }).first()).toBeVisible();
  }
  const expandedDetailRows = await row.locator(".holding-mobile-detail-cell").evaluateAll((cells) =>
    cells.map((cell) => {
      const label = cell.querySelector(".holding-mobile-detail-label")?.getBoundingClientRect();
      const value = cell.querySelector(".holding-mobile-detail-value")?.getBoundingClientRect();
      return {
        labelText: cell.querySelector(".holding-mobile-detail-label")?.textContent?.trim() || "",
        valueText: cell.querySelector(".holding-mobile-detail-value")?.textContent?.trim() || "",
        clientWidth: cell.clientWidth,
        scrollWidth: cell.scrollWidth,
        labelWidth: label?.width ?? 0,
        valueWidth: value?.width ?? 0,
        overlaps: Boolean(
          label &&
            value &&
            label.right > value.left &&
            label.bottom > value.top &&
            value.bottom > label.top
        ),
      };
    })
  );
  expect(expandedDetailRows.length).toBeGreaterThanOrEqual(5);
  expect(
    expandedDetailRows.every((item) =>
      item.labelText &&
      item.valueText &&
      item.labelWidth > 0 &&
      item.valueWidth > 0 &&
      !item.overlaps &&
      item.scrollWidth <= item.clientWidth + 1
    ),
    `holding mobile detail labels should be visible and separated: ${JSON.stringify(expandedDetailRows)}`
  ).toBe(true);
}

async function expectMobileHoldingNameReadable(row, expectedName) {
  const metrics = await row.evaluate((element, name) => {
    const nameCell = element.querySelector(".holding-col-name");
    const nameLabel = element.querySelector(".holding-name-label");
    const typeCell = element.querySelector(".holding-col-type");
    const marketCell = element.querySelector(".holding-col-market");
    const nameCellBox = nameCell?.getBoundingClientRect();
    const nameLabelBox = nameLabel?.getBoundingClientRect();
    const typeBox = typeCell?.getBoundingClientRect();
    const marketBox = marketCell?.getBoundingClientRect();
    return {
      expectedName: name,
      labelText: nameLabel?.textContent?.trim() || "",
      labelClientWidth: nameLabel?.clientWidth ?? 0,
      labelScrollWidth: nameLabel?.scrollWidth ?? 0,
      labelClientHeight: nameLabel?.clientHeight ?? 0,
      labelScrollHeight: nameLabel?.scrollHeight ?? 0,
      nameCellWidth: nameCellBox?.width ?? 0,
      nameBottom: (nameLabelBox?.y ?? 0) + (nameLabelBox?.height ?? 0),
      typeY: typeBox?.y ?? 0,
      marketY: marketBox?.y ?? 0,
      rowClientWidth: element.clientWidth,
      rowScrollWidth: element.scrollWidth,
    };
  }, expectedName);
  expect(metrics.labelText).toBe(expectedName);
  expect(
    metrics.labelScrollWidth <= metrics.labelClientWidth + 1,
    `holding name should not be horizontally ellipsized at 320px: ${JSON.stringify(metrics)}`
  ).toBe(true);
  expect(
    metrics.labelScrollHeight <= metrics.labelClientHeight + 1,
    `holding name should fit within the visible mobile label area: ${JSON.stringify(metrics)}`
  ).toBe(true);
  expect(metrics.nameCellWidth).toBeGreaterThanOrEqual(170);
  expect(metrics.typeY).toBeGreaterThanOrEqual(metrics.nameBottom - 1);
  expect(metrics.marketY).toBeGreaterThanOrEqual(metrics.nameBottom - 1);
  expect(metrics.rowScrollWidth - metrics.rowClientWidth).toBeLessThanOrEqual(1);
}

test("holding entry defaults owner and keeps it for repeated assets", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("holding-owner-default")}@example.com`;
  const displayName = "댕";
  await registerAndVerify(page, { email, displayName });
  const currentUser = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    return response.json();
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await openTab(page, "자산");
  const holdingCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "자산 입력" }),
  });
  await holdingCard.getByRole("button", { name: "자산 추가" }).click();
  const holdingForm = holdingCard.locator("form.holdings-form-grid").first();
  const ownerSelect = labeledField(holdingForm, "보유자", "select");
  await expect(ownerSelect).toHaveValue(currentUser.id);
  await expect(ownerSelect.locator("option:checked")).toContainText(displayName);

  const ownerQuickSelect = holdingForm.getByTestId("holding-owner-quick-select");
  await expect(ownerQuickSelect).toBeVisible();
  const currentUserChip = ownerQuickSelect.getByRole("button", { name: `${displayName} 보유자 선택` });
  await expect(currentUserChip).toBeVisible();
  await expect(currentUserChip).toHaveAttribute("aria-pressed", "true");

  const firstHoldingName = unique("issue-201-holding-first");
  await labeledField(holdingForm, "자산명", "textarea").fill(firstHoldingName);
  await labeledField(holdingForm, "평가금액", "input").fill("123456");
  await capture(page, "issue-201-holding-owner-quick-select");
  await holdingForm.getByRole("button", { name: "자산 등록" }).click();
  await expect(page.locator("tr", { hasText: firstHoldingName }).first()).toBeVisible({ timeout: 20_000 });

  await holdingCard.getByRole("button", { name: "자산 추가" }).click();
  const repeatedOwnerSelect = labeledField(holdingForm, "보유자", "select");
  await expect(repeatedOwnerSelect).toHaveValue(currentUser.id);
  await expect(repeatedOwnerSelect.locator("option:checked")).toContainText(displayName);
  await capture(page, "issue-201-holding-owner-repeated");
});

test("issue 192: mobile holding entry asks before closing a dirty draft and preserves it", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("holding-draft-close")}@example.com`;
  const displayName = unique("holding-draft-close-name");
  const holdingName = unique("holding-draft-name");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "자산");
  await page.waitForLoadState("networkidle");

  const holdingsFab = page.getByTestId("holdings-fab");
  const holdingSheet = page.getByTestId("holding-entry-sheet");
  await expect(holdingsFab).toBeVisible();
  await holdingsFab.click();
  await expect(holdingSheet).toBeVisible();

  const nameInput = labeledField(holdingSheet, "자산명", "textarea");
  const valueInput = labeledField(holdingSheet, "평가금액", "input");
  await nameInput.fill(holdingName);
  await valueInput.fill("7654321");

  await page.getByTestId("holding-entry-sheet-close").click();
  const closeDraftDialog = page.getByRole("alertdialog");
  await expect(closeDraftDialog.getByRole("heading", { name: "자산 입력을 닫을까요?" })).toBeVisible();
  await expect(closeDraftDialog).toContainText("작성 중인 자산 초안은 보존됩니다.");
  await closeDraftDialog.getByRole("button", { name: "취소" }).click();
  await expect(closeDraftDialog).toBeHidden();
  await expect(holdingSheet).toBeVisible();
  await expect(nameInput).toHaveValue(holdingName);
  await expect(valueInput).toHaveValue("7,654,321");

  await page.getByTestId("holding-entry-sheet-close").click();
  await expect(closeDraftDialog.getByRole("heading", { name: "자산 입력을 닫을까요?" })).toBeVisible();
  await closeDraftDialog.getByRole("button", { name: "입력 닫기" }).click();
  await expect(holdingSheet).toBeHidden();

  await holdingsFab.click();
  await expect(holdingSheet).toBeVisible();
  await expect(labeledField(holdingSheet, "자산명", "textarea")).toHaveValue(holdingName);
  await expect(labeledField(holdingSheet, "평가금액", "input")).toHaveValue("7,654,321");
  await capture(page, "issue-192-mobile-holding-draft-preserved");
});

async function expectSingleSliceDonutHasNoRadialSeam(chartCard, label) {
  const metrics = await chartCard.locator(".compact-chart-wrap canvas").first().evaluate((canvas) => {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const centerX = Math.round(width / 2);
    const centerY = Math.round(height / 2);
    const image = context.getImageData(0, 0, width, height).data;
    const pixelAt = (x, y) => {
      const index = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
      return {
        red: image[index],
        green: image[index + 1],
        blue: image[index + 2],
        alpha: image[index + 3],
      };
    };
    const isWhiteLike = (pixel) => pixel.alpha > 220 && pixel.red > 235 && pixel.green > 235 && pixel.blue > 235;
    const isVisibleArc = (pixel) =>
      pixel.alpha > 220 && !isWhiteLike(pixel) && Math.max(pixel.red, pixel.green, pixel.blue) - Math.min(pixel.red, pixel.green, pixel.blue) > 24;
    const seamRows = [];
    for (let y = 0; y < centerY; y += 1) {
      const centerPixel = pixelAt(centerX, y);
      const leftPixel = pixelAt(centerX - 5, y);
      const rightPixel = pixelAt(centerX + 5, y);
      if (isVisibleArc(leftPixel) && isVisibleArc(rightPixel) && isWhiteLike(centerPixel)) {
        seamRows.push({
          y,
          center: centerPixel,
          left: leftPixel,
          right: rightPixel,
        });
      }
    }
    const ringRadius = Math.min(width, height) * 0.38;
    const quadrantSamples = [
      { name: "upper-right", angle: -45 },
      { name: "lower-right", angle: 45 },
      { name: "lower-left", angle: 135 },
      { name: "upper-left", angle: 225 },
    ].map((sample) => {
      const radians = (sample.angle * Math.PI) / 180;
      const x = Math.round(centerX + Math.cos(radians) * ringRadius);
      const y = Math.round(centerY + Math.sin(radians) * ringRadius);
      let visiblePixels = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (isVisibleArc(pixelAt(x + dx, y + dy))) {
            visiblePixels += 1;
          }
        }
      }
      return {
        ...sample,
        x,
        y,
        visiblePixels,
      };
    });
    return {
      width,
      height,
      centerX,
      centerY,
      seamRows,
      quadrantSamples,
    };
  });
  expect(
    metrics.seamRows.length,
    `${label} should not have a white radial seam through the 100% ring: ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(1);
  for (const sample of metrics.quadrantSamples) {
    expect(
      sample.visiblePixels,
      `${label} should render a visible arc in ${sample.name}: ${JSON.stringify(metrics)}`
    ).toBeGreaterThanOrEqual(6);
  }
}

test("single holding portfolio donut renders a seamless 100 percent ring", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("holding-donut")}@example.com`;
  const displayName = unique("holding-donut-owner");
  const holdingName = unique("holding-donut");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 768 });
  await createBasicHolding(page, { name: holdingName, category: "현금성", marketValue: "300000" });
  await page.setViewportSize({ width: 320, height: 568 });
  await openTab(page, "자산");

  const holdingSummaryCard = page.locator("details.holding-summary-card").first();
  await expect(holdingSummaryCard).toBeVisible();
  if (!(await holdingSummaryCard.evaluate((element) => element.hasAttribute("open")))) {
    await holdingSummaryCard.locator("summary").click();
  }
  const holdingSummarySelect = holdingSummaryCard.getByLabel("자산 요약 보기 기준");
  await expect(holdingSummarySelect).toBeVisible();
  await holdingSummarySelect.selectOption("type");
  await expect(holdingSummaryCard.getByTestId("portfolio-donut-slice-label")).toHaveCount(1);
  await expect(holdingSummaryCard.getByTestId("portfolio-donut-slice-label")).toContainText("100.0%");
  await expectSingleSliceDonutHasNoRadialSeam(holdingSummaryCard, "mobile holding portfolio 100% donut");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "holdings-single-slice-donut-ring");
});

test("mobile holding summary reopen keeps portfolio labels in viewport", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("holding-summary-reopen")}@example.com`;
  const displayName = unique("holding-summary-reopen-owner");
  const holdingName = unique("holding-summary-reopen");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await createBasicHolding(page, { name: holdingName, category: "현금성", marketValue: "360000" });
  await openTab(page, "자산");

  const holdingSummaryCard = page.locator("details.holding-summary-card").first();
  const holdingSummary = holdingSummaryCard.locator("summary").first();
  await expect(holdingSummaryCard).toBeVisible();
  if (!(await holdingSummaryCard.evaluate((element) => element.hasAttribute("open")))) {
    await holdingSummary.click();
  }

  const holdingSummarySelect = holdingSummaryCard.getByLabel("자산 요약 보기 기준");
  await expect(holdingSummarySelect).toBeVisible();
  await holdingSummarySelect.selectOption("type");
  await expect(holdingSummaryCard.getByTestId("portfolio-donut-slice-label")).toHaveCount(1);

  await holdingSummary.click();
  await expect(holdingSummaryCard).not.toHaveAttribute("open", "");
  await holdingSummary.evaluate((summary) => {
    const summaryTop = window.scrollY + summary.getBoundingClientRect().top;
    window.scrollTo({ top: Math.max(0, summaryTop - window.innerHeight + 68), behavior: "auto" });
  });
  await page.waitForTimeout(50);
  await holdingSummary.click();
  await expect(holdingSummaryCard).toHaveAttribute("open", "");
  await expectPortfolioLabelsClearOfBottomNav(
    page,
    holdingSummaryCard,
    "mobile reopened holding portfolio chart",
  );
  await capture(page, "holdings-summary-reopen-viewport");
});

test("desktop holding ledger controls keep usable hit targets", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("holding-hit-area")}@example.com`;
  const displayName = unique("holding-hit-area-owner");
  const holdingName = unique("holding-hit-area");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 768 });
  await createBasicHolding(page, { name: holdingName, category: "현금성" });
  await openTab(page, "자산");

  const sortMetrics = await page.locator(".holdings-surface-table thead .sort-header").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        text: button.textContent?.trim() || "",
        width: box.width,
        height: box.height,
      };
    }),
  );
  expect(sortMetrics.length, "holding sort headers should be present").toBeGreaterThanOrEqual(8);
  expect(
    sortMetrics.every((button) => button.width >= 40 && button.height >= 32),
    `holding sort headers should keep desktop hit targets: ${JSON.stringify(sortMetrics)}`,
  ).toBe(true);

  const holdingActions = page
    .locator("tr.holding-row", { hasText: holdingName })
    .first()
    .locator(".holding-col-actions .inline > button:not(.mobile-toggle-btn)");
  await expect(holdingActions).toHaveCount(4);
  const actionMetrics = await holdingActions.evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      const text = button.textContent?.trim() || "";
      return {
        text,
        aria: button.getAttribute("aria-label") || "",
        title: button.getAttribute("title") || "",
        width: box.width,
        height: box.height,
        disabled: button.disabled,
      };
    }),
  );
  expect(
    actionMetrics.every((button) => button.height >= 32 && button.width >= (["↑", "↓"].includes(button.text) ? 32 : 40)),
    `holding row action buttons should keep desktop hit targets: ${JSON.stringify(actionMetrics)}`,
  ).toBe(true);
  const moveActionMetrics = actionMetrics.filter((button) => ["↑", "↓"].includes(button.text));
  expect(
    moveActionMetrics.every(
      (button) =>
        button.aria.includes(holdingName) &&
        button.aria.includes(button.text === "↑" ? "위로 이동" : "아래로 이동") &&
        button.title.includes("전체 자산 순서"),
    ),
    `holding row move buttons should name the target asset and ordering scope: ${JSON.stringify(moveActionMetrics)}`,
  ).toBe(true);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "holdings-desktop-hit-targets");
});

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
    await expect(holdingSummaryCard.getByText("자산 포트폴리오 차트")).toBeVisible();
    await expect(holdingSummaryCard.getByRole("heading", { name: "자산 포트폴리오" })).toBeVisible();
    await expect(holdingSummaryCard).not.toContainText("총자산");
    await expect(holdingSummaryCard).not.toContainText("현재 보유 자산");
    await expect(holdingSummaryCard).not.toContainText("평가금액 기준");
    await expect(holdingSummaryCard.getByLabel("자산 포트폴리오 보기 기준")).toHaveCount(0);
    await expect(holdingSummaryCard).not.toContainText("거래 유형 비중");
    await expect(holdingSummaryCard).not.toContainText("거래 카테고리");
    await expect(holdingSummaryCard).not.toContainText("보유 카테고리");
    await expect(holdingSummaryCard).toContainText("표시할 포트폴리오 데이터가 없습니다.");
    const emptyPortfolioChartHeight = await holdingSummaryCard
      .locator(".compact-support-section")
      .first()
      .locator(".chart-wrap")
      .first()
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(emptyPortfolioChartHeight).toBeLessThanOrEqual(120);
    const holdingSummarySelect = holdingSummaryCard.getByLabel("자산 요약 보기 기준");
    await expect(holdingSummarySelect).toBeVisible();
    await holdingSummarySelect.selectOption("category");
    await expect(holdingSummaryCard).toContainText("자산 분류 상위 항목");
    await expect(holdingSummaryCard.locator(".compact-support-section .chart-wrap")).toHaveCount(1);
    await expect(holdingSummaryCard.getByTestId("holding-donut-slice-label")).toHaveCount(0);
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
  const cryptoHoldingName = unique("holding-crypto");
  await createBasicHolding(page, {
    name: cryptoHoldingName,
    category: "가상자산",
    type: "crypto",
    symbol: "BTC",
    marketSymbol: "UPBIT",
    marketValue: "123456",
  });

  await page.setViewportSize({ width: 768, height: 1024 });
  await openTab(page, "자산");
  await page.waitForLoadState("networkidle");
  const groupOrderButtonMetrics = await page.locator(".holding-section-actions .holding-section-order-btn").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        label: button.getAttribute("aria-label"),
        width: box.width,
        height: box.height,
      };
    }),
  );
  expect(groupOrderButtonMetrics.length, "holding group order buttons should be present").toBeGreaterThanOrEqual(4);
  expect(
    groupOrderButtonMetrics.every((button) => button.width >= 40 && button.height >= 40),
    `holding group order buttons should keep tablet hit targets: ${JSON.stringify(groupOrderButtonMetrics)}`,
  ).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "자산");
  await page.waitForLoadState("networkidle");
  const holdingDisplayOptions = page.locator("details.holding-display-options").first();
  await expect(holdingDisplayOptions).toBeVisible();
  const holdingDisplaySummary = holdingDisplayOptions.locator("summary").first();
  await expect(holdingDisplaySummary).toContainText("보기 옵션");
  const holdingDisplaySummaryMetrics = await holdingDisplaySummary.evaluate((summary) => {
    const box = summary.getBoundingClientRect();
    return {
      text: summary.textContent?.trim() || "",
      width: box.width,
      height: box.height,
      clientWidth: summary.clientWidth,
      scrollWidth: summary.scrollWidth,
    };
  });
  expect(holdingDisplaySummaryMetrics.height).toBeGreaterThanOrEqual(44);
  expect(
    holdingDisplaySummaryMetrics.scrollWidth - holdingDisplaySummaryMetrics.clientWidth,
    `holding display summary should keep a readable mobile hit area: ${JSON.stringify(holdingDisplaySummaryMetrics)}`
  ).toBeLessThanOrEqual(1);
  const displayOptionsOpen = await holdingDisplayOptions.evaluate((element) => element.hasAttribute("open"));
  if (!displayOptionsOpen) {
    await holdingDisplaySummary.click();
  }
  const columnWidthSummary = holdingDisplayOptions.locator("details.holding-column-width-editor > summary").first();
  await expect(columnWidthSummary).toContainText("열 너비 조정");
  const columnWidthSummaryMetrics = await columnWidthSummary.evaluate((summary) => {
    const box = summary.getBoundingClientRect();
    return {
      text: summary.textContent?.trim() || "",
      width: box.width,
      height: box.height,
      clientWidth: summary.clientWidth,
      scrollWidth: summary.scrollWidth,
    };
  });
  expect(columnWidthSummaryMetrics.height).toBeGreaterThanOrEqual(44);
  expect(
    columnWidthSummaryMetrics.scrollWidth - columnWidthSummaryMetrics.clientWidth,
    `holding column width summary should keep a readable mobile hit area: ${JSON.stringify(columnWidthSummaryMetrics)}`
  ).toBeLessThanOrEqual(1);
  if (!displayOptionsOpen) {
    await holdingDisplaySummary.click();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(holdingSummaryCard).toBeVisible();
  const holdingSummary = holdingSummaryCard.locator("summary").first();
  await expect(holdingSummary).toContainText("자산 포트폴리오 차트 접기");
  const holdingSummaryMetrics = await holdingSummary.evaluate((summary) => {
    const box = summary.getBoundingClientRect();
    return {
      text: summary.textContent?.trim() || "",
      width: box.width,
      height: box.height,
      clientWidth: summary.clientWidth,
      scrollWidth: summary.scrollWidth,
    };
  });
  expect(holdingSummaryMetrics.height).toBeGreaterThanOrEqual(44);
  expect(
    holdingSummaryMetrics.scrollWidth - holdingSummaryMetrics.clientWidth,
    `holding summary should keep a readable mobile hit area: ${JSON.stringify(holdingSummaryMetrics)}`
  ).toBeLessThanOrEqual(1);
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
  const mobileTabsBox = await page.locator(".topbar-tabs").first().boundingBox();
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
  expect(mobileTabsBox, "mobile tab rail should have a bounding box").not.toBeNull();
  expect(holdingHeadingBox, "holding heading should have a bounding box").not.toBeNull();
  expect(holdingJumpBox, "holding summary jump should have a bounding box").not.toBeNull();
  expect(holdingSubTabsBox, "holding sub tabs should have a bounding box").not.toBeNull();
  expect(holdingLedgerBoxInitial, "holding ledger head should have a bounding box").not.toBeNull();
  expect(holdingTableBoxInitial, "holding table should have a bounding box").not.toBeNull();
  expect(mobileTopbarBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(88);
  const mobileChromeBottom = Math.max(
    (mobileTopbarBox?.y ?? 0) + (mobileTopbarBox?.height ?? 0),
    (mobileTabsBox?.y ?? 0) + (mobileTabsBox?.height ?? 0),
  );
  if (inFlowMessageBox) {
    await expect(inFlowMessage).toHaveCSS("position", "fixed");
    expect(holdingHeadingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(mobileChromeBottom + 28);
    expect(inFlowMessageBox.y).toBeGreaterThan((mobileTopbarBox?.y ?? 0) + (mobileTopbarBox?.height ?? 0));
  } else {
    expect(holdingHeadingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(mobileChromeBottom + 28);
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
  await holdingSummary.click();
  await expect(holdingSummary).toContainText("자산 포트폴리오 차트 열기");
  await expect(holdingSummaryCard).not.toHaveAttribute("open", "");
  await holdingSummary.click();
  await expect(holdingSummary).toContainText("자산 포트폴리오 차트 접기");
  await expect(holdingSummaryCard).toHaveAttribute("open", "");
  await expect(page.locator(".holdings-mobile-ledger-head")).toBeVisible();
  await expect(holdingSummaryCard.getByLabel("자산 포트폴리오 보기 기준")).toHaveCount(0);
  const mobileHoldingSummarySelect = holdingSummaryCard.getByLabel("자산 요약 보기 기준");
  await expect(mobileHoldingSummarySelect).toBeVisible();
  await mobileHoldingSummarySelect.selectOption("type");
  await expect(holdingSummaryCard.locator(".compact-support-section .chart-wrap")).toHaveCount(1);
  await expectNoOrphanTextLine(holdingSummaryCard.locator("summary > span"), "mobile holding summary title");
  await expectNoOrphanTextLine(
    holdingSummaryCard.getByRole("heading", { name: "자산 포트폴리오" }),
    "mobile holding portfolio heading",
  );
  await expect(holdingSummaryCard.getByTestId("portfolio-donut-center-label")).toContainText("총 자산");
  await expect(holdingSummaryCard.getByTestId("holding-donut-slice-label")).toHaveCount(0);
  await expectPortfolioLabelsClearOfBottomNav(page, holdingSummaryCard, "mobile holding portfolio chart");
  const mobileBreakdownRow = holdingSummaryCard
    .locator(".portfolio-breakdown-list button, .portfolio-breakdown-list .portfolio-breakdown-row")
    .first();
  await expect(mobileBreakdownRow).toBeVisible();
  const breakdownLayout = await mobileBreakdownRow.evaluate((button) => {
    const value = button.querySelector(".portfolio-breakdown-value")?.getBoundingClientRect();
    const percent = button.querySelector("strong")?.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    return {
      height: box.height,
      valueY: value?.y ?? 0,
      percentY: percent?.y ?? 0,
      percentRightGap: Math.abs(box.right - (percent?.right ?? box.right)),
    };
  });
  expect(breakdownLayout.height).toBeLessThanOrEqual(48);
  expect(Math.abs(breakdownLayout.valueY - breakdownLayout.percentY)).toBeLessThanOrEqual(4);
  expect(breakdownLayout.percentRightGap).toBeLessThanOrEqual(14);

  const cryptoBreakdownFilter = holdingSummaryCard.getByRole("button", { name: "가상자산만 보기" });
  await expect(cryptoBreakdownFilter).toBeVisible();
  await cryptoBreakdownFilter.click();
  const holdingTypeFilterStatus = page.getByTestId("holding-type-filter-status");
  await expect(holdingTypeFilterStatus).toBeVisible();
  await expect(holdingTypeFilterStatus).toContainText("유형 필터: 가상자산");
  await expectNoHorizontalOverflow(page, 12);
  await expect(page.locator(".holding-list-card > .sub-tabs").getByRole("tab", { name: "전체" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".holding-list-card > .surface-list-heading .surface-count-summary")).toContainText(/중 1건 표시/);
  await expect(page.locator("tr.holding-row", { hasText: cryptoHoldingName })).toBeVisible();
  await expect(page.locator("tr.holding-row", { hasText: editedHoldingName })).toHaveCount(0);
  await holdingTypeFilterStatus.getByRole("button", { name: "유형 필터 해제" }).click();
  await expect(holdingTypeFilterStatus).toHaveCount(0);
  await expect(page.locator("tr.holding-row", { hasText: editedHoldingName })).toBeVisible();

  for (const width of [345, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await openTab(page, "자산");
    await holdingsJumpCue.click();
    await page.waitForTimeout(160);
    await expectNoOrphanTextLine(holdingSummaryCard.locator("summary > span"), `holding summary title at ${width}px`);
    await expectNoOrphanTextLine(
      holdingSummaryCard.getByRole("heading", { name: "자산 포트폴리오" }),
      `holding portfolio heading at ${width}px`,
    );
    await expectPortfolioLabelsClearOfBottomNav(page, holdingSummaryCard, `holding portfolio chart at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "자산");
  const mobileEditedRow = page.locator("tr.holding-row", { hasText: editedHoldingName }).first();
  await expect(mobileEditedRow).toBeVisible();
  await expect(mobileEditedRow).not.toHaveClass(/mobile-row-expanded/);
  await expect(mobileEditedRow.locator(".holding-col-type")).toContainText(holdingCategory);
  await expectCompactLedgerRow(mobileEditedRow, 62);
  await expectSingleLineText(mobileEditedRow.locator(".holding-col-name").first());
  await expectBackgroundNotPlainWhite(mobileEditedRow);
  await expectTransparentBackground(mobileEditedRow.locator(".holding-col-name").first());
  await expectCompactHeader(page.locator(".section-header-cell").first(), 54);
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
  const holdingToggleBox = await mobileToggleButton.boundingBox();
  expect(holdingToggleBox, "mobile holding detail toggle should have a bounding box").not.toBeNull();
  expect(
    (holdingToggleBox?.width ?? 0) >= 44 && (holdingToggleBox?.height ?? 0) >= 44,
    `mobile holding detail toggle should keep a 44px hit target: ${JSON.stringify(holdingToggleBox)}`,
  ).toBe(true);
  await expectStableButtonPosition(mobileToggleButton, async () => {
    await mobileToggleButton.click({ force: true });
  });
  await expect(mobileEditedRow).toHaveClass(/mobile-row-expanded/);
  const expandedActionRow = mobileEditedRow.locator("xpath=following-sibling::tr[1][contains(@class,'holding-mobile-expanded-actions-row')]");
  await expect(expandedActionRow).toBeVisible();
  await expectMobileHoldingDetailLabels(mobileEditedRow);
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

test("mobile holding expanded details show labeled values", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("holding-detail-label")}@example.com`;
  const displayName = unique("holding-detail-label-name");
  const holdingName = unique("holding-detail-label");
  const holdingCategory = unique("상세라벨");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  const row = await createBasicHolding(page, {
    name: holdingName,
    category: holdingCategory,
    type: "stock",
    quantity: "10",
    averageCost: "72000",
  });
  await expect(row).toBeVisible();
  await row.locator(".mobile-toggle-btn").first().click();
  await expect(row).toHaveClass(/mobile-row-expanded/);
  const scenarios = [
    { width: 390, height: 844, font: "Apple SD Gothic Neo", slug: "390-apple" },
    { width: 320, height: 740, font: "Malgun Gothic", slug: "320-malgun" },
    { width: 412, height: 915, font: "Noto Sans KR", slug: "412-noto" },
  ];
  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.addStyleTag({
      content: `html, body, button, input, select, textarea { font-family: "${scenario.font}", "Noto Sans KR", sans-serif !important; }`,
    });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toHaveClass(/mobile-row-expanded/);
    await expectMobileHoldingDetailLabels(row);
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, `holdings-mobile-detail-labels-${scenario.slug}`);
  }
});

test("mobile holding names remain readable at 320px", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("holding-name-mobile")}@example.com`;
  const displayName = unique("holding-name-mobile-owner");
  const holdingName = "현금성 / 모바일가져오기자산명 / 테스트은행";

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await createBasicHolding(page, { name: holdingName, category: "현금성" });

  await page.setViewportSize({ width: 320, height: 568 });
  await openTab(page, "자산");
  const mobileRow = page.locator("tr.holding-row", { hasText: holdingName }).first();
  await expect(mobileRow).toBeVisible();
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  const scenarios = [
    { width: 320, height: 568, font: "Malgun Gothic", slug: "320-malgun" },
    { width: 390, height: 844, font: "Apple SD Gothic Neo", slug: "390-apple" },
    { width: 430, height: 932, font: "Noto Sans KR", slug: "430-noto" },
  ];
  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.addStyleTag({
      content: `html, body, button, input, select, textarea { font-family: "${scenario.font}", "Noto Sans KR", sans-serif !important; }`,
    });
    await mobileRow.scrollIntoViewIfNeeded();
    await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
    await expectMobileHoldingNameReadable(mobileRow, holdingName);
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, `holdings-mobile-name-readable-${scenario.slug}`);
  }
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

test("mobile holding entry sheet stays within the viewport", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("holding-sheet-overflow-with-long-email")}@example.com`;
  const displayName = unique("holding-sheet-overflow-name");
  await registerAndVerify(page, { email, displayName });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 780 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await openTab(page, "자산");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("holdings-fab").click();

    const holdingSheet = page.getByTestId("holding-entry-sheet");
    await expect(holdingSheet).toBeVisible();
    await expect(labeledField(holdingSheet, "자산명", "textarea")).toBeVisible();

    const metrics = await holdingSheet.evaluate((sheet) => {
      const measured = [sheet, sheet.querySelector(".holdings-form-container"), sheet.querySelector(".holdings-form-grid")]
        .filter(Boolean)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            className: element.className,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            left: rect.left,
            right: rect.right,
            width: rect.width,
          };
        });
      return {
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        measured,
      };
    });

    expect(metrics.documentScrollWidth, `document overflow at ${viewport.width}px`).toBeLessThanOrEqual(viewport.width + 1);
    expect(metrics.bodyScrollWidth, `body overflow at ${viewport.width}px`).toBeLessThanOrEqual(viewport.width + 1);
    for (const entry of metrics.measured) {
      expect(entry.left, `${entry.className} left at ${viewport.width}px`).toBeGreaterThanOrEqual(-1);
      expect(entry.right, `${entry.className} right at ${viewport.width}px`).toBeLessThanOrEqual(viewport.width + 1);
      expect(entry.scrollWidth, `${entry.className} horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(
        entry.clientWidth + 1,
      );
    }

    await capture(page, `holding-entry-sheet-${viewport.width}`);
    await page.getByTestId("holding-entry-sheet-close").click();
    await expect(holdingSheet).toBeHidden();
  }
});
