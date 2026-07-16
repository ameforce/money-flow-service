import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createCategoryViaApi,
  expectKeyboardReachableInOrder,
  expectNoHorizontalOverflow,
  expectWithinViewport,
  labeledField,
  openTransactionEntryForm,
  openTab,
  bootstrapVerifiedSession,
  unique,
} from "../support/helpers";

async function scrollLocatorIntoView(locator) {
  await locator.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  });
}

async function openSettingsDetails(page, text) {
  const card = page.locator("details.card", { hasText: text }).first();
  await scrollLocatorIntoView(card);
  if (!(await card.evaluate((element) => element.hasAttribute("open")))) {
    await card.locator("summary").click();
  }
  await expect(card).toHaveAttribute("open", "");
  return card;
}

async function readColorInputMetrics(card) {
  return card.locator("input[type='color']").evaluateAll((inputs) =>
    inputs.map((input) => {
      const box = input.getBoundingClientRect();
      return {
        label: input.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim() || input.getAttribute("aria-label") || "",
        value: input.value,
        width: box.width,
        height: box.height,
      };
    }),
  );
}

function expectColorInputsKeepTouchTargets(metrics, label) {
  expect(metrics.length, `${label} should expose color inputs`).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.width, `${label} ${metric.label || metric.value} width`).toBeGreaterThanOrEqual(44);
    expect(metric.height, `${label} ${metric.label || metric.value} height`).toBeGreaterThanOrEqual(40);
  }
}

async function expectPassiveStatusStripsDoNotScroll(page, label) {
  const metrics = await page.locator(".secondary-control-strip[role='group']").evaluateAll((strips) =>
    strips.map((strip) => ({
      label: strip.getAttribute("aria-label") || "",
      clientWidth: strip.clientWidth,
      scrollWidth: strip.scrollWidth,
      overflowX: getComputedStyle(strip).overflowX,
    })),
  );
  expect(metrics.length, `${label} should expose passive status strips`).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric.scrollWidth, `${label}/${metric.label} should wrap without horizontal scrolling: ${JSON.stringify(metric)}`).toBeLessThanOrEqual(
      metric.clientWidth + 1,
    );
    expect(metric.overflowX, `${label}/${metric.label} should not be a scroll container`).not.toBe("auto");
  }
}

async function expectCategoryUsageSummariesKeepHitTargets(page, group, label) {
  await scrollLocatorIntoView(group);
  const summaryMetrics = await group.locator(".settings-category-usage-detail .category-usage-month summary").evaluateAll((summaries) =>
    summaries.map((summary) => {
      const box = summary.getBoundingClientRect();
      return {
        text: summary.textContent?.replace(/\s+/g, " ").trim() || "",
        width: box.width,
        height: box.height,
      };
    }),
  );
  expect(summaryMetrics.length, `${label} should expose monthly usage summaries`).toBeGreaterThan(0);
  expect(
    summaryMetrics.every(({ height }) => height >= 44),
    `${label} monthly usage summaries should keep 44px hit targets: ${JSON.stringify(summaryMetrics)}`,
  ).toBe(true);
  await expectNoHorizontalOverflow(page, 12);
}

async function expectMajorRenameInputAccessible(page, group, label) {
  await scrollLocatorIntoView(group);
  const majorRenameInput = group.locator("input[placeholder='새 대분류명']").first();
  await expect(majorRenameInput).toHaveAccessibleName(/대분류 변경 새 이름/);
  const inputMetrics = await majorRenameInput.evaluate((input) => {
    const box = input.getBoundingClientRect();
    return {
      ariaLabel: input.getAttribute("aria-label") || "",
      placeholder: input.getAttribute("placeholder") || "",
      width: box.width,
      height: box.height,
    };
  });
  expect(inputMetrics.ariaLabel, `${label} major rename input should not rely on placeholder`).toContain("대분류 변경 새 이름");
  expect(inputMetrics.placeholder, `${label} placeholder should remain visual hint only`).toBe("새 대분류명");
  await expectNoHorizontalOverflow(page, 12);
}

