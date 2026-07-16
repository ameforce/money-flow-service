import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicHolding,
  createBasicTransaction,
  currentE2EHistoryDateIso,
  expectDonutLabelsCenteredOnRing,
  expectDonutLabelsInsideChart,
  expectDonutTextNotClipped,
  expectKeyboardReachableInOrder,
  expectNoOrphanTextLine,
  expectNoHorizontalOverflow,
  expectPortfolioLabelsClearOfBottomNav,
  expectTextContrast,
  expectWithinViewport,
  openTab,
  bootstrapVerifiedSession,
  unique,
} from "../support/helpers";

function previousMonthMiddleIso() {
  const [year, month] = currentE2EHistoryDateIso().split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 2, 15)).toISOString().slice(0, 10);
}

function currentMonthBounds() {
  const [year, month] = currentE2EHistoryDateIso().split("-").map((part) => Number(part));
  const monthText = String(month).padStart(2, "0");
  return {
    start: `${year}-${monthText}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

async function expectDonutSliceLabelsWithoutLeftAccentBars(card, label) {
  const metrics = await card.getByTestId("portfolio-donut-slice-label").evaluateAll((nodes) =>
    nodes.map((node) => {
      const before = getComputedStyle(node, "::before");
      return {
        text: node.textContent?.replace(/\s+/g, " ").trim(),
        beforeContent: before.content,
        beforeDisplay: before.display,
        beforeWidth: Number.parseFloat(before.width || "0") || 0,
      };
    }),
  );
  expect(metrics.length, `${label} should expose slice labels before checking accent bars`).toBeGreaterThan(0);
  for (const item of metrics) {
    expect(
      item.beforeDisplay === "none" || item.beforeContent === "none" || item.beforeWidth <= 0.5,
      `${label} ${item.text} should not render a left accent bar: ${JSON.stringify(item)}`
    ).toBe(true);
  }
}

async function expectDashboardHeroNoInternalOverflow(page, label) {
  const metrics = await page.locator(".dashboard-hero-card").evaluate((hero) => {
    const heroBox = hero.getBoundingClientRect();
    const selectors = [
      ".dashboard-hero-copy",
      ".dashboard-hero-metric",
      ".dashboard-hero-metric strong",
      ".dashboard-hero-metric small",
      ".dashboard-kpi-grid",
      ".dashboard-kpi-card",
      ".dashboard-kpi-card strong",
      ".dashboard-kpi-value-line",
      ".dashboard-kpi-value-main",
      ".dashboard-kpi-value-meta",
    ];
    const elements = Array.from(hero.querySelectorAll(selectors.join(",")))
      .map((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const overflowX = Math.max(
          0,
          element.scrollWidth - element.clientWidth,
          box.right - heroBox.right,
          heroBox.left - box.left,
        );
        return {
          selector: selectors.find((selector) => element.matches(selector)) || element.tagName.toLowerCase(),
          text: element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) || "",
          display: style.display,
          width: box.width,
          height: box.height,
          overflowX,
        };
      })
      .filter((item) => item.display !== "none" && item.width > 0 && item.height > 0);
    return {
      heroClientWidth: hero.clientWidth,
      heroScrollWidth: hero.scrollWidth,
      worstElement: elements.sort((left, right) => right.overflowX - left.overflowX)[0] || null,
    };
  });

  expect(metrics.heroScrollWidth, `${label} hero internal width`).toBeLessThanOrEqual(metrics.heroClientWidth + 1);
  expect(
    metrics.worstElement?.overflowX ?? 0,
    `${label} internal overflow at ${metrics.worstElement?.selector || "none"}: ${metrics.worstElement?.text || ""}`,
  ).toBeLessThanOrEqual(1);
}

async function readDashboardFilterLayout(filterCard) {
  return filterCard.evaluate((card) => {
    const mode = card.querySelector(".filter-modes-segmented")?.getBoundingClientRect();
    const inputs = card.querySelector(".filter-inputs-wrapper")?.getBoundingClientRect();
    const stepper = card.querySelector(".month-stepper")?.getBoundingClientRect();
    const range = card.querySelector(".range-picker")?.getBoundingClientRect();
    const presetRow = card.querySelector(".range-preset-row")?.getBoundingClientRect();
    const dates = Array.from(card.querySelectorAll('input[type="date"]')).map((input) => input.getBoundingClientRect());
    const presetButtons = Array.from(card.querySelectorAll(".range-preset-row button")).map((button) => {
      const buttonBox = button.getBoundingClientRect();
      return {
        height: buttonBox.height,
      };
    });
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
        left: childBox.left,
        right: childBox.right,
        topInset: stepper ? childBox.top - stepper.top : 0,
        bottomInset: stepper ? stepper.bottom - childBox.bottom : 0,
      };
    });
    const orderedStepperChildren = [...stepperChildren].sort((left, right) => left.left - right.left);
    const stepperOverlaps = orderedStepperChildren.slice(1).map((child, index) => {
      const previous = orderedStepperChildren[index];
      return {
        pair: `${previous.label} -> ${child.label}`,
        overlap: previous.right - child.left,
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
      modeBottom: mode?.bottom ?? 0,
      modeHeight: mode?.height ?? 0,
      stepperHeight: stepper?.height ?? 0,
      rangeHeight: range?.height ?? 0,
      rangeBottom: range?.bottom ?? 0,
      presetY: presetRow?.y ?? 0,
      presetHeight: presetRow?.height ?? 0,
      stepperClientWidth: stepper ? Math.round(stepper.width) : 0,
      stepperScrollWidth: stepper ? card.querySelector(".month-stepper").scrollWidth : 0,
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
      presetButtons,
      stepperChildren,
      stepperOverlaps,
      cardBoxShadow: getComputedStyle(card).boxShadow,
      modeBoxShadow: modeStyle?.boxShadow || "",
      stepperBoxShadow: stepperStyle?.boxShadow || "",
      rangeBoxShadow: rangeStyle?.boxShadow || "",
    };
  });
}

function expectMonthlyFilterLayout(layout) {
  const stacked = layout.inputsY > layout.modeBottom + 2;
  expect(layout.height).toBeLessThanOrEqual(stacked ? 138 : 72);
  if (stacked) {
    expect(layout.inputsY - layout.modeBottom).toBeGreaterThanOrEqual(4);
  } else {
    expect(Math.abs(layout.modeY - layout.inputsY)).toBeLessThanOrEqual(2);
  }
  expect(Math.abs(layout.modeHeight - layout.stepperHeight)).toBeLessThanOrEqual(1);
  if (!stacked) {
    expect(Math.abs(layout.modeCenterY - layout.stepperCenterY)).toBeLessThanOrEqual(1);
  }
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
  expect(layout.stepperScrollWidth, "month-stepper should not overflow horizontally").toBeLessThanOrEqual(layout.stepperClientWidth + 1);
  for (const overlap of layout.stepperOverlaps) {
    expect(overlap.overlap, `${overlap.pair} should not overlap horizontally`).toBeLessThanOrEqual(0.5);
  }
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
  const stacked = layout.inputsY > layout.modeBottom + 2;
  const stackedHeightLimit = layout.presetHeight > 0 ? 216 : 180;
  expect(layout.height).toBeLessThanOrEqual(stacked ? stackedHeightLimit : 72);
  if (stacked) {
    expect(layout.inputsY - layout.modeBottom).toBeGreaterThanOrEqual(4);
    expect(layout.rangeHeight).toBeGreaterThanOrEqual(layout.modeHeight);
    if (layout.presetHeight > 0) {
      expect(layout.presetY - layout.rangeBottom).toBeGreaterThanOrEqual(4);
    }
  } else {
    expect(Math.abs(layout.modeY - layout.inputsY)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.modeHeight - layout.rangeHeight)).toBeLessThanOrEqual(1);
  }
  if (!stacked) {
    expect(Math.abs(layout.modeCenterY - layout.rangeCenterY)).toBeLessThanOrEqual(1);
  }
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
  for (const button of layout.presetButtons) {
    expect(button.height, "range preset buttons should keep a mobile touch target").toBeGreaterThanOrEqual(40);
  }
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

async function expectPressFeedbackWhenEnabled(page, button, label) {
  await expect(button, `${label} button should remain visible`).toBeVisible();
  if (await button.isEnabled()) {
    await expectPressFeedback(page, button, label);
  }
}

async function expectNoRefreshNoteLayoutShiftWhenEnabled(page, button, filterCard, label) {
  await expect(button, `${label} button should remain visible`).toBeVisible();
  if (await button.isEnabled()) {
    await expectNoRefreshNoteLayoutShift(page, button, filterCard, label);
  }
}

async function applyFontFamily(page, fontFamily) {
  await page.evaluate((nextFontFamily) => {
    document.documentElement.style.setProperty("--mf-font-family", nextFontFamily);
  }, fontFamily);
}

async function expectTopbarActionHitAreas(page, label) {
  const metrics = await page.locator(".topbar-actions button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        text: button.textContent?.replace(/\s+/g, " ").trim(),
        height: box.height,
        width: box.width,
      };
    }),
  );
  expect(metrics, `${label} should expose the three global topbar actions`).toHaveLength(3);
  expect(
    metrics.every(({ height, width }) => height >= 44 && width >= 44),
    `${label} topbar action hit areas: ${JSON.stringify(metrics)}`,
  ).toBe(true);
}

async function expectPriceRefreshIconAction(page, label) {
  const button = page.getByRole("button", { name: "시세 갱신" });
  await expect(button).toBeVisible();
  const metrics = await button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const actionButtons = Array.from(element.closest(".topbar-actions")?.querySelectorAll("button") || []);
    const actionDetails = actionButtons.map((buttonElement) => {
      const describedBy = String(buttonElement.getAttribute("aria-describedby") || "").trim();
      const description = describedBy
        .split(/\s+/u)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim() || "")
        .filter(Boolean)
        .join(" ");
      return {
        ariaLabel: buttonElement.getAttribute("aria-label") || "",
        description,
        text: String(buttonElement.textContent || "").replace(/\s+/g, " ").trim(),
      };
    });
    const actionIcons = actionButtons.map((buttonElement) => {
      const icon = buttonElement.querySelector(".topbar-action-icon svg");
      const box = icon?.getBoundingClientRect();
      const before = getComputedStyle(buttonElement, "::before");
      return {
        hasIcon: Boolean(icon),
        ariaHidden: icon?.getAttribute("aria-hidden") || "",
        width: box?.width ?? 0,
        height: box?.height ?? 0,
        pseudoContent: before.content,
        pseudoDisplay: before.display,
      };
    });
    const textMetrics = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
      if (text.includes("시세")) {
        const parent = node.parentElement || element;
        const style = getComputedStyle(parent);
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        textMetrics.push({
          text,
          width: rect.width,
          height: rect.height,
          fontSize: Number.parseFloat(style.fontSize) || 0,
          display: style.display,
          visibility: style.visibility,
          opacity: Number.parseFloat(style.opacity) || 0,
        });
        range.detach();
      }
      node = walker.nextNode();
    }
    const describedBy = String(element.getAttribute("aria-describedby") || "").trim();
    const description = describedBy
      .split(/\s+/u)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, " ").trim() || "")
      .filter(Boolean)
      .join(" ");
    return {
      ariaLabel: element.getAttribute("aria-label") || "",
      buttonWidth: box.width,
      buttonHeight: box.height,
      actionWidths: actionButtons.map((buttonElement) => buttonElement.getBoundingClientRect().width),
      actionDetails,
      actionIcons,
      textMetrics,
      description,
    };
  });
  const visiblePriceText = metrics.textMetrics.filter(
    (item) =>
      item.width >= 8 &&
      item.height >= 8 &&
      item.fontSize >= 8 &&
      item.display !== "none" &&
      item.visibility !== "hidden" &&
      item.opacity >= 0.5,
  );
  expect(metrics.ariaLabel, `${label} should keep the accessible action name stable`).toBe("시세 갱신");
  expect(metrics.actionDetails[0]?.ariaLabel, `${label} refresh action should keep a stable name`).toBe("새로고침");
  expect(
    metrics.actionDetails[0]?.description || "",
    `${label} refresh action should expose non-layout status copy: ${JSON.stringify(metrics)}`,
  ).toContain("새로고침");
  expect(metrics.description, `${label} should expose non-layout status copy: ${JSON.stringify(metrics)}`).toContain(
    "시세 갱신",
  );
  expect(
    visiblePriceText,
    `${label} should not render 시세 갱신 as a visible mobile text button: ${JSON.stringify(metrics)}`,
  ).toHaveLength(0);
  expect(
    Math.max(...metrics.actionWidths) - Math.min(...metrics.actionWidths),
    `${label} global topbar actions should share one visual width: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(1.5);
  expect(
    metrics.actionIcons.every(
      (icon) =>
        icon.hasIcon &&
        icon.ariaHidden === "true" &&
        icon.width >= 14 &&
        icon.height >= 14 &&
        (icon.pseudoContent === "none" || icon.pseudoContent === "\"\"") &&
        icon.pseudoDisplay === "none",
    ),
    `${label} global topbar actions should use inline SVG icons instead of CSS glyphs: ${JSON.stringify(metrics)}`,
  ).toBe(true);
  expect(metrics.buttonWidth, `${label} should keep touch width: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(44);
  expect(metrics.buttonHeight, `${label} should keep touch height: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(44);
}

test("price refresh polling releases the global busy state after status failures", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("price-refresh-status")}@example.com`;
  await bootstrapVerifiedSession(page, { email, displayName: unique("price-refresh-user") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "대시보드");

  let refreshRequested = false;
  let statusAttempts = 0;
  await page.route("**/api/v1/prices/refresh", async (route) => {
    refreshRequested = true;
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        household_id: 1,
        accepted: true,
        queued: false,
        in_progress: true,
        started_at: new Date().toISOString(),
        target_count: 1,
        completed_count: 0,
      }),
    });
  });
  await page.route("**/api/v1/prices/status", async (route) => {
    statusAttempts += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: { code: "PRICE_STATUS_TEMPORARILY_UNAVAILABLE" } }),
    });
  });

  const priceRefreshButton = page.getByRole("button", { name: /시세 갱신/ });
  const priceRefreshStatus = page.locator("#topbar-price-refresh-status");
  await expect(priceRefreshButton).toBeEnabled();
  await expect(priceRefreshStatus).toContainText("시세 갱신 대기");
  await priceRefreshButton.click();
  await expect(priceRefreshStatus).toContainText("시세 갱신 중");
  await expect(priceRefreshButton).toBeEnabled({ timeout: 8_000 });
  await expect(priceRefreshStatus).toContainText("시세 갱신 대기");
  await expect(page.locator(".message", { hasText: "시세 갱신 상태 확인이 지연되고 있습니다." })).toBeVisible();
  await expect(page.locator(".message", { hasText: "요청 처리 중 오류" })).toHaveCount(0);

  await openTab(page, "협업");
  await expect(page.getByRole("button", { name: "시세 갱신" })).toBeEnabled();
  await expect(page.locator(".message", { hasText: "요청 처리 중 오류" })).toHaveCount(0);
  await capture(page, "price-refresh-polling-release");
  expect(refreshRequested).toBe(true);
  expect(statusAttempts).toBeGreaterThanOrEqual(3);
});

test("dashboard month shortcut keeps readable mobile contrast", async ({ page }) => {
  const email = `${unique("dashboard-contrast")}@example.com`;
  const displayName = unique("dashboard-contrast-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "대시보드");

  const filterCard = page.locator(".dashboard-filter-card");
  await expect(filterCard).toBeVisible();
  const shortcutMetrics = await expectTextContrast(
    filterCard.getByRole("button", { name: "이번 달" }),
    "dashboard this-month shortcut",
  );
  expect(shortcutMetrics.fontSize, "dashboard this-month shortcut should remain normal text").toBeLessThan(18);
  await capture(page, "dashboard-this-month-contrast");
});

test("dashboard realtime status remains readable at minimum mobile width", async ({ page }) => {
  const email = `${unique("dashboard-status-chip")}@example.com`;
  const displayName = unique("dashboard-status-chip-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "18px";
  });
  await applyFontFamily(page, '"Malgun Gothic", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif');
  await openTab(page, "대시보드");

  const statusChip = page.locator(".socket-chip");
  await expect(statusChip).toBeVisible();
  const metrics = await statusChip.evaluate((chip) => {
    const chipBox = chip.getBoundingClientRect();
    const prefix = chip.querySelector(".socket-chip-prefix");
    const text = chip.querySelector(".socket-chip-text");
    const status = chip.querySelector(".socket-chip-status");
    const textBox = text?.getBoundingClientRect();
    const statusBox = status?.getBoundingClientRect();
    return {
      chipText: chip.textContent?.replace(/\s+/g, " ").trim() || "",
      ariaLabel: chip.getAttribute("aria-label") || "",
      chipWidth: chipBox.width,
      textClientWidth: text?.clientWidth ?? 0,
      textScrollWidth: text?.scrollWidth ?? 0,
      statusText: status?.textContent?.trim() || "",
      statusWidth: statusBox?.width ?? 0,
      statusVisible: Boolean(statusBox && statusBox.width > 0 && statusBox.height > 0),
      prefixDisplay: prefix ? getComputedStyle(prefix).display : "",
      textOverflow: text ? getComputedStyle(text).textOverflow : "",
      textWidth: textBox?.width ?? 0,
    };
  });

  expect(metrics.ariaLabel, `full realtime label should stay available: ${JSON.stringify(metrics)}`).toContain(
    "실시간 연결:",
  );
  expect(metrics.statusText, `status value should be rendered separately: ${JSON.stringify(metrics)}`).toMatch(
    /연결됨|연결 끊김|연결 오류|권한 변경|동기화 중/,
  );
  expect(metrics.statusVisible, `status value should be visible: ${JSON.stringify(metrics)}`).toBeTruthy();
  expect(metrics.statusWidth, `status value should keep measurable width: ${JSON.stringify(metrics)}`).toBeGreaterThan(0);
  expect(metrics.prefixDisplay, `prefix should collapse at 320px: ${JSON.stringify(metrics)}`).toBe("none");
  expect(metrics.textScrollWidth, `status text should not be clipped: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.textClientWidth + 1,
  );
  expect(metrics.textOverflow, `status text should not rely on ellipsis: ${JSON.stringify(metrics)}`).toBe("clip");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "dashboard-status-chip-minimum-mobile");
});

