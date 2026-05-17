import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  currentE2EHistoryDateIso,
  expectKeyboardReachableInOrder,
  expectNoHorizontalOverflow,
  expectWithinViewport,
  labeledField,
  openTab,
  registerAndVerify,
  selectFirstNonEmptyOption,
  unique,
} from "../support/helpers";

async function openSettingsDetails(page, text) {
  const card = page.locator("details.card", { hasText: text }).first();
  await card.scrollIntoViewIfNeeded();
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

async function expectCategoryUsageSummariesKeepHitTargets(page, group, label) {
  await group.scrollIntoViewIfNeeded();
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

test("settings color inputs keep mobile and tablet hit targets", async ({ page }) => {
  const email = `${unique("settings-color-hit")}@example.com`;
  const displayName = unique("settings-color-hit-name");

  await registerAndVerify(page, { email, displayName });

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

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  await openTab(page, "설정");
  await capture(page, "settings-entry");

  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "settings-mobile-entry");

  const profileCard = page.locator("article.card", { has: page.getByRole("heading", { name: "내 프로필" }) });
  await profileCard.scrollIntoViewIfNeeded();
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
  await householdCard.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page, 12);
  await labeledField(householdCard, "가계 이름", "input").fill(householdName);
  await householdCard.getByRole("button", { name: "가계 설정 저장" }).click();
  await expect(page.getByText("가계 설정을 저장했습니다.")).toBeVisible();
  await expect(page.locator(".topbar .meta")).toContainText(`가계: ${householdName}`);

  await page.setViewportSize({ width: 320, height: 720 });
  await assertResponsiveShell(page);
  const settingsSwitchCard = page.locator("article.settings-switch-card");
  await settingsSwitchCard.scrollIntoViewIfNeeded();
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
  await categoryCard.scrollIntoViewIfNeeded();
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
  const assetRulesCard = page.locator("details.settings-asset-rules-card").first();
  await assetRulesCard.scrollIntoViewIfNeeded();
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
    typeOrderButtonMetrics.every(({ width, height }) => width >= 40 && height >= 40),
    `asset type order buttons should keep mobile hit targets: ${JSON.stringify(typeOrderButtonMetrics)}`,
  ).toBe(true);
  await capture(page, "settings-asset-type-order-buttons-mobile");

  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  const usageMemo = unique("usage-memo");
  await openTab(page, "거래");
  const transactionCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "거래 입력" }),
  });
  const txToggleButton = transactionCard.getByRole("button", { name: /거래 추가|입력 닫기/ }).first();
  await expect(txToggleButton).toContainText("거래 추가");
  await expect(transactionCard.locator("form.transactions-form-grid")).toHaveCount(0);
  await txToggleButton.click();
  await expect(transactionCard.locator("form.transactions-form-grid")).toHaveCount(1);
  await labeledField(transactionCard, "유형", "select").selectOption("expense");
  await labeledField(transactionCard, "일자", "input").fill(currentE2EHistoryDateIso());
  await labeledField(transactionCard, "금액", "input").fill("77777");
  await labeledField(transactionCard, "메모", "input").fill(usageMemo);
  await selectFirstNonEmptyOption(labeledField(transactionCard, "거래자", "select"));
  const txMajorSelectNew = labeledField(transactionCard, "카테고리 그룹", "select");
  const txHasNewCategoryLabels = (await txMajorSelectNew.count()) > 0;
  const txMajorSelect = txHasNewCategoryLabels
    ? txMajorSelectNew
    : labeledField(transactionCard, "대분류", "select");
  const txMajorValue = await txMajorSelect.locator("option").evaluateAll(
    (nodes, targetMajor) => {
      const matched = nodes.find((node) => String(node.textContent || "").includes(targetMajor));
      return matched ? String(matched.value || "") : "";
    },
    majorSeed
  );
  expect(txMajorValue).not.toBe("");
  await txMajorSelect.selectOption(txMajorValue);
  const txMinorSelect = txHasNewCategoryLabels
    ? transactionCard.locator("form.transactions-form-grid select").nth(2)
    : labeledField(transactionCard, "중분류", "select");
  await expect(txMinorSelect).toBeEnabled();
  await expect.poll(async () => txMinorSelect.locator("option").count()).toBeGreaterThan(1);
  await txMinorSelect.selectOption({ index: 1 });
  await expect(txMinorSelect.locator("option:checked")).toContainText(minorSeed);
  await transactionCard.getByRole("button", { name: "거래 등록" }).click();
  await expect(page.locator("tr.transaction-row", { hasText: usageMemo }).first()).toBeVisible();
  await openTab(page, "설정");
  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);
  await categoryCard.scrollIntoViewIfNeeded();

  await createCategoryPairCompat(deleteMajor, deleteMinor);
  await categoryCard.getByRole("button", { name: "카테고리 추가" }).click();
  await expect(categoryCard).toContainText(deleteMinor);

  const createdGroup = categoryCard.locator(".settings-category-group", { hasText: majorSeed }).first();
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