test("settings color inputs keep mobile and tablet hit targets", async ({ page }) => {
  const email = `${unique("settings-color-hit")}@example.com`;
  const displayName = unique("settings-color-hit-name");

  await bootstrapVerifiedSession(page, { email, displayName });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await assertResponsiveShell(page);
    await openTab(page, "설정");

    const rowColorCard = await openSettingsDetails(page, "거래 행 색상");
    const rowMetrics = await readColorInputMetrics(rowColorCard);
    expect(rowMetrics.length, "transaction row color inputs should cover flow types").toBeGreaterThanOrEqual(4);
    expectColorInputsKeepTouchTargets(rowMetrics, `${viewport.width}x${viewport.height} transaction colors`);

    const assetRulesCard = await openSettingsDetails(page, "자산 유형/색상 설정");
    const assetMetrics = await readColorInputMetrics(assetRulesCard);
    expectColorInputsKeepTouchTargets(assetMetrics, `${viewport.width}x${viewport.height} holding colors`);
    await expectNoHorizontalOverflow(page, 12);
  }

  await capture(page, "settings-color-input-hit-targets");
});

test("settings passive status strips wrap instead of creating keyboard-inaccessible scroll regions", async ({ page }) => {
  const email = `${unique("settings-status-strip")}@example.com`;
  const displayName = unique("settings-status-strip-name-with-a-long-mobile-label");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 320, height: 568 });
  await assertResponsiveShell(page);
  await openTab(page, "설정");

  await expectPassiveStatusStripsDoNotScroll(page, "320x568 settings");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "settings-passive-status-strips-mobile");
});

test("issue 236: mobile asset type rule checkboxes keep touch targets", async ({ page }) => {
  const email = `${unique("settings-asset-rule-hit")}@example.com`;
  const displayName = unique("settings-asset-rule-hit-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);
  await openTab(page, "설정");

  const assetRulesCard = await openSettingsDetails(page, "자산 유형/색상 설정");
  const targetLabels = ["시장 추적형 유형", "평균단가/평가금액 입력 표시", "손익 표시"];
  const targetMetrics = [];
  for (const text of targetLabels) {
    const label = assetRulesCard.locator("label.check-row", { hasText: text }).first();
    await scrollLocatorIntoView(label);
    await expect(label).toBeVisible();
    targetMetrics.push(
      await label.evaluate((element) => {
        const input = element.querySelector("input[type='checkbox']");
        const labelBox = element.getBoundingClientRect();
        const inputBox = input?.getBoundingClientRect();
        const centerX = labelBox.left + labelBox.width / 2;
        const centerY = labelBox.top + labelBox.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);
        return {
          text: element.textContent?.replace(/\s+/g, " ").trim() || "",
          labelHeight: labelBox.height,
          labelWidth: labelBox.width,
          inputHeight: inputBox?.height || 0,
          inputWidth: inputBox?.width || 0,
          centerHitsLabel: Boolean(topElement && (topElement === element || element.contains(topElement))),
        };
      }),
    );
  }

  expect(targetMetrics, `asset type rule labels should be present: ${JSON.stringify(targetMetrics)}`).toHaveLength(3);
  for (const metric of targetMetrics) {
    expect(metric.labelHeight, `${metric.text} label hit target height: ${JSON.stringify(targetMetrics)}`).toBeGreaterThanOrEqual(44);
    expect(metric.labelWidth, `${metric.text} label should span a tappable row: ${JSON.stringify(targetMetrics)}`).toBeGreaterThanOrEqual(220);
    expect(metric.inputWidth, `${metric.text} checkbox should remain visible: ${JSON.stringify(targetMetrics)}`).toBeGreaterThanOrEqual(16);
    expect(metric.inputHeight, `${metric.text} checkbox should remain visible: ${JSON.stringify(targetMetrics)}`).toBeGreaterThanOrEqual(16);
    expect(metric.centerHitsLabel, `${metric.text} row center should hit the label: ${JSON.stringify(targetMetrics)}`).toBe(true);
  }

  const gainLossRule = assetRulesCard.locator("label.check-row", { hasText: "손익 표시" }).first();
  const gainLossInput = gainLossRule.locator("input[type='checkbox']");
  await scrollLocatorIntoView(gainLossRule);
  const before = await gainLossInput.isChecked();
  await gainLossRule.click({ position: { x: 180, y: 22 } });
  await expect(gainLossInput, "tapping the rule row should toggle the checkbox").toBeChecked({ checked: !before });
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-236-mobile-asset-type-rule-hit-targets");
});