test("dashboard topbar actions keep landscape touch targets", async ({ page }) => {
  const email = `${unique("dashboard-landscape-topbar")}@example.com`;
  const displayName = unique("dashboard-landscape-topbar-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 844, height: 390 });
  await applyFontFamily(page, '"Malgun Gothic", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif');
  await openTab(page, "대시보드");

  const metrics = await page.locator(".topbar-actions button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        label: button.textContent?.replace(/\s+/g, " ").trim() || "",
        height: box.height,
        width: box.width,
        right: box.right,
        bottom: box.bottom,
      };
    }),
  );

  expect(metrics, `landscape topbar actions should be present: ${JSON.stringify(metrics)}`).toHaveLength(3);
  for (const metric of metrics) {
    expect(metric.height, `${metric.label} should keep a 44px landscape hit area: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(44);
    expect(metric.width, `${metric.label} should keep a 44px landscape hit area: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(44);
    expect(metric.right, `${metric.label} should stay inside the landscape viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(845);
  }
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "dashboard-landscape-topbar-touch-targets");
});

test("dashboard mobile topbar uses compact price refresh icon action", async ({ page }) => {
  const email = `${unique("dashboard-price-label")}@example.com`;
  const displayName = unique("dashboard-price-label-name");

  await bootstrapVerifiedSession(page, { email, displayName });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await applyFontFamily(page, '"Malgun Gothic", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif');
    await openTab(page, "대시보드");
    await expectPriceRefreshIconAction(page, `${viewport.width}x${viewport.height}`);
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, `dashboard-mobile-price-refresh-icon-action-${viewport.width}x${viewport.height}`);
  }
});

test("dashboard mobile footer actions keep touch targets", async ({ page }) => {
  const email = `${unique("dashboard-footer-actions")}@example.com`;
  const displayName = unique("dashboard-footer-actions-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await applyFontFamily(page, '"Malgun Gothic", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif');
  await openTab(page, "대시보드");

  const metrics = await page.locator(".dashboard-card-footer-action").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return {
        label: button.textContent?.replace(/\s+/g, " ").trim() || "",
        height: box.height,
        width: box.width,
        left: box.left,
        right: box.right,
      };
    }),
  );

  expect(metrics, `dashboard footer actions should be present: ${JSON.stringify(metrics)}`).toHaveLength(2);
  for (const metric of metrics) {
    expect(metric.label).toBe("전체 보기");
    expect(metric.height, `${metric.label} should keep a mobile hit area: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(40);
    expect(metric.width, `${metric.label} should keep a mobile hit area: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(44);
    expect(metric.left, `${metric.label} should stay inside the mobile viewport: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(0);
    expect(metric.right, `${metric.label} should stay inside the mobile viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(391);
  }
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "dashboard-mobile-footer-touch-targets");
});

test("dashboard month inputs expose visible focus state", async ({ page }) => {
  const email = `${unique("dashboard-month-focus")}@example.com`;
  const displayName = unique("dashboard-month-focus-name");

  await bootstrapVerifiedSession(page, { email, displayName });

  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openTab(page, "대시보드");

    const filterCard = page.locator(".dashboard-filter-card");
    await expect(filterCard).toBeVisible();

    for (const label of ["연도", "월"]) {
      const input = filterCard.getByLabel(label, { exact: true });
      await input.focus();
      const focusStyle = await input.evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          label: element.getAttribute("aria-label"),
          width: box.width,
          height: box.height,
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
          boxShadow: style.boxShadow,
        };
      });

      expect(
        focusStyle.outlineStyle,
        `${viewport.width}x${viewport.height} ${label} focus style: ${JSON.stringify(focusStyle)}`,
      ).not.toBe("none");
      expect(
        focusStyle.outlineWidth,
        `${viewport.width}x${viewport.height} ${label} focus width: ${JSON.stringify(focusStyle)}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        focusStyle.boxShadow,
        `${viewport.width}x${viewport.height} ${label} focus shadow: ${JSON.stringify(focusStyle)}`,
      ).not.toBe("none");
    }
  }

  await capture(page, "dashboard-month-input-focus");
});

test("dashboard period mode keeps the current month scope and ISO date affordance", async ({ page }) => {
  const email = `${unique("dashboard-period-scope")}@example.com`;
  const displayName = unique("dashboard-period-scope-name");
  const memo = unique("dashboard-period-current-month");
  const monthRange = currentMonthBounds();

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);
  await openTab(page, "거래");
  await createBasicTransaction(page, {
    memo,
    amount: "34000",
    flowType: "income",
    occurredOn: currentE2EHistoryDateIso(),
  });

  await openTab(page, "대시보드");
  const filterCard = page.locator(".dashboard-filter-card");
  await filterCard.getByRole("button", { name: "기간" }).click();

  await expect(filterCard.getByLabel("시작일")).toHaveValue(monthRange.start);
  await expect(filterCard.getByLabel("종료일")).toHaveValue(monthRange.end);
  await expect(filterCard.getByRole("button", { name: "이번 달" })).toBeVisible();
  await expect(filterCard.getByRole("button", { name: "최근 30일" })).toBeVisible();
  await expect(filterCard.locator(".range-date-value", { hasText: monthRange.start })).toBeVisible();
  await expect(filterCard.locator(".range-date-value", { hasText: monthRange.end })).toBeVisible();

  const incomeCard = page.locator(".dashboard-kpi-card", { hasText: "수입" }).first();
  await expect(incomeCard.locator(".dashboard-kpi-value-main")).not.toHaveText("0원");
  await expect(page.getByText("최근 거래가 없습니다.")).toHaveCount(0);
  await capture(page, "issue-214-dashboard-period-current-month-scope");
});