test("settings category row actions stay inside mobile cards", async ({ page }) => {
  const email = `${unique("settings-category-actions")}@example.com`;
  const displayName = unique("settings-category-actions-name");
  const major = unique("settings-mobile-major");
  const minor = unique("settings-mobile-minor");

  await bootstrapVerifiedSession(page, { email, displayName });
  await createCategoryViaApi(page, { major, minor, flowType: "expense" });
  await page.reload();

  await page.setViewportSize({ width: 360, height: 740 });
  await assertResponsiveShell(page);
  await openTab(page, "설정");

  const categoryCard = page.locator("article.card", { has: page.getByRole("heading", { name: "카테고리 관리" }) });
  await scrollLocatorIntoView(categoryCard);
  const categoryRow = categoryCard.locator(".settings-category-row", { hasText: minor }).first();
  await expect(categoryRow).toBeVisible();

  const metrics = await categoryRow.evaluate((row) => {
    const card = row.closest(".category-manager-card");
    const actionGroup = row.querySelector(".inline");
    const boxOf = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      };
    };
    return {
      viewportWidth: window.innerWidth,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      card: card
        ? {
            box: boxOf(card),
            clientWidth: card.clientWidth,
            scrollWidth: card.scrollWidth,
          }
        : null,
      row: {
        box: boxOf(row),
        clientWidth: row.clientWidth,
        scrollWidth: row.scrollWidth,
        gridTemplateColumns: getComputedStyle(row).gridTemplateColumns,
      },
      actionGroup: actionGroup
        ? {
            box: boxOf(actionGroup),
            flexWrap: getComputedStyle(actionGroup).flexWrap,
            clientWidth: actionGroup.clientWidth,
            scrollWidth: actionGroup.scrollWidth,
          }
        : null,
      buttons: Array.from(row.querySelectorAll("button")).map((button) => ({
        text: button.textContent?.replace(/\s+/g, " ").trim() || "",
        box: boxOf(button),
      })),
    };
  });

  expect(metrics.card, `category card should be measurable: ${JSON.stringify(metrics)}`).not.toBeNull();
  expect(metrics.actionGroup, `category action group should be measurable: ${JSON.stringify(metrics)}`).not.toBeNull();
  expect(metrics.pageOverflowX, `settings page should not overflow horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(
    metrics.card.scrollWidth,
    `category card content should stay inside the card: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(metrics.card.clientWidth + 1);
  expect(
    metrics.row.scrollWidth,
    `category row content should stay inside the row: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(metrics.row.clientWidth + 1);
  expect(metrics.actionGroup.flexWrap, `mobile action group should wrap: ${JSON.stringify(metrics)}`).toBe("wrap");
  for (const button of metrics.buttons) {
    expect(button.box.right, `${button.text} button should stay inside the viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
      metrics.viewportWidth + 1,
    );
    expect(button.box.height, `${button.text} button should keep touch height: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(40);
  }
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "settings-category-actions-mobile");
});

test("settings flow: profile, household, colors, categories CRUD", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("settings-user")}@example.com`;
  const displayName = unique("settings-real");
  const nickname = unique("settings-nick");
  const householdName = unique("settings-household");
  const expenseColor = "#E6F4EA";
  const majorSeed = unique("major");
  const minorSeed = unique("minor");
  const renamedMajor = `${majorSeed}-renamed`;
  const renamedMinor = `${minorSeed}-edited`;
  const deleteMajor = unique("delete-major");
  const deleteMinor = unique("delete-minor");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  await openTab(page, "설정");
  await capture(page, "settings-entry");

  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "settings-mobile-entry");

  const profileCard = page.locator("article.card", { has: page.getByRole("heading", { name: "내 프로필" }) });
  await scrollLocatorIntoView(profileCard);
  const nicknameInput = labeledField(profileCard, "닉네임", "input");
  const profileSaveButton = profileCard.getByRole("button", { name: "프로필 저장" });
  await expectWithinViewport(nicknameInput);
  await expectWithinViewport(profileSaveButton);
  await expectKeyboardReachableInOrder(page, [nicknameInput, profileSaveButton]);
  await nicknameInput.fill(nickname);
  await labeledField(profileCard, "표시명 방식", "select").selectOption("nickname");
  await profileSaveButton.click();
  const profileSavedMessage = page.locator(".message").first();
  await expect(profileSavedMessage).toBeVisible();
  const dismissButton = profileSavedMessage.locator(".message-close").first();
  const canDismiss = await dismissButton.isVisible().catch(() => false);
  if (canDismiss) {
    await dismissButton.click();
    await expect(profileSavedMessage).toHaveCount(0);
  }
  await expect(page.locator(".topbar .meta")).toContainText(`사용자: ${nickname}`);

  const householdCard = page.locator("article.card", { has: page.getByRole("heading", { name: "가계 설정" }) });
  await scrollLocatorIntoView(householdCard);
  await expectNoHorizontalOverflow(page, 12);
  await labeledField(householdCard, "가계 이름", "input").fill(householdName);
  await householdCard.getByRole("button", { name: "가계 설정 저장" }).click();
  await expect(page.getByText("가계 설정을 저장했습니다.")).toBeVisible();
  await expect(page.locator(".topbar .meta")).toContainText(`가계: ${householdName}`);

  await page.setViewportSize({ width: 320, height: 720 });
  await assertResponsiveShell(page);
  const settingsSwitchCard = page.locator("article.settings-switch-card");
  await scrollLocatorIntoView(settingsSwitchCard);
  const settingsHouseholdSelect = settingsSwitchCard.locator("select.household-select").first();
  await expectWithinViewport(settingsHouseholdSelect);
  const switchMetrics = await settingsHouseholdSelect.evaluate((select) => {
    const summaryId = select.getAttribute("aria-describedby") || "";
    const summary = summaryId ? document.getElementById(summaryId) : null;
    return {
      clientWidth: select.clientWidth,
      scrollWidth: select.scrollWidth,
      optionText: select.options[select.selectedIndex]?.textContent?.trim() || "",
      summaryText: summary?.textContent?.trim() || "",
    };
  });
  expect(switchMetrics.optionText).toBe(householdName);
  expect(switchMetrics.optionText).not.toContain("내 권한");
  expect(switchMetrics.summaryText).toContain(householdName);
  expect(switchMetrics.summaryText).toContain("내 권한");
  expect(switchMetrics.scrollWidth).toBeLessThanOrEqual(switchMetrics.clientWidth + 1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "settings-household-switch-mobile-320");
  await page.setViewportSize({ width: 390, height: 844 });

  const colorDetailsCard = page.locator("details.card", { hasText: "거래 행 색상" }).first();
  const colorCard =
    (await colorDetailsCard.count()) > 0
      ? colorDetailsCard
      : page.locator("article.card", { has: page.getByRole("heading", { name: "거래 행 색상" }) });
  if ((await colorDetailsCard.count()) > 0) {
    await colorDetailsCard.locator("summary").click();
    await expect(colorDetailsCard).toHaveAttribute("open", "");
  }
  await colorCard.locator("input[type='color']").nth(1).fill(expenseColor);
  await colorCard.getByRole("button", { name: "색상 저장" }).click();
  await expect(page.getByText("가계 설정을 저장했습니다.")).toBeVisible();

  const categoryCard = page.locator("article.card", { has: page.getByRole("heading", { name: "카테고리 관리" }) });
  await scrollLocatorIntoView(categoryCard);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "settings-mobile-controls");
  const quickCategorySelect = labeledField(categoryCard, "기존 카테고리 선택", "select");
  const findCategoryOptionValue = async (major, minor) => {
    if ((await quickCategorySelect.count()) === 0) {
      return "";
    }
    return quickCategorySelect.locator("option").evaluateAll(
      (nodes, target) => {
        const [majorText, minorText] = target;
        const matched = nodes.find((node) => {
          const text = String(node.textContent || "");
          return text.includes(majorText) && text.includes(minorText);
        });
        return matched ? String(matched.value || "") : "";
      },
      [major, minor]
    );
  };
  const createCategoryPairCompat = async (major, minor) => {
    const majorSelect = labeledField(categoryCard, "새 대분류", "select");
    if ((await majorSelect.count()) > 0) {
      await majorSelect.selectOption("__custom__");
      await labeledField(categoryCard, "새 대분류 입력", "input").fill(major);
      const firstMinorSelect = labeledField(categoryCard, "첫 중분류", "select");
      if ((await firstMinorSelect.count()) > 0) {
        await firstMinorSelect.selectOption("__custom__");
        await labeledField(categoryCard, "첫 중분류 입력", "input").fill(minor);
      } else {
        const firstMinorInput = labeledField(categoryCard, "첫 중분류", "input");
        if ((await firstMinorInput.count()) > 0) {
          await firstMinorInput.fill(minor);
        } else {
          await labeledField(categoryCard, "새 중분류", "input").fill(minor);
        }
      }
      return;
    }
    await labeledField(categoryCard, "새 대분류", "input").fill(major);
    const firstMinorInput = labeledField(categoryCard, "첫 중분류", "input");
    if ((await firstMinorInput.count()) > 0) {
      await firstMinorInput.fill(minor);
    } else {
      await labeledField(categoryCard, "새 중분류", "input").fill(minor);
    }
  };
  const categoryTypeSelect = labeledField(categoryCard, "유형", "select");
  const categoryAddButton = categoryCard.getByRole("button", { name: "카테고리 추가" });
  await expectWithinViewport(categoryTypeSelect);
  await expectWithinViewport(categoryAddButton);
  await expectKeyboardReachableInOrder(page, [categoryTypeSelect, categoryAddButton], { maxTabsPerLocator: 40 });
  await categoryTypeSelect.selectOption("expense");
  await createCategoryPairCompat(majorSeed, minorSeed);
  await categoryCard.getByRole("button", { name: "카테고리 추가" }).click();
  await expect(page.getByText("카테고리를 추가했습니다.")).toBeVisible();
  const createdGroup = categoryCard.locator(".settings-category-group", { hasText: majorSeed }).first();
  const createdCategoryRow = createdGroup.locator(".settings-category-row", { hasText: minorSeed }).first();
  await page.setViewportSize({ width: 844, height: 390 });
  await assertResponsiveShell(page);
  await scrollLocatorIntoView(categoryCard);
  const landscapeCategoryMetrics = await createdCategoryRow.evaluate((row) => {
    const minor = row.querySelector(".settings-category-minor");
    const rowBox = row.getBoundingClientRect();
    const minorBox = minor?.getBoundingClientRect();
    const minorStyle = minor ? getComputedStyle(minor) : null;
    const minorLineHeight = Number.parseFloat(minorStyle?.lineHeight || "") || Number.parseFloat(minorStyle?.fontSize || "") * 1.35 || 24;
    return {
      gridTemplateColumns: getComputedStyle(row).gridTemplateColumns,
      rowHeight: rowBox.height,
      rowClientWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      minorText: minor?.textContent?.replace(/\s+/g, " ").trim() || "",
      minorWidth: minorBox?.width ?? 0,
      minorHeight: minorBox?.height ?? 0,
      minorLineHeight,
    };
  });
  expect(
    landscapeCategoryMetrics.gridTemplateColumns,
    `landscape category row should not collapse a column: ${JSON.stringify(landscapeCategoryMetrics)}`,
  ).not.toContain("0px");
  expect(
    landscapeCategoryMetrics.minorWidth,
    `landscape category minor should remain readable: ${JSON.stringify(landscapeCategoryMetrics)}`,
  ).toBeGreaterThanOrEqual(96);
  expect(
    landscapeCategoryMetrics.minorHeight,
    `landscape category minor should not wrap one character per line: ${JSON.stringify(landscapeCategoryMetrics)}`,
  ).toBeLessThanOrEqual(landscapeCategoryMetrics.minorLineHeight * 2.25);
  expect(
    landscapeCategoryMetrics.rowScrollWidth,
    `landscape category row should not overflow internally: ${JSON.stringify(landscapeCategoryMetrics)}`,
  ).toBeLessThanOrEqual(landscapeCategoryMetrics.rowClientWidth + 1);
  await expectNoHorizontalOverflow(page, 12);
  await page.setViewportSize({ width: 390, height: 844 });
  const assetRulesCard = page.locator("details.settings-asset-rules-card").first();
  await scrollLocatorIntoView(assetRulesCard);
  if (!(await assetRulesCard.evaluate((element) => element.hasAttribute("open")))) {
    await assetRulesCard.locator("summary").click();
  }
  await expect(assetRulesCard).toHaveAttribute("open", "");
  const typeOrderButtonMetrics = await assetRulesCard.locator(".settings-type-order-btn").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        label: button.getAttribute("aria-label") || button.textContent?.trim() || "",
        width: box.width,
        height: box.height,
      };
    }),
  );
  expect(typeOrderButtonMetrics.length, "asset type order buttons should be present").toBeGreaterThanOrEqual(4);
  expect(
    typeOrderButtonMetrics.every(({ width, height }) => width >= 44 && height >= 44),
    `asset type order buttons should keep mobile hit targets: ${JSON.stringify(typeOrderButtonMetrics)}`,
  ).toBe(true);
  await capture(page, "settings-asset-type-order-buttons-mobile");

  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  const usageMemo = unique("usage-memo");
  const { container: transactionEntry } = await openTransactionEntryForm(page);
  await transactionEntry.getByTestId("transaction-quick-amount").fill("77777");
  await labeledField(transactionEntry, "메모", "input").fill(usageMemo);
  const stagedCategoryPicker = transactionEntry.getByTestId("transaction-staged-category");
  await expect(stagedCategoryPicker).toBeVisible();
  const searchToggle = stagedCategoryPicker.getByTestId("transaction-category-search-toggle");
  if ((await searchToggle.count()) > 0 && (await searchToggle.isVisible().catch(() => false))) {
    await searchToggle.click();
  }
  const categorySearch = stagedCategoryPicker.getByTestId("transaction-category-search");
  await expect(categorySearch).toBeVisible();
  await categorySearch.fill(minorSeed);
  const targetCategoryChip = stagedCategoryPicker.getByTestId("transaction-category-search-option").filter({ hasText: minorSeed }).first();
  await expect(targetCategoryChip).toBeVisible();
  await targetCategoryChip.click();
  await expect(stagedCategoryPicker).toContainText(minorSeed);
  await transactionEntry.getByRole("button", { name: "거래 등록" }).click();
  await expect(page.locator("tr.transaction-row", { hasText: usageMemo }).first()).toBeVisible();
  await openTab(page, "설정");
  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);
  await scrollLocatorIntoView(categoryCard);

  await createCategoryPairCompat(deleteMajor, deleteMinor);
  await categoryCard.getByRole("button", { name: "카테고리 추가" }).click();
  await expect(categoryCard).toContainText(deleteMinor);

  for (const viewport of [
    { width: 320, height: 568, label: "320x568" },
    { width: 375, height: 667, label: "375x667" },
    { width: 667, height: 375, label: "667x375" },
    { width: 1024, height: 600, label: "1024x600" },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await assertResponsiveShell(page);
    await expectMajorRenameInputAccessible(page, createdGroup, viewport.label);
  }
  const usageRow = createdGroup.locator(".settings-category-row", { hasText: minorSeed }).first();
  const usageToggleButton = usageRow.locator("button[aria-expanded]").first();
  await expect(usageToggleButton).toHaveAttribute("aria-expanded", "false");
  await usageToggleButton.click();
  await expect(usageToggleButton).toHaveAttribute("aria-expanded", "true");
  const usageDetail = createdGroup.locator(".settings-category-usage-detail").first();
  await expect(usageDetail).toBeVisible();
  const usageSummary = usageDetail.locator("summary").first();
  await expect(usageSummary).toContainText(/건/);
  await expect(usageSummary).toContainText("합계");
  const usageMonthDetail = usageDetail.locator("details").first();
  const usageMonthInitiallyOpen = await usageMonthDetail.evaluate((node) => node.hasAttribute("open"));
  if (!usageMonthInitiallyOpen) {
    await usageSummary.click();
    await expect.poll(() => usageMonthDetail.evaluate((node) => node.hasAttribute("open"))).toBe(true);
  } else {
    await expect(usageMonthDetail).toBeVisible();
  }
  for (const viewport of [
    { width: 375, height: 667, label: "375x667" },
    { width: 667, height: 375, label: "667x375" },
    { width: 1024, height: 600, label: "1024x600" },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await assertResponsiveShell(page);
    await expectCategoryUsageSummariesKeepHitTargets(page, createdGroup, viewport.label);
  }

  const createdCategoryOption = await findCategoryOptionValue(majorSeed, minorSeed);
  if (createdCategoryOption) {
    await quickCategorySelect.selectOption(createdCategoryOption);
    await categoryCard.getByRole("button", { name: "선택 수정" }).click();
  } else {
    const createdRow = createdGroup.locator(".settings-category-row", { hasText: minorSeed }).first();
    await createdRow.getByRole("button", { name: "중분류 수정" }).click();
  }
  const editingRow = createdGroup.locator(".category-row-editing").first();
  await editingRow.locator("input").fill(renamedMinor);
  await editingRow.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("카테고리를 수정했습니다.")).toBeVisible();

  const majorInput = createdGroup.locator("input[placeholder='새 대분류명']").first();
  await majorInput.fill(renamedMajor);
  await createdGroup.getByRole("button", { name: "대분류 변경" }).click();
  await expect(page.getByText("대분류 이름을 일괄 변경했습니다.")).toBeVisible();
  await expect(categoryCard).toContainText(renamedMajor);

  const deleteCategoryOption = await findCategoryOptionValue(deleteMajor, deleteMinor);
  if (deleteCategoryOption) {
    await quickCategorySelect.selectOption(deleteCategoryOption);
    await categoryCard.getByRole("button", { name: "선택 삭제" }).click();
  } else {
    const deleteGroup = categoryCard.locator(".settings-category-group", { hasText: deleteMajor }).first();
    await deleteGroup
      .locator(".settings-category-row", { hasText: deleteMinor })
      .first()
      .getByRole("button", { name: "삭제" })
      .click();
  }
  const confirmDialog = page.locator(".confirm-dialog");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByText("카테고리를 삭제했습니다.")).toBeVisible();
  await expect(categoryCard).not.toContainText(deleteMajor);
  await capture(page, "settings-result");
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "설정");
  await assertResponsiveShell(page);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "settings-mobile-result");
});