test("dashboard range inputs expose readable mobile labels and focus", async ({ page }) => {
  const email = `${unique("dashboard-range-labels")}@example.com`;
  const displayName = unique("dashboard-range-labels-name");

  await bootstrapVerifiedSession(page, { email, displayName });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openTab(page, "대시보드");

    const filterCard = page.locator(".dashboard-filter-card");
    await expect(filterCard).toBeVisible();
    await filterCard.getByRole("button", { name: "기간" }).click();
    await expect(filterCard.locator('input[type="date"]')).toHaveCount(2);

    const rangeMetrics = await filterCard.locator(".range-picker").evaluate((picker) => {
      const box = picker.getBoundingClientRect();
      return {
        width: box.width,
        clientWidth: picker.clientWidth,
        scrollWidth: picker.scrollWidth,
        fields: Array.from(picker.querySelectorAll(".range-date-field")).map((field) => {
          const label = field.querySelector(".range-date-label");
          const input = field.querySelector('input[type="date"]');
          const labelBox = label?.getBoundingClientRect();
          const inputBox = input?.getBoundingClientRect();
          return {
            label: label?.textContent?.trim() || "",
            labelVisible: Boolean(labelBox && labelBox.width > 0 && labelBox.height > 0),
            ariaLabel: input?.getAttribute("aria-label") || "",
            value: input?.value || "",
            inputWidth: inputBox?.width ?? 0,
            inputHeight: inputBox?.height ?? 0,
          };
        }),
      };
    });

    expect(rangeMetrics.scrollWidth, `${viewport.width} range picker should not overflow horizontally`).toBeLessThanOrEqual(
      rangeMetrics.clientWidth + 1,
    );
    expect(rangeMetrics.fields).toHaveLength(2);
    for (const field of rangeMetrics.fields) {
      expect(field.labelVisible, `${viewport.width} ${field.label} visible label`).toBeTruthy();
      expect(["시작일", "종료일"]).toContain(field.ariaLabel);
      expect(field.value, `${viewport.width} ${field.label} should show a full ISO date value`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(field.inputWidth, `${viewport.width} ${field.label} input width`).toBeGreaterThanOrEqual(118);
      expect(field.inputHeight, `${viewport.width} ${field.label} input height`).toBeGreaterThanOrEqual(40);
    }

    for (const label of ["시작일", "종료일"]) {
      const input = filterCard.getByLabel(label, { exact: true });
      await input.focus();
      const focusStyle = await input.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
          boxShadow: style.boxShadow,
        };
      });
      expect(focusStyle.outlineStyle, `${viewport.width} ${label} focus style`).not.toBe("none");
      expect(focusStyle.outlineWidth, `${viewport.width} ${label} focus width`).toBeGreaterThanOrEqual(2);
      expect(focusStyle.boxShadow, `${viewport.width} ${label} focus shadow`).not.toBe("none");
    }
  }

  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "dashboard-range-mobile-labels");
});

test("dashboard flow: onboarding, portfolio coherence, summary visibility", async ({ page }, testInfo) => {
  test.setTimeout(420_000);

  const email = `${unique("dashboard-user")}@example.com`;
  const displayName = unique("dashboard-name");
  const holdingName = unique("dashboard-holding");
  const txMemo = unique("dashboard-tx");
  const incomeMemo = unique("dashboard-income");
  const previousMonthMemo = unique("dashboard-prev-month");
  const currentListIso = currentE2EHistoryDateIso();
  const previousMonthIso = previousMonthMiddleIso();

  await bootstrapVerifiedSession(page, { email, displayName });
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
  const dashboardPortfolioHeading = page.getByRole("heading", { name: "포트폴리오 및 거래내역 차트" });
  await expect(dashboardPortfolioHeading).toBeVisible();
  await expectNoOrphanTextLine(dashboardPortfolioHeading, "desktop dashboard portfolio heading");
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
  await expectDashboardHeroNoInternalOverflow(page, "desktop 1366 dashboard hero");
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
    await expectDonutLabelsInsideChart(dashboardPortfolioCard, "desktop dashboard asset type");
    await expectDonutSliceLabelsWithoutLeftAccentBars(dashboardPortfolioCard, "desktop dashboard asset type");
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
    await expectDonutLabelsInsideChart(dashboardPortfolioCard, "desktop dashboard transaction flow");
    await expectDonutSliceLabelsWithoutLeftAccentBars(dashboardPortfolioCard, "desktop dashboard transaction flow");

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

  const shouldRunNarrowDesktopProfile =
    testInfo.project.name === "desktop-chromium" || process.env.E2E_PROJECT_MATRIX !== "1";
  if (shouldRunNarrowDesktopProfile && (await dashboardPortfolioSelect.count()) > 0) {
    await page.setViewportSize({ width: 1366, height: 768 });
    await applyFontFamily(page, '"Malgun Gothic", "Noto Sans KR", "Segoe UI", sans-serif');
    await openTab(page, "대시보드");
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectNoHorizontalOverflow(page, 12);
    await dashboardPortfolioCard.evaluate((card) => card.scrollIntoView({ block: "start", inline: "nearest" }));
    await page.waitForTimeout(80);
    await expectNoOrphanTextLine(dashboardPortfolioHeading, "narrow desktop dashboard portfolio heading");
    await expectWithinViewport(dashboardPortfolioSelect);
    const narrowDesktopHeaderLayout = await dashboardPortfolioCard.evaluate((card) => {
      const cardBox = card.getBoundingClientRect();
      const heading = card.querySelector(".dashboard-card-heading h2")?.getBoundingClientRect();
      const select = card.querySelector(".dashboard-portfolio-chart-select")?.getBoundingClientRect();
      return {
        missingElements: !heading || !select,
        headingBottom: heading?.bottom ?? 0,
        selectTop: select?.top ?? 0,
        selectLeftGap: select ? select.left - cardBox.left : Number.NEGATIVE_INFINITY,
        selectRightGap: select ? cardBox.right - select.right : Number.NEGATIVE_INFINITY,
      };
    });
    expect(narrowDesktopHeaderLayout.missingElements, "narrow desktop heading/select should be measurable").toBeFalsy();
    expect(narrowDesktopHeaderLayout.selectTop).toBeGreaterThanOrEqual(
      narrowDesktopHeaderLayout.headingBottom - 2,
    );
    expect(narrowDesktopHeaderLayout.selectLeftGap).toBeGreaterThanOrEqual(0);
    expect(narrowDesktopHeaderLayout.selectRightGap).toBeGreaterThanOrEqual(0);
    await dashboardPortfolioSelect.selectOption("transaction_flow");
    await expect.poll(async () => dashboardSliceLabels.count()).toBeGreaterThanOrEqual(1);
    await expectDonutTextNotClipped(dashboardCenterLabel);
    await expectDonutTextNotClipped(dashboardSliceLabels);
    await expectDonutLabelsInsideChart(dashboardPortfolioCard, "narrow desktop dashboard transaction flow");
    await capture(page, "dashboard-narrow-desktop-portfolio");
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "대시보드");
  await page.evaluate(() => window.scrollTo(0, 0));
  await assertResponsiveShell(page);
  await expectNoHorizontalOverflow(page, 12);
  await expectWithinViewport(page.getByRole("button", { name: "새로고침" }));
  await expectWithinViewport(page.getByRole("button", { name: "시세 갱신" }));
  await expect(page.locator(".dashboard-hero-card")).toBeVisible();
  await expectDashboardHeroNoInternalOverflow(page, "mobile 390 dashboard hero");
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
  await expectPressFeedbackWhenEnabled(page, mobileFilterCard.getByRole("button", { name: "이전 달" }), "이전 달");
  await expectPressFeedbackWhenEnabled(page, mobileFilterCard.getByRole("button", { name: "다음 달" }), "다음 달");
  await expectPressFeedbackWhenEnabled(page, mobileFilterCard.getByRole("button", { name: "이번 달" }), "이번 달");
  await expectNoRefreshNoteLayoutShift(page, mobileFilterCard.getByRole("button", { name: "월별" }), mobileFilterCard, "월별");
  await expectNoRefreshNoteLayoutShift(page, mobileFilterCard.getByRole("button", { name: "기간" }), mobileFilterCard, "기간");
  await expectNoRefreshNoteLayoutShift(page, mobileFilterCard.getByRole("button", { name: "월별" }), mobileFilterCard, "월별 복귀");
  await expectNoRefreshNoteLayoutShiftWhenEnabled(page, mobileFilterCard.getByRole("button", { name: "이전 달" }), mobileFilterCard, "이전 달");
  await expectNoRefreshNoteLayoutShiftWhenEnabled(page, mobileFilterCard.getByRole("button", { name: "다음 달" }), mobileFilterCard, "다음 달");
  await expectNoRefreshNoteLayoutShiftWhenEnabled(page, mobileFilterCard.getByRole("button", { name: "이번 달" }), mobileFilterCard, "이번 달");
  await expect(page.locator(".dashboard-status-card")).toBeVisible();
  await expect(page.locator(".dashboard-members-card")).toBeVisible();
  await expect(page.getByRole("heading", { name: "가져오기 & 상태" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "협업 멤버" })).toBeVisible();
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
    await expectDonutLabelsInsideChart(dashboardPortfolioCard, "mobile dashboard asset type");
    await dashboardPortfolioSelect.selectOption("transaction_flow");
    await expect(dashboardSliceLabels).toHaveCount(2);
    await expect(dashboardSliceLabels.first()).toContainText("%");
    await expect(dashboardCenterLabel).not.toContainText("분포");
    await expect(dashboardCenterLabel).toContainText(/\d{1,2}월 거래/);
    await expectDonutTextNotClipped(dashboardCenterLabel);
    await expectDonutTextNotClipped(dashboardSliceLabels);
    await expectDonutLabelsCenteredOnRing(dashboardPortfolioCard, "mobile dashboard transaction flow");
    await expectDonutLabelsInsideChart(dashboardPortfolioCard, "mobile dashboard transaction flow");
    await expectDonutSliceLabelsWithoutLeftAccentBars(dashboardPortfolioCard, "mobile dashboard transaction flow");
    await expectPortfolioLabelsClearOfBottomNav(page, dashboardPortfolioCard, "mobile dashboard transaction flow");
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
        name: "narrow-345-malgun",
        viewport: { width: 345, height: 740 },
        fontFamily: '"Malgun Gothic", "Noto Sans KR", system-ui, sans-serif',
      },
      {
        name: "minimum-320-noto",
        viewport: { width: 320, height: 740 },
        fontFamily: '"Noto Sans KR", "Malgun Gothic", system-ui, sans-serif',
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
      await expectDashboardHeroNoInternalOverflow(page, profile.name);
      await expectMonthlyFilterLayout(await readDashboardFilterLayout(mobileFilterCard));
      await dashboardPortfolioCard.evaluate((card) => card.scrollIntoView({ block: "start", inline: "nearest" }));
      await page.waitForTimeout(80);
      await dashboardPortfolioSelect.selectOption("transaction_flow");
      await expectNoOrphanTextLine(dashboardPortfolioHeading, profile.name);
      await expect(dashboardCenterLabel).not.toContainText("분포");
      await expect(dashboardCenterLabel).toContainText(/\d{1,2}월 거래/);
      await expectDonutTextNotClipped(dashboardCenterLabel);
      await expectDonutTextNotClipped(dashboardSliceLabels);
      await expectDonutLabelsCenteredOnRing(dashboardPortfolioCard, profile.name);
      await expectDonutLabelsInsideChart(dashboardPortfolioCard, profile.name);
      await expectDonutSliceLabelsWithoutLeftAccentBars(dashboardPortfolioCard, profile.name);
      await expectPortfolioLabelsClearOfBottomNav(page, dashboardPortfolioCard, profile.name);
      await expectNoHorizontalOverflow(page, 12);
      await capture(page, `dashboard-mobile-layout-${profile.name}`);
    }
  }
});
