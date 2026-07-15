import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicTransaction,
  createCategoryViaApi,
  createTransactionViaApi,
  currentE2EHistoryDateIso,
  expectBackgroundNotPlainWhite,
  expectCompactLedgerRow,
  expectNoHorizontalOverflow,
  expectSingleLineText,
  expectStableButtonPosition,
  expectStickyStack,
  expectTextContrast,
  expectTransparentBackground,
  labeledField,
  openTab,
  bootstrapVerifiedSession,
  selectFirstNonEmptyOption,
  unique,
} from "../support/helpers";

function isoDaysAgo(days) {
  return isoDaysFromToday(-days);
}

function isoDaysFromToday(days) {
  return currentE2EHistoryDateIso(days);
}

function yearMonthFromIso(value) {
  const [year, month] = String(value || "").split("-").map((part) => Number(part));
  return { year, month };
}

function isMonthlyTransactionsResponse(response, targetYearMonth) {
  if (response.request().method() !== "GET") {
    return false;
  }
  const url = new URL(response.url());
  return (
    url.pathname.endsWith("/api/v1/transactions") &&
    url.searchParams.get("year") === String(targetYearMonth.year) &&
    url.searchParams.get("month") === String(targetYearMonth.month)
  );
}

async function browserLocalTodayIso(page, daysOffset = 0) {
  return page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }, daysOffset);
}

async function expectStagedCategoryLayoutStable(page) {
  const metrics = await page.getByTestId("transaction-staged-category").evaluate((panel) => {
    const buttons = Array.from(
      panel.querySelectorAll(
        "[data-testid='transaction-flow-choice'], [data-testid='transaction-category-group-choice'], [data-testid='transaction-category-choice']",
      ),
    );
    const documentOverflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return {
      buttonCount: buttons.length,
      documentOverflowX,
      recommendationCount: document.querySelectorAll(".transaction-quick-category-panel, [data-testid='transaction-quick-category-chip']").length,
      detailsCount: document.querySelectorAll("details.transaction-quick-details").length,
      buttonMetrics: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        return {
          text: button.textContent?.trim() || "",
          width: rect.width,
          height: rect.height,
          clientWidth: button.clientWidth,
          scrollWidth: button.scrollWidth,
          clientHeight: button.clientHeight,
          scrollHeight: button.scrollHeight,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
        };
      }),
    };
  });

  expect(metrics.recommendationCount, "add transaction should not render recommended category chips").toBe(0);
  expect(metrics.detailsCount, "add transaction should not hide fields in secondary details").toBe(0);
  expect(metrics.documentOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.buttonCount).toBeGreaterThanOrEqual(4);
  expect(
    metrics.buttonMetrics.every((button) => button.height >= 32),
    `staged category buttons should keep usable touch height: ${JSON.stringify(metrics.buttonMetrics)}`,
  ).toBe(true);
  expect(
    metrics.buttonMetrics.every(
      (button) =>
        button.scrollWidth <= button.clientWidth + 1 ||
        (button.textOverflow === "ellipsis" && button.whiteSpace === "nowrap")
    ),
    `staged category button labels should fit: ${JSON.stringify(metrics.buttonMetrics)}`,
  ).toBe(true);
  expect(
    metrics.buttonMetrics.every((button) => button.scrollHeight <= button.clientHeight + 1),
    `staged category button labels should not clip vertically: ${JSON.stringify(metrics.buttonMetrics)}`,
  ).toBe(true);
}

async function expectMobileTransactionFilterTriggersSeparated(page, label) {
  const metrics = await page.locator(".transactions-mobile-ledger-head").first().evaluate((head) => {
    const labels = ["일자 필터 열기", "메모 필터 열기", "금액 필터 열기", "유형 필터 열기"];
    const buttons = labels.map((ariaLabel) => {
      const node = head.querySelector(`button[aria-label="${ariaLabel}"]`);
      const box = node?.getBoundingClientRect();
      return box
        ? {
            ariaLabel,
            text: node.textContent?.trim() || "",
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            right: box.right,
            bottom: box.bottom,
          }
        : { ariaLabel, missing: true };
    });
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < buttons.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < buttons.length; rightIndex += 1) {
        const left = buttons[leftIndex];
        const right = buttons[rightIndex];
        if (left.missing || right.missing) {
          continue;
        }
        const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.x, right.x));
        const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.y, right.y));
        if (width > 0.5 && height > 0.5) {
          overlaps.push({
            pair: [left.ariaLabel, right.ariaLabel],
            width,
            height,
            area: width * height,
          });
        }
      }
    }
    return {
      buttons,
      overlaps,
      viewportWidth: window.innerWidth,
    };
  });

  expect(metrics.overlaps, `${label} filter triggers should not overlap`).toEqual([]);
  expect(
    metrics.buttons.every((button) => !button.missing && button.width >= 40 && button.height >= 40),
    `${label} filter trigger hit areas should stay readable: ${JSON.stringify(metrics)}`,
  ).toBe(true);
}

async function jumpTransactionListToMonth(page, isoDate) {
  const { year, month } = yearMonthFromIso(isoDate);
  const listCard = page.locator(".transaction-list-card").first();
  await listCard.getByLabel("연도").fill(String(year));
  await listCard.getByLabel("월").fill(String(month));
  await listCard.getByLabel("월").press("Enter");
}

async function scrollTransactionLedgerIntoStickyRange(page) {
  const metrics = await page.evaluate(() => {
    const listCard = document.querySelector(".transaction-list-card");
    const ledgerHead = document.querySelector(".transactions-mobile-ledger-head");
    if (!listCard || !ledgerHead) {
      return null;
    }

    const ledgerTop = ledgerHead.getBoundingClientRect().top + window.scrollY;
    const targetScrollY = Math.max(0, ledgerTop - 96);
    window.scrollTo(0, targetScrollY);

    return {
      ledgerTop,
      targetScrollY,
    };
  });
  expect(metrics, "transaction ledger sticky target should exist").not.toBeNull();
  await page.waitForTimeout(400);
}

async function stabilizeTransactionLedgerAtPageTop(page) {
  const metrics = await page.evaluate(async () => {
    const listCard = document.querySelector(".transaction-list-card");
    const toolbar = document.querySelector('[data-testid="transaction-sticky-toolbar"]');
    const ledgerHead = document.querySelector(".transactions-mobile-ledger-head");
    if (!listCard || !toolbar || !ledgerHead) {
      return {
        stable: false,
        reason: "transaction sticky elements are missing",
      };
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      activeElement.blur();
    }
    await document.fonts?.ready;

    const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(resolve));
    const readMetrics = () => {
      const listStyle = getComputedStyle(listCard);
      const toolbarHeight = Math.ceil(toolbar.getBoundingClientRect().height);
      const ledgerHeight = Math.ceil(ledgerHead.getBoundingClientRect().height);
      const toolbarHeightVar = Number.parseFloat(
        listStyle.getPropertyValue("--transaction-toolbar-sticky-height"),
      );
      const ledgerHeightVar = Number.parseFloat(
        listStyle.getPropertyValue("--surface-ledger-head-height"),
      );
      return {
        scrollY: window.scrollY || window.pageYOffset || 0,
        stickyActive: ledgerHead.getAttribute("data-sticky-active"),
        toolbarHeight,
        toolbarHeightVar,
        ledgerHeight,
        ledgerHeightVar,
      };
    };
    const geometrySignature = (current) =>
      [
        current.toolbarHeight,
        current.toolbarHeightVar,
        current.ledgerHeight,
        current.ledgerHeightVar,
      ].join(":");
    const geometryMatches = (current) =>
      Number.isFinite(current.toolbarHeightVar) &&
      Number.isFinite(current.ledgerHeightVar) &&
      Math.abs(current.toolbarHeightVar - current.toolbarHeight) <= 1 &&
      Math.abs(current.ledgerHeightVar - current.ledgerHeight) <= 1;
    const isTopState = (current) =>
      current.scrollY <= 1 && current.stickyActive === "false";

    let stableFrames = 0;
    let previousGeometry = "";
    let current = readMetrics();
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    for (let frame = 0; frame < 60; frame += 1) {
      await nextFrame();
      current = readMetrics();
      const nextGeometry = geometrySignature(current);
      if (geometryMatches(current) && isTopState(current) && nextGeometry === previousGeometry) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }
      if (!isTopState(current)) {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      previousGeometry = nextGeometry;
      if (stableFrames >= 4) {
        return {
          stable: true,
          stableFrames,
          ...current,
        };
      }
    }

    return {
      stable: false,
      stableFrames,
      ...current,
    };
  });

  expect(
    metrics.stable,
    `transaction sticky geometry and top state should settle together: ${JSON.stringify(metrics)}`,
  ).toBe(true);
}

async function expectTransactionMonthControls(page, isoDate, label = "transaction month controls") {
  const { year, month } = yearMonthFromIso(isoDate);
  const listCard = page.locator(".transaction-list-card").first();
  await expect(listCard.getByLabel("연도"), `${label} year`).toHaveValue(String(year), { timeout: 6_000 });
  await expect(listCard.getByLabel("월"), `${label} month`).toHaveValue(String(month), { timeout: 6_000 });
}

async function expectIsoDateInput(locator, label, expectedValue = null) {
  await expect(locator, `${label} visible`).toBeVisible();
  await expect(locator, `${label} uses text type`).toHaveAttribute("type", "text");
  await expect(locator, `${label} has numeric keyboard hint`).toHaveAttribute("inputmode", "numeric");
  await expect(locator, `${label} has ISO placeholder`).toHaveAttribute("placeholder", "YYYY-MM-DD");
  if (expectedValue !== null) {
    await expect(locator, `${label} value`).toHaveValue(expectedValue);
  }
}

async function readTransactionMonthStepperLayout(page) {
  return page.locator(".transaction-list-card .month-stepper").first().evaluate((stepper) => {
    const boxOf = (selector) => {
      const element = stepper.querySelector(selector);
      const box = element?.getBoundingClientRect();
      return box
        ? {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            centerY: box.y + box.height / 2,
            boxShadow: getComputedStyle(element).boxShadow,
          }
        : null;
    };
    const stepperBox = stepper.getBoundingClientRect();
    const controls = Array.from(stepper.querySelectorAll("button, .date-inputs")).map((element) => {
      const box = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        className: element.className,
        height: box.height,
        centerY: box.y + box.height / 2,
      };
    });
    const touchTargets = Array.from(stepper.querySelectorAll("button, input")).map((element) => {
      const box = element.getBoundingClientRect();
      return {
        label: element.getAttribute("aria-label") || element.textContent?.trim() || "",
        tag: element.tagName,
        width: box.width,
        height: box.height,
      };
    });
    const monthGroups = Array.from(stepper.querySelectorAll(".month-value-group")).map((group) => {
      const input = group.querySelector("input")?.getBoundingClientRect();
      const unit = group.querySelector("span")?.getBoundingClientRect();
      return {
        inputCenterY: input ? input.y + input.height / 2 : 0,
        unitCenterY: unit ? unit.y + unit.height / 2 : 0,
        inputHeight: input?.height ?? 0,
        unitHeight: unit?.height ?? 0,
      };
    });
    return {
      stepper: {
        height: stepperBox.height,
        centerY: stepperBox.y + stepperBox.height / 2,
        boxShadow: getComputedStyle(stepper).boxShadow,
      },
      dateInputs: boxOf(".date-inputs"),
      controls,
      touchTargets,
      monthGroups,
    };
  });
}

function expectMonthStepperCentered(layout, label = "transaction month stepper") {
  expect(layout.stepper.height, `${label} should keep compact control height`).toBeLessThanOrEqual(52);
  expect(layout.stepper.boxShadow, `${label} should not add shadow that visually offsets the filter`).toBe("none");
  expect(layout.dateInputs, `${label} date inputs should be measurable`).not.toBeNull();
  expect(Math.abs((layout.dateInputs?.centerY ?? 0) - layout.stepper.centerY), `${label} date input group center`).toBeLessThanOrEqual(1.5);
  expect(layout.monthGroups.length, `${label} should group each numeric value with its unit`).toBeGreaterThanOrEqual(2);
  for (const group of layout.monthGroups) {
    expect(Math.abs(group.inputCenterY - group.unitCenterY), `${label} input/unit vertical center`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(group.inputHeight - group.unitHeight), `${label} input/unit line box`).toBeLessThanOrEqual(4);
  }
  for (const control of layout.controls) {
    expect(Math.abs(control.centerY - layout.stepper.centerY), `${label} ${control.tag}.${control.className} center`).toBeLessThanOrEqual(2);
  }
}

function expectTransactionMonthTouchTargets(layout, label = "transaction month stepper") {
  expect(layout.touchTargets.length, `${label} touch targets should be measurable`).toBeGreaterThanOrEqual(5);
  for (const target of layout.touchTargets) {
    expect(
      target.height,
      `${label} ${target.tag}.${target.label} should be at least 40px tall: ${JSON.stringify(layout.touchTargets)}`,
    ).toBeGreaterThanOrEqual(40);
  }
}

async function expectDesktopSidebarSticky(page) {
  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) <= 900) {
    return;
  }
  const sidebar = page.locator(".topbar-tabs").first();
  await expect(sidebar).toBeVisible();
  const originalScrollY = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(100);
  const before = await sidebar.boundingBox();
  expect(before, "desktop sidebar should have a bounding box before scroll").not.toBeNull();
  await page.evaluate(() => {
    const maxScrollY = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
    const originalY = window.scrollY;
    const targetY = originalY > 720 ? originalY - 640 : Math.min(maxScrollY, originalY + 640);
    window.scrollTo(0, targetY);
  });
  await page.waitForTimeout(200);
  const after = await sidebar.boundingBox();
  const style = await sidebar.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      position: computed.position,
      overflowY: computed.overflowY,
      maxHeight: computed.maxHeight,
    };
  });
  expect(after, "desktop sidebar should have a bounding box after scroll").not.toBeNull();
  expect(["sticky", "fixed"]).toContain(style.position);
  expect(style.overflowY).toMatch(/auto|overlay/);
  expect(style.maxHeight).not.toBe("none");
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0)), "desktop sidebar should follow viewport while scrolling").toBeLessThanOrEqual(2);
  await page.evaluate((scrollY) => window.scrollTo(0, scrollY), originalScrollY);
  await page.waitForTimeout(100);
}

async function expectTransactionMonthStepperSticky(page, label = "transaction month stepper") {
  const viewport = page.viewportSize();
  const stickyToolbar = page.getByTestId("transaction-sticky-toolbar").first();
  const stepper = page.locator(".transaction-list-card .month-stepper").first();
  await expect(stickyToolbar).toBeVisible();
  await expect(stepper).toBeVisible();
  const state = await stickyToolbar.evaluate((element) => {
    const toolbarBox = element.getBoundingClientRect();
    const stepperBox = element.querySelector(".month-stepper")?.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      position: style.position,
      top: style.top,
      toolbarTop: toolbarBox.top,
      toolbarBottom: toolbarBox.bottom,
      stepperTop: stepperBox?.top ?? null,
      stepperBottom: stepperBox?.bottom ?? null,
      scrollY: window.scrollY,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
    };
  });
  expect(["sticky", "fixed"], `${label} sticky state: ${JSON.stringify(state)}`).toContain(state.position);
  expect(state.top, `${label} sticky state: ${JSON.stringify(state)}`).not.toBe("auto");
  expect(state.stepperTop, `${label} should stay in viewport: ${JSON.stringify(state)}`).not.toBeNull();
  expect(state.stepperTop ?? -1, `${label} sticky state: ${JSON.stringify(state)}`).toBeGreaterThanOrEqual(0);
  const bottomReserve = (viewport?.width ?? 0) <= 820 ? 72 : 16;
  expect(state.stepperBottom ?? Number.POSITIVE_INFINITY, `${label} sticky state: ${JSON.stringify(state)}`).toBeLessThanOrEqual(
    (viewport?.height ?? 0) - bottomReserve
  );
}

async function expectTransactionAddActionReachable(page, label = "transaction add action") {
  const fab = page.getByTestId("transactions-fab");
  await expect(fab, `${label} visible`).toBeVisible();
  await expect(fab, `${label} enabled`).toBeEnabled();
  const metrics = await fab.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    const style = getComputedStyle(element);
    const toolbar = document.querySelector('[data-testid="transaction-sticky-toolbar"]');
    const ledgerHead = document.querySelector(".transactions-mobile-ledger-head");
    const firstRow = document.querySelector("tr.transaction-row");
    const toolbarBox = toolbar?.getBoundingClientRect();
    const ledgerBox = ledgerHead?.getBoundingClientRect();
    const rowBox = firstRow?.getBoundingClientRect();
    const intersects = (left, right) =>
      Boolean(
        left &&
          right &&
          left.left < right.right &&
          left.right > right.left &&
          left.top < right.bottom &&
          left.bottom > right.top,
      );
    return {
      position: style.position,
      zIndex: Number.parseInt(style.zIndex || "0", 10),
      inListHeading: Boolean(element.closest(".surface-list-heading")),
      box: {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        bottomGap: window.innerHeight - box.bottom,
        rightGap: window.innerWidth - box.right,
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hitTargetIsFab: topElement === element || element.contains(topElement),
      overlapsToolbar: intersects(box, toolbarBox),
      overlapsLedgerHead: intersects(box, ledgerBox),
      overlapsFirstRow: intersects(box, rowBox),
      scrollY: window.scrollY,
    };
  });
  expect(metrics.position, `${label} should stay fixed at the bottom-right: ${JSON.stringify(metrics)}`).toBe("fixed");
  expect(metrics.inListHeading, `${label} should be outside the sticky heading containing block: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.box.width, `${label} width should remain touch-friendly: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(48);
  expect(metrics.box.height, `${label} height should remain touch-friendly: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(48);
  expect(metrics.box.right, `${label} should stay inside right viewport edge: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth - 8,
  );
  expect(metrics.box.rightGap, `${label} should sit near the right edge: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(20);
  expect(metrics.box.top, `${label} should live in the lower screen, not the sticky heading: ${JSON.stringify(metrics)}`).toBeGreaterThan(
    metrics.viewportHeight * 0.72,
  );
  expect(metrics.box.bottom, `${label} should remain above the mobile bottom chrome: ${JSON.stringify(metrics)}`).toBeLessThan(
    metrics.viewportHeight - 48,
  );
  expect(metrics.hitTargetIsFab, `${label} should be topmost at its center: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.overlapsToolbar, `${label} should not belong to or cover the sticky toolbar: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.overlapsLedgerHead, `${label} should not cover the mobile ledger head: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.overlapsFirstRow, `${label} should not cover transaction rows: ${JSON.stringify(metrics)}`).toBe(false);
}

async function expectDesktopTransactionAddActionReachable(page, label = "desktop transaction add action") {
  await expect(page.getByTestId("transactions-fab"), `${label} should not use a fixed FAB on desktop`).toHaveCount(0);
  const action = page.getByTestId("transactions-desktop-add-action");
  await expect(action, `${label} visible`).toBeVisible();
  await expect(action, `${label} enabled`).toBeEnabled();
  const metrics = await action.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    const style = getComputedStyle(element);
    return {
      position: style.position,
      display: style.display,
      visibility: style.visibility,
      box: {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hitTargetIsAction: topElement === element || element.contains(topElement),
    };
  });
  expect(metrics.display, `${label} should be displayed: ${JSON.stringify(metrics)}`).not.toBe("none");
  expect(metrics.visibility, `${label} should be visible: ${JSON.stringify(metrics)}`).toBe("visible");
  expect(metrics.position, `${label} should be docked in document flow: ${JSON.stringify(metrics)}`).not.toBe("fixed");
  expect(metrics.box.height, `${label} should keep a desktop hit target: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(40);
  expect(metrics.box.right, `${label} should stay inside viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth - 8
  );
  expect(metrics.box.top, `${label} should stay in viewport: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(0);
  expect(metrics.box.bottom, `${label} should stay in viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportHeight
  );
  expect(metrics.hitTargetIsAction, `${label} should be topmost at its center: ${JSON.stringify(metrics)}`).toBe(true);
  return action;
}

async function expectDesktopTransactionMonthStepperSticky(page) {
  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) <= 820) {
    return;
  }
  await expectTransactionMonthStepperSticky(page, "desktop transaction month stepper");
}

async function expectMobileTransactionMonthStepperSticky(page) {
  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) > 820) {
    return;
  }
  await expectTransactionMonthStepperSticky(page, "mobile transaction month stepper");
}

function isTransactionLedgerCompactViewport(viewport) {
  const width = viewport?.width ?? 0;
  const height = viewport?.height ?? 0;
  return width <= 820 || (width <= 900 && height <= 520);
}

async function expectTransactionSelectionSummary(page, count, expectedAmountText = null) {
  const summary = page.getByTestId("transaction-sticky-toolbar").getByTestId("transaction-selection-summary");
  const viewport = page.viewportSize();
  if (count === 0 && isTransactionLedgerCompactViewport(viewport)) {
    await expect(summary).toHaveAttribute("data-selection-active", "false");
    await expect(page.locator(".transaction-list-card > .message", { hasText: "선택" })).toHaveCount(0);
    return summary;
  }
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(`선택 ${count}건`);
  await expect(summary).toContainText("선택 합계");
  if (expectedAmountText) {
    await expect(summary).toContainText(expectedAmountText);
  }
  await expect(page.locator(".transaction-list-card > .message", { hasText: "선택" })).toHaveCount(0);
  return summary;
}

async function clearTransactionSelection(page) {
  const summary = page.getByTestId("transaction-sticky-toolbar").getByTestId("transaction-selection-summary");
  if (!(await summary.isVisible().catch(() => false))) {
    return;
  }
  const clearButton = summary.getByRole("button", { name: "선택 해제" });
  if (await clearButton.isEnabled().catch(() => false)) {
    await clearButton.click();
  }
  await expectTransactionSelectionSummary(page, 0, "0원");
}

async function withTouchInputSession(page, callback) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    return await callback(client);
  } finally {
    await client.send("Emulation.setTouchEmulationEnabled", { enabled: false }).catch(() => undefined);
    await client.detach().catch(() => undefined);
  }
}

function touchPoint(x, y) {
  return [{ x, y, radiusX: 6, radiusY: 6, force: 0.6, id: 287 }];
}

async function transactionRowTouchCoordinates(page, row, xRatio = 0.28) {
  await expect(row).toBeVisible();
  await row.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(80);
  return transactionRowCurrentTouchCoordinates(row, xRatio);
}

async function transactionRowCurrentTouchCoordinates(row, xRatio = 0.28) {
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  expect(box, "transaction row should have a box for touch input").not.toBeNull();
  return {
    x: Math.round((box?.x ?? 0) + Math.min(72, Math.max(24, (box?.width ?? 120) * xRatio))),
    y: Math.round((box?.y ?? 0) + (box?.height ?? 40) / 2),
  };
}

async function longPressTransactionRow(page, row, durationMs = 520) {
  const start = await transactionRowTouchCoordinates(page, row);
  await withTouchInputSession(page, async (client) => {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoint(start.x, start.y) });
    await page.waitForTimeout(durationMs);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
  await page.waitForTimeout(420);
}

async function longPressDragTransactionRows(page, startRow, endRow, durationMs = 520) {
  const start = await transactionRowTouchCoordinates(page, startRow);
  const end = await transactionRowCurrentTouchCoordinates(endRow);
  await withTouchInputSession(page, async (client) => {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoint(start.x, start.y) });
    await page.waitForTimeout(durationMs);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touchPoint(Math.round((start.x + end.x) / 2), Math.round((start.y + end.y) / 2)),
    });
    await page.waitForTimeout(60);
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchPoint(end.x, end.y) });
    await page.waitForTimeout(60);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
  await page.waitForTimeout(420);
}

async function releaseTouchPointerOutsideRowBeforeLongPress(page, row) {
  const { x, y } = await transactionRowTouchCoordinates(page, row);
  const outsideY = Math.max(8, y - 96);
  await row.dispatchEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
    pointerId: 287,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: y,
  });
  await page.waitForTimeout(120);
  await page.evaluate(
    ({ clientX, clientY }) => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 287,
          pointerType: "touch",
          isPrimary: true,
          button: 0,
          buttons: 0,
          clientX,
          clientY,
        })
      );
    },
    { clientX: x, clientY: outsideY }
  );
  await page.waitForTimeout(560);
}

async function selectTransactionRowForToolbar(page, row, { expectedCount = 1 } = {}) {
  await expect(row).toBeVisible();
  await row.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  if ((await row.getAttribute("data-row-selected")) !== "true") {
    const viewport = page.viewportSize();
    const isLedgerCompactViewport =
      (viewport?.width ?? 0) <= 820 || ((viewport?.width ?? 0) <= 920 && (viewport?.height ?? 0) <= 520);
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press(isLedgerCompactViewport ? "Shift+Space" : "Space");
  }
  await expect(row).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, expectedCount);
}

async function clickTransactionSelectionToolbarAction(page, row, actionName) {
  await selectTransactionRowForToolbar(page, row);
  const actionTestIds = new Map([
    ["수정", "transaction-selection-edit"],
    ["삭제", "transaction-selection-delete"],
    ["위에 삽입", "transaction-selection-insert-above"],
    ["아래에 삽입", "transaction-selection-insert-below"],
  ]);
  const testId = actionTestIds.get(actionName);
  const actionButton = testId
    ? page.getByTestId(testId)
    : page.getByTestId("transaction-sticky-toolbar").getByRole("button", { name: actionName }).first();
  await expect(actionButton).toBeVisible();
  await actionButton.click();
}

async function scrollTransactionHeaderIntoStickyRange(page) {
  await page.evaluate(() => {
    const toolbar = document.querySelector('[data-testid="transaction-sticky-toolbar"]');
    const header =
      window.innerWidth <= 820
        ? document.querySelector(".transactions-mobile-ledger-head")
        : document.querySelector(".transactions-desktop-ledger-head") ||
          document.querySelector(".transaction-list-card .transactions-surface-table thead");
    if (!toolbar || !header) {
      return;
    }
    const toolbarBox = toolbar.getBoundingClientRect();
    const headerTop = header.getBoundingClientRect().top + window.scrollY;
    const stickyReserve = Math.max(toolbarBox.height + 28, 96);
    window.scrollTo(0, Math.max(0, headerTop - stickyReserve));
  });
  await page.waitForTimeout(300);
}

async function readTransactionStickyHeaderGeometry(page) {
  return page.evaluate(() => {
    const boxOf = (element) => {
      const box = element?.getBoundingClientRect();
      return box
        ? {
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            width: box.width,
            height: box.height,
          }
        : null;
    };
    const toolbar = document.querySelector('[data-testid="transaction-sticky-toolbar"]');
    const desktopHead =
      document.querySelector(".transactions-desktop-ledger-head") ||
      document.querySelector(".transaction-list-card .transactions-surface-table thead");
    const mobileHead = document.querySelector(".transactions-mobile-ledger-head");
    const header = window.innerWidth <= 820 ? mobileHead : desktopHead;
    const firstVisibleRow = Array.from(document.querySelectorAll("tr.transaction-row")).find((row) => {
      const box = row.getBoundingClientRect();
      return box.bottom > 0 && box.top < window.innerHeight;
    });
    const toolbarBox = boxOf(toolbar);
    const headerBox = boxOf(header);
    const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
    const headerStyle = header ? getComputedStyle(header) : null;
    const listCard = document.querySelector(".transaction-list-card");
    const listStyle = listCard ? getComputedStyle(listCard) : null;
    const fabBox = boxOf(document.querySelector('[data-testid="transactions-fab"]'));
    const intersects = (left, right) =>
      Boolean(
        left &&
          right &&
          left.left < right.right &&
          left.right > right.left &&
          left.top < right.bottom &&
          left.bottom > right.top,
      );
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      toolbar: {
        box: toolbarBox,
        position: toolbarStyle?.position || "",
        topCss: toolbarStyle?.top || "",
      },
      header: {
        box: headerBox,
        position: headerStyle?.position || "",
        topCss: headerStyle?.top || "",
        display: headerStyle?.display || "",
      },
      firstVisibleRow: boxOf(firstVisibleRow),
      gap: toolbarBox && headerBox ? headerBox.top - toolbarBox.bottom : null,
      headerOverlapsToolbar: intersects(toolbarBox, headerBox),
      headerOverlapsFab: intersects(headerBox, fabBox),
      firstRowUnderHeader: Boolean(headerBox && firstVisibleRow && firstVisibleRow.getBoundingClientRect().top >= headerBox.bottom - 2),
      cssVars: {
        toolbarHeight: listStyle?.getPropertyValue("--transaction-toolbar-sticky-height").trim() || "",
        columnHeadTop: listStyle?.getPropertyValue("--transaction-column-head-top").trim() || "",
        ledgerTop: listStyle?.getPropertyValue("--surface-ledger-sticky-top").trim() || "",
      },
    };
  });
}

async function expectTransactionStickyHeaderGeometry(page, label) {
  await scrollTransactionHeaderIntoStickyRange(page);
  const geometry = await readTransactionStickyHeaderGeometry(page);
  expect(geometry.toolbar.box, `${label} toolbar should be measurable: ${JSON.stringify(geometry)}`).not.toBeNull();
  expect(geometry.header.box, `${label} header should be measurable: ${JSON.stringify(geometry)}`).not.toBeNull();
  expect(["sticky", "fixed"], `${label} toolbar sticky state: ${JSON.stringify(geometry)}`).toContain(
    geometry.toolbar.position,
  );
  expect(geometry.header.position, `${label} column/ledger header sticky state: ${JSON.stringify(geometry)}`).toBe("sticky");
  expect(geometry.header.display, `${label} header should be displayed: ${JSON.stringify(geometry)}`).not.toBe("none");
  expect(geometry.header.box?.top ?? -1, `${label} header should remain in viewport: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(0);
  expect(geometry.headerOverlapsToolbar, `${label} header should not overlap toolbar: ${JSON.stringify(geometry)}`).toBe(false);
  expect(geometry.headerOverlapsFab, `${label} header should not overlap FAB: ${JSON.stringify(geometry)}`).toBe(false);
  expect(geometry.gap ?? Number.NEGATIVE_INFINITY, `${label} header should sit below toolbar: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(-2);
  return geometry;
}

async function expectDesktopTransactionColumnHeaderLabels(page, label) {
  const header = page.locator(".transactions-desktop-ledger-head").first();
  await expect(header, `${label} desktop ledger header visible`).toBeVisible();
  for (const columnLabel of ["일자", "유형", "카테고리", "메모", "금액", "거래자명", "최종 수정일"]) {
    await expect(header, `${label} should include ${columnLabel}`).toContainText(columnLabel);
  }
  const metrics = await header.evaluate((element) => {
    const toolbar = document.querySelector('[data-testid="transaction-sticky-toolbar"]');
    const toolbarBox = toolbar?.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      position: style.position,
      display: style.display,
      topCss: style.top,
      box: {
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      },
      toolbarBox: toolbarBox
        ? {
            top: toolbarBox.top,
            bottom: toolbarBox.bottom,
            height: toolbarBox.height,
          }
        : null,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
    };
  });
  expect(metrics.position, `${label} desktop ledger header sticky metrics: ${JSON.stringify(metrics)}`).toBe("sticky");
  expect(metrics.display, `${label} desktop ledger header display: ${JSON.stringify(metrics)}`).not.toBe("none");
  expect(metrics.topCss, `${label} desktop ledger header top css: ${JSON.stringify(metrics)}`).not.toBe("auto");
  expect(metrics.box.top, `${label} desktop ledger header should stay in viewport: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(0);
  expect(metrics.box.bottom, `${label} desktop ledger header should stay in viewport: ${JSON.stringify(metrics)}`).toBeLessThan(
    metrics.viewportHeight,
  );
  if (metrics.toolbarBox) {
    expect(
      metrics.box.top,
      `${label} desktop ledger header should follow toolbar, not overlap it: ${JSON.stringify(metrics)}`,
    ).toBeGreaterThanOrEqual(metrics.toolbarBox.bottom - 2);
  }
}

async function sweepSelectRows(page, rows) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const boxes = [];
  for (const row of rows) {
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box, "sweep row should have a bounding box").not.toBeNull();
    boxes.push(box);
  }
  const pointFor = (box) => ({
    x: Math.round(box.x + box.width * 0.42),
    y: Math.round(box.y + box.height / 2),
  });
  const firstPoint = pointFor(boxes[0]);
  await page.mouse.move(firstPoint.x, firstPoint.y);
  await page.mouse.down();
  for (const box of boxes.slice(1)) {
    const point = pointFor(box);
    await page.mouse.move(point.x, point.y, { steps: 8 });
    await expectNoActiveTextSelection(page, "row sweep selection during drag");
  }
  await page.mouse.up();
}

async function sweepFromRowToViewportEdge(page, row, direction = "down", holdMs = 900) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  expect(box, "edge sweep row should have a bounding box").not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport, "edge sweep viewport should exist").not.toBeNull();
  const start = {
    x: Math.round((box?.x ?? 0) + (box?.width ?? 0) * 0.42),
    y: Math.round((box?.y ?? 0) + (box?.height ?? 0) / 2),
  };
  const endY = direction === "up" ? 24 : Math.max(48, (viewport?.height ?? 0) - 24);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + (direction === "up" ? -14 : 14), { steps: 2 });
  await expectNoActiveTextSelection(page, `row edge sweep ${direction} after activation`);
  await page.mouse.move(start.x, endY, { steps: 16 });
  await page.waitForTimeout(holdMs);
  await expectNoActiveTextSelection(page, `row edge sweep ${direction} during auto-scroll`);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function expectNoActiveTextSelection(page, label) {
  const selectedText = await page.evaluate(() => window.getSelection()?.toString() || "");
  expect(selectedText.trim(), `${label} should not leave browser text selected`).toBe("");
}

async function performTouchScrollGestureOnRow(page, row, deltaY = 260) {
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  expect(box, "touch scroll row should have a bounding box").not.toBeNull();
  const x = Math.round((box?.x ?? 0) + Math.min(Math.max((box?.width ?? 0) * 0.42, 24), (box?.width ?? 0) - 12));
  const startY = Math.round((box?.y ?? 0) + Math.min(Math.max((box?.height ?? 0) * 0.5, 18), (box?.height ?? 0) - 8));
  const endY = Math.max(16, startY - Math.abs(deltaY));
  const beforeScrollY = await page.evaluate(() => window.scrollY);
  await withTouchInputSession(page, async (client) => {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoint(x, startY) });
    await page.waitForTimeout(40);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touchPoint(x, Math.round((startY + endY) / 2)),
    });
    await page.waitForTimeout(40);
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchPoint(x, endY) });
    await page.waitForTimeout(40);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });
  await page.waitForTimeout(350);
  const afterScrollY = await page.evaluate(() => window.scrollY);
  const touchAction = await row.evaluate((element) => getComputedStyle(element).touchAction);
  return { beforeScrollY, afterScrollY, touchAction, x, startY, endY };
}

async function expectDesktopTransactionRowsSingleLine(page) {
  const viewport = page.viewportSize();
  if ((viewport?.width ?? 0) <= 820) {
    return;
  }
  const metrics = await page.locator(".transactions-surface-table tbody tr.transaction-row").evaluateAll((rows) =>
    rows.slice(0, 12).map((row) => {
      const box = row.getBoundingClientRect();
      const category = row.querySelector(".category-cell");
      const compact = row.querySelector(".category-cell-compact");
      const major = row.querySelector(".category-cell-major");
      const minor = row.querySelector(".category-cell-minor");
      const emptyCategory = row.querySelector(".category-cell-empty");
      const memo = row.querySelector(".transaction-memo-text");
      return {
        height: box.height,
        categoryDisplay: category ? getComputedStyle(category).display : "",
        compactDisplay: compact ? getComputedStyle(compact).display : "",
        majorDisplay: major ? getComputedStyle(major).display : "",
        minorDisplay: minor ? getComputedStyle(minor).display : "",
        emptyCategoryDisplay: emptyCategory ? getComputedStyle(emptyCategory).display : "",
        memoWhiteSpace: memo ? getComputedStyle(memo).whiteSpace : "",
        memoOverflowY: memo ? memo.scrollHeight - memo.clientHeight : 0,
      };
    })
  );
  expect(metrics.length, "desktop transaction rows should be measurable").toBeGreaterThan(0);
  expect(
    metrics.every((row) => row.height <= 44),
    `desktop rows should remain Excel-like one-line rows: ${JSON.stringify(metrics)}`
  ).toBe(true);
  const categoryColumnRows = metrics.filter((row) => row.categoryDisplay || row.emptyCategoryDisplay);
  expect(categoryColumnRows.length, "desktop category column should be measured").toBeGreaterThan(0);
  const categorizedRows = categoryColumnRows.filter((row) => row.categoryDisplay);
  if (categorizedRows.length > 0) {
    expect(
      categorizedRows.every((row) => row.compactDisplay !== "none" && row.majorDisplay === "none" && row.minorDisplay === "none"),
      `desktop category cells should render as one compact line: ${JSON.stringify(categorizedRows)}`
    ).toBe(true);
  }
  expect(
    metrics.every((row) => row.memoWhiteSpace === "nowrap" && row.memoOverflowY <= 3),
    `desktop memo cells should stay one line: ${JSON.stringify(metrics)}`
  ).toBe(true);
}

async function waitForTransactionAppShell(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("main").waitFor({ state: "visible", timeout: 20_000 });
}

async function openMobileTransactionQuickEntry(page) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width > 820) {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);
  const transactionFab = page.getByTestId("transactions-fab");
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionFab).toBeVisible();
  await expect(transactionFab).toBeEnabled();
  await transactionFab.click();
  await expect(transactionSheet).toBeVisible();
  return transactionSheet;
}

async function openTransactionEntrySheet(page, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport);
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);
  const transactionAddAction =
    (viewport?.width ?? 0) > 820 ? page.getByTestId("transactions-desktop-add-action") : page.getByTestId("transactions-fab");
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionAddAction).toBeVisible();
  await expect(transactionAddAction).toBeEnabled();
  await transactionAddAction.click();
  await expect(transactionSheet).toBeVisible();
  return transactionSheet;
}

async function openTransactionQuickDetails(transactionSheet, summaryText) {
  const labels =
    summaryText === "추가 입력" || summaryText === "전체 카테고리"
      ? [summaryText, "추가 설정", "날짜·유형·거래자·전체 카테고리", "기본값·전체 카테고리"]
      : [summaryText];
  let details = transactionSheet.locator("details.transaction-quick-details", { hasText: labels[0] }).first();
  for (const label of labels) {
    const candidate = transactionSheet.locator("details.transaction-quick-details", { hasText: label }).first();
    if ((await candidate.count()) > 0) {
      details = candidate;
      break;
    }
  }

  if ((await details.count()) === 0) {
    return transactionSheet;
  }

  await expect(details.locator("summary")).toBeVisible();
  const isOpen = await details.evaluate((element) => element.open);
  if (!isOpen) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveJSProperty("open", true);
  return details;
}

async function selectTransactionFormCategory(container, category) {
  const groupChoices = container.getByTestId("transaction-category-group-choice");
  if ((await groupChoices.count()) > 0) {
    const groupChoice = groupChoices.filter({ hasText: category.major }).first();
    await expect(groupChoice).toBeVisible();
    await groupChoice.click();
    await expect(groupChoice).toHaveAttribute("aria-pressed", "true");

    const categoryChoice = container.getByTestId("transaction-category-choice").filter({ hasText: category.minor }).first();
    await expect(categoryChoice).toBeVisible();
    await categoryChoice.click();
    await expect(categoryChoice).toHaveAttribute("aria-pressed", "true");
    return { groupChoice, categoryChoice };
  }

  const majorSelect = labeledField(container, "카테고리 그룹", "select");
  if ((await majorSelect.count()) > 0 && !(await majorSelect.isVisible().catch(() => false))) {
    const quickDetails = container.locator("details.transaction-quick-details");
    if ((await quickDetails.count()) > 0) {
      await openTransactionQuickDetails(container, "전체 카테고리");
    }
  }
  await expect(majorSelect).toBeVisible();
  await majorSelect.selectOption(category.major);
  const categorySelect = container
    .locator("label")
    .filter({ hasText: /^\s*카테고리\s*\(/ })
    .locator("select")
    .first();
  await expect(categorySelect).toBeEnabled();
  await categorySelect.selectOption(String(category.id));
  return { majorSelect, categorySelect };
}

async function selectTransactionFormOwner(container, { ownerless = false } = {}) {
  const ownerChoices = container.getByTestId("transaction-owner-choice");
  if ((await ownerChoices.count()) > 0) {
    const choice = ownerless
      ? container.locator('[data-testid="transaction-owner-choice"][data-owner-value=""]').first()
      : container.locator('[data-testid="transaction-owner-choice"]:not([data-owner-value=""])').first();
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    return choice;
  }

  const ownerSelect = labeledField(container, "거래자", "select");
  if (ownerless) {
    await ownerSelect.selectOption("");
    await expect(ownerSelect).toHaveValue("");
  } else {
    await selectFirstNonEmptyOption(ownerSelect);
  }
  return ownerSelect;
}

async function createTransactionCategoryFromQuickPicker(picker, category) {
  const majorInput = picker.getByTestId("transaction-category-create-major");
  const minorInput = picker.getByTestId("transaction-category-create-minor");
  const submitButton = picker.getByTestId("transaction-category-create-submit");

  if (!(await majorInput.isVisible().catch(() => false))) {
    const searchInput = await openTransactionCategorySearch(picker);
    await searchInput.fill(category.minor);
    const createToggle = picker.getByTestId("transaction-category-create-toggle");
    if ((await createToggle.count()) > 0) {
      await createToggle.click();
    }
  }

  await expect(majorInput).toBeVisible();
  await expect(minorInput).toBeVisible();
  await expect(async () => {
    await majorInput.fill(category.major);
    await minorInput.fill(category.minor);
    await expect(majorInput).toHaveValue(category.major);
    await expect(minorInput).toHaveValue(category.minor);
    await expect(submitButton).toBeEnabled();
  }).toPass({ timeout: 15_000 });
  await submitButton.click();
}

async function openTransactionCategorySearch(picker) {
  const searchToggle = picker.getByTestId("transaction-category-search-toggle");
  if ((await searchToggle.count()) > 0 && (await searchToggle.isVisible().catch(() => false))) {
    await searchToggle.click();
  }
  const searchInput = picker.getByTestId("transaction-category-search");
  await expect(searchInput).toBeVisible();
  return searchInput;
}

async function expectMobileQuickEntryDefaults(page, transactionSheet) {
  const today = await browserLocalTodayIso(page);
  const dateInput =
    (await transactionSheet.getByTestId("transaction-quick-date").count()) > 0
      ? transactionSheet.getByTestId("transaction-quick-date")
      : labeledField(transactionSheet, "일자", "input");
  if ((await dateInput.count()) > 0 && (await dateInput.isVisible().catch(() => false))) {
    await expect(dateInput).toHaveValue(today);
  }

  const expenseChoice = transactionSheet.locator('[data-testid="transaction-flow-choice"][data-flow-type="expense"]').first();
  if ((await expenseChoice.count()) > 0) {
    await expect(expenseChoice).toHaveAttribute("aria-pressed", "true");
  } else {
    const typeSelect = labeledField(transactionSheet, "유형", "select");
    await expect(typeSelect).toHaveValue("expense");
  }
}

async function expectQuickEntryFieldClearOfStickyActions(transactionSheet, labelText, fieldSelector) {
  const field = labeledField(transactionSheet, labelText, fieldSelector);
  await expect(field).toBeVisible();
  await transactionSheet.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

  const metrics = await field.evaluate((element) => {
    const sheet = element.closest("[data-testid='transaction-entry-sheet']");
    const actions = sheet?.querySelector(".transaction-quick-actions");
    const box = element.getBoundingClientRect();
    const sheetBox = sheet?.getBoundingClientRect();
    const actionBox = actions?.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);

    return {
      actionHeight: actionBox?.height ?? 0,
      actionTop: actionBox?.top ?? 0,
      coveredByActions: Boolean(topElement?.closest(".transaction-quick-actions")),
      fieldBottom: box.bottom,
      fieldHeight: box.height,
      fieldTop: box.top,
      label: element.closest("label")?.textContent?.replace(/\s+/g, " ").trim() || "",
      sheetBottom: sheetBox?.bottom ?? 0,
      sheetClientHeight: sheet?.clientHeight ?? 0,
      sheetScrollHeight: sheet?.scrollHeight ?? 0,
      sheetScrollTop: sheet?.scrollTop ?? 0,
    };
  });

  expect(metrics.fieldHeight, `${labelText} field should have measurable height`).toBeGreaterThan(0);
  expect(metrics.coveredByActions, `${labelText} field center should not be under actions`).toBe(false);
  expect(metrics.fieldTop, `${labelText} field should stay inside the sheet: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(
    (metrics.sheetBottom - metrics.sheetClientHeight) - 2
  );
  expect(metrics.sheetScrollHeight, `${labelText} sheet should fit without internal scrolling: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.sheetClientHeight + 2
  );
}

async function expectQuickCategoryReflectedInFullFallback(transactionSheet, selectedChipText) {
  const selectedChoice = transactionSheet.locator('[data-testid="transaction-category-choice"][aria-pressed="true"]').first();
  if ((await selectedChoice.count()) > 0) {
    await expect(selectedChoice).toContainText(selectedChipText);
  }
}

async function expectTransactionEntryPrimaryPath(page, transactionSheet, label) {
  const quickForm = transactionSheet.getByTestId("transaction-quick-form");
  const dateInput = transactionSheet.getByTestId("transaction-quick-date");
  const amountInput = transactionSheet.getByTestId("transaction-quick-amount");
  const stagedCategory = transactionSheet.getByTestId("transaction-staged-category");
  const ownerChoices = transactionSheet.getByTestId("transaction-owner-choice");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  const saveButton = transactionSheet.getByTestId("transaction-quick-save");

  await expect(quickForm, `${label} should use the quick transaction form`).toBeVisible();
  await expect(dateInput, `${label} date is the first primary field`).toBeVisible();
  await expect(dateInput, `${label} date defaults to today`).toHaveValue(await browserLocalTodayIso(page));
  await expect(amountInput, `${label} amount is visible`).toBeVisible();
  await expect(stagedCategory, `${label} staged category buttons are in the primary path`).toBeVisible();
  await expect(ownerChoices.first(), `${label} owner choice buttons are in the primary path`).toBeVisible();
  await expect(memoInput, `${label} memo is in the primary path`).toBeVisible();
  await expect(saveButton, `${label} save is visible with primary fields`).toBeVisible();
  await expect(transactionSheet.locator("details.transaction-quick-details"), `${label} should not hide primary fields in details`).toHaveCount(0);
  await expect(transactionSheet.getByTestId("transaction-category-quick-picker"), `${label} should not render recommended category picker`).toHaveCount(0);
  await expectStagedCategoryLayoutStable(page);

  const metrics = await transactionSheet.evaluate((sheet) => {
    const rectFor = (element) => {
      const rect = element?.getBoundingClientRect();
      if (!rect) {
        return null;
      }
      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      };
    };
    const visible = (element) => {
      const rect = element?.getBoundingClientRect();
      const style = element ? getComputedStyle(element) : null;
      return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden");
    };
    const date = sheet.querySelector("[data-testid='transaction-quick-date']");
    const amount = sheet.querySelector("[data-testid='transaction-quick-amount']");
    const category = sheet.querySelector("[data-testid='transaction-staged-category']");
    const owner = sheet.querySelector(".transaction-owner-choice-section");
    const memo = Array.from(sheet.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim().startsWith("메모"))
      ?.querySelector("input");
    const save = sheet.querySelector("[data-testid='transaction-quick-save']");
    const sheetBox = rectFor(sheet);
    const primaryRects = [date, amount, category, owner, memo, save].map(rectFor);
    const visiblePrimaryRects = [date, amount, category, owner, memo, save].filter(visible).map(rectFor);
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const documentOverflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const sheetOverflowX = sheet.scrollWidth - sheet.clientWidth;
    const primaryTop = Math.min(...visiblePrimaryRects.map((rect) => rect.top));
    const primaryBottom = Math.max(...visiblePrimaryRects.map((rect) => rect.bottom));
    const primaryHeight = primaryBottom - primaryTop;
    const pointerDistance =
      date && amount && category && owner && memo && save
        ? Math.round(
            Math.abs(rectFor(date).centerY - rectFor(amount).centerY) +
              Math.abs(rectFor(amount).centerY - rectFor(category).centerY) +
              Math.abs(rectFor(category).centerY - rectFor(owner).centerY) +
              Math.abs(rectFor(owner).centerY - rectFor(memo).centerY) +
              Math.abs(rectFor(memo).centerY - rectFor(save).centerY)
          )
        : Number.POSITIVE_INFINITY;

    return {
      date: primaryRects[0],
      amount: primaryRects[1],
      category: primaryRects[2],
      owner: primaryRects[3],
      memo: primaryRects[4],
      save: primaryRects[5],
      documentOverflowX,
      pointerDistance,
      primaryHeight,
      sheet: {
        ...sheetBox,
        clientHeight: sheet.clientHeight,
        scrollHeight: sheet.scrollHeight,
        scrollTop: sheet.scrollTop,
      },
      sheetOverflowX,
      viewportHeight,
      viewportWidth,
    };
  });

  expect(metrics.documentOverflowX, `${label} document should not overflow horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.sheetOverflowX, `${label} sheet should not overflow horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(
    Math.abs(metrics.date.top - metrics.amount.top),
    `${label} date and amount should share the compact primary row: ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(3);
  expect(metrics.amount.left, `${label} amount should sit to the right of date: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(
    metrics.date.right - 1
  );
  expect(metrics.amount.top, `${label} amount should precede category: ${JSON.stringify(metrics)}`).toBeLessThan(metrics.category.top);
  expect(metrics.category.top, `${label} category should precede owner: ${JSON.stringify(metrics)}`).toBeLessThan(metrics.owner.top);
  expect(metrics.owner.top, `${label} owner should precede memo: ${JSON.stringify(metrics)}`).toBeLessThan(metrics.memo.top);
  expect(metrics.memo.top, `${label} memo should remain close to save: ${JSON.stringify(metrics)}`).toBeLessThan(metrics.save.bottom);
  expect(metrics.sheet.scrollHeight, `${label} sheet should fit without internal scrolling: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.sheet.clientHeight + 2
  );
  expect(metrics.primaryHeight, `${label} primary path should fit as one compact work unit: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    Math.min(metrics.viewportHeight * 0.98, 820)
  );
  expect(metrics.pointerDistance, `${label} pointer travel should stay bounded: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    Math.min(metrics.viewportHeight * 1.18, 900)
  );
  expect(metrics.save.bottom, `${label} save action should stay in view: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewportHeight + 1);
}

async function installStaleCategoryHistoryFixture(page, { staleCategoryMajor, staleCategoryMinor, staleMemo }) {
  const staleCategoryId = `stale-category-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const staleRowId = `stale-row-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const routePattern = "**/api/v1/transactions**";
  let injected = false;

  await page.route(routePattern, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.pathname.endsWith("/history") || !url.searchParams.has("limit")) {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const payload = await response.json().catch(() => null);
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    if (!payload || items.length === 0) {
      await route.fulfill({ response, json: payload ?? [] });
      return;
    }

    const template = items.find((item) => String(item?.flow_type || "") === "expense") || items[0];
    const nowIso = new Date().toISOString();
    const nextItems = [
      {
        ...template,
        id: staleRowId,
        memo: staleMemo,
        amount: "888888",
        flow_type: "expense",
        occurred_on: currentE2EHistoryDateIso(),
        created_at: nowIso,
        updated_at: nowIso,
        category_id: staleCategoryId,
        category_major: staleCategoryMajor,
        category_minor: staleCategoryMinor,
        category_label: `${staleCategoryMajor} / ${staleCategoryMinor}`,
      },
      ...items,
    ];
    injected = true;
    await route.fulfill({ response, json: Array.isArray(payload) ? nextItems : { ...payload, items: nextItems } });
  });

  return {
    wasInjected: () => injected,
    unroute: () => page.unroute(routePattern),
  };
}

test("mobile quick entry creates an expense through one-screen staged buttons", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-create")}@example.com`;
  const displayName = unique("tx-quick-create-name");
  const seedMemo = unique("tx-quick-seed");
  const memo = unique("tx-quick-created");

  await bootstrapVerifiedSession(page, { email, displayName });
  const seedCategory = await createCategoryViaApi(page, {
    major: unique("빠른입력"),
    minor: unique("최근카테고리"),
  });
  await createTransactionViaApi(page, {
    memo: seedMemo,
    amount: "13579",
    categoryId: seedCategory.id,
    ownerName: displayName,
  });
  await page.reload();

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  const quickForm = page.getByTestId("transaction-quick-form");
  await expect(quickForm).toBeVisible();
  const quickDate = page.getByTestId("transaction-quick-date");
  await expect(quickDate).toBeVisible();
  const quickAmount = page.getByTestId("transaction-quick-amount");
  await expect(quickAmount).toBeVisible();
  await expect(quickAmount).toBeFocused();
  const amountBox = await quickAmount.boundingBox();
  const dateBox = await quickDate.boundingBox();
  const firstSheetFieldTop = await quickForm.locator("input, select, textarea, button").evaluateAll((nodes) => {
    const visibleTops = nodes
      .map((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" ? box.top : null;
      })
      .filter((top) => top !== null);
    return visibleTops.length ? Math.min(...visibleTops) : Number.POSITIVE_INFINITY;
  });
  expect(dateBox?.y ?? Number.POSITIVE_INFINITY, "date should be the first meaningful sheet field").toBeLessThanOrEqual(firstSheetFieldTop + 4);
  expect(
    Math.abs((dateBox?.y ?? Number.POSITIVE_INFINITY) - (amountBox?.y ?? Number.NEGATIVE_INFINITY)),
    "date and amount should share the compact primary row"
  ).toBeLessThanOrEqual(3);
  expect(amountBox?.x ?? 0, "amount should sit to the right of date").toBeGreaterThanOrEqual((dateBox?.x ?? 0) + (dateBox?.width ?? 0) - 1);
  await expectMobileQuickEntryDefaults(page, transactionSheet);

  await quickAmount.fill("24680");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  await expect(memoInput).toBeVisible();
  await quickAmount.press("Enter");
  await expect(memoInput).toBeFocused();
  await memoInput.fill(memo);

  const { categoryChoice } = await selectTransactionFormCategory(transactionSheet, seedCategory);
  await expect(categoryChoice).toContainText(seedCategory.minor);
  await expectStagedCategoryLayoutStable(page);
  await capture(page, "transactions-quick-entry-create");

  const quickSave = page.getByTestId("transaction-quick-save");
  await expect(quickSave).toBeVisible();
  await expect(quickSave).toBeEnabled();
  await quickSave.click();

  const createdRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(createdRow).toBeVisible({ timeout: 20_000 });
});

test("mobile quick entry locks save while a transaction submit is pending", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-submit-lock")}@example.com`;
  const displayName = unique("tx-quick-submit-lock-name");
  const seedMemo = unique("tx-quick-submit-seed");
  const memo = unique("tx-quick-submit-created");

  await bootstrapVerifiedSession(page, { email, displayName });
  const seedCategory = await createCategoryViaApi(page, {
    major: unique("빠른저장잠금"),
    minor: unique("최근카테고리"),
  });
  await createTransactionViaApi(page, {
    memo: seedMemo,
    amount: "13579",
    categoryId: seedCategory.id,
    ownerName: displayName,
  });
  await page.reload();

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  const quickAmount = page.getByTestId("transaction-quick-amount");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  await quickAmount.fill("24680");
  await memoInput.fill(memo);
  await selectTransactionFormCategory(transactionSheet, seedCategory);

  let resolveFirstPost;
  let releasePost;
  const firstPostSeen = new Promise((resolve) => {
    resolveFirstPost = resolve;
  });
  const postRelease = new Promise((resolve) => {
    releasePost = resolve;
  });
  let postCount = 0;

  await page.route("**/api/v1/transactions", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "POST" || !url.pathname.endsWith("/api/v1/transactions")) {
      await route.continue();
      return;
    }

    postCount += 1;
    resolveFirstPost();
    await postRelease;
    await route.continue();
  });

  const quickSave = page.getByTestId("transaction-quick-save");
  await expect(quickSave).toBeEnabled();
  await quickSave.click();
  await firstPostSeen;
  await expect(quickSave, "transaction save should lock while POST is pending").toBeDisabled();
  expect(postCount, "only one transaction POST should be started before the pending save resolves").toBe(1);

  releasePost();
  const createdRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(createdRow).toBeVisible({ timeout: 20_000 });
  expect(postCount, "unlock should happen after the original save resolves, not by issuing another POST").toBe(1);
  await capture(page, "transactions-quick-submit-lock");
});

test("transaction entry primary path stays shallow across mobile tablet and desktop", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-entry-primary-path")}@example.com`;
  const displayName = unique("tx-entry-primary-path-name");
  const seedMemo = unique("tx-entry-primary-seed");
  await bootstrapVerifiedSession(page, { email, displayName });
  const recentCategories = await Promise.all(
    [
      {
        major: "post-deploy-import-major",
        minor: `${unique("초장문추천카테고리")}-post-deploy-import-minor-long-primary-path`,
      },
      {
        major: "post-deploy-import-major",
        minor: `${unique("초장문추천카테고리")}-post-deploy-import-minor-long-secondary-path`,
      },
    ].map((category) => createCategoryViaApi(page, category))
  );
  const fallbackCategory = await createCategoryViaApi(page, {
    major: `${unique("초장문대분류")}-post-deploy-import-major-long-fallback-label`,
    minor: `${unique("fallback중분류")}-post-deploy-import-minor-long-fallback-label`,
  });
  await Promise.all(
    recentCategories.map((category, index) =>
      createTransactionViaApi(page, {
        memo: `${seedMemo}-${index}`,
        amount: String(12000 + index),
        categoryId: category.id,
        ownerName: displayName,
      })
    )
  );

  const cases = [
    {
      name: "mobile-320",
      viewport: { width: 320, height: 568 },
      fontStack: '"Malgun Gothic", "Noto Sans KR", sans-serif',
    },
    {
      name: "mobile-390",
      viewport: { width: 390, height: 844 },
      fontStack: '"Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
    },
    {
      name: "tablet-768",
      viewport: { width: 768, height: 1024 },
      fontStack: '"Noto Sans KR", "Malgun Gothic", sans-serif',
    },
    {
      name: "desktop-1366",
      viewport: { width: 1366, height: 900 },
      fontStack: '"Malgun Gothic", "Noto Sans KR", sans-serif',
    },
  ];

  for (const testCase of cases) {
    await page.setViewportSize(testCase.viewport);
    await page.reload();
    await page.addStyleTag({
      content: `html, body, button, input, select, textarea { font-family: ${testCase.fontStack} !important; }`,
    });
    const transactionSheet = await openTransactionEntrySheet(page, testCase.viewport);
    await expect(transactionSheet.getByTestId("transaction-category-quick-picker")).toHaveCount(0);
    await expect(transactionSheet.locator("details.transaction-quick-details")).toHaveCount(0);
    await expect(transactionSheet.getByTestId("transaction-flow-choice")).toHaveCount(4);
    await expectTransactionEntryPrimaryPath(page, transactionSheet, testCase.name);
    const fallbackGroup = transactionSheet.getByTestId("transaction-category-group-choice").filter({ hasText: fallbackCategory.major }).first();
    await expect(fallbackGroup, `${testCase.name} should expose the long fallback group as a button`).toBeVisible();
    await fallbackGroup.click();
    await expect(transactionSheet.getByTestId("transaction-category-choice").filter({ hasText: fallbackCategory.minor }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, `transactions-entry-primary-path-${testCase.name}`);
    await transactionSheet.getByTestId("transaction-entry-sheet-close").click();
    const closeDraftDialog = page.getByRole("alertdialog");
    if (await closeDraftDialog.isVisible().catch(() => false)) {
      await closeDraftDialog.getByRole("button", { name: "입력 닫기" }).click();
    }
    await expect(transactionSheet).toBeHidden();
  }
});

test("desktop transaction entry keeps repeat context after save", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-repeat-desktop")}@example.com`;
  const displayName = unique("tx-repeat-desktop-name");
  const category = await (async () => {
    await bootstrapVerifiedSession(page, { email, displayName });
    return createCategoryViaApi(page, {
      major: unique("반복입력"),
      minor: unique("영수증"),
    });
  })();
  await page.reload();
  await waitForTransactionAppShell(page);
  const firstMemo = unique("tx-repeat-desktop-first");
  const secondMemo = unique("tx-repeat-desktop-second");
  const occurredOn = currentE2EHistoryDateIso(-2);

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await openTransactionQuickDetails(transactionSheet, "추가 입력");
  const amountInput = labeledField(transactionSheet, "금액", "input");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  const dateInput = labeledField(transactionSheet, "일자", "input");
  const expenseChoice = transactionSheet.locator('[data-testid="transaction-flow-choice"][data-flow-type="expense"]').first();

  await dateInput.fill(occurredOn);
  await expenseChoice.click();
  const { groupChoice, categoryChoice } = await selectTransactionFormCategory(transactionSheet, category);
  const ownerChoice = await selectTransactionFormOwner(transactionSheet);
  const ownerValue = await ownerChoice.getAttribute("data-owner-value");
  await amountInput.fill("12345");
  await memoInput.fill(firstMemo);
  await capture(page, "transactions-repeat-desktop-before-save");

  await transactionSheet.getByRole("button", { name: "거래 등록" }).click();
  await expect(page.locator("tr.transaction-row", { hasText: firstMemo }).first()).toBeVisible({ timeout: 20_000 });

  await expect(transactionSheet).toBeVisible();
  await expect(amountInput).toHaveValue("");
  await expect(memoInput).toHaveValue("");
  await expect(dateInput).toHaveValue(occurredOn);
  await expect(expenseChoice).toHaveAttribute("aria-pressed", "true");
  await expect(groupChoice).toHaveAttribute("aria-pressed", "true");
  await expect(categoryChoice).toHaveAttribute("aria-pressed", "true");
  await expect(transactionSheet.locator(`[data-testid="transaction-owner-choice"][data-owner-value="${ownerValue}"]`)).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(amountInput).toBeFocused();
  await capture(page, "transactions-repeat-desktop-context-preserved");

  await amountInput.fill("23456");
  await memoInput.fill(secondMemo);
  await transactionSheet.getByRole("button", { name: "거래 등록" }).click();
  await expect(page.locator("tr.transaction-row", { hasText: secondMemo }).first()).toBeVisible({ timeout: 20_000 });
});

test("issue 193: desktop transaction entry selects category through staged buttons", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-cat-entry")}@example.com`;
  const displayName = unique("tx-cat-entry-name");
  const targetCategory = {
    major: unique("빠른분류"),
    minor: unique("검색항목"),
  };

  await bootstrapVerifiedSession(page, { email, displayName });
  const category = await createCategoryViaApi(page, targetCategory);
  await page.reload();
  await waitForTransactionAppShell(page);

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await expect(transactionSheet.getByTestId("transaction-category-quick-picker")).toHaveCount(0);
  await expect(transactionSheet.getByTestId("transaction-category-search")).toHaveCount(0);

  const { groupChoice, categoryChoice } = await selectTransactionFormCategory(transactionSheet, category);
  await expect(groupChoice).toContainText(targetCategory.major);
  await expect(categoryChoice).toContainText(targetCategory.minor);
  await capture(page, "issue-193-desktop-category-staged-entry");
});

test("issue 193: inline transaction edit searches category in one step", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-cat-inline")}@example.com`;
  const displayName = unique("tx-cat-inline-name");
  const memo = unique("tx-cat-inline-memo");
  const sourceCategory = {
    major: unique("기존분류"),
    minor: unique("기존항목"),
  };
  const targetCategory = {
    major: unique("수정분류"),
    minor: unique("수정항목"),
  };

  await bootstrapVerifiedSession(page, { email, displayName });
  const [source, target] = await Promise.all([
    createCategoryViaApi(page, sourceCategory),
    createCategoryViaApi(page, targetCategory),
  ]);
  await createTransactionViaApi(page, {
    memo,
    amount: "12000",
    categoryId: source.id,
    occurredOn: currentE2EHistoryDateIso(),
  });
  await page.reload();
  await waitForTransactionAppShell(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTab(page, "거래");

  const row = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await clickTransactionSelectionToolbarAction(page, row, "수정");
  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();

  const picker = editorRow.getByTestId("transaction-category-quick-picker");
  await expect(picker).toBeVisible();

  const searchInput = picker.getByTestId("transaction-category-search");
  await expect(searchInput).toBeVisible();
  await searchInput.fill(targetCategory.minor);

  const option = picker
    .locator("[data-testid='transaction-category-option'], [data-testid='transaction-quick-category-chip']")
    .filter({ hasText: targetCategory.minor })
    .first();
  await expect(option).toBeVisible();
  await option.click();

  await expect(editorRow.getByLabel("카테고리 그룹", { exact: true })).toHaveValue(targetCategory.major);
  await expect(editorRow.getByLabel("카테고리", { exact: true })).toHaveValue(String(target.id));
  await capture(page, "issue-193-inline-category-one-step-edit");
});

test("issue 194: desktop transaction entry does not expose the removed category quick picker", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-cat-create-entry")}@example.com`;
  const displayName = unique("tx-cat-create-entry-name");
  await bootstrapVerifiedSession(page, { email, displayName });

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await expect(transactionSheet.getByTestId("transaction-staged-category")).toBeVisible();
  await expect(transactionSheet.getByTestId("transaction-category-quick-picker")).toHaveCount(0);
  await expect(transactionSheet.getByTestId("transaction-category-create-submit")).toHaveCount(0);
  await expect(transactionSheet).not.toContainText("추천 카테고리");
  await capture(page, "issue-194-desktop-category-quick-picker-removed");
});

test("issue 194: inline transaction edit creates and applies a missing category inline", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-cat-create-inline")}@example.com`;
  const displayName = unique("tx-cat-create-inline-name");
  const memo = unique("tx-cat-create-inline-memo");
  const sourceCategory = {
    major: unique("기존즉시분류"),
    minor: unique("기존즉시항목"),
  };
  const targetCategory = {
    major: unique("수정즉시분류"),
    minor: unique("수정즉시항목"),
  };

  await bootstrapVerifiedSession(page, { email, displayName });
  const source = await createCategoryViaApi(page, sourceCategory);
  await createTransactionViaApi(page, {
    memo,
    amount: "12000",
    categoryId: source.id,
    occurredOn: currentE2EHistoryDateIso(),
  });
  await page.reload();
  await waitForTransactionAppShell(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTab(page, "거래");

  const row = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await clickTransactionSelectionToolbarAction(page, row, "수정");
  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();

  const picker = editorRow.getByTestId("transaction-category-quick-picker");
  await expect(picker).toBeVisible();
  await createTransactionCategoryFromQuickPicker(picker, targetCategory);

  await expect(editorRow.getByLabel("카테고리 그룹", { exact: true })).toHaveValue(targetCategory.major);
  await expect(editorRow.getByLabel("카테고리", { exact: true }).locator("option:checked")).toContainText(targetCategory.minor);
  await capture(page, "issue-194-inline-category-create");
});

test("issue 195: transaction entry keeps a compatible category when type changes", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-flow-compatible")}@example.com`;
  const displayName = unique("tx-flow-compatible-name");
  const categoryPair = {
    major: unique("유형공유분류"),
    minor: unique("유형공유항목"),
  };

  await bootstrapVerifiedSession(page, { email, displayName });
  const expenseCategory = await createCategoryViaApi(page, {
    ...categoryPair,
    flowType: "expense",
  });
  const incomeCategory = await createCategoryViaApi(page, {
    ...categoryPair,
    flowType: "income",
  });
  await page.reload();
  await waitForTransactionAppShell(page);

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await selectTransactionFormCategory(transactionSheet, expenseCategory);
  const incomeChoice = transactionSheet.locator('[data-testid="transaction-flow-choice"][data-flow-type="income"]').first();
  await expect(incomeChoice).toBeVisible();
  await incomeChoice.click();
  await expect(incomeChoice).toHaveAttribute("aria-pressed", "true");

  await expect(transactionSheet.getByTestId("transaction-category-group-choice").filter({ hasText: categoryPair.major }).first()).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(transactionSheet.getByTestId("transaction-category-choice").filter({ hasText: incomeCategory.minor }).first()).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(transactionSheet.getByTestId("transaction-category-restore-notice")).toHaveCount(0);
  await capture(page, "issue-195-entry-compatible-category-kept");
});

test("issue 195: transaction entry offers a category restore when type clears selection", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-flow-restore")}@example.com`;
  const displayName = unique("tx-flow-restore-name");
  const category = {
    major: unique("유형복구분류"),
    minor: unique("유형복구항목"),
  };

  await bootstrapVerifiedSession(page, { email, displayName });
  const expenseCategory = await createCategoryViaApi(page, category);
  await page.reload();
  await waitForTransactionAppShell(page);

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await selectTransactionFormCategory(transactionSheet, expenseCategory);
  const incomeChoice = transactionSheet.locator('[data-testid="transaction-flow-choice"][data-flow-type="income"]').first();
  await expect(incomeChoice).toBeVisible();
  await incomeChoice.click();
  await expect(incomeChoice).toHaveAttribute("aria-pressed", "true");

  const restoreNotice = transactionSheet.getByTestId("transaction-category-restore-notice");
  await expect(restoreNotice).toContainText("카테고리 선택을 비웠습니다.");
  await expect(restoreNotice).toContainText(category.minor);
  await expect(transactionSheet.getByTestId("transaction-category-choice").filter({ hasText: category.minor })).toHaveCount(0);

  await transactionSheet.getByTestId("transaction-category-restore-button").click();
  await expect(transactionSheet.locator('[data-testid="transaction-flow-choice"][data-flow-type="expense"]').first()).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(transactionSheet.getByTestId("transaction-category-group-choice").filter({ hasText: category.major }).first()).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(transactionSheet.getByTestId("transaction-category-choice").filter({ hasText: expenseCategory.minor }).first()).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await capture(page, "issue-195-entry-category-restored");
});

test("issue 195: inline transaction edit restores the original category after type change", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-flow-inline")}@example.com`;
  const displayName = unique("tx-flow-inline-name");
  const memo = unique("tx-flow-inline-memo");
  const category = {
    major: unique("인라인복구분류"),
    minor: unique("인라인복구항목"),
  };

  await bootstrapVerifiedSession(page, { email, displayName });
  const expenseCategory = await createCategoryViaApi(page, category);
  await createTransactionViaApi(page, {
    memo,
    amount: "12000",
    categoryId: expenseCategory.id,
    occurredOn: currentE2EHistoryDateIso(),
  });
  await page.reload();
  await waitForTransactionAppShell(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTab(page, "거래");

  const row = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await clickTransactionSelectionToolbarAction(page, row, "수정");
  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();

  const typeSelect = editorRow.getByLabel("유형", { exact: true });
  await typeSelect.selectOption("income");
  const restoreNotice = editorRow.getByTestId("tx-inline-category-restore-notice");
  await expect(restoreNotice).toContainText("원래 카테고리를 잃을 수 있습니다.");
  await expect(restoreNotice).toContainText(category.minor);
  await expect(editorRow.getByLabel("카테고리", { exact: true })).toHaveValue("");

  await editorRow.getByTestId("tx-inline-category-restore-button").click();
  await expect(typeSelect).toHaveValue("expense");
  await expect(editorRow.getByLabel("카테고리 그룹", { exact: true })).toHaveValue(category.major);
  await expect(editorRow.getByLabel("카테고리", { exact: true })).toHaveValue(String(expenseCategory.id));
  await capture(page, "issue-195-inline-original-category-restored");
});

test("issue 196: transaction save clears hiding filters and reveals the saved row", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-save-filter")}@example.com`;
  const displayName = unique("tx-save-filter-name");
  const seedMemo = unique("tx-save-filter-seed");
  const savedMemo = unique("tx-save-filter-saved");
  const occurredOn = currentE2EHistoryDateIso();
  const categoryPair = {
    major: unique("저장필터분류"),
    minor: unique("저장필터항목"),
  };

  await bootstrapVerifiedSession(page, { email, displayName });
  const incomeCategory = await createCategoryViaApi(page, {
    ...categoryPair,
    flowType: "income",
  });
  const expenseCategory = await createCategoryViaApi(page, categoryPair);
  await createTransactionViaApi(page, {
    memo: seedMemo,
    amount: "12000",
    flowType: "income",
    categoryId: incomeCategory.id,
    occurredOn,
  });
  await page.reload();
  await waitForTransactionAppShell(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTab(page, "거래");

  const listCard = page.locator(".transaction-list-card").first();
  await expect(listCard).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: seedMemo }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("transaction-sticky-toolbar").getByRole("button", { name: "필터 열기" }).click();
  await expect(listCard.locator(".tx-header-filters")).toBeVisible();
  await listCard.locator(".tx-header-filter-search input").fill(seedMemo);
  await listCard.locator(".tx-header-filter-type select").selectOption("income");
  await expect(page.locator("tr.transaction-row", { hasText: seedMemo }).first()).toBeVisible();
  await capture(page, "issue-196-active-filter-before-save");

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await openTransactionQuickDetails(transactionSheet, "추가 입력");
  await labeledField(transactionSheet, "일자", "input").fill(occurredOn);
  await transactionSheet.locator('[data-testid="transaction-flow-choice"][data-flow-type="expense"]').click();
  await selectTransactionFormCategory(transactionSheet, expenseCategory);
  await selectTransactionFormOwner(transactionSheet);
  await labeledField(transactionSheet, "금액", "input").fill("34567");
  await labeledField(transactionSheet, "메모", "input").fill(savedMemo);
  await capture(page, "issue-196-save-with-hiding-filter");
  await transactionSheet.getByRole("button", { name: "거래 등록" }).click();

  const savedRow = page.locator("tr.transaction-row", { hasText: savedMemo }).first();
  await expect(savedRow).toBeVisible({ timeout: 20_000 });
  await expect(savedRow).toHaveAttribute("data-save-highlight", "true");
  await expect(listCard.locator(".surface-control-strip")).toContainText("필터 기본");
  await expect(listCard.locator(".tx-header-filter-search input")).toHaveValue("");
  await expect(listCard.locator(".tx-header-filter-type select")).toHaveValue("all");
  await capture(page, "issue-196-saved-row-visible-after-filter-clear");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(savedRow).toBeVisible();
  await expect(savedRow).toHaveAttribute("data-save-highlight", "true");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-196-mobile-saved-row-visible-after-filter-clear");
});

test("issue 212: mobile transaction quick amount requests a numeric keypad", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-mobile-amount-keypad")}@example.com`;
  const displayName = unique("tx-mobile-amount-keypad-name");

  await bootstrapVerifiedSession(page, { email, displayName });

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  const quickAmount = page.getByTestId("transaction-quick-amount");
  await expect(quickAmount).toBeVisible();
  await expect(quickAmount).toBeFocused();
  await expect(quickAmount, "quick entry amount keeps text formatting support").toHaveAttribute("type", "text");
  await expect(quickAmount, "quick entry amount requests mobile numeric keypad").toHaveAttribute("inputmode", "numeric");
  await expect(quickAmount, "quick entry amount advances to the next field").toHaveAttribute("enterkeyhint", "next");
  const quickAttributes = await quickAmount.evaluate((input) => ({
    type: input.getAttribute("type"),
    inputMode: input.getAttribute("inputmode"),
    pattern: input.getAttribute("pattern"),
    placeholder: input.getAttribute("placeholder"),
  }));
  expect(quickAttributes).toEqual({
    type: "text",
    inputMode: "numeric",
    pattern: null,
    placeholder: "0",
  });
  await capture(page, "issue-212-mobile-quick-amount-numeric-keypad");

  await expect(transactionSheet).toContainText("일자부터 거래자까지 한 화면에서 저장합니다.");
});

test("mobile quick entry keeps repeat context and returns focus to amount", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-repeat-mobile")}@example.com`;
  const displayName = unique("tx-repeat-mobile-name");
  await bootstrapVerifiedSession(page, { email, displayName });
  const category = await createCategoryViaApi(page, {
    major: unique("반복모바일"),
    minor: unique("영수증"),
  });
  await page.reload();
  await waitForTransactionAppShell(page);
  const firstMemo = unique("tx-repeat-mobile-first");
  const secondMemo = unique("tx-repeat-mobile-second");
  const occurredOn = currentE2EHistoryDateIso(-1);

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  const quickAmount = page.getByTestId("transaction-quick-amount");
  const memoInput = labeledField(transactionSheet, "메모", "input");

  await openTransactionQuickDetails(transactionSheet, "추가 입력");
  const dateInput = labeledField(transactionSheet, "일자", "input");
  const expenseChoice = transactionSheet.locator('[data-testid="transaction-flow-choice"][data-flow-type="expense"]').first();
  await dateInput.fill(occurredOn);
  await expenseChoice.click();
  const ownerChoice = await selectTransactionFormOwner(transactionSheet);
  const ownerValue = await ownerChoice.getAttribute("data-owner-value");
  await openTransactionQuickDetails(transactionSheet, "전체 카테고리");
  const { groupChoice, categoryChoice } = await selectTransactionFormCategory(transactionSheet, category);
  await quickAmount.fill("12345");
  await memoInput.fill(firstMemo);
  await capture(page, "transactions-repeat-mobile-before-save");

  await page.getByTestId("transaction-quick-save").click();
  await expect(page.locator("tr.transaction-row", { hasText: firstMemo }).first()).toBeVisible({ timeout: 20_000 });

  await expect(transactionSheet).toBeVisible();
  await expect(quickAmount).toHaveValue("");
  await expect(memoInput).toHaveValue("");
  await expect(dateInput).toHaveValue(occurredOn);
  await expect(expenseChoice).toHaveAttribute("aria-pressed", "true");
  await expect(groupChoice).toHaveAttribute("aria-pressed", "true");
  await expect(categoryChoice).toHaveAttribute("aria-pressed", "true");
  await expect(transactionSheet.locator(`[data-testid="transaction-owner-choice"][data-owner-value="${ownerValue}"]`)).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(quickAmount).toBeFocused();
  await capture(page, "transactions-repeat-mobile-context-preserved");

  await quickAmount.fill("23456");
  await memoInput.fill(secondMemo);
  await page.getByTestId("transaction-quick-save").click();
  await expect(page.locator("tr.transaction-row", { hasText: secondMemo }).first()).toBeVisible({ timeout: 20_000 });
});

test("mobile quick entry rejects decimal KRW amount immediately", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-quick-decimal")}@example.com`;
  const displayName = unique("tx-quick-decimal-name");
  const memo = unique("tx-quick-decimal-memo");

  await bootstrapVerifiedSession(page, { email, displayName });

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  const quickAmount = page.getByTestId("transaction-quick-amount");
  await expect(quickAmount).toBeVisible();
  await expect(quickAmount).toHaveAttribute("inputmode", "numeric");
  await quickAmount.click();
  await quickAmount.fill("");
  await quickAmount.pressSequentially("123.6");
  await expect(quickAmount).toHaveValue("123.6");

  const amountError = transactionSheet.locator("#transaction-quick-amount-error");
  await expect(quickAmount).toHaveAttribute("aria-invalid", "true");
  await expect(quickAmount).toHaveAttribute("aria-describedby", "transaction-quick-amount-error");
  await expect(amountError).toHaveText("원화 금액은 소수 없이 정수로 입력해 주세요.");
  await expect(page.locator(".message", { hasText: "원화 금액은 소수 없이 정수로 입력해 주세요." })).toHaveCount(0);
  await labeledField(transactionSheet, "메모", "input").fill(memo);
  await page.getByTestId("transaction-quick-save").click();
  await expect(amountError).toHaveText("원화 금액은 소수 없이 정수로 입력해 주세요.");
  await expect(page.locator(".message", { hasText: "원화 금액은 소수 없이 정수로 입력해 주세요." })).toHaveCount(0);
  await expect(page.locator("tr.transaction-row", { hasText: memo })).toHaveCount(0);
  await capture(page, "transactions-quick-decimal-rejected");
});

test("mobile quick entry selected category button remains readable while hovered", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-chip-hover")}@example.com`;
  const displayName = unique("tx-quick-chip-hover-name");
  const seedMemo = unique("tx-quick-chip-hover-seed");

  await bootstrapVerifiedSession(page, { email, displayName });
  const seedCategory = await createCategoryViaApi(page, {
    major: unique("선택칩"),
    minor: unique("대비확인"),
  });
  await createTransactionViaApi(page, {
    memo: seedMemo,
    amount: "31415",
    categoryId: seedCategory.id,
    ownerName: displayName,
  });
  await page.reload();

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  await page.getByTestId("transaction-quick-amount").fill("27182");
  const groupChoice = transactionSheet.getByTestId("transaction-category-group-choice").filter({ hasText: seedCategory.major }).first();
  await expect(groupChoice).toBeVisible();
  await groupChoice.click();
  const categoryChoice = transactionSheet.getByTestId("transaction-category-choice").filter({ hasText: seedCategory.minor }).first();
  await expect(categoryChoice).toBeVisible();
  await categoryChoice.hover();
  await page.mouse.down();
  try {
    await expectTextContrast(categoryChoice, "pressed staged category button");
  } finally {
    await page.mouse.up();
  }
  await categoryChoice.click();
  await categoryChoice.hover();
  await expect(categoryChoice).toHaveAttribute("aria-pressed", "true");

  const selectedChoiceMetrics = await categoryChoice.evaluate((choice) => {
    const style = getComputedStyle(choice);
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      color: style.color,
      text: choice.textContent?.replace(/\s+/g, " ").trim() || "",
    };
  });
  expect(
    selectedChoiceMetrics.backgroundImage,
    `selected staged category button should not inherit the global primary-button hover gradient: ${JSON.stringify(selectedChoiceMetrics)}`
  ).toBe("none");
  await expectTextContrast(categoryChoice, "selected staged category button");
  await capture(page, "transactions-quick-entry-selected-category-button-hover");
  await transactionSheet.getByTestId("transaction-entry-sheet-close").click();
});

test("mobile quick entry keeps all fields and actions in one non-scrolling sheet", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-sticky")}@example.com`;
  const displayName = unique("tx-quick-sticky-name");
  const seedMemo = unique("tx-quick-sticky-seed");
  const mobileCases = [
    {
      name: "320-malgun",
      viewport: { width: 320, height: 568 },
      fontStack: '"Malgun Gothic", "Noto Sans KR", sans-serif',
    },
    {
      name: "360-noto",
      viewport: { width: 360, height: 640 },
      fontStack: '"Noto Sans KR", "Apple SD Gothic Neo", sans-serif',
    },
    {
      name: "390-apple",
      viewport: { width: 390, height: 844 },
      fontStack: '"Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
    },
  ];

  await page.setViewportSize(mobileCases[0].viewport);
  await bootstrapVerifiedSession(page, { email, displayName });
  const seedCategory = await createCategoryViaApi(page, {
    major: unique("고정버튼"),
    minor: unique("최근카테고리"),
  });
  await createTransactionViaApi(page, {
    memo: seedMemo,
    amount: "13579",
    categoryId: seedCategory.id,
    ownerName: displayName,
  });

  for (const mobileCase of mobileCases) {
    await page.setViewportSize(mobileCase.viewport);
    await page.reload();
    await page.addStyleTag({ content: `:root { --mf-font-family: ${mobileCase.fontStack}; }` });

    const transactionSheet = await openMobileTransactionQuickEntry(page);
    const quickAmount = page.getByTestId("transaction-quick-amount");
    await expect(quickAmount).toBeVisible();
    await quickAmount.fill("24680");

    await selectTransactionFormCategory(transactionSheet, seedCategory);
    await expectTransactionEntryPrimaryPath(page, transactionSheet, mobileCase.name);
    await expectQuickEntryFieldClearOfStickyActions(transactionSheet, "일자", "input");
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, `transactions-quick-entry-one-screen-${mobileCase.name}`);
    await page.getByTestId("transaction-entry-sheet-close").click();
  }
});

test("transaction mobile meta text keeps readable contrast", async ({ page }) => {
  const email = `${unique("tx-contrast")}@example.com`;
  const displayName = unique("tx-contrast-name");
  const memo = unique("tx-contrast-memo");
  const occurredOn = currentE2EHistoryDateIso();

  await bootstrapVerifiedSession(page, { email, displayName });
  await createBasicTransaction(page, { memo, amount: "12000", occurredOn });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");

  const listCard = page.locator(".transaction-list-card").first();
  await expect(listCard).toBeVisible();
  const shortcutMetrics = await expectTextContrast(
    listCard.getByRole("button", { name: "이번 달" }),
    "transaction this-month shortcut",
  );
  expect(shortcutMetrics.fontSize, "transaction this-month shortcut should remain normal text").toBeLessThan(18);

  const createdRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(createdRow).toBeVisible({ timeout: 20_000 });
  const dateMetrics = await expectTextContrast(createdRow.locator(".mobile-date-text").first(), "transaction mobile date");
  expect(dateMetrics.fontSize, "mobile transaction date remains small meta text").toBeLessThan(18);
  await capture(page, "transactions-mobile-meta-contrast");
});

test("mobile transaction month stepper keeps usable touch targets", async ({ page }) => {
  const email = `${unique("tx-month-touch")}@example.com`;
  const displayName = unique("tx-month-touch-name");
  const memo = unique("tx-month-touch-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  await createBasicTransaction(page, { memo, amount: "12000", occurredOn: currentE2EHistoryDateIso() });
  await page.setViewportSize({ width: 320, height: 568 });
  await openTab(page, "거래");

  const listCard = page.locator(".transaction-list-card").first();
  await expect(listCard).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: memo }).first()).toBeVisible({ timeout: 20_000 });
  const layout = await readTransactionMonthStepperLayout(page);
  expectMonthStepperCentered(layout, "320px transaction month stepper");
  expectTransactionMonthTouchTargets(layout, "320px transaction month stepper");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "transactions-mobile-month-touch-targets");
});

test("issue 197: transaction month direct input clearly marks unapplied changes until Enter", async ({ page }) => {
  test.setTimeout(150_000);

  const email = `${unique("tx-month-apply")}@example.com`;
  const displayName = unique("tx-month-apply-name");
  const currentMemo = unique("tx-month-apply-current");
  const previousMemoPrefix = unique("tx-month-apply-previous");
  const previousBoundaryMemo = unique("tx-month-apply-boundary");
  const currentDate = currentE2EHistoryDateIso();
  const previousDate = currentE2EHistoryDateIso(-35);
  const previousMonth = yearMonthFromIso(previousDate);
  const previousMonthDate = (day) =>
    `${previousMonth.year}-${String(previousMonth.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const previousOldestMemo = `${previousMemoPrefix}-01`;
  const previousLatestMemo = `${previousMemoPrefix}-28`;

  await bootstrapVerifiedSession(page, { email, displayName });
  await createTransactionViaApi(page, { memo: currentMemo, amount: "12000", occurredOn: currentDate });
  await createTransactionViaApi(page, { memo: previousBoundaryMemo, amount: "34000", occurredOn: previousDate });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");

  const listCard = page.locator(".transaction-list-card").first();
  await expect(listCard).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: currentMemo }).first()).toBeVisible({ timeout: 20_000 });
  await waitForTransactionAppShell(page);

  const previousRows = Array.from({ length: 28 }, (_, index) => {
    const day = index + 1;
    return {
      id: `tx-month-apply-${day}`,
      occurred_on: previousMonthDate(day),
      flow_type: "expense",
      amount: 34_000 + day,
      currency: "KRW",
      memo: `${previousMemoPrefix}-${String(day).padStart(2, "0")}`,
      category_id: null,
      owner_user_id: null,
      owner_name: displayName,
      source_ref: null,
      order_key: day * 1024,
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    };
  });
  const previousMonthRequests = [];
  await page.route("**/api/v1/transactions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isPreviousMonthRequest =
      request.method() === "GET" &&
      url.pathname.endsWith("/api/v1/transactions") &&
      url.searchParams.get("year") === String(previousMonth.year) &&
      url.searchParams.get("month") === String(previousMonth.month);
    if (!isPreviousMonthRequest) {
      await route.fallback();
      return;
    }
    const limit = Number(url.searchParams.get("limit") || "1000");
    const offset = Number(url.searchParams.get("offset") || "0");
    previousMonthRequests.push(request.url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(previousRows.slice(offset, offset + limit)),
    });
  });

  await listCard.getByLabel("연도").fill(String(previousMonth.year));
  await listCard.getByLabel("월").fill(String(previousMonth.month));
  const pendingStatus = page.getByTestId("transaction-month-pending-status");
  await expect(pendingStatus).toBeVisible();
  await expect(pendingStatus).toContainText("변경됨");
  await expect(pendingStatus).toContainText("Enter");
  await expect(page.locator("tr.transaction-row", { hasText: currentMemo }).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(previousMonthRequests, "direct month edits should not reload monthly transactions before Enter").toHaveLength(0);
  await capture(page, "issue-197-month-input-unapplied");
  await expect(pendingStatus).toBeVisible();

  const appliedResponse = page.waitForResponse(
    (response) => isMonthlyTransactionsResponse(response, previousMonth),
    { timeout: 20_000 }
  );
  await listCard.getByLabel("월").press("Enter");
  await appliedResponse;
  await expect(pendingStatus).toHaveCount(0);
  await expect(page.locator("tr.transaction-row", { hasText: previousOldestMemo }).first()).toBeVisible({ timeout: 20_000 });
  const latestPreviousRow = page.locator("tr.transaction-row", { hasText: previousLatestMemo }).first();
  await expect(latestPreviousRow).toBeVisible();
  await expect.poll(
    async () =>
      latestPreviousRow.evaluate((row) => {
        const box = row.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
      }),
    { message: "applied month changes should re-anchor the ledger to the latest row" }
  ).toBe(true);
  await capture(page, "issue-197-month-input-applied");
});

test("mobile transaction category flow summaries wrap long leading labels", async ({ page }) => {
  const email = `${unique("tx-flow-wrap")}@example.com`;
  const displayName = unique("tx-flow-wrap-name");
  const memo = unique("tx-flow-wrap-memo");
  const major = unique("issue175-flow-major");
  const minor = `${unique("issue175-flow-minor")} browser verify long representative category label`;

  await bootstrapVerifiedSession(page, { email, displayName });
  const category = await createCategoryViaApi(page, {
    major,
    minor,
    flowType: "expense",
  });
  await createTransactionViaApi(page, {
    memo,
    amount: "110765",
    flowType: "expense",
    categoryId: category.id,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 320, height: 568 });
  await openTab(page, "거래");

  const supportDetails = page.locator("details.compact-support-card").first();
  if ((await supportDetails.count()) > 0 && (await supportDetails.getAttribute("open")) === null) {
    await supportDetails.locator("summary").click();
    await expect(supportDetails).toHaveAttribute("open", "");
  }

  const breakdownCard = page
    .locator(".compact-support-section", {
      has: page.getByRole("heading", { name: "유형별 카테고리 집계" }),
    })
    .first();
  await expect(breakdownCard).toBeVisible();
  const expenseToggle = breakdownCard.getByTestId("tx-flow-summary-toggle-expense");
  await expect(expenseToggle).toBeVisible();
  await expect(expenseToggle.locator(".compact-flow-toggle-meta")).toContainText(minor);

  const expenseCard = breakdownCard
    .locator(".compact-flow-card", {
      has: page.getByTestId("tx-flow-summary-toggle-expense"),
    })
    .first();
  const metrics = await expenseCard.evaluate((card) => {
    const boxOf = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const readNode = (element) => {
      const style = element ? getComputedStyle(element) : null;
      return element
        ? {
            box: boxOf(element),
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            clientHeight: element.clientHeight,
            scrollHeight: element.scrollHeight,
            whiteSpace: style?.whiteSpace || "",
            overflowWrap: style?.overflowWrap || "",
            overflowX: style?.overflowX || "",
            flexWrap: style?.flexWrap || "",
            textOverflow: style?.textOverflow || "",
            text: element.textContent?.replace(/\s+/g, " ").trim() || "",
          }
        : null;
    };
    const toggle = card.querySelector('[data-testid="tx-flow-summary-toggle-expense"]');
    const line = card.querySelector('[data-testid="tx-flow-summary-line"]');
    const meta = card.querySelector(".compact-flow-toggle-meta");
    return {
      viewportWidth: window.innerWidth,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      card: readNode(card),
      toggle: readNode(toggle),
      line: readNode(line),
      meta: readNode(meta),
    };
  });

  expect(metrics.pageOverflowX, `page should not overflow at 320px: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.card.scrollWidth - metrics.card.clientWidth, `flow card should not clip: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.toggle.scrollWidth - metrics.toggle.clientWidth, `flow toggle should not clip: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.line.flexWrap, `summary line should wrap when narrow: ${JSON.stringify(metrics)}`).toBe("wrap");
  expect(metrics.line.whiteSpace, `summary line should not force nowrap: ${JSON.stringify(metrics)}`).not.toBe("nowrap");
  expect(metrics.meta.whiteSpace, `leading category should wrap: ${JSON.stringify(metrics)}`).not.toBe("nowrap");
  expect(metrics.meta.scrollWidth - metrics.meta.clientWidth, `leading category should not clip: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.meta.scrollHeight - metrics.meta.clientHeight, `leading category should not clip vertically: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.card.box.right, `flow card should stay in viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  expect(metrics.meta.box.right, `leading category should stay inside card: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.card.box.right + 1,
  );
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "transactions-compact-flow-mobile-wrap");
});

test("transaction ledger stays readable in landscape compact width", async ({ page }) => {
  const email = `${unique("tx-landscape-ledger")}@example.com`;
  const displayName = unique("tx-landscape-ledger-name");
  const memo = unique("tx-landscape-ledger-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  await createBasicTransaction(page, { memo, amount: "98765", occurredOn: currentE2EHistoryDateIso() });
  await page.setViewportSize({ width: 844, height: 390 });
  await openTab(page, "거래");

  const createdRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(createdRow).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".tx-header-filters").first()).toBeHidden();
  await expect(page.locator(".transactions-mobile-ledger-head").first()).toBeVisible();

  const metrics = await page.evaluate(() => {
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
    const listCard = document.querySelector(".transaction-list-card");
    const scroll = document.querySelector(".transactions-surface-scroll");
    const table = document.querySelector(".transactions-surface-table");
    const row = document.querySelector("tr.transaction-row");
    const amount = row?.querySelector(".transaction-amount-text");
    return {
      viewportWidth: window.innerWidth,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      listCard: listCard
        ? {
            box: boxOf(listCard),
            clientWidth: listCard.clientWidth,
            scrollWidth: listCard.scrollWidth,
          }
        : null,
      scroll: scroll
        ? {
            box: boxOf(scroll),
            clientWidth: scroll.clientWidth,
            scrollWidth: scroll.scrollWidth,
          }
        : null,
      table: table
        ? {
            box: boxOf(table),
            minWidth: getComputedStyle(table).minWidth,
          }
        : null,
      row: boxOf(row),
      amount: amount
        ? {
            text: amount.textContent?.trim() || "",
            box: boxOf(amount),
            clientWidth: amount.clientWidth,
            scrollWidth: amount.scrollWidth,
          }
        : null,
    };
  });

  expect(metrics.listCard, "transaction list card should be measurable").not.toBeNull();
  expect(metrics.scroll, "transaction scroll surface should be measurable").not.toBeNull();
  expect(metrics.table, "transaction table should be measurable").not.toBeNull();
  expect(metrics.row, "transaction row should be measurable").not.toBeNull();
  expect(metrics.amount, "transaction amount should be measurable").not.toBeNull();
  expect(metrics.pageOverflowX, `page should not overflow horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(
    metrics.listCard.scrollWidth - metrics.listCard.clientWidth,
    `transaction list card content should not be clipped: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(1);
  expect(
    metrics.scroll.scrollWidth - metrics.scroll.clientWidth,
    `transaction table wrapper should not require hidden horizontal scrolling: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(1);
  expect(metrics.table.minWidth, "compact transaction table should remove desktop min-width").toBe("0px");
  expect(metrics.row.right, `transaction row should stay inside the viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  expect(metrics.amount.text, "transaction amount should render full grouped value").toContain("98,765");
  expect(
    metrics.amount.scrollWidth - metrics.amount.clientWidth,
    `transaction amount should not clip: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page, 12);

  await page.setViewportSize({ width: 880, height: 500 });
  await openTab(page, "거래");
  await page.waitForTimeout(250);
  await expectMobileTransactionFilterTriggersSeparated(page, "880px landscape transaction ledger");

  const landscapeInsertRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await selectTransactionRowForToolbar(page, landscapeInsertRow);
  await page.getByTestId("transaction-selection-insert-below").click();
  const landscapeInsertSheet = page.getByTestId("transaction-entry-sheet");
  await expect(landscapeInsertSheet).toBeVisible();
  await expect(page.locator("tr.transaction-inline-editor-row")).toHaveCount(0);
  await page.getByTestId("transaction-entry-sheet-close").click();
  await expect(landscapeInsertSheet).toBeHidden();
  await page.getByRole("button", { name: "선택 해제" }).click();

  const landscapeLedgerHead = page.locator(".transactions-mobile-ledger-head").first();
  const openLandscapeFilter = async (buttonName, focusedLabel, closeAfter = true) => {
    const trigger = landscapeLedgerHead.getByRole("button", { name: buttonName });
    await trigger.click();
    const panel = page.getByTestId("tx-ledger-filter-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel(focusedLabel, { exact: true })).toBeFocused();
    await expect(page.locator("#transaction-filter-panel")).toHaveCount(0);
    if (closeAfter) {
      await panel.getByRole("button", { name: "닫기" }).click();
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  };
  await openLandscapeFilter("메모 필터 열기", "메모");
  await openLandscapeFilter("금액 필터 열기", "최소 금액");
  await openLandscapeFilter("유형 필터 열기", "유형", false);

  const landscapeRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(landscapeRow).toBeVisible();
  await landscapeRow.click({ position: { x: 92, y: 18 } });
  await expect(landscapeRow).toHaveClass(/mobile-row-expanded/);

  const landscapeMetrics = await page.evaluate(() => {
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
    const intersects = (left, right) =>
      Boolean(
        left &&
          right &&
          left.x < right.right &&
          left.right > right.x &&
          left.y < right.bottom &&
          left.bottom > right.y,
      );
    const listCard = document.querySelector(".transaction-list-card");
    const ledgerHead = document.querySelector(".transactions-mobile-ledger-head");
    const filterPanel = document.querySelector('[data-testid="tx-ledger-filter-panel"]');
    const filterReset = filterPanel?.querySelector(".tx-ledger-filter-reset");
    const row = document.querySelector("tr.transaction-row");
    const actionRow = row?.nextElementSibling?.classList.contains("transaction-mobile-expanded-actions-row")
      ? row.nextElementSibling
      : null;
    const fab = document.querySelector('[data-testid="transactions-fab"]');
    const boxes = {
      listCard: boxOf(listCard),
      ledgerHead: boxOf(ledgerHead),
      filterPanel: boxOf(filterPanel),
      filterReset: boxOf(filterReset),
      row: boxOf(row),
      actionRow: boxOf(actionRow),
      fab: boxOf(fab),
    };
    return {
      viewportWidth: window.innerWidth,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      listCard: listCard
        ? {
            clientWidth: listCard.clientWidth,
            scrollWidth: listCard.scrollWidth,
          }
        : null,
      boxes,
      filterPanelBelowHead: Boolean(boxes.filterPanel && boxes.ledgerHead && boxes.filterPanel.y >= boxes.ledgerHead.bottom - 2),
      filterResetBeforeRow: Boolean(boxes.filterReset && boxes.row && boxes.filterReset.bottom <= boxes.row.y + 1),
      actionStartsAfterRow: !boxes.actionRow || Boolean(boxes.row && boxes.actionRow.y >= boxes.row.bottom - 1),
      resetRowOverlap: intersects(boxes.filterReset, boxes.row),
      rowActionButtonCount: row?.querySelectorAll(".transaction-col-actions button").length || 0,
    };
  });
  expect(landscapeMetrics.pageOverflowX, `880px landscape should not overflow: ${JSON.stringify(landscapeMetrics)}`).toBeLessThanOrEqual(1);
  expect(
    landscapeMetrics.listCard.scrollWidth - landscapeMetrics.listCard.clientWidth,
    `880px transaction list card content should not be clipped: ${JSON.stringify(landscapeMetrics)}`,
  ).toBeLessThanOrEqual(1);
  expect(landscapeMetrics.filterPanelBelowHead, `filter panel should sit below ledger head: ${JSON.stringify(landscapeMetrics)}`).toBe(true);
  expect(landscapeMetrics.rowActionButtonCount, `transaction rows should not expose compact action buttons: ${JSON.stringify(landscapeMetrics)}`).toBe(0);
  expect(landscapeMetrics.filterResetBeforeRow, `filter reset should not overlap ledger row: ${JSON.stringify(landscapeMetrics)}`).toBe(true);
  expect(landscapeMetrics.actionStartsAfterRow, `expanded details should not overlap removed row actions: ${JSON.stringify(landscapeMetrics)}`).toBe(true);
  expect(landscapeMetrics.resetRowOverlap, `filter reset should not overlap row content: ${JSON.stringify(landscapeMetrics)}`).toBe(false);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "transactions-landscape-compact-ledger");
});

test("issue 192: mobile quick entry asks before closing a dirty draft and preserves it", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-draft")}@example.com`;
  const displayName = unique("tx-quick-draft-name");
  const seedMemo = unique("tx-quick-draft-seed");
  const draftMemo = unique("tx-quick-draft-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  const seedCategory = await createCategoryViaApi(page, {
    major: unique("초안입력"),
    minor: unique("최근카테고리"),
  });
  await createTransactionViaApi(page, {
    memo: seedMemo,
    amount: "97531",
    categoryId: seedCategory.id,
    ownerName: displayName,
  });
  await page.reload();

  let transactionSheet = await openMobileTransactionQuickEntry(page);
  const quickAmount = page.getByTestId("transaction-quick-amount");
  await expect(quickAmount).toBeVisible();
  await quickAmount.fill("11223");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  await expect(memoInput).toBeVisible();
  await memoInput.fill(draftMemo);
  const { categoryChoice } = await selectTransactionFormCategory(transactionSheet, seedCategory);
  await expect(categoryChoice).toHaveAttribute("aria-pressed", "true");

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.getByTestId("transaction-quick-resume")).toHaveCount(0);
  await expect(quickAmount).toHaveValue("11,223");
  await expect(memoInput).toHaveValue(draftMemo);

  await page.getByTestId("transaction-entry-sheet-close").click();
  const closeDraftDialog = page.getByRole("alertdialog");
  await expect(closeDraftDialog.getByRole("heading", { name: "거래 입력을 닫을까요?" })).toBeVisible();
  await expect(closeDraftDialog).toContainText("작성 중인 거래 초안은 보존됩니다.");
  await closeDraftDialog.getByRole("button", { name: "취소" }).click();
  await expect(closeDraftDialog).toBeHidden();
  await expect(transactionSheet).toBeVisible();
  await expect(page.getByTestId("transaction-quick-amount")).toHaveValue("11,223");
  await expect(labeledField(transactionSheet, "메모", "input")).toHaveValue(draftMemo);

  await page.getByTestId("transaction-entry-sheet-close").click();
  await expect(closeDraftDialog.getByRole("heading", { name: "거래 입력을 닫을까요?" })).toBeVisible();
  await closeDraftDialog.getByRole("button", { name: "입력 닫기" }).click();
  await expect(transactionSheet).toBeHidden();

  transactionSheet = await openMobileTransactionQuickEntry(page);
  await expect(page.getByTestId("transaction-quick-amount")).toHaveValue("11,223");
  await expect(labeledField(transactionSheet, "메모", "input")).toHaveValue(draftMemo);
  await capture(page, "transactions-quick-entry-draft");

  const quickReset = page.getByTestId("transaction-quick-reset");
  await expect(quickReset).toBeVisible();
  await expect(quickReset).toBeEnabled();
  await quickReset.click();

  await expect(page.getByTestId("transaction-quick-amount")).toHaveValue("");
  await expect(labeledField(transactionSheet, "메모", "input")).toHaveValue("");
  await expectMobileQuickEntryDefaults(page, transactionSheet);
});

test("mobile quick entry restores the active field instead of jumping back to amount", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-focus")}@example.com`;
  const displayName = unique("tx-quick-focus-name");
  const seedMemo = unique("tx-quick-focus-seed");

  await bootstrapVerifiedSession(page, { email, displayName });
  const seedCategory = await createCategoryViaApi(page, {
    major: unique("포커스입력"),
    minor: unique("최근카테고리"),
  });
  await createTransactionViaApi(page, {
    memo: seedMemo,
    amount: "12345",
    categoryId: seedCategory.id,
    ownerName: displayName,
  });
  await page.reload();

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  const quickAmount = page.getByTestId("transaction-quick-amount");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  await expect(quickAmount).toBeFocused();

  await page.evaluate(() => {
    window.__e2eScrollIntoViewCalls = [];
    const original = Element.prototype.scrollIntoView;
    if (!window.__e2eOriginalScrollIntoView) {
      Object.defineProperty(window, "__e2eOriginalScrollIntoView", {
        configurable: true,
        value: original,
      });
    }
    Element.prototype.scrollIntoView = function scrollIntoViewSpy(options) {
      window.__e2eScrollIntoViewCalls.push({
        tagName: this.tagName,
        testId: this.getAttribute("data-testid") || "",
        label: this.closest("label")?.textContent?.trim() || "",
        block: options && typeof options === "object" ? String(options.block || "") : "",
      });
    };
  });

  await quickAmount.fill("24680");
  await quickAmount.press("Enter");
  await expect(memoInput).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => window.__e2eScrollIntoViewCalls || []))
    .toEqual([]);
  await memoInput.fill("포커스 유지 메모");

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(memoInput).toBeFocused();

  const scrollBeforeCategory = await page.evaluate(() => window.scrollY);
  await selectTransactionFormCategory(transactionSheet, seedCategory);
  await expect.poll(() => page.evaluate(() => window.__e2eScrollIntoViewCalls || [])).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBeforeCategory);
  await expect(quickAmount).not.toBeFocused();

  await capture(page, "transactions-quick-entry-focus-restore");
});

test("mobile quick entry defaults owner to current user over recent other member", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-current-owner")}@example.com`;
  const displayName = "댕";
  const otherDisplayName = "찌";
  const otherUserId = `other-user-${Date.now()}`;

  await bootstrapVerifiedSession(page, { email, displayName });
  const currentUser = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    return response.json();
  });
  const createdAt = new Date().toISOString();

  await page.route("**/api/v1/household/members", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          member_id: "member-current",
          user_id: currentUser.id,
          email,
          display_name: displayName,
          role: "owner",
          created_at: createdAt,
        },
        {
          member_id: "member-other",
          user_id: otherUserId,
          email: "jji@example.com",
          display_name: otherDisplayName,
          role: "editor",
          created_at: createdAt,
        },
      ]),
    });
  });
  await page.reload();

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  const currentOwnerChoice = transactionSheet.locator(`[data-testid="transaction-owner-choice"][data-owner-value="${currentUser.id}"]`);
  await expect(currentOwnerChoice).toBeVisible();
  await expect(currentOwnerChoice).toHaveAttribute("aria-pressed", "true");
  await expect(currentOwnerChoice).toContainText(displayName);
  await expect(transactionSheet.getByTestId("transaction-owner-choice").filter({ hasText: otherDisplayName })).toHaveAttribute(
    "aria-pressed",
    "false"
  );

  await capture(page, "transactions-quick-entry-current-owner");
});

test("desktop transaction entry defaults owner and exposes quick member selection", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-owner-default-desktop")}@example.com`;
  const displayName = "댕";
  await bootstrapVerifiedSession(page, { email, displayName });
  const currentUser = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    return response.json();
  });

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  const currentUserChoice = transactionSheet.locator(`[data-testid="transaction-owner-choice"][data-owner-value="${currentUser.id}"]`);
  await expect(currentUserChoice).toBeVisible();
  await expect(currentUserChoice).toContainText(displayName);
  await expect(currentUserChoice).toHaveAttribute("aria-pressed", "true");
  await expect(transactionSheet.getByTestId("transaction-owner-quick-select")).toHaveCount(0);
  await capture(page, "issue-201-transaction-owner-button-select");
});

test("mobile quick entry keeps owner override and filters staged category choices", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-owner")}@example.com`;
  const displayName = unique("tx-quick-owner-name");
  const recentExpenseCategory = {
    major: unique("정렬최근"),
    minor: unique("나중발생"),
  };
  const olderExpenseCategory = {
    major: unique("정렬과거"),
    minor: unique("나중생성"),
  };
  const incomeCategory = {
    major: unique("수입제외"),
    minor: unique("잘못된흐름"),
  };
  const staleCategory = {
    major: unique("삭제된분류"),
    minor: unique("오래된아이디"),
  };
  const staleMemo = unique("tx-quick-stale-category");

  await bootstrapVerifiedSession(page, { email, displayName });
  const recentExpense = await createCategoryViaApi(page, recentExpenseCategory);
  const olderExpense = await createCategoryViaApi(page, olderExpenseCategory);
  const income = await createCategoryViaApi(page, { ...incomeCategory, flowType: "income" });
  await createTransactionViaApi(page, {
    memo: unique("tx-quick-recent-expense"),
    amount: "1000",
    categoryId: recentExpense.id,
    occurredOn: isoDaysAgo(1),
    ownerName: displayName,
  });
  await createTransactionViaApi(page, {
    memo: unique("tx-quick-older-expense"),
    amount: "2000",
    categoryId: olderExpense.id,
    occurredOn: isoDaysAgo(7),
    ownerName: displayName,
  });
  await createTransactionViaApi(page, {
    memo: unique("tx-quick-income-filter"),
    amount: "3000",
    flowType: "income",
    categoryId: income.id,
    occurredOn: currentE2EHistoryDateIso(),
    ownerName: displayName,
  });
  await createTransactionViaApi(page, {
    memo: unique("tx-quick-empty-category"),
    amount: "4000",
    occurredOn: currentE2EHistoryDateIso(),
    ownerName: displayName,
  });
  const staleHistoryFixture = await installStaleCategoryHistoryFixture(page, {
    staleCategoryMajor: staleCategory.major,
    staleCategoryMinor: staleCategory.minor,
    staleMemo,
  });
  await page.reload();

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  expect(staleHistoryFixture.wasInjected(), "stale category fixture should be present in the monthly transaction ledger").toBe(true);
  await expect(page.locator("tr.transaction-row", { hasText: staleMemo }).first()).toBeVisible();
  await expectStagedCategoryLayoutStable(page);
  const groupTexts = (await transactionSheet.getByTestId("transaction-category-group-choice").allTextContents()).join(" ");
  expect(groupTexts).toContain(recentExpenseCategory.major);
  expect(groupTexts).toContain(olderExpenseCategory.major);
  expect(groupTexts).not.toContain(incomeCategory.major);
  expect(groupTexts).not.toContain(staleCategory.major);

  const ownerNoneChoice = await selectTransactionFormOwner(transactionSheet, { ownerless: true });
  await expect(ownerNoneChoice).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);
  await expect(ownerNoneChoice).toHaveAttribute("aria-pressed", "true");
  await capture(page, "transactions-quick-entry-owner-order");
  await staleHistoryFixture.unroute();
});

test("issue 82: mobile staged category buttons stay readable at 320px", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-issue-82")}@example.com`;
  const displayName = unique("tx-issue-82-name");
  const memo = unique("tx-issue-82-memo");
  const category = {
    major: unique("지출"),
    minor: unique("테스트긴분류명"),
  };

  await bootstrapVerifiedSession(page, { email, displayName });
  const createdCategory = await createCategoryViaApi(page, category);
  await createTransactionViaApi(page, {
    memo,
    amount: "82000",
    categoryId: createdCategory.id,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addStyleTag({
    content: 'html, body, button, input, select, textarea { font-family: "Malgun Gothic", "Noto Sans KR", sans-serif !important; }',
  });

  await openMobileTransactionQuickEntry(page);
  await expect(page.getByTestId("transaction-quick-form")).toBeVisible();
  await expect(page.getByTestId("transaction-staged-category")).toBeVisible();
  await expectStagedCategoryLayoutStable(page);
  await page.getByTestId("transaction-category-group-choice").filter({ hasText: category.major }).click();

  const issueMetrics = await page.getByTestId("transaction-staged-category").evaluate((panel) => {
    const buttons = Array.from(
      panel.querySelectorAll("[data-testid='transaction-flow-choice'], [data-testid='transaction-category-group-choice'], [data-testid='transaction-category-choice']"),
    );
    return {
      buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
      buttonTexts: buttons.map((button) => button.textContent?.trim() || ""),
      overflowingButtons: buttons.filter((button) => button.scrollWidth - button.clientWidth > 1 || button.scrollHeight - button.clientHeight > 1).length,
    };
  });

  expect(issueMetrics.overflowingButtons, JSON.stringify(issueMetrics)).toBe(0);
  expect(issueMetrics.buttonHeights.every((height) => height >= 32), JSON.stringify(issueMetrics)).toBe(true);
  expect(issueMetrics.buttonTexts.join(" ")).toContain(category.minor);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-82-mobile-staged-category-fit");
});

test("mobile quick entry stays usable across viewport and Korean font fallbacks", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-matrix")}@example.com`;
  const displayName = unique("tx-quick-matrix-name");
  const seedMemo = unique("tx-quick-matrix-seed");
  const seedCategory = { major: unique("행렬입력"), minor: unique("테스트긴분류명") };
  const scenarios = [
    { width: 390, height: 844, font: "Apple SD Gothic Neo", slug: "apple-sd-gothic" },
    { width: 360, height: 780, font: "Apple SD Gothic Neo", slug: "apple-sd-gothic-narrow" },
    { width: 375, height: 812, font: "Malgun Gothic", slug: "malgun-gothic" },
    { width: 320, height: 568, font: "Malgun Gothic", slug: "malgun-gothic-compact" },
    { width: 412, height: 915, font: "Noto Sans KR", slug: "noto-sans-kr" },
  ];

  await bootstrapVerifiedSession(page, { email, displayName });
  const category = await createCategoryViaApi(page, seedCategory);
  await createTransactionViaApi(page, {
    memo: seedMemo,
    amount: "54321",
    categoryId: category.id,
    ownerName: displayName,
  });
  await page.reload();

  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.addStyleTag({
      content: `html, body, button, input, select, textarea { font-family: "${scenario.font}", "Noto Sans KR", sans-serif !important; }`,
    });
    const transactionSheet = await openMobileTransactionQuickEntry(page);
    await expect(page.getByTestId("transaction-quick-form")).toBeVisible();
    await expect(page.getByTestId("transaction-quick-amount")).toBeVisible();
    await expect(page.getByTestId("transaction-quick-save")).toBeVisible();
    await expect(page.getByTestId("transaction-staged-category")).toBeVisible();
    await expectStagedCategoryLayoutStable(page);
    await page.getByTestId("transaction-category-group-choice").filter({ hasText: seedCategory.major }).click();
    await expect(page.getByTestId("transaction-category-choice").filter({ hasText: seedCategory.minor })).toBeVisible();
    await expectNoHorizontalOverflow(page, 12);
    const sheetBox = await transactionSheet.boundingBox();
    expect(sheetBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(scenario.width);
    await capture(page, `transactions-quick-entry-${scenario.slug}`);
    await page.getByTestId("transaction-entry-sheet-close").click();
    const closeDraftDialog = page.getByRole("alertdialog");
    if (await closeDraftDialog.isVisible().catch(() => false)) {
      await closeDraftDialog.getByRole("button", { name: "입력 닫기" }).click();
    }
    await expect(transactionSheet).toBeHidden();
  }
});


test("desktop transaction row click and sweep selection keep toolbar summary stable", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-row-select")}@example.com`;
  const displayName = unique("tx-row-select-name");
  const memoPrefix = unique("tx-row-select-memo");
  const amounts = [12345, 23456, 34567, 45678, 56789, 67890];
  const memos = amounts.map((_, index) => `${memoPrefix}-${String(index).padStart(2, "0")}`);

  await bootstrapVerifiedSession(page, { email, displayName });
  for (const [index, memo] of memos.entries()) {
    await createTransactionViaApi(page, {
      memo,
      amount: String(amounts[index]),
      ownerName: displayName,
      sourceRef: `${memoPrefix}-source-${index}`,
    });
  }
  await page.reload();
  await page.setViewportSize({ width: 1366, height: 960 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const rows = page.locator("tr.transaction-row[data-transaction-id]");
  await expect(rows.nth(2)).toBeVisible({ timeout: 20_000 });
  await expectTransactionSelectionSummary(page, 0, "0원");
  await expectTransactionStickyHeaderGeometry(page, "desktop transaction sticky header before selection");

  const targetRow = page.locator("tr.transaction-row", { hasText: memos[0] }).first();
  await targetRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(150);
  const targetTopBefore = await targetRow.evaluate((row) => row.getBoundingClientRect().top);
  const headerBeforeClick = await readTransactionStickyHeaderGeometry(page);
  await targetRow.locator(".transaction-col-memo").click();
  await expect(targetRow).toHaveAttribute("data-row-selected", "true");
  await expect(targetRow).toHaveAttribute("aria-selected", "true");
  await expectTransactionSelectionSummary(page, 1, `${amounts[0].toLocaleString("ko-KR")}원`);
  const targetTopAfter = await targetRow.evaluate((row) => row.getBoundingClientRect().top);
  expect(Math.abs(targetTopAfter - targetTopBefore), "first row selection should not insert a flow banner that moves rows").toBeLessThanOrEqual(1.5);
  const headerAfterClick = await readTransactionStickyHeaderGeometry(page);
  expect(
    Math.abs((headerAfterClick.header.box?.top ?? 0) - (headerBeforeClick.header.box?.top ?? 0)),
    `desktop header should not jump after toolbar summary update: ${JSON.stringify({ headerBeforeClick, headerAfterClick })}`,
  ).toBeLessThanOrEqual(4);

  await clearTransactionSelection(page);
  await expect(targetRow).toHaveAttribute("data-row-selected", "false");
  await targetRow.focus();
  await expect(targetRow).toBeFocused();
  await expect(targetRow).toHaveAttribute("aria-keyshortcuts", /Space/);
  await page.keyboard.press("Space");
  await expect(targetRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1, `${amounts[0].toLocaleString("ko-KR")}원`);
  await page.keyboard.press("Space");
  await expect(targetRow).toHaveAttribute("data-row-selected", "false");
  await expectTransactionSelectionSummary(page, 0, "0원");
  await clearTransactionSelection(page);

  const sweepRows = [memos[1], memos[2], memos[3]].map((memo) =>
    page.locator("tr.transaction-row", { hasText: memo }).first(),
  );
  await sweepRows[0].evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(150);
  await sweepSelectRows(page, sweepRows);
  await expectNoActiveTextSelection(page, "desktop row sweep selection");
  for (const row of sweepRows) {
    await expect(row).toHaveAttribute("data-row-selected", "true");
    await expect(row).toHaveAttribute("data-row-expanded", "false");
  }
  const selectedAfterSweep = await page.locator("tr.transaction-row[data-row-selected='true']").count();
  expect(selectedAfterSweep, "sweep should select at least the rows that the pointer passed over").toBeGreaterThanOrEqual(3);
  await expectTransactionSelectionSummary(page, selectedAfterSweep);

  const toolbar = page.getByTestId("transaction-sticky-toolbar");
  await toolbar.getByRole("button", { name: "필터 열기" }).click();
  await expect(toolbar.locator(".tx-header-filters")).toBeVisible();
  await expectTransactionSelectionSummary(page, selectedAfterSweep);
  await toolbar.getByRole("button", { name: "필터 닫기" }).click();
  await expect(toolbar.locator(".tx-header-filters")).toBeHidden();
  await capture(page, "transactions-row-selection-desktop");
});

test("transaction selection persists through passive websocket transaction refresh", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-selection-passive")}@example.com`;
  const displayName = unique("tx-selection-passive-owner");
  const selectedMemo = unique("tx-selection-passive-selected");
  const incomingMemo = unique("tx-selection-passive-incoming");
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("실시간"),
      minor: unique("선택유지"),
    })
  );
  await createTransactionViaApi(page, {
    memo: selectedMemo,
    amount: "33000",
    categoryId: category.id,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 1366, height: 900 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const selectedRow = page.locator("tr.transaction-row", { hasText: selectedMemo }).first();
  await selectTransactionRowForToolbar(page, selectedRow);
  await expectTransactionSelectionSummary(page, 1, "33,000원");

  await createTransactionViaApi(page, {
    memo: incomingMemo,
    amount: "44000",
    categoryId: category.id,
    ownerName: displayName,
  });
  await expect(page.locator("tr.transaction-row", { hasText: incomingMemo }).first()).toBeVisible({ timeout: 20_000 });
  await expect(selectedRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1, "33,000원");
  await expect(page.locator(".transaction-list-card > .message", { hasText: "선택" })).toHaveCount(0);
  await expect(page.locator(".transaction-list-card > .message", { hasText: "로딩" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "transactions-selection-passive-refresh");
});

test("issue 233: desktop transaction rows expose keyboard selection", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-checkbox-hitarea")}@example.com`;
  const displayName = unique("tx-checkbox-hitarea-name");
  const memo = unique("tx-checkbox-hitarea-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "23300",
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 1024, height: 768 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const targetRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(targetRow).toBeVisible({ timeout: 20_000 });
  const rowMetrics = await targetRow.evaluate((row) => {
    const rect = row.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      tabIndex: row.getAttribute("tabindex"),
      ariaKeyshortcuts: row.getAttribute("aria-keyshortcuts") || "",
      ariaLabel: row.getAttribute("aria-label") || "",
      selected: row.getAttribute("data-row-selected"),
    };
  });
  expect(rowMetrics.height, `desktop transaction row should keep a comfortable focus target: ${JSON.stringify(rowMetrics)}`).toBeGreaterThanOrEqual(32);
  expect(rowMetrics.tabIndex, `desktop transaction row should be keyboard focusable: ${JSON.stringify(rowMetrics)}`).toBe("0");
  expect(rowMetrics.ariaKeyshortcuts, `desktop transaction row should advertise Space selection: ${JSON.stringify(rowMetrics)}`).toContain("Space");
  expect(rowMetrics.ariaLabel, `desktop transaction row should describe Space selection: ${JSON.stringify(rowMetrics)}`).toContain("Space");
  expect(rowMetrics.selected, `desktop transaction row should start unselected: ${JSON.stringify(rowMetrics)}`).toBe("false");

  await targetRow.focus();
  await expect(targetRow).toBeFocused();
  await page.keyboard.press("Space");
  await expect(targetRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1, "23,300원");
  await page.keyboard.press("Space");
  await expect(targetRow).toHaveAttribute("data-row-selected", "false");
  await expectTransactionSelectionSummary(page, 0, "0원");
  await capture(page, "issue-233-desktop-transaction-keyboard-selection");
});

test("desktop transaction sticky column titles and sweep auto-scroll selection toggle work", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("tx-row-sweep-scroll")}@example.com`;
  const displayName = unique("tx-row-sweep-scroll-name");
  const memoPrefix = unique("tx-row-sweep-scroll-memo");
  const rowCount = 52;
  const amounts = Array.from({ length: rowCount }, (_, index) => 1000 + index * 111);
  const memos = amounts.map((_, index) => `${memoPrefix}-${String(index).padStart(2, "0")}`);

  await bootstrapVerifiedSession(page, { email, displayName });
  for (const [index, memo] of memos.entries()) {
    await createTransactionViaApi(page, {
      memo,
      amount: String(amounts[index]),
      ownerName: displayName,
      sourceRef: `${memoPrefix}-source-${index}`,
    });
  }
  await page.reload();
  await page.setViewportSize({ width: 1366, height: 620 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);
  await expect(page.locator("tr.transaction-row", { hasText: memos[2] }).first()).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => window.scrollTo(0, Math.min(document.documentElement.scrollHeight - window.innerHeight, 520)));
  await page.waitForTimeout(250);
  await expectTransactionStickyHeaderGeometry(page, "desktop sticky column titles after page scroll");
  await expectDesktopTransactionColumnHeaderLabels(page, "desktop sticky column titles after page scroll");

  const startScrollY = await page.evaluate(() => window.scrollY);
  const startRow = page.locator("tr.transaction-row", { hasText: memos[4] }).first();
  await startRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(150);
  await sweepFromRowToViewportEdge(page, startRow, "down", 1200);
  await expectNoActiveTextSelection(page, "desktop auto-scroll sweep selection");
  const afterDownScrollY = await page.evaluate(() => window.scrollY);
  expect(afterDownScrollY, "dragging near the lower viewport edge should auto-scroll the ledger").toBeGreaterThan(
    startScrollY + 80,
  );
  const selectedAfterAutoScroll = await page.locator("tr.transaction-row[data-row-selected='true']").count();
  expect(selectedAfterAutoScroll, "auto-scroll sweep should select multiple rows while the page scrolls").toBeGreaterThanOrEqual(5);
  await expectTransactionSelectionSummary(page, selectedAfterAutoScroll);
  await expect(page.locator("tr.transaction-row[data-row-expanded='true']")).toHaveCount(0);
  await expectTransactionStickyHeaderGeometry(page, "desktop sticky column titles after auto-scroll select");
  await expectDesktopTransactionColumnHeaderLabels(page, "desktop sticky column titles after auto-scroll select");

  const selectedRowsBeforeDeselect = selectedAfterAutoScroll;
  const selectedRows = page.locator("tr.transaction-row[data-row-selected='true']");
  await selectedRows.first().evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(150);
  await sweepSelectRows(page, [
    selectedRows.nth(0),
    selectedRows.nth(1),
    selectedRows.nth(2),
  ]);
  await expectNoActiveTextSelection(page, "desktop sweep deselection without scroll");
  const selectedAfterDeselectSweep = await page.locator("tr.transaction-row[data-row-selected='true']").count();
  expect(
    selectedAfterDeselectSweep,
    "starting a sweep on selected rows should deselect visited rows",
  ).toBeLessThanOrEqual(selectedRowsBeforeDeselect - 2);
  await expectTransactionSelectionSummary(page, selectedAfterDeselectSweep);
  await expect(page.locator("tr.transaction-row[data-row-expanded='true']")).toHaveCount(0);

  const selectedForUpwardDeselect = page.locator("tr.transaction-row[data-row-selected='true']").last();
  await selectedForUpwardDeselect.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.waitForTimeout(150);
  const beforeUpDeselectY = await page.evaluate(() => window.scrollY);
  const selectedBeforeUpDeselect = await page.locator("tr.transaction-row[data-row-selected='true']").count();
  await sweepFromRowToViewportEdge(page, selectedForUpwardDeselect, "up", 900);
  await expectNoActiveTextSelection(page, "desktop upward auto-scroll sweep deselection");
  const afterUpDeselectY = await page.evaluate(() => window.scrollY);
  expect(afterUpDeselectY, "dragging near the upper viewport edge should auto-scroll upward").toBeLessThan(
    beforeUpDeselectY - 20,
  );
  const selectedAfterUpDeselect = await page.locator("tr.transaction-row[data-row-selected='true']").count();
  expect(
    selectedAfterUpDeselect,
    "auto-scroll deselection sweep should reduce selected rows",
  ).toBeLessThan(selectedBeforeUpDeselect);
  await expectTransactionSelectionSummary(page, selectedAfterUpDeselect);
  await expect(page.locator("tr.transaction-row[data-row-expanded='true']")).toHaveCount(0);
  await expectTransactionStickyHeaderGeometry(page, "desktop sticky column titles after sweep deselect");
  await capture(page, "transactions-row-selection-autoscroll-toggle");
});

test("mobile transaction row selection, touch scroll, and sticky ledger head survive Korean font viewports", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("tx-mobile-row-select")}@example.com`;
  const displayName = unique("tx-mobile-row-select-name");
  const memoPrefix = unique("tx-mobile-row-select-memo");
  const amounts = Array.from({ length: 24 }, (_, index) => 11000 + index * 777);
  const memos = amounts.map((_, index) => `${memoPrefix}-${String(index).padStart(2, "0")}`);
  const scenarios = [
    { label: "390px Apple SD Gothic Neo", width: 390, height: 844, font: "Apple SD Gothic Neo", targetIndex: 2, scrollIndex: 13 },
    { label: "320px Malgun Gothic", width: 320, height: 568, font: "Malgun Gothic", targetIndex: 4, scrollIndex: 15 },
    { label: "432px Noto Sans KR", width: 432, height: 936, font: "Noto Sans KR", targetIndex: 6, scrollIndex: 17 },
  ];

  await bootstrapVerifiedSession(page, { email, displayName });
  for (const [index, memo] of memos.entries()) {
    await createTransactionViaApi(page, {
      memo,
      amount: String(amounts[index]),
      ownerName: displayName,
      sourceRef: `${memoPrefix}-source-${index}`,
    });
  }

  for (const scenario of scenarios) {
    await page.reload();
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.addStyleTag({
      content: `html, body, button, input, select, textarea { font-family: "${scenario.font}", "Noto Sans KR", sans-serif !important; }`,
    });
    await openTab(page, "거래");
    await waitForTransactionAppShell(page);
    await expect(page.locator("tr.transaction-row", { hasText: memos[scenario.targetIndex] }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expectNoHorizontalOverflow(page, 12);
    await expectTransactionSelectionSummary(page, 0, "0원");

    const stickyBeforeSelection = await expectTransactionStickyHeaderGeometry(page, `${scenario.label} sticky ledger before selection`);
    const targetRow = page.locator("tr.transaction-row", { hasText: memos[scenario.targetIndex] }).first();
    await targetRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
    await page.waitForTimeout(150);
    const headerBeforeClick = await readTransactionStickyHeaderGeometry(page);
    await targetRow.click({ position: { x: 92, y: 18 } });
    await expect(targetRow).toHaveAttribute("data-row-selected", "false");
    await expect(targetRow).toHaveClass(/mobile-row-expanded/);
    await expect(
      targetRow.locator("xpath=following-sibling::tr[1][contains(@class,'transaction-mobile-expanded-actions-row')]"),
    ).toHaveCount(0);
    await targetRow.click({ position: { x: 92, y: 18 } });
    await expect(targetRow).not.toHaveClass(/mobile-row-expanded/);
    await longPressTransactionRow(page, targetRow);
    await expect(targetRow).toHaveAttribute("data-row-selected", "true");
    await expect(targetRow).not.toHaveClass(/mobile-row-expanded/);
    await expectTransactionSelectionSummary(
      page,
      1,
      `${amounts[scenario.targetIndex].toLocaleString("ko-KR")}원`,
    );
    const headerAfterClick = await expectTransactionStickyHeaderGeometry(page, `${scenario.label} sticky ledger after row selection`);
    expect(
      Math.abs((headerAfterClick.gap ?? 0) - (stickyBeforeSelection.gap ?? 0)),
      `${scenario.label} ledger head gap should remain stable after row selection: ${JSON.stringify({
        stickyBeforeSelection,
        headerBeforeClick,
        headerAfterClick,
      })}`,
    ).toBeLessThanOrEqual(8);

    await targetRow.click({ position: { x: 92, y: 18 } });
    await expect(targetRow).toHaveClass(/mobile-row-expanded/);
    await expect(targetRow.getByRole("button", { name: /거래 세부/ })).toHaveCount(0);
    await targetRow.click({ position: { x: 92, y: 18 } });
    await expect(targetRow).not.toHaveClass(/mobile-row-expanded/);

    await clearTransactionSelection(page);
    const scrollRow = page.locator("tr.transaction-row", { hasText: memos[scenario.scrollIndex] }).first();
    await scrollRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
    await page.waitForTimeout(150);
    const touchMetrics = await performTouchScrollGestureOnRow(page, scrollRow);
    expect(touchMetrics.touchAction, `${scenario.label} rows should not disable touch scrolling`).not.toBe("none");
    expect(
      touchMetrics.afterScrollY,
      `${scenario.label} touch-like vertical drag should scroll the page: ${JSON.stringify(touchMetrics)}`,
    ).toBeGreaterThan(touchMetrics.beforeScrollY + 8);
    await expect(scrollRow).toHaveAttribute("data-row-selected", "false");
    await expect(scrollRow).not.toHaveClass(/mobile-row-expanded/);
    await expectTransactionSelectionSummary(page, 0, "0원");
    await expectTransactionStickyHeaderGeometry(page, `${scenario.label} sticky ledger after touch scroll`);
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, `transactions-row-selection-mobile-${scenario.width}`);
  }
});

test("transaction add action and sticky toolbar stay reachable after ledger scroll", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-fab-sticky")}@example.com`;
  const displayName = unique("tx-fab-sticky-name");
  const memoPrefix = unique("tx-fab-sticky-row");

  await bootstrapVerifiedSession(page, { email, displayName });
  for (let index = 0; index < 36; index += 1) {
    await createTransactionViaApi(page, {
      memo: `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(10000 + index),
      ownerName: displayName,
      sourceRef: `${memoPrefix}-source-${index}`,
    });
  }

  await page.setViewportSize({ width: 1366, height: 960 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);
  await expect(page.locator("tr.transaction-row", { hasText: `${memoPrefix}-00` }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);

  const toolbar = page.getByTestId("transaction-sticky-toolbar");
  await expect(toolbar).toBeVisible();
  const toolbarMetrics = await toolbar.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      position: style.position,
      top: style.top,
      box: {
        top: box.top,
        bottom: box.bottom,
        height: box.height,
      },
      viewportHeight: window.innerHeight,
    };
  });
  expect(["sticky", "fixed"], `desktop toolbar should remain sticky: ${JSON.stringify(toolbarMetrics)}`).toContain(
    toolbarMetrics.position,
  );
  expect(toolbarMetrics.top, `desktop toolbar sticky top should be explicit: ${JSON.stringify(toolbarMetrics)}`).not.toBe("auto");
  expect(toolbarMetrics.box.bottom, `desktop toolbar should stay within viewport: ${JSON.stringify(toolbarMetrics)}`).toBeLessThan(
    toolbarMetrics.viewportHeight,
  );
  const desktopAddAction = await expectDesktopTransactionAddActionReachable(page, "desktop transaction add action after ledger scroll");

  await toolbar.getByRole("button", { name: "필터 열기" }).click();
  await expect(toolbar.locator(".tx-header-filters")).toBeVisible();
  await expect(toolbar.locator(".tx-header-filters").getByPlaceholder("검색")).toBeVisible();
  await toolbar.getByRole("button", { name: "필터 닫기" }).click();
  await expect(toolbar.locator(".tx-header-filters")).toBeHidden();

  const desktopScrollBeforeSheet = await page.evaluate(() => window.scrollY);
  await desktopAddAction.click();
  await expect(page.getByRole("dialog", { name: "거래 추가 레이어" })).toBeVisible();
  await expect(labeledField(page.getByTestId("transaction-entry-sheet"), "금액", "input")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("transaction-entry-sheet")).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") || "")).toBe("transactions-desktop-add-action");
  const desktopScrollAfterSheet = await page.evaluate(() => window.scrollY);
  expect(Math.abs(desktopScrollAfterSheet - desktopScrollBeforeSheet)).toBeLessThanOrEqual(16);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({
    content: 'html, body, button, input, select, textarea { font-family: "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif !important; }',
  });
  await openTab(page, "거래");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  await expectTransactionAddActionReachable(page, "mobile transaction add action after ledger scroll");
  await expectMobileTransactionMonthStepperSticky(page);

  const mobileScrollBeforeSheet = await page.evaluate(() => window.scrollY);
  await page.getByTestId("transactions-fab").evaluate((element) => element.click());
  const mobileSheet = page.getByTestId("transaction-entry-sheet");
  await expect(mobileSheet).toBeVisible();
  const mobileAmountInput = labeledField(mobileSheet, "금액", "input");
  await expect(mobileAmountInput).toBeVisible();
  await expect(mobileAmountInput).toBeFocused();
  await capture(page, "transactions-fab-sticky-entry-sheet");
  await page.getByTestId("transaction-entry-sheet-close").click();
  await expect(mobileSheet).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") || "")).toBe("transactions-fab");
  const mobileScrollAfterSheet = await page.evaluate(() => window.scrollY);
  expect(Math.abs(mobileScrollAfterSheet - mobileScrollBeforeSheet)).toBeLessThanOrEqual(16);
});

test("transaction sheet return focus does not override a newer ledger focus", async ({ page }) => {
  const email = `${unique("tx-sheet-focus-race")}@example.com`;
  const displayName = unique("tx-sheet-focus-race-owner");
  const memo = unique("tx-sheet-focus-race-row");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 900 });
  const row = await createBasicTransaction(page, { memo, amount: "12000" });
  await expect(row).toBeVisible();

  await page.getByTestId("transactions-desktop-add-action").click();
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();

  await row.evaluate((element) => {
    const sheet = document.querySelector('[data-testid="transaction-entry-sheet"]');
    const observer = new MutationObserver(() => {
      if (sheet?.isConnected) {
        return;
      }
      observer.disconnect();
      element.focus({ preventScroll: true });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.querySelector('[data-testid="transaction-entry-sheet-close"]')?.click();
  });
  await expect(transactionSheet).toBeHidden();
  await page.evaluate(() => new Promise((resolve) => window.setTimeout(resolve, 0)));

  await expect(row, "deferred sheet cleanup must not steal a newer explicit ledger focus").toBeFocused();
  await capture(page, "transaction-sheet-newer-ledger-focus");
});

test("issue 211: transaction add opens a visible sheet from a scrolled list", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-add-visible")}@example.com`;
  const displayName = unique("tx-add-visible-name");
  const memoPrefix = unique("tx-add-visible-row");

  await bootstrapVerifiedSession(page, { email, displayName });
  for (let index = 0; index < 32; index += 1) {
    await createTransactionViaApi(page, {
      memo: `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(9000 + index),
      ownerName: displayName,
      sourceRef: `${memoPrefix}-source-${index}`,
    });
  }

  await page.setViewportSize({ width: 1366, height: 960 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);
  await expect(page.locator("tr.transaction-row", { hasText: `${memoPrefix}-00` }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);

  const scrollBeforeSheet = await page.evaluate(() => window.scrollY);
  const transactionAddAction = await expectDesktopTransactionAddActionReachable(page, "issue 211 desktop transaction add action");
  await capture(page, "issue-211-scrolled-list-before-add");

  await transactionAddAction.click();
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(page.getByRole("dialog", { name: "거래 추가 레이어" })).toBeVisible();
  await expect(labeledField(transactionSheet, "금액", "input")).toBeVisible();
  const sheetMetrics = await transactionSheet.evaluate((sheet) => {
    const backdrop = sheet.closest(".transaction-entry-sheet-backdrop");
    const sheetBox = sheet.getBoundingClientRect();
    const backdropStyle = backdrop ? getComputedStyle(backdrop) : null;
    return {
      backdropPosition: backdropStyle?.position || "",
      backdropZIndex: Number.parseInt(backdropStyle?.zIndex || "0", 10),
      sheetTop: sheetBox.top,
      sheetBottom: sheetBox.bottom,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
  expect(sheetMetrics.backdropPosition, JSON.stringify(sheetMetrics)).toBe("fixed");
  expect(sheetMetrics.backdropZIndex, JSON.stringify(sheetMetrics)).toBeGreaterThan(50);
  expect(sheetMetrics.sheetTop, JSON.stringify(sheetMetrics)).toBeGreaterThanOrEqual(0);
  expect(sheetMetrics.sheetBottom, JSON.stringify(sheetMetrics)).toBeLessThanOrEqual(sheetMetrics.viewportHeight);
  const scrollAfterSheet = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollAfterSheet - scrollBeforeSheet)).toBeLessThanOrEqual(16);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-211-transaction-add-sheet-visible");

  await page.keyboard.press("Escape");
  await expect(transactionSheet).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") || "")).toBe("transactions-desktop-add-action");
});

test("issue 213: mobile transaction add defaults to today outside visible month context", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-add-month-context")}@example.com`;
  const displayName = unique("tx-add-month-context-name");
  const monthContextDate = isoDaysFromToday(-75);
  const monthMemo = unique("tx-add-month-context-row");

  await bootstrapVerifiedSession(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo: monthMemo,
    amount: "21300",
    occurredOn: monthContextDate,
    ownerName: displayName,
    sourceRef: `${monthMemo}-source`,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await jumpTransactionListToMonth(page, monthContextDate);
  await expect(page.locator("tr.transaction-row", { hasText: monthMemo }).first()).toBeVisible({ timeout: 30_000 });
  await expectTransactionMonthControls(page, monthContextDate, "issue 213 visible month context");
  await capture(page, "issue-213-mobile-month-context-before-add");

  const transactionFab = page.getByTestId("transactions-fab");
  await expect(transactionFab).toBeVisible();
  await transactionFab.click();
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(page.getByRole("dialog", { name: "거래 추가 레이어" })).toBeVisible();
  await expect(transactionSheet).toContainText("일자부터 거래자까지 한 화면에서 저장합니다.");

  const dateInput = labeledField(transactionSheet, "일자", "input");
  await expect(dateInput).toBeVisible();
  await expect(dateInput).toHaveValue(await browserLocalTodayIso(page));

  await dateInput.fill(monthContextDate);
  await expect(dateInput).toHaveValue(monthContextDate);
  await transactionSheet.getByTestId("transaction-quick-reset").click();
  await expect(dateInput).toHaveValue(await browserLocalTodayIso(page));
  await capture(page, "issue-213-mobile-add-date-defaults-today");
});

test("issue 234: mobile transaction add keeps context visible without secondary details", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-add-context-first-screen")}@example.com`;
  const displayName = unique("tx-add-context-first-screen-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 320, height: 568 });
  const transactionSheet = await openMobileTransactionQuickEntry(page);
  await expect(page.getByRole("dialog", { name: "거래 추가 레이어" })).toBeVisible();
  await expect(page.getByTestId("transaction-quick-save")).toBeVisible();
  await expect(page.getByTestId("transaction-quick-amount")).toBeFocused();
  await expect(transactionSheet.locator("details.transaction-quick-details")).toHaveCount(0);
  await expect(transactionSheet.getByTestId("transaction-staged-category")).toBeVisible();
  await expect(transactionSheet.getByTestId("transaction-owner-choice").first()).toBeVisible();

  const metrics = await transactionSheet.evaluate((sheet) => {
    const date = sheet.querySelector("[data-testid='transaction-quick-date']");
    const amount = sheet.querySelector("[data-testid='transaction-quick-amount']");
    const category = sheet.querySelector("[data-testid='transaction-staged-category']");
    const owner = sheet.querySelector(".transaction-owner-choice-section");
    const memo = Array.from(sheet.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim().startsWith("메모"))
      ?.querySelector("input");
    const saveButton = sheet.querySelector("[data-testid='transaction-quick-save']");
    const actions = sheet.querySelector(".transaction-quick-actions");
    const dateRect = date?.getBoundingClientRect();
    const amountRect = amount?.getBoundingClientRect();
    const categoryRect = category?.getBoundingClientRect();
    const ownerRect = owner?.getBoundingClientRect();
    const memoRect = memo?.getBoundingClientRect();
    const saveRect = saveButton?.getBoundingClientRect();
    const actionsStyle = actions ? getComputedStyle(actions) : null;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return {
      viewportHeight,
      dateTop: dateRect?.top || 0,
      dateBottom: dateRect?.bottom || 0,
      dateLeft: dateRect?.left || 0,
      dateRight: dateRect?.right || 0,
      amountTop: amountRect?.top || 0,
      amountBottom: amountRect?.bottom || 0,
      amountLeft: amountRect?.left || 0,
      amountRight: amountRect?.right || 0,
      categoryTop: categoryRect?.top || 0,
      categoryBottom: categoryRect?.bottom || 0,
      ownerTop: ownerRect?.top || 0,
      ownerBottom: ownerRect?.bottom || 0,
      memoTop: memoRect?.top || 0,
      memoBottom: memoRect?.bottom || 0,
      actionPosition: actionsStyle?.position || "",
      saveTop: saveRect?.top || 0,
      saveBottom: saveRect?.bottom || 0,
      sheetClientHeight: sheet.clientHeight,
      sheetScrollHeight: sheet.scrollHeight,
    };
  });

  expect(metrics.dateTop, JSON.stringify(metrics)).toBeGreaterThanOrEqual(0);
  expect(Math.abs(metrics.dateTop - metrics.amountTop), `date and amount should share the primary row: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(3);
  expect(metrics.amountLeft, `amount should sit to the right of date: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(metrics.dateRight - 1);
  expect(metrics.categoryTop, "category should remain below amount").toBeGreaterThan(metrics.amountBottom);
  expect(metrics.ownerTop, "owner should remain below category").toBeGreaterThan(metrics.categoryTop);
  expect(metrics.memoTop, "memo should remain below owner").toBeGreaterThan(metrics.ownerTop);
  expect(metrics.actionPosition).toBe("static");
  expect(metrics.sheetScrollHeight, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.sheetClientHeight + 2);
  expect(metrics.saveTop, JSON.stringify(metrics)).toBeLessThan(metrics.viewportHeight);
  await capture(page, "issue-234-mobile-add-context-first-screen");
});

test("mobile transaction add keeps actions reachable with many staged category options", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-add-many-categories")}@example.com`;
  const displayName = unique("tx-add-many-categories-name");
  const crowdedMajor = unique("과밀그룹");
  const otherMajorPrefix = unique("추가그룹");

  await bootstrapVerifiedSession(page, { email, displayName });
  for (let index = 0; index < 12; index += 1) {
    await createCategoryViaApi(page, {
      major: crowdedMajor,
      minor: `${unique("선택항목")}-${index}`,
    });
  }
  for (let index = 0; index < 12; index += 1) {
    await createCategoryViaApi(page, {
      major: `${otherMajorPrefix}-${index}`,
      minor: `${unique("보조항목")}-${index}`,
    });
  }

  await page.reload();
  await page.setViewportSize({ width: 320, height: 568 });
  const transactionSheet = await openMobileTransactionQuickEntry(page);
  await expect(page.getByRole("dialog", { name: "거래 추가 레이어" })).toBeVisible();
  const groupChoice = transactionSheet.getByTestId("transaction-category-group-choice").filter({ hasText: crowdedMajor }).first();
  await expect(groupChoice).toBeVisible();
  await groupChoice.click();
  await expect(transactionSheet.getByTestId("transaction-category-choice").first()).toBeVisible();

  const metrics = await transactionSheet.evaluate((sheet) => {
    const boxOf = (element) => {
      const box = element?.getBoundingClientRect();
      return box
        ? {
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            width: box.width,
            height: box.height,
          }
        : null;
    };
    const scrollState = (element) => {
      const style = element ? getComputedStyle(element) : null;
      return {
        ...boxOf(element),
        clientHeight: element?.clientHeight || 0,
        scrollHeight: element?.scrollHeight || 0,
        overflowY: style?.overflowY || "",
      };
    };
    const save = sheet.querySelector("[data-testid='transaction-quick-save']");
    const primary = sheet.querySelector(".transaction-quick-primary-stack");
    const groupGrid = sheet.querySelector(".transaction-category-group-grid");
    const categoryGrid = sheet.querySelector(".transaction-category-choice-grid");
    const actions = sheet.querySelector(".transaction-quick-actions");
    const saveBox = boxOf(save);
    const centerX = saveBox ? saveBox.left + saveBox.width / 2 : -1;
    const centerY = saveBox ? saveBox.top + saveBox.height / 2 : -1;
    const topElement = centerX >= 0 && centerY >= 0 ? document.elementFromPoint(centerX, centerY) : null;
    return {
      viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0,
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sheet: scrollState(sheet),
      primary: scrollState(primary),
      groupGrid: scrollState(groupGrid),
      categoryGrid: scrollState(categoryGrid),
      actions: boxOf(actions),
      save: saveBox,
      saveHitVisible: Boolean(topElement && save && (topElement === save || save.contains(topElement))),
    };
  });

  expect(metrics.documentOverflowX, `crowded quick entry should not overflow horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.save?.bottom ?? Number.POSITIVE_INFINITY, `save should stay in the viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportHeight + 1,
  );
  expect(metrics.actions?.bottom ?? Number.POSITIVE_INFINITY, `actions should stay inside the sheet: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    (metrics.sheet.bottom ?? metrics.viewportHeight) + 1,
  );
  expect(metrics.saveHitVisible, `save button center should stay clickable: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.primary.overflowY, `primary stack should provide overflow fallback: ${JSON.stringify(metrics)}`).toMatch(/auto|overlay/);
  expect(metrics.groupGrid.overflowY, `category group grid should provide overflow fallback: ${JSON.stringify(metrics)}`).toMatch(/auto|overlay/);
  expect(metrics.categoryGrid.overflowY, `category grid should provide overflow fallback: ${JSON.stringify(metrics)}`).toMatch(/auto|overlay/);
  expect(
    metrics.primary.scrollHeight > metrics.primary.clientHeight ||
      metrics.groupGrid.scrollHeight > metrics.groupGrid.clientHeight ||
      metrics.categoryGrid.scrollHeight > metrics.categoryGrid.clientHeight,
    `crowded options should be bounded by a scrollable region: ${JSON.stringify(metrics)}`,
  ).toBe(true);

  await page.evaluate(() => {
    window.__e2eScrollIntoViewCalls = [];
    const original = Element.prototype.scrollIntoView;
    if (!window.__e2eOriginalScrollIntoView) {
      Object.defineProperty(window, "__e2eOriginalScrollIntoView", {
        configurable: true,
        value: original,
      });
    }
    Element.prototype.scrollIntoView = function scrollIntoViewSpy(options) {
      window.__e2eScrollIntoViewCalls.push({
        tagName: this.tagName,
        testId: this.getAttribute("data-testid") || "",
        label: this.closest("label")?.textContent?.trim() || "",
        block: options && typeof options === "object" ? String(options.block || "") : "",
      });
    };
  });

  const quickAmount = transactionSheet.getByTestId("transaction-quick-amount");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  const windowScrollBeforeFocusMove = await page.evaluate(() => window.scrollY);
  await quickAmount.click();
  await quickAmount.fill("24680");
  await quickAmount.press("Enter");
  await expect(memoInput).toBeFocused();

  const focusMetrics = await transactionSheet.evaluate((sheet) => {
    const primary = sheet.querySelector(".transaction-quick-primary-stack");
    const memo = Array.from(sheet.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("메모"))
      ?.querySelector("input");
    const primaryBox = primary?.getBoundingClientRect();
    const memoBox = memo?.getBoundingClientRect();
    return {
      windowScrollY: window.scrollY,
      primaryScrollTop: primary?.scrollTop || 0,
      primaryTop: primaryBox?.top || 0,
      primaryBottom: primaryBox?.bottom || 0,
      memoTop: memoBox?.top || 0,
      memoBottom: memoBox?.bottom || 0,
    };
  });
  expect(focusMetrics.windowScrollY, `focus move should not scroll the page: ${JSON.stringify(focusMetrics)}`).toBe(windowScrollBeforeFocusMove);
  expect(focusMetrics.primaryScrollTop, `focus move should use the internal primary stack scroll: ${JSON.stringify(focusMetrics)}`).toBeGreaterThan(0);
  expect(focusMetrics.memoTop, `focused memo should be visible inside primary stack: ${JSON.stringify(focusMetrics)}`).toBeGreaterThanOrEqual(
    focusMetrics.primaryTop - 1,
  );
  expect(focusMetrics.memoBottom, `focused memo should be visible inside primary stack: ${JSON.stringify(focusMetrics)}`).toBeLessThanOrEqual(
    focusMetrics.primaryBottom + 1,
  );
  await expect.poll(() => page.evaluate(() => window.__e2eScrollIntoViewCalls || [])).toEqual([]);
  await page.evaluate(() => {
    if (window.__e2eOriginalScrollIntoView) {
      Element.prototype.scrollIntoView = window.__e2eOriginalScrollIntoView;
    }
  });

  await capture(page, "transactions-add-many-categories-scroll-fallback");
});

test("issue 237: mobile transaction edit keeps completion controls in the first viewport", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-mobile-edit-save-flow")}@example.com`;
  const displayName = unique("tx-mobile-edit-save-flow-name");
  const memo = unique("tx-mobile-edit-save-flow-memo");
  const occurredOn = currentE2EHistoryDateIso();

  await bootstrapVerifiedSession(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "23700",
    occurredOn,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible({ timeout: 20_000 });
  await selectTransactionRowForToolbar(page, mobileRow);
  await page.getByTestId("transaction-selection-edit").click();

  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();
  const actions = editorRow.locator(".tx-inline-editor-actions");
  await expect(actions.getByRole("button", { name: "저장" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "취소" })).toBeVisible();

  const metrics = await editorRow.evaluate((row) => {
    const actionsElement = row.querySelector(".tx-inline-editor-actions");
    const firstField = row.querySelector(".tx-inline-date-field");
    const amountField = row.querySelector(".tx-inline-amount-field");
    const actionsBox = actionsElement?.getBoundingClientRect();
    const firstFieldBox = firstField?.getBoundingClientRect();
    const amountFieldBox = amountField?.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return {
      viewportHeight,
      actionsTop: actionsBox?.top ?? null,
      actionsBottom: actionsBox?.bottom ?? null,
      firstFieldTop: firstFieldBox?.top ?? null,
      amountFieldBottom: amountFieldBox?.bottom ?? null,
    };
  });
  expect(metrics.actionsTop, `edit actions should be measurable: ${JSON.stringify(metrics)}`).not.toBeNull();
  expect(metrics.actionsTop, `edit actions should stay in the initial viewport: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(0);
  expect(metrics.actionsBottom, `edit actions should stay in the initial viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportHeight - 8,
  );
  expect(metrics.firstFieldTop, `first edit field should be measurable: ${JSON.stringify(metrics)}`).not.toBeNull();
  expect(
    metrics.actionsTop,
    `completion controls should be presented before edit fields on mobile: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(metrics.firstFieldTop + 1);
  await expect(page.getByTestId("transactions-fab")).toHaveCount(0);
  await capture(page, "issue-237-mobile-edit-save-flow-first-screen");
});

test("issue 198: mobile collapsed transaction row keeps key details and actions visible", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-mobile-row-action")}@example.com`;
  const displayName = unique("tx-mobile-row-action-name");
  const memo = unique("tx-mobile-row-action-memo");
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("행요약"),
      minor: unique("즉시수정"),
    })
  );

  await createTransactionViaApi(page, {
    memo,
    amount: "19800",
    categoryId: category.id,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible({ timeout: 20_000 });
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);

  const metrics = await mobileRow.evaluate((row, expectedOwner) => {
    const visible = (selector) => {
      const element = row.querySelector(selector);
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        text: element.textContent?.replace(/\s+/g, " ").trim() || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        display: style.display,
        visibility: style.visibility,
        width: box.width,
        height: box.height,
        hidden: style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0,
      };
    };
    const rowBox = row.getBoundingClientRect();
    const actions = Array.from(row.querySelectorAll(".transaction-col-actions button")).map((button) => {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        text: button.textContent?.replace(/\s+/g, " ").trim() || button.getAttribute("aria-label") || "",
        ariaLabel: button.getAttribute("aria-label") || "",
        display: style.display,
        visibility: style.visibility,
        width: box.width,
        height: box.height,
        hidden: style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0,
      };
    });
    return {
      row: {
        width: rowBox.width,
        height: rowBox.height,
        expanded: row.getAttribute("data-row-expanded"),
      },
      category: visible(".transaction-mobile-category-cue"),
      memo: visible(".transaction-memo-text"),
      memoFull: visible(".transaction-memo-text-full"),
      memoCompact: visible(".transaction-memo-text-compact"),
      owner: visible(".transaction-col-owner .transaction-mobile-detail-value"),
      ownerCue: visible(".transaction-col-owner .transaction-owner-compact"),
      actions,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      expectedOwner,
    };
  }, displayName);

  expect(metrics.row.expanded, `row should stay collapsed: ${JSON.stringify(metrics)}`).toBe("false");
  expect(metrics.category?.hidden, `collapsed category summary should be visible: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.category?.text || "", `collapsed category summary should name the category: ${JSON.stringify(metrics)}`).toContain(
    "즉시수정",
  );
  expect(metrics.memo?.hidden, `collapsed memo should stay visible: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.memo?.ariaLabel || "", `collapsed memo should expose the full memo label: ${JSON.stringify(metrics)}`).toBe(
    `메모 ${memo}`,
  );
  expect(metrics.memoFull?.hidden, `collapsed memo should hide the full visual text: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.memoCompact?.hidden, `collapsed memo should show the compact visual text: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.memoCompact?.text || "", `collapsed memo should remain identifiable: ${JSON.stringify(metrics)}`).toMatch(
    /^.\u2026.{3}$/u,
  );
  expect(metrics.owner?.hidden, `collapsed owner detail should not duplicate the compact owner cue: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.ownerCue?.hidden, `collapsed owner cue should stay visible: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.ownerCue?.ariaLabel || "", `collapsed owner cue should expose the full owner label: ${JSON.stringify(metrics)}`).toBe(
    `거래자 ${displayName}`,
  );
  expect(metrics.actions, `collapsed mobile row should not spend space on action buttons: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(
    metrics.actions.some((action) => ["수정", "삭제"].includes(action.text) || ["수정", "삭제"].includes(action.ariaLabel)),
    `edit/delete should move out of the collapsed row actions: ${JSON.stringify(metrics)}`
  ).toBe(false);
  expect(metrics.row.height, `collapsed row should stay compact enough for scanning: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(96);
  expect(metrics.pageOverflowX, `collapsed row should not cause horizontal overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await mobileRow.click({ position: { x: 92, y: 18 } });
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);
  await mobileRow.click({ position: { x: 92, y: 18 } });
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-198-mobile-row-key-details-actions");
  await selectTransactionRowForToolbar(page, mobileRow);
  await expect(page.getByTestId("transaction-selection-edit")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-above")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-below")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-delete")).toBeVisible();
});

test("mobile normal add clears stale anchored insert fields after cancelled insert", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-mobile-anchor-clear")}@example.com`;
  const displayName = unique("tx-mobile-anchor-clear-owner");
  const memoPrefix = unique("tx-mobile-anchor-clear-row");
  const targetMemo = `${memoPrefix}-target`;
  const afterMemo = `${memoPrefix}-after`;
  const normalMemo = `${memoPrefix}-normal`;

  await bootstrapVerifiedSession(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo: targetMemo,
    amount: "22001",
    ownerName: displayName,
    sourceRef: `${memoPrefix}-source-target`,
  });
  await createTransactionViaApi(page, {
    memo: afterMemo,
    amount: "22002",
    ownerName: displayName,
    sourceRef: `${memoPrefix}-source-after`,
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const targetRow = page.locator("tr.transaction-row", { hasText: targetMemo }).first();
  await expect(targetRow).toBeVisible({ timeout: 20_000 });
  await selectTransactionRowForToolbar(page, targetRow);
  await page.getByTestId("transaction-selection-insert-below").click();

  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();
  await page.getByTestId("transaction-entry-sheet-close").click();
  await expect(transactionSheet).toBeHidden();

  await page.getByTestId("transactions-fab").click();
  await expect(transactionSheet).toBeVisible();
  await page.getByTestId("transaction-quick-amount").fill("22003");
  await labeledField(transactionSheet, "메모", "input").fill(normalMemo);
  await page.getByTestId("transaction-quick-save").click();
  await expect(page.locator("tr.transaction-row", { hasText: normalMemo }).first()).toBeVisible({ timeout: 20_000 });

  const ledgerOrder = await page.locator("tr.transaction-row").evaluateAll(
    (rows, expectedMemos) =>
      rows
        .map((row) => row.textContent || "")
        .filter((text) => expectedMemos.some((memo) => text.includes(memo)))
        .map((text) => expectedMemos.find((memo) => text.includes(memo))),
    [targetMemo, afterMemo, normalMemo]
  );
  expect(ledgerOrder).toEqual([targetMemo, afterMemo, normalMemo]);
  await capture(page, "transactions-mobile-anchor-clear-normal-add");
});

test("issue 220: mobile collapsed transaction row scans as one ledger line", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-one-line-row")}@example.com`;
  const displayName = unique("tx-one-line-owner");
  const memo = unique("tx-one-line-memo");
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("한줄요약"),
      minor: unique("스캔"),
    })
  );

  await createTransactionViaApi(page, {
    memo,
    amount: "22000",
    categoryId: category.id,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible({ timeout: 20_000 });
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);

  const metrics = await mobileRow.evaluate((row) => {
    const read = (selector) => {
      const element = row.querySelector(selector);
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const hidden = style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0;
      return {
        text: element.textContent?.replace(/\s+/g, " ").trim() || element.getAttribute("aria-label") || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        top: box.top,
        bottom: box.bottom,
        center: box.top + box.height / 2,
        width: box.width,
        height: box.height,
        hidden,
      };
    };
    const readBox = (root, selector) => {
      const element = root?.querySelector?.(selector);
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const hidden = style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0;
      return {
        left: box.left,
        right: box.right,
        center: box.left + box.width / 2,
        width: box.width,
        hidden,
      };
    };
    const rowBox = row.getBoundingClientRect();
    const ledgerHead = document.querySelector(".transactions-mobile-ledger-head");
    const buttons = Array.from(row.querySelectorAll(".transaction-col-actions button")).map((button) => {
      const box = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        text: button.textContent?.replace(/\s+/g, " ").trim() || button.getAttribute("aria-label") || "",
        ariaLabel: button.getAttribute("aria-label") || "",
        top: box.top,
        bottom: box.bottom,
        center: box.top + box.height / 2,
        width: box.width,
        height: box.height,
        hidden: style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0,
      };
    });
    const headerAlignment = {
      dateLeftDelta: Math.abs((readBox(ledgerHead, ".ledger-head-date")?.left ?? 0) - (readBox(row, ".transaction-col-date")?.left ?? 0)),
      cuesCenterDelta: Math.abs((readBox(ledgerHead, ".ledger-head-cues")?.center ?? 0) - (readBox(row, ".transaction-col-type")?.center ?? 0)),
      ownerCenterDelta: Math.abs((readBox(ledgerHead, ".ledger-head-owner")?.center ?? 0) - (readBox(row, ".transaction-col-owner")?.center ?? 0)),
      categoryLeftDelta: Math.abs((readBox(ledgerHead, ".ledger-head-category")?.left ?? 0) - (readBox(row, ".transaction-col-category")?.left ?? 0)),
      mainLeftDelta: Math.abs((readBox(ledgerHead, ".ledger-head-main")?.left ?? 0) - (readBox(row, ".transaction-col-memo")?.left ?? 0)),
      amountLeftDelta: Math.abs((readBox(ledgerHead, ".ledger-head-amount")?.left ?? 0) - (readBox(row, ".transaction-col-amount")?.left ?? 0)),
    };
    const ownerChip = read(".transaction-owner-compact");
    const ownerSummary = read(".transaction-col-owner .transaction-mobile-detail-value");
    const lineItems = [
      read(".mobile-date-text"),
      read(".transaction-flow-short"),
      read(".transaction-owner-compact"),
      read(".transaction-mobile-category-cue"),
      read(".transaction-memo-text"),
      read(".transaction-amount-text"),
    ].filter((item) => item && !item.hidden);
    const centers = lineItems.map((item) => item.center);
    const centerBandCount = new Set(lineItems.map((item) => Math.round(item.center / 4) * 4)).size;
    return {
      row: {
        height: rowBox.height,
        expanded: row.getAttribute("data-row-expanded"),
      },
      headerAlignment,
      ownerChip,
      ownerSummary,
      lineItems,
      buttons,
      centerBandCount,
      centerSpread: Math.max(...centers) - Math.min(...centers),
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.row.expanded, `row should stay collapsed: ${JSON.stringify(metrics)}`).toBe("false");
  expect(metrics.row.height, `collapsed row should fit a dense one-line ledger scan: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(48);
  for (const [key, delta] of Object.entries(metrics.headerAlignment)) {
    expect(delta, `mobile ledger header should align with row column ${key}: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(8);
  }
  expect(metrics.ownerChip?.hidden, `collapsed row should keep one compact owner cue: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.ownerSummary?.hidden, `collapsed row should not duplicate owner text beside the owner cue: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.centerBandCount, `collapsed row should not split visible content into stacked center lines: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(2);
  expect(metrics.centerSpread, `date/type/owner/category/memo/amount should share one scan line: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(12);
  expect(metrics.buttons, `collapsed one-line row should not expose visual action buttons: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(
    metrics.buttons.some((action) => ["수정", "삭제"].includes(action.text) || ["수정", "삭제"].includes(action.ariaLabel)),
    `edit/delete should not be direct row actions in the one-line row: ${JSON.stringify(metrics)}`
  ).toBe(false);
  expect(metrics.pageOverflowX, `one-line row should not cause horizontal overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-220-mobile-row-one-line-summary");
  await selectTransactionRowForToolbar(page, mobileRow);
  await expect(page.getByTestId("transaction-selection-edit")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-above")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-below")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-delete")).toBeVisible();
});

test("mobile collapsed transaction row keeps large KRW amount readable", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-large-amount-row")}@example.com`;
  const displayName = unique("tx-large-amount-owner");
  const memo = unique("tx-large-amount-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "123456789",
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 360, height: 780 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible({ timeout: 20_000 });
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);

  const metrics = await mobileRow.evaluate((row) => {
    const boxOf = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const amountCell = row.querySelector(".transaction-col-amount");
    const amountText = row.querySelector(".transaction-amount-text");
    const memoText = row.querySelector(".transaction-memo-text");
  const actionCell = row.querySelector(".transaction-col-actions");
  const actionButtons = row.querySelectorAll(".transaction-col-actions button").length;
    return {
      row: boxOf(row),
      amountCell: boxOf(amountCell),
      amountText: amountText
        ? {
            ...boxOf(amountText),
            text: amountText.textContent?.trim() || "",
            clientWidth: amountText.clientWidth,
            scrollWidth: amountText.scrollWidth,
          }
        : null,
      memoText: boxOf(memoText),
      actionCell: boxOf(actionCell),
      actionButtons,
      viewportWidth: window.innerWidth,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.amountText?.text, `large amount should render the full grouped value: ${JSON.stringify(metrics)}`).toContain("123,456,789");
  expect(
    metrics.amountText.scrollWidth - metrics.amountText.clientWidth,
    `large amount text should not clip: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(1);
  expect(
    metrics.amountText.right,
    `large amount should stay inside the row after row action buttons are removed: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(metrics.row.right - 2);
  expect(metrics.actionButtons, `collapsed mobile rows should not expose separate action buttons: ${JSON.stringify(metrics)}`).toBe(0);
  expect(
    metrics.memoText.right,
    `memo should stay visible without overlapping the large amount in the dense row: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(metrics.amountText.left - 1);
  expect(metrics.row.right, `large amount row should stay inside the viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  expect(metrics.pageOverflowX, `large amount row should not cause horizontal overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "transactions-mobile-large-amount-readable");
});

test("issue 221: mobile transaction status chips keep clear action in viewport", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-status-chip-row")}@example.com`;
  const displayName = unique("tx-status-chip-owner");
  const memo = unique("tx-status-chip-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "22100",
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);
  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible({ timeout: 20_000 });
  await selectTransactionRowForToolbar(page, mobileRow);

  const toolbar = page.getByTestId("transaction-sticky-toolbar");
  const controlStrip = toolbar.locator(".surface-control-strip").first();
  const clearButton = controlStrip.getByRole("button", { name: "선택 해제" });
  await expect(controlStrip).toBeVisible();
  await expect(clearButton).toBeVisible();

  const metrics = await controlStrip.evaluate((strip) => {
    const stripBox = strip.getBoundingClientRect();
    const stripStyle = getComputedStyle(strip);
    const items = Array.from(strip.querySelectorAll(".surface-chip, .transaction-selection-clear")).map((item) => {
      const box = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return {
        text: item.textContent?.replace(/\s+/g, " ").trim() || item.getAttribute("aria-label") || "",
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
        hidden: style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0,
      };
    });
    const visibleItems = items.filter((item) => !item.hidden);
    return {
      viewportWidth: document.documentElement.clientWidth,
      strip: {
        left: stripBox.left,
        right: stripBox.right,
        clientWidth: strip.clientWidth,
        scrollWidth: strip.scrollWidth,
        overflowX: stripStyle.overflowX,
        flexWrap: stripStyle.flexWrap,
      },
      visibleItems,
      clippedItems: visibleItems.filter(
        (item) =>
          item.left < stripBox.left - 1 ||
          item.right > stripBox.right + 1 ||
          item.left < -1 ||
          item.right > document.documentElement.clientWidth + 1
      ),
    };
  });

  expect(["wrap", "nowrap"]).toContain(metrics.strip.flexWrap);
  expect(metrics.strip.scrollWidth, `status chip strip should not require hidden horizontal scroll: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.strip.clientWidth + 1
  );
  expect(metrics.clippedItems, `status chips and clear action should stay in the viewport: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.visibleItems.map((item) => item.text).join(" ")).toContain("선택 해제");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-221-mobile-status-chips-visible");
});

test("issue 222: mobile transaction add action does not cover ledger rows", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-fab-clearance")}@example.com`;
  const displayName = unique("tx-fab-clearance-owner");
  const memoPrefix = unique("tx-fab-clearance-row");
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("FAB겹침"),
      minor: unique("하단행"),
    })
  );

  for (let index = 0; index < 18; index += 1) {
    await createTransactionViaApi(page, {
      memo: `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(1200 + index),
      categoryId: category.id,
      ownerName: displayName,
    });
  }

  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const transactionFab = page.getByTestId("transactions-fab");
  await expect(transactionFab).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);

  const metrics = await page.evaluate(() => {
    const fab = document.querySelector("[data-testid='transactions-fab']");
    const fabBox = fab?.getBoundingClientRect();
    const stickyToolbarBox = document.querySelector("[data-testid='transaction-sticky-toolbar']")?.getBoundingClientRect();
    const stickyLedgerBox = document.querySelector(".transactions-mobile-ledger-head")?.getBoundingClientRect();
    const visibleLedgerTop = Math.max(
      stickyToolbarBox?.bottom ?? 0,
      stickyLedgerBox?.bottom ?? 0,
      0
    );
    const intersects = (left, right, inset = 0) =>
      Boolean(
        left &&
          right &&
          left.left + inset < right.right &&
          left.right - inset > right.left &&
          left.top + inset < right.bottom &&
          left.bottom - inset > right.top
      );
    const boxOf = (element) => {
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const hidden = style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0;
      return {
        text: element.textContent?.replace(/\s+/g, " ").trim() || element.getAttribute("aria-label") || "",
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        hidden,
      };
    };
    const isVisibleLedgerTarget = (target) => target && !target.hidden && target.bottom > visibleLedgerTop + 1;
    const rows = Array.from(document.querySelectorAll("tr.transaction-row"))
      .map((row) => {
        const rowBox = row.getBoundingClientRect();
        const targets = [
          ".mobile-date-text",
          ".transaction-flow-short",
          ".transaction-mobile-category-cue",
          ".transaction-memo-text",
          ".transaction-owner-compact",
          ".transaction-amount-text",
        ]
          .map((selector) => boxOf(row.querySelector(selector)))
          .concat(Array.from(row.querySelectorAll(".transaction-col-actions button")).map((button) => boxOf(button)))
          .filter(isVisibleLedgerTarget);
        return {
          text: row.textContent?.replace(/\s+/g, " ").trim() || "",
          row: {
            left: rowBox.left,
            right: rowBox.right,
            top: rowBox.top,
            bottom: rowBox.bottom,
            width: rowBox.width,
            height: rowBox.height,
          },
          targets,
          coveredTargets: targets.filter((target) => intersects(target, fabBox, 1)),
          rowIntersectsFab: rowBox.bottom > visibleLedgerTop + 1 && intersects(rowBox, fabBox, 1),
        };
      })
      .filter((row) => row.row.top < window.innerHeight && row.row.bottom > visibleLedgerTop + 1);
    return {
      scrollY: window.scrollY,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      visibleLedgerTop,
      fab: fabBox
        ? {
            position: getComputedStyle(fab).position,
            inListHeading: Boolean(fab.closest(".surface-list-heading")),
            left: fabBox.left,
            right: fabBox.right,
            top: fabBox.top,
            bottom: fabBox.bottom,
            width: fabBox.width,
            height: fabBox.height,
          }
        : null,
      visibleRows: rows.map((row) => ({
        text: row.text,
        row: row.row,
        rowIntersectsFab: row.rowIntersectsFab,
        coveredTargets: row.coveredTargets,
      })),
      coveredRows: rows.filter((row) => row.coveredTargets.length > 0),
      intersectedRows: rows.filter((row) => row.rowIntersectsFab),
      visibleRowCount: rows.length,
      lowestVisibleRowBottom: rows.reduce((maxBottom, row) => Math.max(maxBottom, row.row.bottom), 0),
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.fab, `transaction add action should have geometry: ${JSON.stringify(metrics)}`).toBeTruthy();
  expect(metrics.fab.position, `transaction add action should stay fixed at the bottom-right: ${JSON.stringify(metrics)}`).toBe("fixed");
  expect(metrics.fab.inListHeading, `transaction add action should be outside the sticky heading containing block: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.fab.right, `transaction add action should sit near the right edge: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(
    metrics.viewport.width - 20,
  );
  expect(metrics.fab.top, `transaction add action should live in the lower viewport: ${JSON.stringify(metrics)}`).toBeGreaterThan(
    metrics.viewport.height * 0.72,
  );
  expect(metrics.visibleRowCount, `test should exercise visible ledger rows: ${JSON.stringify(metrics)}`).toBeGreaterThan(0);
  expect(metrics.intersectedRows, `transaction add action should not overlap ledger rows: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.coveredRows, `transaction add action should not cover readable or tappable row content: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.pageOverflowX, `transaction add action should not create horizontal overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-222-mobile-add-action-row-clearance");
});

test("issue 223: desktop transaction add action does not cover bottom row actions", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-desktop-fab-clearance")}@example.com`;
  const displayName = unique("tx-desktop-fab-owner");
  const memoPrefix = unique("tx-desktop-fab-row");
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("DesktopFAB"),
      minor: unique("동작열"),
    })
  );

  for (let index = 0; index < 36; index += 1) {
    await createTransactionViaApi(page, {
      memo: `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(3200 + index),
      categoryId: category.id,
      ownerName: displayName,
    });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  await page.evaluate(() => {
    const fab = document.querySelector("[data-testid='transactions-fab']");
    const row = Array.from(document.querySelectorAll("tr.transaction-row"))[Math.min(28, document.querySelectorAll("tr.transaction-row").length - 1)];
    const actionButton = row?.querySelector(".transaction-col-actions button");
    const fabBox = fab?.getBoundingClientRect();
    const actionBox = actionButton?.getBoundingClientRect();
    if (!fabBox || !actionBox) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return;
    }
    const actionCenterY = actionBox.top + window.scrollY + actionBox.height / 2;
    const fabCenterY = fabBox.top + fabBox.height / 2;
    window.scrollTo(0, Math.max(0, actionCenterY - fabCenterY));
  });
  await page.waitForTimeout(300);
  await expectDesktopTransactionAddActionReachable(page, "desktop transaction add action");

  const metrics = await page.evaluate(() => {
    const fixedFab = document.querySelector("[data-testid='transactions-fab']");
    const boxOf = (element) => {
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        text: element.textContent?.replace(/\s+/g, " ").trim() || element.getAttribute("aria-label") || "",
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        display: style.display,
        position: style.position,
        visibility: style.visibility,
      };
    };
    const intersects = (left, right, inset = 0) =>
      Boolean(
        left &&
          right &&
          left.left + inset < right.right &&
          left.right - inset > right.left &&
          left.top + inset < right.bottom &&
          left.bottom - inset > right.top
      );
    const fabBox = boxOf(fixedFab);
    const actionTargets = Array.from(
      document.querySelectorAll("tr.transaction-row .transaction-col-actions button"),
    )
      .map((button) => {
        const box = boxOf(button);
        if (!box) {
          return null;
        }
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);
        return {
          ...box,
          centerX,
          centerY,
          centerCoveredByFab: Boolean(
            fabBox &&
              centerX >= fabBox.left &&
              centerX <= fabBox.right &&
              centerY >= fabBox.top &&
              centerY <= fabBox.bottom
          ),
          hitVisible: Boolean(topElement && (topElement === button || button.contains(topElement))),
        };
      })
      .filter((target) => target && target.top < window.innerHeight && target.bottom > 0);
    const visibleRows = Array.from(document.querySelectorAll("tr.transaction-row"))
      .map((row) => boxOf(row))
      .filter((target) => target && target.top < window.innerHeight && target.bottom > 0);
    return {
      scrollY: window.scrollY,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fixedFab: fabBox,
      visibleRowCount: visibleRows.length,
      coveredActionTargets: actionTargets.filter((target) => intersects(target, fabBox, 1)),
      centerCoveredActionTargets: actionTargets.filter((target) => target.centerCoveredByFab && !target.hitVisible),
      visibleActionTargetCount: actionTargets.length,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.fixedFab, `desktop should not render a fixed transaction FAB: ${JSON.stringify(metrics)}`).toBeNull();
  expect(metrics.visibleRowCount, `test should exercise visible ledger rows: ${JSON.stringify(metrics)}`).toBeGreaterThan(0);
  expect(metrics.visibleActionTargetCount, `row edit/delete targets should move out of the ledger row: ${JSON.stringify(metrics)}`).toBe(0);
  expect(metrics.coveredActionTargets, `desktop add affordance should not cover row targets: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.centerCoveredActionTargets, `desktop row target centers should remain directly hittable: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.pageOverflowX, `desktop add clearance should not create horizontal overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-223-desktop-add-action-row-clearance");
});

test("issue 224: desktop transaction row edit and delete targets stay comfortable", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-desktop-row-actions")}@example.com`;
  const displayName = unique("tx-desktop-row-actions-owner");
  const memoPrefix = unique("tx-desktop-row-actions-row");
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("DesktopActions"),
      minor: unique("정리작업"),
    })
  );

  for (let index = 0; index < 18; index += 1) {
    await createTransactionViaApi(page, {
      memo: `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(4200 + index),
      categoryId: category.id,
      ownerName: displayName,
    });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);
  await page.locator(".transaction-list-card").first().evaluate((element) => element.scrollIntoView({ block: "start" }));
  const targetMemo = `${memoPrefix}-00`;
  const targetRow = page.locator("tr.transaction-row", { hasText: targetMemo }).first();
  await targetRow.scrollIntoViewIfNeeded();
  await selectTransactionRowForToolbar(page, targetRow);
  await page.waitForTimeout(150);

  const metrics = await page.evaluate(() => {
    const boxOf = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;
      const topElement = document.elementFromPoint(centerX, centerY);
      return {
        text: element.textContent?.replace(/\s+/g, " ").trim() || element.getAttribute("aria-label") || "",
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        display: style.display,
        visibility: style.visibility,
        hitVisible: Boolean(topElement && (topElement === element || element.contains(topElement))),
      };
    };
    const rowEditDeleteTargets = Array.from(document.querySelectorAll("tr.transaction-row .transaction-col-actions button:not(.mobile-toggle-btn)"))
      .map((button) => boxOf(button))
      .filter((target) => target.display !== "none" && target.visibility === "visible" && target.width > 0 && target.height > 0)
      .filter((target) => target.top >= 0 && target.bottom <= window.innerHeight);
    const toolbarTargets = Array.from(
      document.querySelectorAll(
        [
          "[data-testid='transaction-selection-edit']",
          "[data-testid='transaction-selection-insert-above']",
          "[data-testid='transaction-selection-insert-below']",
          "[data-testid='transaction-selection-delete']",
        ].join(",")
      )
    )
      .map((button) => boxOf(button))
      .filter((target) => target.display !== "none" && target.visibility === "visible" && target.width > 0 && target.height > 0);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rowEditDeleteTargets,
      toolbarTargets,
      undersizedTargets: toolbarTargets.filter((target) => target.width < 44 || target.height < 36),
      hiddenHitTargets: toolbarTargets.filter((target) => !target.hitVisible),
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.rowEditDeleteTargets.length, `row-level edit/delete targets should stay out of ledger rows: ${JSON.stringify(metrics)}`).toBe(0);
  expect(metrics.toolbarTargets.length, `selection toolbar should expose edit/insert/delete targets: ${JSON.stringify(metrics)}`).toBe(4);
  expect(metrics.undersizedTargets, `selection toolbar targets should be at least 44x36px: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.hiddenHitTargets, `selection toolbar target centers should be directly clickable: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.pageOverflowX, `larger desktop selection toolbar should not create horizontal overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-224-desktop-row-action-target-size");
});

test("issue 273: desktop transaction row double-click opens inline edit only from row body", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-row-double-click-edit")}@example.com`;
  const displayName = unique("tx-row-double-click-owner");
  const memo = unique("tx-row-double-click-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 900 });

  const createdRow = await createBasicTransaction(page, { memo, amount: "12000" });
  await expect(createdRow).toBeVisible();
  await expect(page.locator("tr.transaction-inline-editor-row")).toHaveCount(0);
  await expect(createdRow).toHaveAttribute("data-row-selected", "false");
  await expect(createdRow).toHaveAttribute("data-row-expanded", "false");

  await createdRow.locator(".transaction-col-memo").dblclick();
  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();
  await expect(editorRow.getByLabel("메모")).toHaveValue(memo);
  await expect(createdRow).toHaveAttribute("data-row-selected", "false");
  await expect(createdRow).toHaveAttribute("data-row-expanded", "false");
  await capture(page, "issue-273-desktop-row-double-click-edit");

  await editorRow.getByRole("button", { name: "취소" }).click();
  await expect(page.locator("tr.transaction-inline-editor-row")).toHaveCount(0);
  await createdRow.locator(".transaction-col-memo").click();
  await expect(createdRow).toHaveAttribute("data-row-selected", "true");
  await expect(createdRow).toHaveAttribute("data-row-expanded", "true");
  await createdRow.locator(".transaction-col-memo").dispatchEvent("click", {
    bubbles: true,
    cancelable: true,
    detail: 2,
    button: 0,
  });
  await createdRow.locator(".transaction-col-memo").dispatchEvent("dblclick", {
    bubbles: true,
    cancelable: true,
    detail: 2,
    button: 0,
  });
  await expect(page.locator("tr.transaction-inline-editor-row").first()).toBeVisible();
  await expect(createdRow).toHaveAttribute("data-row-selected", "false");
  await expect(createdRow).toHaveAttribute("data-row-expanded", "false");
  await page.locator("tr.transaction-inline-editor-row").first().getByRole("button", { name: "취소" }).click();
  await expect(page.locator("tr.transaction-inline-editor-row")).toHaveCount(0);

  await createdRow.focus();
  await createdRow.press("Enter");
  await expect(page.locator("tr.transaction-inline-editor-row").first()).toBeVisible();
  await page.locator("tr.transaction-inline-editor-row").first().getByRole("button", { name: "취소" }).click();
  await expect(page.locator("tr.transaction-inline-editor-row")).toHaveCount(0);
  await createdRow.focus();
  await createdRow.press("F2");
  await expect(page.locator("tr.transaction-inline-editor-row").first()).toBeVisible();
  await page.locator("tr.transaction-inline-editor-row").first().getByRole("button", { name: "취소" }).click();
  await expect(page.locator("tr.transaction-inline-editor-row")).toHaveCount(0);

  await page.route("**/api/v1/household/current", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, role: "viewer" },
    });
  });
  await page.reload();
  await expect(page.locator("tr.transaction-row", { hasText: memo }).first()).toBeVisible();
  const readOnlyRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await readOnlyRow.locator(".transaction-col-memo").dblclick();
  await expect(page.locator("tr.transaction-inline-editor-row")).toHaveCount(0);
  await expect(page.locator(".message", { hasText: "현재 권한으로는 거래를 수정할 수 없습니다." })).toBeVisible();
});

test("issue 248: extracted transactions page keeps entry and inline edit wiring live", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-extracted-wiring")}@example.com`;
  const displayName = unique("tx-extracted-wiring-owner");
  const memo = unique("tx-extracted-wiring-memo");
  const editedMemo = `${memo}-edited`;

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 900 });

  const createdRow = await createBasicTransaction(page, { memo, amount: "24800" });
  await expect(createdRow).toContainText(memo);

  await clickTransactionSelectionToolbarAction(page, createdRow, "수정");
  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();
  await expectIsoDateInput(editorRow.getByLabel("일자"), "issue 248 inline edit date");
  await editorRow.getByLabel("메모").fill(editedMemo);
  await editorRow.getByLabel("금액").fill("24900");
  await editorRow.getByRole("button", { name: "저장" }).click();

  await expect(page.locator("tr.transaction-row", { hasText: editedMemo }).first()).toBeVisible();
  await capture(page, "issue-248-transactions-page-wiring");
});

test("desktop inline insert locks save while a transaction POST is pending", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-inline-submit-lock")}@example.com`;
  const displayName = unique("tx-inline-submit-lock-owner");
  const seedMemo = unique("tx-inline-submit-lock-seed");
  const insertMemo = unique("tx-inline-submit-lock-insert");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 900 });

  const seedRow = await createBasicTransaction(page, { memo: seedMemo, amount: "12000" });
  await expect(seedRow).toBeVisible();
  await clickTransactionSelectionToolbarAction(page, seedRow, "위에 삽입");

  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();
  await editorRow.getByLabel("금액").fill("43210");
  await editorRow.getByLabel("메모").fill(insertMemo);

  let resolveFirstPost;
  let releasePost;
  const firstPostSeen = new Promise((resolve) => {
    resolveFirstPost = resolve;
  });
  const postRelease = new Promise((resolve) => {
    releasePost = resolve;
  });
  let postCount = 0;

  await page.route("**/api/v1/transactions", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "POST" || !url.pathname.endsWith("/api/v1/transactions")) {
      await route.continue();
      return;
    }

    postCount += 1;
    resolveFirstPost();
    await postRelease;
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  const saveButton = editorRow.getByTestId("tx-inline-save");
  await expect(saveButton).toBeEnabled();
  await saveButton.evaluate((button) => {
    button.click();
    button.click();
  });
  await firstPostSeen;
  await expect(saveButton, "inline insert save should lock while POST is pending").toBeDisabled();
  expect(postCount, "same-tick repeated inline save clicks should start one transaction POST").toBe(1);

  releasePost();
  await expect(page.locator("tr.transaction-row", { hasText: insertMemo }).first()).toBeVisible({ timeout: 20_000 });
  expect(postCount, "inline insert should not replay after the original save resolves").toBe(1);
  await capture(page, "transactions-inline-insert-submit-lock");
});

test("issue 227: 1024px transaction row actions stay inside the viewport", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-1024-actions")}@example.com`;
  const displayName = unique("tx-1024-actions-owner");
  const memoPrefix = unique("tx-1024-actions-row");
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("Desktop1024"),
      minor: unique("동작열"),
    })
  );

  for (let index = 0; index < 6; index += 1) {
    await createTransactionViaApi(page, {
      memo: `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(5227 + index),
      categoryId: category.id,
      ownerName: displayName,
    });
  }

  await page.reload();
  await page.setViewportSize({ width: 1024, height: 768 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const targetMemo = `${memoPrefix}-00`;
  const targetRow = page.locator("tr.transaction-row", { hasText: targetMemo }).first();
  await expect(targetRow).toBeVisible({ timeout: 20_000 });
  await page.locator(".transaction-list-card").first().evaluate((element) => element.scrollIntoView({ block: "start" }));
  await targetRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  const transactionScroller = page.locator(".transactions-surface-scroll").first();
  await transactionScroller.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await expect(
    transactionScroller,
    "a transaction ledger that fits its container must not add an inert keyboard stop"
  ).not.toHaveAttribute("tabindex");
  await page.waitForTimeout(150);

  const metrics = await page.evaluate((rowMemoPrefix) => {
    const boxOf = (element) => {
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;
      const topElement = document.elementFromPoint(centerX, centerY);
      return {
        text: element.textContent?.replace(/\s+/g, " ").trim() || element.getAttribute("aria-label") || "",
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        display: style.display,
        visibility: style.visibility,
        hitVisible: Boolean(topElement && (topElement === element || element.contains(topElement))),
      };
    };
    const viewportWidth = window.innerWidth;
    const scroller = document.querySelector(".transactions-surface-scroll");
    const table = document.querySelector(".transactions-surface-table");
    const headerAction = document.querySelector(".transactions-desktop-ledger-head .transaction-col-actions");
    const target = Array.from(document.querySelectorAll("tr.transaction-row")).find((row) =>
      row.textContent?.includes(rowMemoPrefix)
    );
    const actionCell = target?.querySelector(".transaction-col-actions");
    const actionButtons = Array.from(actionCell?.querySelectorAll("button:not(.mobile-toggle-btn)") || [])
      .map((button) => boxOf(button))
      .filter((targetBox) => targetBox && targetBox.display !== "none" && targetBox.visibility === "visible" && targetBox.width > 0 && targetBox.height > 0);
    const trackedBoxes = [boxOf(headerAction), boxOf(actionCell), ...actionButtons].filter(Boolean);
    return {
      viewport: { width: viewportWidth, height: window.innerHeight },
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scroller: {
        ...boxOf(scroller),
        clientWidth: scroller?.clientWidth || 0,
        scrollWidth: scroller?.scrollWidth || 0,
        scrollLeft: scroller?.scrollLeft || 0,
        scrollOverflowX: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      },
      table: boxOf(table),
      headerAction: boxOf(headerAction),
      actionCell: boxOf(actionCell),
      actionButtons,
      outsideViewport: trackedBoxes.filter((targetBox) => targetBox.left < -1 || targetBox.right > viewportWidth + 1),
      hiddenHitTargets: actionButtons.filter((targetBox) => !targetBox.hitVisible),
      undersizedTargets: actionButtons.filter((targetBox) => targetBox.width < 44 || targetBox.height < 36),
    };
  }, memoPrefix);

  expect(metrics.actionButtons.length, `row-level edit/delete targets should move out of the ledger row: ${JSON.stringify(metrics)}`).toBe(0);
  expect(metrics.pageOverflowX, `1024px desktop page should not overflow horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.scroller.scrollOverflowX, `1024px transaction table should not need horizontal scroll after action column removal: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.outsideViewport, `desktop ledger action remnants should stay inside viewport: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.undersizedTargets, `desktop row should not expose undersized edit/delete targets: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.hiddenHitTargets, `desktop row should not expose hidden edit/delete centers: ${JSON.stringify(metrics)}`).toEqual([]);
  await selectTransactionRowForToolbar(page, targetRow);
  const selectionToolbar = page.getByTestId("transaction-sticky-toolbar");
  await expect(selectionToolbar.getByTestId("transaction-selection-edit")).toBeVisible();
  await expect(selectionToolbar.getByTestId("transaction-selection-edit")).toBeEnabled();
  await expect(selectionToolbar.getByTestId("transaction-selection-insert-above")).toBeVisible();
  await expect(selectionToolbar.getByTestId("transaction-selection-insert-below")).toBeVisible();
  await expect(selectionToolbar.getByTestId("transaction-selection-delete")).toBeVisible();

  const aboveMemo = `${memoPrefix}-insert-above`;
  await selectionToolbar.getByTestId("transaction-selection-insert-above").click();
  const aboveEditor = page.locator("tr.transaction-inline-editor-row").first();
  await expect(aboveEditor).toBeVisible();
  const aboveGeometry = await page.evaluate((targetText) => {
    const editor = document.querySelector("tr.transaction-inline-editor-row");
    const target = Array.from(document.querySelectorAll("tr.transaction-row")).find((row) =>
      row.textContent?.includes(targetText)
    );
    const editorBox = editor?.getBoundingClientRect();
    const targetBox = target?.getBoundingClientRect();
    return {
      editorBottom: editorBox?.bottom ?? null,
      targetTop: targetBox?.top ?? null,
    };
  }, targetMemo);
  expect(aboveGeometry.editorBottom, `insert-above editor should be measurable: ${JSON.stringify(aboveGeometry)}`).not.toBeNull();
  expect(aboveGeometry.targetTop, `target row should be measurable: ${JSON.stringify(aboveGeometry)}`).not.toBeNull();
  expect(
    aboveGeometry.editorBottom,
    `insert-above editor should render before the selected row: ${JSON.stringify(aboveGeometry)}`
  ).toBeLessThanOrEqual((aboveGeometry.targetTop ?? 0) + 1);
  await aboveEditor.getByLabel("금액").fill("7101");
  await aboveEditor.getByLabel("메모").fill(aboveMemo);
  await aboveEditor.getByRole("button", { name: "저장" }).click();
  await expect(page.locator("tr.transaction-row", { hasText: aboveMemo }).first()).toBeVisible({ timeout: 20_000 });

  if (await page.getByTestId("transaction-selection-summary").isVisible().catch(() => false)) {
    await clearTransactionSelection(page);
  }
  await selectTransactionRowForToolbar(page, targetRow);
  const belowMemo = `${memoPrefix}-insert-below`;
  await selectionToolbar.getByTestId("transaction-selection-insert-below").click();
  const belowEditor = page.locator("tr.transaction-inline-editor-row").first();
  await expect(belowEditor).toBeVisible();
  const belowGeometry = await page.evaluate((targetText) => {
    const editor = document.querySelector("tr.transaction-inline-editor-row");
    const target = Array.from(document.querySelectorAll("tr.transaction-row")).find((row) =>
      row.textContent?.includes(targetText)
    );
    const editorBox = editor?.getBoundingClientRect();
    const targetBox = target?.getBoundingClientRect();
    return {
      editorTop: editorBox?.top ?? null,
      targetBottom: targetBox?.bottom ?? null,
    };
  }, targetMemo);
  expect(belowGeometry.editorTop, `insert-below editor should be measurable: ${JSON.stringify(belowGeometry)}`).not.toBeNull();
  expect(belowGeometry.targetBottom, `target row should be measurable: ${JSON.stringify(belowGeometry)}`).not.toBeNull();
  expect(
    belowGeometry.editorTop,
    `insert-below editor should render after the selected row: ${JSON.stringify(belowGeometry)}`
  ).toBeGreaterThanOrEqual((belowGeometry.targetBottom ?? 0) - 1);
  await belowEditor.getByLabel("금액").fill("7102");
  await belowEditor.getByLabel("메모").fill(belowMemo);
  await belowEditor.getByRole("button", { name: "저장" }).click();
  await expect(page.locator("tr.transaction-row", { hasText: belowMemo }).first()).toBeVisible({ timeout: 20_000 });

  const ledgerOrder = await page.locator("tr.transaction-row").evaluateAll(
    (rows, expectedMemos) =>
      rows
        .map((row) => row.textContent || "")
        .filter((text) => expectedMemos.some((memo) => text.includes(memo)))
        .map((text) => expectedMemos.find((memo) => text.includes(memo))),
    [aboveMemo, targetMemo, belowMemo]
  );
  expect(ledgerOrder).toEqual([aboveMemo, targetMemo, belowMemo]);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-227-1024-transaction-toolbar-actions-visible");
});

test("transaction selection toolbar bulk deletes multiple rows in one request", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-bulk-delete-ui")}@example.com`;
  const displayName = unique("tx-bulk-delete-owner");
  const memoPrefix = unique("tx-bulk-delete-row");
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("일괄삭제"),
      minor: unique("선택툴바"),
    })
  );
  const memos = [`${memoPrefix}-a`, `${memoPrefix}-b`];
  for (const [index, memo] of memos.entries()) {
    await createTransactionViaApi(page, {
      memo,
      amount: String(6200 + index),
      categoryId: category.id,
      ownerName: displayName,
    });
  }
  const requestCounts = { bulkDelete: 0, singleDelete: 0 };
  page.on("request", (request) => {
    const url = request.url();
    if (request.method() === "POST" && url.includes("/api/v1/transactions/bulk-delete")) {
      requestCounts.bulkDelete += 1;
    }
    if (request.method() === "DELETE" && /\/api\/v1\/transactions\/[^/]+$/.test(url)) {
      requestCounts.singleDelete += 1;
    }
  });

  await page.reload();
  await page.setViewportSize({ width: 1280, height: 820 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  for (const [index, memo] of memos.entries()) {
    const row = page.locator("tr.transaction-row", { hasText: memo }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await selectTransactionRowForToolbar(page, row, { expectedCount: index + 1 });
    await expect(row).toHaveAttribute("data-row-selected", "true");
  }
  await expectTransactionSelectionSummary(page, 2);
  await page.getByTestId("transaction-selection-delete").click();
  const confirmDialog = page.locator(".confirm-dialog");
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("2건을 한 번에 삭제합니다.");
  await confirmDialog.getByRole("button", { name: "선택 삭제" }).click();
  await expect(page.getByText("선택한 거래를 삭제했습니다.")).toBeVisible();
  for (const memo of memos) {
    await expect(page.locator("tr.transaction-row", { hasText: memo })).toHaveCount(0);
  }
  expect(requestCounts.bulkDelete).toBe(1);
  expect(requestCounts.singleDelete).toBe(0);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "transactions-selection-bulk-delete");
});

test("transaction ledger selection toolbar stays overflow-free at 820px and 1100px", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-boundary-width")}@example.com`;
  const displayName = unique("tx-boundary-width-owner-long");
  const memo = `${unique("tx-boundary-width-memo")}-긴메모-abcdefghijklmnopqrstuvwxyz`;
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("경계폭"),
      minor: unique("오버플로"),
    })
  );
  await createTransactionViaApi(page, {
    memo,
    amount: "8201100",
    categoryId: category.id,
    ownerName: displayName,
  });
  await page.reload();

  for (const width of [820, 1100]) {
    await page.setViewportSize({ width, height: 860 });
    await openTab(page, "거래");
    await waitForTransactionAppShell(page);
    const row = page.locator("tr.transaction-row", { hasText: memo }).first();
    await selectTransactionRowForToolbar(page, row);
    await expect(page.getByTestId("transaction-selection-edit")).toBeVisible();
    await expect(page.getByTestId("transaction-selection-delete")).toBeVisible();
    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector(".transactions-surface-scroll");
      const toolbar = document.querySelector("[data-testid='transaction-sticky-toolbar']");
      const toolbarBox = toolbar?.getBoundingClientRect();
      return {
        documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollerOverflowX: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
        toolbarRight: toolbarBox?.right ?? 0,
        viewportWidth: window.innerWidth,
      };
    });
    expect(metrics.documentOverflowX, `${width}px document should not overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
    expect(metrics.scrollerOverflowX, `${width}px transaction scroller should not overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
    expect(metrics.toolbarRight, `${width}px toolbar should stay inside viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
      metrics.viewportWidth + 1
    );
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, `transactions-boundary-width-${width}`);
    if (await page.getByTestId("transaction-selection-summary").isVisible().catch(() => false)) {
      await clearTransactionSelection(page);
    }
  }
});

test("issue 228: mobile transaction filters use ledger headers without duplicate generic toggle", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-filter-affordance")}@example.com`;
  const displayName = unique("tx-filter-affordance-owner");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const toolbar = page.getByTestId("transaction-sticky-toolbar");
  const genericFilterToggle = toolbar.getByRole("button", { name: "필터 열기", exact: true });
  const mobileLedgerHead = page.locator(".transactions-mobile-ledger-head").first();
  const memoFilterTrigger = mobileLedgerHead.getByRole("button", { name: "메모 필터 열기" });

  await expect(mobileLedgerHead).toBeVisible();
  await expect(genericFilterToggle).toHaveCount(0);
  await expect(mobileLedgerHead.getByRole("button", { name: "일자 필터 열기" })).toBeVisible();
  await expect(memoFilterTrigger).toBeVisible();
  await expect(mobileLedgerHead.getByRole("button", { name: "금액 필터 열기" })).toBeVisible();
  await expect(mobileLedgerHead.getByRole("button", { name: "유형 필터 열기" })).toBeVisible();
  await capture(page, "issue-228-mobile-header-filter-primary");

  const openPortraitFilter = async (buttonName, focusedLabel, panelTitle) => {
    const trigger = mobileLedgerHead.getByRole("button", { name: buttonName });
    await trigger.click();
    const mobileFilterPanel = page.getByTestId("tx-ledger-filter-panel");
    await expect(mobileFilterPanel).toContainText(panelTitle);
    await expect(mobileFilterPanel.getByLabel(focusedLabel, { exact: true })).toBeFocused();
    await expect(toolbar.getByRole("button", { name: "필터 닫기", exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page, 12);
    await mobileFilterPanel.getByRole("button", { name: "닫기" }).click();
    await expect(mobileFilterPanel).toBeHidden();
    await expect(trigger).toBeFocused();
  };
  await openPortraitFilter("메모 필터 열기", "메모", "메모 필터");
  await openPortraitFilter("금액 필터 열기", "최소 금액", "금액 필터");
  await openPortraitFilter("유형 필터 열기", "유형", "유형 필터");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-228-mobile-filter-closed");
});

test("issue #249: mobile transaction sticky stack uses measured heights", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-sticky-measured")}@example.com`;
  const displayName = unique("tx-sticky-measured-owner");
  const memo = unique("tx-sticky-measured-row");

  await bootstrapVerifiedSession(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "49000",
    occurredOn: isoDaysAgo(0),
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const mobileLedgerHead = page.locator(".transactions-mobile-ledger-head").first();
  await expect(mobileLedgerHead).toBeVisible();
  await mobileLedgerHead.getByRole("button", { name: "메모 필터 열기" }).click();
  const mobileFilterPanel = page.getByTestId("tx-ledger-filter-panel");
  await expect(mobileFilterPanel).toBeVisible();
  await mobileFilterPanel.getByPlaceholder("메모 검색").fill(memo);
  await expect(page.locator("tr.transaction-row", { hasText: memo }).first()).toBeVisible();

  const metrics = await page.locator(".transaction-list-card").evaluate((card) => {
    const readNumber = (value) => Number.parseFloat(String(value || "").replace("px", ""));
    const style = getComputedStyle(card);
    const ledgerHead = card.querySelector(".transactions-mobile-ledger-head");
    const filterPanel = card.querySelector("[data-testid='tx-ledger-filter-panel']");
    const tableBody = card.querySelector(".transactions-surface-table tbody");
    const row = card.querySelector("tr.transaction-row");
    const cssText = Array.from(document.styleSheets).flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules || [])
          .map((rule) => rule.cssText || "")
          .filter((ruleText) =>
            ruleText.includes("transaction-list-card") ||
            ruleText.includes("transactions-surface-table") ||
            ruleText.includes("tx-ledger-filter-panel")
          );
      } catch {
        return [];
      }
    });
    const ledgerHeadHeight = Math.ceil(ledgerHead?.getBoundingClientRect().height || 0);
    const filterPanelHeight = Math.ceil(filterPanel?.getBoundingClientRect().height || 0);
    const ledgerHeadHeightVar = style.getPropertyValue("--surface-ledger-head-height").trim();
    const filterPanelHeightVar = style.getPropertyValue("--tx-ledger-filter-panel-height").trim();
    const bodyPaddingTop = getComputedStyle(tableBody).paddingTop;
    const rowScrollMarginTop = row ? getComputedStyle(row).scrollMarginTop : "";

    return {
      ledgerHeadHeight,
      filterPanelHeight,
      toolbarHeightVar: style.getPropertyValue("--transaction-toolbar-sticky-height").trim(),
      ledgerHeadHeightVar,
      filterPanelHeightVar,
      bodyPaddingTop,
      rowScrollMarginTop,
      bodyPaddingTopPx: readNumber(bodyPaddingTop),
      rowScrollMarginTopPx: readNumber(rowScrollMarginTop),
      fixedStickyHeightRules: cssText.filter((ruleText) => /10\.(25|75)rem/.test(ruleText)),
    };
  });

  expect(metrics.toolbarHeightVar, `toolbar height should be measured in px: ${JSON.stringify(metrics)}`).toMatch(/px$/);
  expect(metrics.ledgerHeadHeightVar, `ledger head height should be measured in px: ${JSON.stringify(metrics)}`).toMatch(/px$/);
  expect(metrics.filterPanelHeightVar, `filter panel height should be measured in px: ${JSON.stringify(metrics)}`).toMatch(/px$/);
  expect(
    Math.abs(Number.parseFloat(metrics.ledgerHeadHeightVar) - metrics.ledgerHeadHeight),
    `ledger head variable should match DOM height: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(Number.parseFloat(metrics.filterPanelHeightVar) - metrics.filterPanelHeight),
    `filter panel variable should match DOM height: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(2);
  expect(metrics.bodyPaddingTopPx, `filter panel should reserve measured table clearance: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(
    metrics.filterPanelHeight - 2,
  );
  expect(metrics.rowScrollMarginTopPx, `row scroll margin should include measured filter panel clearance: ${JSON.stringify(metrics)}`).toBeGreaterThan(
    metrics.filterPanelHeight,
  );
  expect(metrics.fixedStickyHeightRules, `sticky stack CSS should not depend on fixed 10.xrem fallbacks: ${JSON.stringify(metrics)}`).toEqual([]);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-249-mobile-sticky-measured-heights");
});

test("transactions flow: create, inline edit, delete, responsive", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("tx-user")}@example.com`;
  const displayName = unique("tx-name");
  const memo = unique("tx-memo");
  const editedMemo = `${memo}-edited`;

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  await capture(page, "transactions-entry");

  const createdRow = await createBasicTransaction(page, { memo, amount: "12000" });
  await expect(createdRow).toContainText(memo);
  await capture(page, "transactions-created");

  await clickTransactionSelectionToolbarAction(page, createdRow, "수정");
  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();

  const inlineEditorControlMetrics = await editorRow.evaluate((row) => {
    const readControl = (ariaLabel) => {
      const control = Array.from(row.querySelectorAll("input, select")).find(
        (element) => element.getAttribute("aria-label") === ariaLabel,
      );
      const rect = control?.getBoundingClientRect();
      return rect
        ? {
            width: rect.width,
            clientWidth: control.clientWidth,
            scrollWidth: control.scrollWidth,
          }
        : null;
    };

    return {
      categoryGroup: readControl("카테고리 그룹"),
      category: readControl("카테고리"),
      owner: readControl("거래자"),
    };
  });
  expect(inlineEditorControlMetrics.categoryGroup, "inline category group select should be measurable").not.toBeNull();
  expect(inlineEditorControlMetrics.category, "inline category select should be measurable").not.toBeNull();
  expect(inlineEditorControlMetrics.owner, "inline owner select should be measurable").not.toBeNull();
  expect(
    inlineEditorControlMetrics.categoryGroup?.width ?? 0,
    `inline category group select should not collapse: ${JSON.stringify(inlineEditorControlMetrics)}`,
  ).toBeGreaterThanOrEqual(120);
  expect(
    inlineEditorControlMetrics.category?.width ?? 0,
    `inline category select should not collapse: ${JSON.stringify(inlineEditorControlMetrics)}`,
  ).toBeGreaterThanOrEqual(120);
  expect(
    inlineEditorControlMetrics.owner?.width ?? 0,
    `inline owner select should stay readable: ${JSON.stringify(inlineEditorControlMetrics)}`,
  ).toBeGreaterThanOrEqual(140);

  await editorRow.getByLabel("메모").fill(editedMemo);
  await editorRow.getByLabel("금액").fill("54321");
  await editorRow.getByLabel("메모").press("Enter");
  const editedRow = page.locator("tr.transaction-row", { hasText: editedMemo }).first();
  const editedVisibleAfterEnter = await editedRow
    .waitFor({ state: "visible", timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  if (!editedVisibleAfterEnter) {
    const fallbackEditorRow = page.locator("tr.transaction-inline-editor-row").first();
    const editorStillVisible = await fallbackEditorRow.isVisible().catch(() => false);
    if (editorStillVisible) {
      await fallbackEditorRow.getByRole("button", { name: "저장" }).click();
    }
  }
  await expect(editedRow).toBeVisible();

  await clickTransactionSelectionToolbarAction(page, editedRow, "삭제");
  const confirmDialog = page.locator(".confirm-dialog");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByText("거래를 삭제했습니다.")).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: editedMemo })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);
  const transactionEmptyState = page.getByTestId("transactions-empty-state");
  await expect(transactionEmptyState).toBeVisible();
  await expect(transactionEmptyState).toContainText("거래 내역이 없습니다.");
  const transactionEmptyBorder = await transactionEmptyState.evaluate((element) => getComputedStyle(element).borderTopStyle);
  expect(transactionEmptyBorder).toBe("none");
  await assertResponsiveShell(page, 12);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "transactions-mobile");
});

test("transaction date controls use unambiguous ISO text fields", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-date-iso")}@example.com`;
  const displayName = unique("tx-date-iso-name");
  const memo = unique("tx-date-iso-memo");
  const occurredOn = currentE2EHistoryDateIso(-2);

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 768 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const desktopTransactionSheet = page.getByTestId("transaction-entry-sheet");
  const desktopTransactionAddAction = await expectDesktopTransactionAddActionReachable(page, "desktop transaction add action for ISO date entry");
  await desktopTransactionAddAction.click();
  await expect(desktopTransactionSheet).toBeVisible();
  const desktopEntryDetails = await openTransactionQuickDetails(desktopTransactionSheet, "추가 입력");
  const desktopEntryDate = labeledField(desktopEntryDetails, "일자", "input");
  await expectIsoDateInput(desktopEntryDate, "desktop transaction entry date");
  await desktopEntryDate.fill("20260502");
  await expect(desktopEntryDate).toHaveValue("2026-05-02");
  await page.getByTestId("transaction-entry-sheet-close").click();
  const closeDateDraftDialog = page.getByRole("alertdialog");
  await expect(closeDateDraftDialog.getByRole("heading", { name: "거래 입력을 닫을까요?" })).toBeVisible();
  await closeDateDraftDialog.getByRole("button", { name: "입력 닫기" }).click();
  await expect(desktopTransactionSheet).toBeHidden();

  const desktopFilterPanel = page.locator("#transaction-filter-panel");
  await page.getByTestId("transaction-sticky-toolbar").getByRole("button", { name: "필터 열기" }).click();
  await expect(desktopFilterPanel).toBeVisible();
  const desktopStartFilter = desktopFilterPanel.locator(".tx-header-filter", { hasText: "시작" }).locator("input").first();
  const desktopEndFilter = desktopFilterPanel.locator(".tx-header-filter", { hasText: "종료" }).locator("input").first();
  await expectIsoDateInput(desktopStartFilter, "desktop transaction start filter");
  await expectIsoDateInput(desktopEndFilter, "desktop transaction end filter");
  await desktopStartFilter.fill("20260501");
  await desktopEndFilter.fill("20260531");
  await expect(desktopStartFilter).toHaveValue("2026-05-01");
  await expect(desktopEndFilter).toHaveValue("2026-05-31");
  await capture(page, "transactions-date-iso-desktop");

  await createTransactionViaApi(page, {
    memo,
    amount: "33000",
    occurredOn,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const dateFilterTrigger = page
    .locator(".transactions-mobile-ledger-head")
    .first()
    .getByRole("button", { name: "일자 필터 열기" });
  await dateFilterTrigger.click();
  const mobileFilterPanel = page.getByTestId("tx-ledger-filter-panel");
  await expect(mobileFilterPanel).toContainText("일자 필터");
  await expectIsoDateInput(mobileFilterPanel.getByLabel("시작일"), "mobile transaction start filter");
  await expectIsoDateInput(mobileFilterPanel.getByLabel("종료일"), "mobile transaction end filter");
  await mobileFilterPanel.getByRole("button", { name: "필터 초기화" }).click();

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible();
  await selectTransactionRowForToolbar(page, mobileRow);
  await page.getByTestId("transaction-selection-edit").click();
  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();
  const inlineEditDate = editorRow.getByLabel("일자");
  await expectIsoDateInput(inlineEditDate, "mobile inline edit date", occurredOn);
  await inlineEditDate.fill("20260503");
  await expect(inlineEditDate).toHaveValue("2026-05-03");
  await capture(page, "transactions-date-iso-mobile-edit");
});

test("issue 219: mobile inline transaction date edit uses numeric ISO assistance", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-mobile-date-edit")}@example.com`;
  const displayName = unique("tx-mobile-date-edit-name");
  const memo = unique("tx-mobile-date-edit-memo");
  const occurredOn = currentE2EHistoryDateIso();

  await bootstrapVerifiedSession(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "21900",
    occurredOn,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible({ timeout: 20_000 });
  await selectTransactionRowForToolbar(page, mobileRow);
  await page.getByTestId("transaction-selection-edit").click();

  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();
  const inlineEditDate = editorRow.getByLabel("일자");
  await expectIsoDateInput(inlineEditDate, "issue 219 mobile inline edit date", occurredOn);
  const dateAttributes = await inlineEditDate.evaluate((input) => ({
    type: input.getAttribute("type"),
    inputMode: input.getAttribute("inputmode"),
    pattern: input.getAttribute("pattern"),
    maxLength: input.getAttribute("maxlength"),
    placeholder: input.getAttribute("placeholder"),
  }));
  expect(dateAttributes).toEqual({
    type: "text",
    inputMode: "numeric",
    pattern: "[0-9]{4}-[0-9]{2}-[0-9]{2}",
    maxLength: "10",
    placeholder: "YYYY-MM-DD",
  });
  await inlineEditDate.fill("20260301");
  await expect(inlineEditDate).toHaveValue("2026-03-01");
  await capture(page, "issue-219-mobile-inline-date-numeric-iso-assistance");
});

test("issue 230: narrow mobile transaction date filters keep ISO placeholders readable", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-mobile-date-filter-width")}@example.com`;
  const displayName = unique("tx-mobile-date-filter-width-name");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 320, height: 568 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  await page
    .locator(".transactions-mobile-ledger-head")
    .first()
    .getByRole("button", { name: "일자 필터 열기" })
    .click();

  const mobileFilterPanel = page.getByTestId("tx-ledger-filter-panel");
  await expect(mobileFilterPanel).toContainText("일자 필터");
  const startInput = mobileFilterPanel.getByLabel("시작일");
  const endInput = mobileFilterPanel.getByLabel("종료일");
  await expectIsoDateInput(startInput, "issue 230 narrow mobile start filter");
  await expectIsoDateInput(endInput, "issue 230 narrow mobile end filter");

  const metrics = await mobileFilterPanel.locator(".tx-ledger-filter-date-grid").evaluate((grid) => {
    const fields = Array.from(grid.querySelectorAll(".tx-ledger-filter-field"));
    const inputs = fields.map((field) => field.querySelector("input"));
    const inputMetrics = inputs.map((input) => {
      const style = window.getComputedStyle(input);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context) {
        context.font = style.font;
      }
      const placeholder = input.getAttribute("placeholder") || "";
      const placeholderWidth = context ? context.measureText(placeholder).width : placeholder.length * 9;
      const horizontalPadding = Number.parseFloat(style.paddingLeft || "0") + Number.parseFloat(style.paddingRight || "0");
      return {
        clientWidth: input.clientWidth,
        requiredWidth: Math.ceil(placeholderWidth + horizontalPadding + 2),
      };
    });
    const rects = fields.map((field) => field.getBoundingClientRect());

    return {
      columns: window.getComputedStyle(grid).gridTemplateColumns,
      startBottom: rects[0]?.bottom || 0,
      endTop: rects[1]?.top || 0,
      inputs: inputMetrics,
    };
  });
  expect(metrics.endTop, "end date filter should stack below start date filter at 320px").toBeGreaterThan(
    metrics.startBottom,
  );
  for (const input of metrics.inputs) {
    expect(input.clientWidth, "ISO placeholder should fit inside the narrow mobile date input").toBeGreaterThanOrEqual(
      input.requiredWidth,
    );
  }
  await capture(page, "issue-230-mobile-date-filter-placeholder-readable");
});

test("mobile transaction expanded row keeps details readable with filter panel open", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-expanded-filter")}@example.com`;
  const displayName = unique("tx-expanded-filter-name");
  const memo = unique("모바일가져오기테스트긴메모");
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("테스트긴대분류명"),
      minor: unique("모바일가져오기테스트긴분류명"),
    })
  );

  await createTransactionViaApi(page, {
    memo,
    amount: "43210",
    categoryId: category.id,
    ownerName: displayName,
    occurredOn: currentE2EHistoryDateIso(),
  });
  await page.reload();
  await page.setViewportSize({ width: 360, height: 740 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const mobileLedgerHead = page.locator(".transactions-mobile-ledger-head").first();
  await mobileLedgerHead.getByRole("button", { name: "유형 필터 열기" }).click();
  await expect(page.getByTestId("tx-ledger-filter-panel")).toBeVisible();

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible();
  await mobileRow.click({ position: { x: 92, y: 18 } });
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);

  const metrics = await mobileRow.evaluate((row) => {
    const rowBox = row.getBoundingClientRect();
    const detailRow = row.nextElementSibling?.classList.contains("transaction-mobile-expanded-detail-row")
      ? row.nextElementSibling
      : null;
    const actionRow = row.nextElementSibling?.classList.contains("transaction-mobile-expanded-actions-row")
      ? row.nextElementSibling
      : null;
    const detailRoot = detailRow || row;
    const detailBox = detailRow?.getBoundingClientRect() || null;
    const actionBox = actionRow?.getBoundingClientRect() || null;
    const detailCells = Array.from(detailRoot.querySelectorAll(".transaction-mobile-detail-cell")).map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        className: cell.className,
        width: box.width,
        clientHeight: cell.clientHeight,
        scrollHeight: cell.scrollHeight,
        hasVerticalOverflow: cell.scrollHeight > cell.clientHeight + 1,
      };
    });
    const categoryValue = detailRoot.querySelector(".transaction-expanded-detail-category .transaction-mobile-detail-value");
    const categoryText = detailRoot.querySelector(".transaction-expanded-detail-category .category-cell");
    return {
      rowWidth: detailBox?.width || rowBox.width,
      rowClientHeight: row.clientHeight,
      rowScrollHeight: row.scrollHeight,
      rowHasVerticalOverflow: row.scrollHeight > row.clientHeight + 1,
      detailRowCount: detailRow ? 1 : 0,
      detailStartsAfterRow: !detailBox || detailBox.top >= rowBox.bottom - 1,
      actionRowCount: actionRow ? 1 : 0,
      actionStartsAfterRow: !actionBox || actionBox.top >= rowBox.bottom - 1,
      detailCells,
      categoryValue: categoryValue
        ? {
            clientWidth: categoryValue.clientWidth,
            scrollWidth: categoryValue.scrollWidth,
          }
        : null,
      categoryText: categoryText
        ? {
            text: categoryText.textContent?.trim() || "",
            clientWidth: categoryText.clientWidth,
            scrollWidth: categoryText.scrollWidth,
            clientHeight: categoryText.clientHeight,
            scrollHeight: categoryText.scrollHeight,
          }
        : null,
      pageOverflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });

  expect(metrics.rowHasVerticalOverflow, `expanded row should not clip details: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.detailRowCount, `expanded details should render in a full-width sibling row: ${JSON.stringify(metrics)}`).toBe(1);
  expect(metrics.detailStartsAfterRow, `expanded details should start after the ledger row: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.actionStartsAfterRow, `expanded details should not overlap removed row actions: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.actionRowCount, `expanded row actions should be moved to the toolbar: ${JSON.stringify(metrics)}`).toBe(0);
  expect(metrics.detailCells.length).toBeGreaterThanOrEqual(3);
  for (const cell of metrics.detailCells) {
    expect(
      cell.width,
      `${cell.className} should span the mobile row instead of inheriting desktop column width: ${JSON.stringify(metrics)}`,
    ).toBeGreaterThanOrEqual(metrics.rowWidth * 0.78);
    expect(cell.hasVerticalOverflow, `${cell.className} should not clip detail text`).toBe(false);
  }
  expect(metrics.categoryValue?.clientWidth ?? 0, `category value should keep readable width: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(130);
  expect(metrics.categoryText?.scrollWidth ?? 0).toBeLessThanOrEqual((metrics.categoryText?.clientWidth ?? 0) + 1);
  expect(metrics.categoryText?.scrollHeight ?? 0).toBeLessThanOrEqual((metrics.categoryText?.clientHeight ?? 0) + 1);
  expect(metrics.pageOverflowX).toBe(0);
  await capture(page, "transactions-mobile-expanded-row-filter-open");
});

test("mobile transaction filter panel stays visible after list scroll", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-mobile-filter")}@example.com`;
  const displayName = unique("tx-mobile-filter-name");
  const memoPrefix = unique("tx-mobile-filter-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  for (let index = 0; index < 18; index += 1) {
    await createTransactionViaApi(page, {
      memo: `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(10000 + index * 1000),
      ownerName: displayName,
    });
  }

  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const scrolledRow = page.locator("tr.transaction-row", { hasText: `${memoPrefix}-14` }).first();
  await expect(scrolledRow).toBeVisible();
  await scrolledRow.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);

  const mobileLedgerHead = page.locator(".transactions-mobile-ledger-head").first();
  const memoFilterTrigger = mobileLedgerHead.getByRole("button", { name: "메모 필터 열기" });
  await expect(mobileLedgerHead).toBeVisible();
  await expect(memoFilterTrigger).toBeVisible();
  await memoFilterTrigger.click();

  const mobileFilterPanel = page.getByTestId("tx-ledger-filter-panel");
  const memoSearchInput = mobileFilterPanel.getByPlaceholder("메모 검색");
  await expect(mobileFilterPanel).toContainText("메모 필터");
  await expect(memoSearchInput).toBeVisible();

  const metrics = await memoSearchInput.evaluate((input) => {
    const panel = input.closest(".tx-ledger-filter-panel");
    const ledgerHead = document.querySelector(".transactions-mobile-ledger-head");
    const inputBox = input.getBoundingClientRect();
    const panelBox = panel?.getBoundingClientRect();
    const ledgerBox = ledgerHead?.getBoundingClientRect();
    return {
      inputTop: inputBox.top,
      inputBottom: inputBox.bottom,
      panelTop: panelBox?.top ?? Number.NEGATIVE_INFINITY,
      panelRight: panelBox?.right ?? Number.POSITIVE_INFINITY,
      ledgerBottom: ledgerBox?.bottom ?? 0,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
  expect(metrics.panelTop).toBeGreaterThanOrEqual(metrics.ledgerBottom - 2);
  expect(metrics.inputTop).toBeGreaterThanOrEqual(0);
  expect(metrics.inputBottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.panelRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  await memoSearchInput.fill(`${memoPrefix}-14`);
  await expect(scrolledRow).toBeVisible();
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "transactions-mobile-filter-panel-sticky");
});

test("transactions form keeps grouped number format", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-format")}@example.com`;
  const displayName = unique("tx-format-name");
  await bootstrapVerifiedSession(page, { email, displayName });

  await openTab(page, "거래");
  const transactionCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "거래 입력" }),
  });
  const desktopTransactionAddAction = page.getByTestId("transactions-desktop-add-action");
  const transactionFab = page.getByTestId("transactions-fab");
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  let transactionContainer = transactionCard;
  const txToggleButton = transactionCard.getByRole("button", { name: /거래 추가|입력 닫기/ }).first();
  const txToggleVisible = await txToggleButton.isVisible().catch(() => false);
  if (txToggleVisible) {
    const txToggleText = String((await txToggleButton.textContent()) || "");
    if (txToggleText.includes("거래 추가")) {
      await txToggleButton.click();
    }
  } else if (await desktopTransactionAddAction.isVisible().catch(() => false)) {
    await desktopTransactionAddAction.click();
    await expect(transactionSheet).toBeVisible();
    transactionContainer = transactionSheet;
  } else if (await transactionFab.isVisible().catch(() => false)) {
    await transactionFab.click();
    await expect(transactionSheet).toBeVisible();
    transactionContainer = transactionSheet;
  }
  const amountInput = labeledField(transactionContainer, "금액", "input");
  const memoInput = labeledField(transactionContainer, "메모", "input");
  await amountInput.fill("123456789");
  await expect(amountInput).toHaveValue("123,456,789");
  await memoInput.fill("빠른 메모 입력");
  await expect(amountInput).toHaveValue("123,456,789");
  await expect(memoInput).toHaveValue("빠른 메모 입력");
});

test("transactions form rejects decimal KRW amount before rounding can occur", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-decimal")}@example.com`;
  const displayName = unique("tx-decimal-name");
  const memo = unique("tx-decimal-memo");

  await bootstrapVerifiedSession(page, { email, displayName });

  await openTab(page, "거래");
  const transactionCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "거래 입력" }),
  });
  const desktopTransactionAddAction = page.getByTestId("transactions-desktop-add-action");
  const transactionFab = page.getByTestId("transactions-fab");
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  let transactionContainer = transactionCard;
  const txToggleButton = transactionCard.getByRole("button", { name: /거래 추가|입력 닫기/ }).first();
  const txToggleVisible = await txToggleButton.isVisible().catch(() => false);
  if (txToggleVisible) {
    const txToggleText = String((await txToggleButton.textContent()) || "");
    if (txToggleText.includes("거래 추가")) {
      await txToggleButton.click();
    }
  } else if (await desktopTransactionAddAction.isVisible().catch(() => false)) {
    await desktopTransactionAddAction.click();
    await expect(transactionSheet).toBeVisible();
    transactionContainer = transactionSheet;
  } else if (await transactionFab.isVisible().catch(() => false)) {
    await transactionFab.click();
    await expect(transactionSheet).toBeVisible();
    transactionContainer = transactionSheet;
  }

  const amountInput = labeledField(transactionContainer, "금액", "input");
  const memoInput = labeledField(transactionContainer, "메모", "input");
  await amountInput.click();
  await amountInput.fill("");
  await amountInput.pressSequentially("123.6");
  await expect(amountInput).toHaveValue("123.6");
  const amountError = transactionContainer.locator("#transaction-quick-amount-error");
  await expect(amountInput).toHaveAttribute("aria-invalid", "true");
  await expect(amountInput).toHaveAttribute("aria-describedby", "transaction-quick-amount-error");
  await expect(amountError).toHaveText("원화 금액은 소수 없이 정수로 입력해 주세요.");
  await expect(page.locator(".message", { hasText: "원화 금액은 소수 없이 정수로 입력해 주세요." })).toHaveCount(0);
  await memoInput.fill(memo);
  await transactionContainer.getByRole("button", { name: /저장|등록/ }).first().click();
  await expect(amountError).toHaveText("원화 금액은 소수 없이 정수로 입력해 주세요.");
  await expect(page.locator(".message", { hasText: "원화 금액은 소수 없이 정수로 입력해 주세요." })).toHaveCount(0);
  await expect(page.locator("tr.transaction-row", { hasText: memo })).toHaveCount(0);
  await capture(page, "transactions-form-decimal-rejected");
});

test("transactions inline edit rejects decimal KRW amount before rounding can occur", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-inline-decimal")}@example.com`;
  const displayName = unique("tx-inline-decimal-name");
  const memo = unique("tx-inline-decimal-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  const createdRow = await createBasicTransaction(page, { memo, amount: "12000" });
  await clickTransactionSelectionToolbarAction(page, createdRow, "수정");

  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();
  const amountInput = editorRow.getByLabel("금액");
  await expect(amountInput).toHaveAttribute("inputmode", "numeric");
  await amountInput.click();
  await amountInput.fill("");
  await amountInput.pressSequentially("123.6");
  await expect(amountInput).toHaveValue("123.6");

  const appMessage = page.locator(".message").first();
  await expect(appMessage).toContainText("원화 금액은 소수 없이 정수로 입력해 주세요.");
  await editorRow.getByRole("button", { name: "저장" }).click();
  await expect(appMessage).toContainText("원화 금액은 소수 없이 정수로 입력해 주세요.");
  await expect(page.locator("tr.transaction-row", { hasText: "124원" })).toHaveCount(0);
  await capture(page, "transactions-inline-decimal-rejected");
});

test("transactions default ledger stays monthly without continuous-history chrome", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-monthly-default")}@example.com`;
  const displayName = unique("tx-monthly-default-name");
  const previousDate = currentE2EHistoryDateIso(-45);
  const currentDate = currentE2EHistoryDateIso();
  const previousMemo = unique("tx-monthly-default-previous");
  const currentMemo = unique("tx-monthly-default-current");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });

  await createTransactionViaApi(page, { memo: previousMemo, amount: "10101", occurredOn: previousDate, ownerName: displayName });
  await createTransactionViaApi(page, { memo: currentMemo, amount: "30303", occurredOn: currentDate, ownerName: displayName });
  await page.reload();

  await openTab(page, "거래");
  await expect(page.locator("tr.transaction-row", { hasText: currentMemo })).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: previousMemo })).toHaveCount(0);
  await expect(page.locator(".transactions-desktop-ledger-head .sort-header-static")).toHaveCount(0);
  await expect(page.locator(".transactions-desktop-ledger-head button.sort-header").first()).toBeVisible();
  await expect(page.locator(".transaction-history-date-row")).toHaveCount(0);
  await expect(page.locator(".transaction-history-sentinel")).toHaveCount(0);
  await expect(page.getByText("연속 내역순", { exact: false })).toHaveCount(0);
  await expectTransactionMonthControls(page, currentDate, "default current month ledger");

  await jumpTransactionListToMonth(page, previousDate);
  await expect(page.locator("tr.transaction-row", { hasText: previousMemo }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("tr.transaction-row", { hasText: currentMemo })).toHaveCount(0);
  await expectTransactionMonthControls(page, previousDate, "previous month ledger");
  await capture(page, "transactions-default-monthly-ledger");
});

test("issue 287: Android PWA transaction ledger uses monthly dense rows", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-android-ledger")}@example.com`;
  const displayName = unique("tx-android-owner");
  const currentMemo = unique("tx-android-current-memo");
  const previousMemo = unique("tx-android-previous-memo");
  const ownerlessMemo = unique("tx-android-ownerless-memo");
  const currentDate = currentE2EHistoryDateIso();
  const previousDate = currentE2EHistoryDateIso(-45);
  const category = await bootstrapVerifiedSession(page, { email, displayName }).then(() =>
    createCategoryViaApi(page, {
      major: unique("안드로이드원장"),
      minor: unique("고밀도"),
    })
  );

  await createTransactionViaApi(page, {
    memo: currentMemo,
    amount: "28700",
    categoryId: category.id,
    ownerName: displayName,
    occurredOn: currentDate,
  });
  await createTransactionViaApi(page, {
    memo: ownerlessMemo,
    amount: "28701",
    categoryId: category.id,
    ownerName: "",
    occurredOn: currentDate,
  });
  await createTransactionViaApi(page, {
    memo: previousMemo,
    amount: "28702",
    categoryId: category.id,
    ownerName: displayName,
    occurredOn: previousDate,
  });

  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  const mobileRow = page.locator("tr.transaction-row", { hasText: currentMemo }).first();
  await expect(mobileRow).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("tr.transaction-row", { hasText: previousMemo })).toHaveCount(0);
  await expect(page.locator(".transaction-history-date-row")).toHaveCount(0);
  await expect(page.locator(".transaction-history-sentinel")).toHaveCount(0);
  await expect(page.getByText("연속 내역순", { exact: false })).toHaveCount(0);
  await expect(page.locator(".transaction-row .transaction-col-actions button")).toHaveCount(0);
  await expect(page.locator(".transaction-row").getByRole("checkbox")).toHaveCount(0);
  await expect(mobileRow).toHaveAttribute("aria-keyshortcuts", /Space/);

  const metrics = await mobileRow.evaluate((row) => {
    const read = (selector) => {
      const element = row.querySelector(selector);
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        text: element.textContent?.replace(/\s+/g, " ").trim() || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        left: box.left,
        center: box.left + box.width / 2,
        top: box.top,
        height: box.height,
        hidden: style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0,
      };
    };
    const head = document.querySelector(".transactions-mobile-ledger-head");
    const headRead = (selector) => {
      const element = head?.querySelector(selector);
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      return {
        text: element.textContent?.replace(/\s+/g, " ").trim() || "",
        left: box.left,
        center: box.left + box.width / 2,
      };
    };
    const rowBox = row.getBoundingClientRect();
    const fields = {
      date: read(".transaction-col-date"),
      type: read(".transaction-col-type"),
      owner: read(".transaction-col-owner .transaction-owner-compact"),
      category: read(".transaction-col-category .transaction-mobile-category-cue"),
      memo: read(".transaction-col-memo .transaction-memo-text"),
      amount: read(".transaction-col-amount .transaction-amount-text"),
    };
    const headFields = {
      date: headRead(".ledger-head-date"),
      type: headRead(".ledger-head-cues"),
      owner: headRead(".ledger-head-owner"),
      category: headRead(".ledger-head-category"),
      memo: headRead(".ledger-head-main"),
      amount: headRead(".ledger-head-amount"),
    };
    return {
      row: {
        height: rowBox.height,
        expanded: row.getAttribute("data-row-expanded"),
        selected: row.getAttribute("data-row-selected"),
      },
      fields,
      headFields,
      alignment: {
        date: Math.abs((headFields.date?.left ?? 0) - (fields.date?.left ?? 0)),
        type: Math.abs((headFields.type?.center ?? 0) - (fields.type?.center ?? 0)),
        owner: Math.abs((headFields.owner?.center ?? 0) - (fields.owner?.center ?? 0)),
        category: Math.abs((headFields.category?.left ?? 0) - (fields.category?.left ?? 0)),
        memo: Math.abs((headFields.memo?.left ?? 0) - (fields.memo?.left ?? 0)),
        amount: Math.abs((headFields.amount?.left ?? 0) - (fields.amount?.left ?? 0)),
      },
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.row.expanded, `Android ledger row should start collapsed: ${JSON.stringify(metrics)}`).toBe("false");
  expect(metrics.row.selected, `Android ledger row should start unselected: ${JSON.stringify(metrics)}`).toBe("false");
  expect(metrics.row.height, `Android ledger row should stay dense: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(48);
  for (const [key, value] of Object.entries(metrics.fields)) {
    expect(value?.hidden, `${key} field should be visible in the collapsed row: ${JSON.stringify(metrics)}`).toBe(false);
  }
  for (const [key, delta] of Object.entries(metrics.alignment)) {
    expect(delta, `${key} header should align with the row field: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(8);
  }
  expect(metrics.fields.owner?.text, `owner should use a compact first-letter cue: ${JSON.stringify(metrics)}`).toBe(
    Array.from(displayName.trim()).slice(0, 1).join("")
  );
  expect(metrics.fields.owner?.ariaLabel || "", `owner cue should preserve the full accessible name: ${JSON.stringify(metrics)}`).toContain(
    displayName
  );
  expect(metrics.fields.category?.text || "", `category should have its own column: ${JSON.stringify(metrics)}`).toContain(
    category.minor.slice(0, 4)
  );
  expect(metrics.pageOverflowX, `Android ledger should not overflow horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);

  const ownerlessRow = page.locator("tr.transaction-row", { hasText: ownerlessMemo }).first();
  await expect(ownerlessRow.locator(".transaction-owner-compact-empty")).toHaveText("-");
  await mobileRow.focus();
  await expect(mobileRow).toBeFocused();
  await page.keyboard.press("Space");
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);
  await expect(mobileRow).toHaveAttribute("data-row-selected", "false");
  await page.keyboard.press("Space");
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await page.keyboard.press("Shift+Space");
  await expect(mobileRow).toHaveAttribute("data-row-selected", "true");
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await expectTransactionSelectionSummary(page, 1);
  await page.keyboard.press("Shift+Space");
  await expect(mobileRow).toHaveAttribute("data-row-selected", "false");
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await mobileRow.click({ position: { x: 88, y: 22 } });
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);
  await expect(mobileRow).toHaveAttribute("data-row-selected", "false");
  await mobileRow.click({ position: { x: 88, y: 22 } });
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await releaseTouchPointerOutsideRowBeforeLongPress(page, mobileRow);
  await expect(mobileRow).toHaveAttribute("data-row-selected", "false");
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await longPressTransactionRow(page, mobileRow);
  await expect(mobileRow).toHaveAttribute("data-row-selected", "true");
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await expectTransactionSelectionSummary(page, 1);
  await clearTransactionSelection(page);
  await longPressDragTransactionRows(page, mobileRow, ownerlessRow);
  await expect(mobileRow).toHaveAttribute("data-row-selected", "true");
  await expect(ownerlessRow).toHaveAttribute("data-row-selected", "true");
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await expect(ownerlessRow).not.toHaveClass(/mobile-row-expanded/);
  await expectTransactionSelectionSummary(page, 2);
  await clearTransactionSelection(page);

  await jumpTransactionListToMonth(page, previousDate);
  await expect(page.locator("tr.transaction-row", { hasText: previousMemo }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("tr.transaction-row", { hasText: currentMemo })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-287-android-monthly-dense-ledger");
});

test("issue 287: monthly transaction ledger loads every paged row", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-monthly-paged")}@example.com`;
  const displayName = unique("tx-monthly-paged-name");
  const currentDate = currentE2EHistoryDateIso();
  const targetYearMonth = yearMonthFromIso(currentDate);
  const pagedMemoPrefix = unique("tx-paged-ledger");
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    id: `tx-paged-${index + 1}`,
    occurred_on: currentDate,
    flow_type: "expense",
    amount: 1000 + index,
    currency: "KRW",
    memo: `${pagedMemoPrefix}-${String(index + 1).padStart(4, "0")}`,
    category_id: null,
    owner_user_id: null,
    owner_name: displayName,
    source_ref: null,
    order_key: (index + 1) * 1024,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  }));
  const transactionRequests = [];

  await page.route("**/api/v1/transactions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isTargetMonth =
      request.method() === "GET" &&
      url.pathname.endsWith("/api/v1/transactions") &&
      url.searchParams.get("year") === String(targetYearMonth.year) &&
      url.searchParams.get("month") === String(targetYearMonth.month);
    if (!isTargetMonth) {
      await route.fallback();
      return;
    }
    const limit = Number(url.searchParams.get("limit") || "500");
    const offset = Number(url.searchParams.get("offset") || "0");
    transactionRequests.push({ limit, offset });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows.slice(offset, offset + limit)),
    });
  });

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  const firstPagedRow = page.locator("tr.transaction-row", { hasText: `${pagedMemoPrefix}-0001` });
  const latestPagedRow = page.locator("tr.transaction-row", { hasText: `${pagedMemoPrefix}-1001` });
  await expect(firstPagedRow).toHaveCount(1);
  await expect(latestPagedRow).toHaveCount(1);
  await expect(page.locator("tr.transaction-row")).toHaveCount(1001);
  await expect.poll(
    async () =>
      latestPagedRow.evaluate((row) => {
        const box = row.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
      }),
    { message: "monthly ledger should open anchored to the latest rendered row" }
  ).toBe(true);
  await expect(
    firstPagedRow,
    "oldest row should not remain the initial viewport anchor when the latest row is available"
  ).not.toBeInViewport({ ratio: 0.1 });
  expect(transactionRequests, "monthly ledger should request the first page").toContainEqual({ limit: 1000, offset: 0 });
  expect(transactionRequests, "monthly ledger should request the second page").toContainEqual({ limit: 1000, offset: 1000 });
  expect(
    transactionRequests.some((request) => request.offset >= 2000),
    `monthly ledger should stop after the short second page: ${JSON.stringify(transactionRequests)}`
  ).toBe(false);
  await expect(page.locator(".transaction-history-date-row")).toHaveCount(0);
  await expect(page.locator(".transaction-history-sentinel")).toHaveCount(0);
  await capture(page, "issue-287-monthly-paged-ledger");
});

test("issue 287: stale monthly transaction refresh cannot replace the active month", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-stale-month")}@example.com`;
  const displayName = unique("tx-stale-month-name");
  const currentDate = currentE2EHistoryDateIso();
  const previousDate = currentE2EHistoryDateIso(-35);
  const currentYearMonth = yearMonthFromIso(currentDate);
  const previousYearMonth = yearMonthFromIso(previousDate);
  const currentMemo = unique("tx-stale-current");
  const previousMemo = unique("tx-stale-previous");
  const rowFor = (id, occurredOn, memo) => ({
    id,
    occurred_on: occurredOn,
    flow_type: "expense",
    amount: 12000,
    currency: "KRW",
    memo,
    category_id: null,
    owner_user_id: null,
    owner_name: displayName,
    source_ref: null,
    order_key: 1024,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  });
  let releasePreviousMonth;
  const previousMonthCanResolve = new Promise((resolve) => {
    releasePreviousMonth = resolve;
  });
  const transactionRequests = [];

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);

  await page.route("**/api/v1/transactions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || !url.pathname.endsWith("/api/v1/transactions")) {
      await route.fallback();
      return;
    }
    const year = url.searchParams.get("year");
    const month = url.searchParams.get("month");
    if (year === String(previousYearMonth.year) && month === String(previousYearMonth.month)) {
      transactionRequests.push("previous");
      await previousMonthCanResolve;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([rowFor("tx-stale-previous", previousDate, previousMemo)]),
      });
      return;
    }
    if (year === String(currentYearMonth.year) && month === String(currentYearMonth.month)) {
      transactionRequests.push("current");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([rowFor("tx-stale-current", currentDate, currentMemo)]),
      });
      return;
    }
    await route.fallback();
  });

  await jumpTransactionListToMonth(page, previousDate);
  await expect.poll(() => transactionRequests.includes("previous")).toBe(true);
  await jumpTransactionListToMonth(page, currentDate);
  await expect(page.locator("tr.transaction-row", { hasText: currentMemo }).first()).toBeVisible({ timeout: 20_000 });
  releasePreviousMonth();
  await page.waitForTimeout(600);
  await expect(page.locator("tr.transaction-row", { hasText: currentMemo }).first()).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: previousMemo })).toHaveCount(0);
  expect(transactionRequests, "test should exercise previous then active current month").toEqual(
    expect.arrayContaining(["previous", "current"])
  );
  await capture(page, "issue-287-stale-month-refresh-guard");
});

test("transactions list affordance: top filters, compact ledger, ownerless marker", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("tx-affordance")}@example.com`;
  const displayName = unique("tx-affordance-name");
  const memo = unique("tx-affordance-memo");
  const incomeMemo = unique("tx-income-memo");
  const investmentMemo = unique("tx-investment-memo");
  const ownerlessMemo = unique("tx-ownerless-memo");

  await bootstrapVerifiedSession(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await openTab(page, "거래");
  await expect(page.locator(".transactions-mobile-ledger-head").first()).toBeHidden();
  await expect(page.locator(".tx-header-filters").first()).toBeHidden();
  await page.getByTestId("transaction-sticky-toolbar").getByRole("button", { name: "필터 열기" }).click();
  await expect(page.locator(".tx-header-filters").first()).toBeVisible();
  await page.getByTestId("transaction-sticky-toolbar").getByRole("button", { name: "필터 닫기" }).click();
  await expect(page.locator(".tx-header-filters").first()).toBeHidden();

  await expect(page.locator(".transaction-entry-card")).toHaveCount(0);
  const desktopTransactionSheet = page.getByTestId("transaction-entry-sheet");
  const desktopTransactionAddAction = await expectDesktopTransactionAddActionReachable(page, "desktop transaction add action in list affordance flow");
  await desktopTransactionAddAction.click();
  await expect(desktopTransactionSheet).toBeVisible();
  await expect(labeledField(desktopTransactionSheet, "금액", "input")).toBeVisible();
  await page.getByTestId("transaction-entry-sheet-close").click();
  await expect(desktopTransactionSheet).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") || "")).toBe("transactions-desktop-add-action");

  const createdRow = await createBasicTransaction(page, { memo, amount: "22222" });
  await expect(createdRow).toBeVisible();
  const incomeRow = await createBasicTransaction(page, { memo: incomeMemo, amount: "33333", flowType: "income" });
  await expect(incomeRow).toBeVisible();
  const investmentRow = await createBasicTransaction(page, { memo: investmentMemo, amount: "44444", flowType: "investment" });
  await expect(investmentRow).toBeVisible();

  const ownerlessRow = await createBasicTransaction(page, { memo: ownerlessMemo, amount: "11111", ownerless: true });
  await expect(ownerlessRow).toBeVisible();
  await expect(ownerlessRow.locator(".transaction-col-type .transaction-owner-empty")).toBeHidden();
  await expect(ownerlessRow.locator(".transaction-col-owner .transaction-owner-compact-empty")).toHaveText("-");
  const extraMemos = [];
  const extraFlowTypes = ["expense", "income", "investment"];
  for (let index = 0; index < 9; index += 1) {
    const extraMemo = unique(`tx-sticky-${index}`);
    extraMemos.push(extraMemo);
    const extraRow = await createBasicTransaction(page, {
      memo: extraMemo,
      amount: String(10000 + index * 1111),
      flowType: extraFlowTypes[index % extraFlowTypes.length],
    });
    await expect(extraRow).toBeVisible();
  }

  await expectDesktopTransactionColumnHeaderLabels(page, "transactions list affordance column header");
  const headerTexts = await page.locator(".transactions-desktop-ledger-head .desktop-ledger-head-cell").evaluateAll((nodes) =>
    nodes.map((node) => String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim())
  );
  const findHeaderIndex = (label) => headerTexts.findIndex((text) => text.includes(label));
  expect(findHeaderIndex("일자")).toBeGreaterThanOrEqual(0);
  expect(findHeaderIndex("유형")).toBeGreaterThan(findHeaderIndex("일자"));
  expect(findHeaderIndex("카테고리")).toBeGreaterThan(findHeaderIndex("유형"));
  expect(findHeaderIndex("메모")).toBeGreaterThan(findHeaderIndex("카테고리"));
  expect(findHeaderIndex("금액")).toBeGreaterThan(findHeaderIndex("메모"));

  await expect(page.locator(".transactions-desktop-ledger-head .sort-header-static")).toHaveCount(0);
  await expect(page.locator(".transactions-desktop-ledger-head button.sort-header").first()).toBeVisible();
  await expect(page.getByText("연속 내역순", { exact: false })).toHaveCount(0);
  await expectDesktopTransactionRowsSingleLine(page);

  await selectTransactionRowForToolbar(page, createdRow);
  await expectTransactionSelectionSummary(page, 1, "22,222원");
  await clearTransactionSelection(page);
  await expect(createdRow).toHaveAttribute("data-row-selected", "false");

  const supportDetails = page.locator("details.compact-support-card").first();
  const supportCard =
    (await supportDetails.count()) > 0
      ? supportDetails
      : page.locator("article.card", { has: page.getByRole("heading", { name: "거래 지원 카드" }) });
  const hasSupportCard = ((await supportDetails.count()) > 0) || ((await supportCard.count()) > 0);
  if ((await supportDetails.count()) > 0) {
    const supportSummary = supportDetails.locator("summary");
    await expect(supportSummary).toContainText("분석·관리 열기");
    await supportSummary.click();
    await expect(supportDetails).toHaveAttribute("open", "");
    await expect(supportSummary).toContainText("분석·관리 접기");
  }

  if (hasSupportCard) {
    await expect(supportCard).toContainText("포트폴리오와 자산 요약은 자산 탭으로 이동했습니다.");
    await expect(supportCard.getByLabel("포트폴리오 보기 기준")).toHaveCount(0);
    await expect(supportCard.getByLabel("자산 요약 보기 기준")).toHaveCount(0);

    const breakdownCard = supportCard.locator(".compact-support-section", {
      has: page.getByRole("heading", { name: "유형별 카테고리 집계" }),
    });
    if ((await breakdownCard.count()) > 0) {
      const breakdownToggle = breakdownCard.locator("button[aria-expanded]").first();
      await expect(breakdownToggle).toHaveAttribute("aria-expanded", "false");
      await breakdownToggle.click();
      await expect(breakdownToggle).toHaveAttribute("aria-expanded", "true");
    }

    const txCategoryManagerCard = supportCard.locator(".compact-support-section", {
      has: page.getByRole("heading", { name: "거래 탭 카테고리 관리" }),
    });
    if ((await txCategoryManagerCard.count()) > 0) {
      await expect(txCategoryManagerCard).toBeVisible();
      const txCategoryToggle = txCategoryManagerCard.getByRole("button", { name: /열기|닫기/ }).first();
      const txCategoryToggleText = String((await txCategoryToggle.textContent()) || "");
      if (txCategoryToggleText.includes("열기")) {
        await txCategoryToggle.click();
      }
      await expect(labeledField(txCategoryManagerCard, "새 대분류", "select")).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await waitForTransactionAppShell(page);
  const mobileSupportSummary = page.locator("details.transaction-support-card > summary").first();
  await expect(mobileSupportSummary).toContainText("분석·관리");
  const mobileSupportSummaryMetrics = await mobileSupportSummary.evaluate((summary) => {
    const box = summary.getBoundingClientRect();
    return {
      text: summary.textContent?.trim() || "",
      width: box.width,
      height: box.height,
      clientWidth: summary.clientWidth,
      scrollWidth: summary.scrollWidth,
    };
  });
  expect(mobileSupportSummaryMetrics.height).toBeGreaterThanOrEqual(44);
  expect(
    mobileSupportSummaryMetrics.scrollWidth - mobileSupportSummaryMetrics.clientWidth,
    `transaction support summary should keep a readable mobile hit area: ${JSON.stringify(mobileSupportSummaryMetrics)}`
  ).toBeLessThanOrEqual(1);
  const routeBeforeMobileSheet = page.url();
  const activeTabBeforeMobileSheet = await page.locator("nav.tabs button.active").first().innerText();
  const transactionFab = page.getByTestId("transactions-fab");
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  const transactionSheetClose = page.getByTestId("transaction-entry-sheet-close");
  const transactionEntryCard = page.locator(".transaction-entry-card").first();
  const transactionTopActionButton = page.locator(".transaction-entry-card").getByRole("button", { name: /거래 추가|카테고리 관리/ }).first();
  const transactionListCard = page.locator(".transaction-list-card").first();
  await expect(transactionEntryCard).toBeHidden();
  await expect(transactionTopActionButton).toBeHidden();
  await expect(transactionFab).toBeVisible();
  const fabInitialBox = await transactionFab.boundingBox();
  const listCardBox = await transactionListCard.boundingBox();
  expect(fabInitialBox, "transaction FAB should have a bounding box").not.toBeNull();
  expect(listCardBox, "transaction list card should have a bounding box").not.toBeNull();
  expect(fabInitialBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(844);
  const mobileHeaderFilters = page.locator(".tx-header-filters").first();
  await expect(page.locator(".tx-filter-details")).toHaveCount(0);
  await expect(mobileHeaderFilters).toBeHidden();
  await stabilizeTransactionLedgerAtPageTop(page);
  await expect(page.locator(".transactions-mobile-ledger-head")).toHaveAttribute("data-sticky-active", "false");
  await expect(page.locator(".transactions-mobile-ledger-head")).toBeVisible();
  const mobileLedgerHead = page.locator(".transactions-mobile-ledger-head").first();
  const dateFilterTrigger = mobileLedgerHead.getByRole("button", { name: "일자 필터 열기" });
  const memoFilterTrigger = mobileLedgerHead.getByRole("button", { name: "메모 필터 열기" });
  const amountFilterTrigger = mobileLedgerHead.getByRole("button", { name: "금액 필터 열기" });
  const typeFilterTrigger = mobileLedgerHead.getByRole("button", { name: "유형 필터 열기" });
  await expect(dateFilterTrigger).toBeVisible();
  await expect(memoFilterTrigger).toBeVisible();
  await expect(amountFilterTrigger).toBeVisible();
  await expect(typeFilterTrigger).toBeVisible();
  await expect(dateFilterTrigger).toHaveText("일자");
  await expectMobileTransactionFilterTriggersSeparated(page, "390px transaction ledger head");
  for (const profile of [
    { label: "320px transaction ledger head", width: 320, height: 568 },
    { label: "412px transaction ledger head", width: 412, height: 915 },
  ]) {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await expectMobileTransactionFilterTriggersSeparated(page, profile.label);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTopbarBox = await page.locator("header.topbar").boundingBox();
  const transactionStickyToolbar = page.getByTestId("transaction-sticky-toolbar");
  const transactionToolbarBox = await transactionStickyToolbar.boundingBox();
  const transactionHeadingBox = await transactionStickyToolbar.locator(".surface-list-heading").first().boundingBox();
  const transactionControlStripBox = await transactionStickyToolbar.locator(".surface-control-strip").first().boundingBox();
  const transactionHeaderGroupBox = await transactionStickyToolbar.locator(".table-header-group").first().boundingBox();
  const transactionLedgerBox = await page.locator(".transactions-mobile-ledger-head").boundingBox();
  const transactionTableBox = await page.locator(".transactions-surface-table").boundingBox();
  expect(mobileTopbarBox, "mobile topbar should have a bounding box").not.toBeNull();
  expect(transactionToolbarBox, "transaction sticky toolbar should have a bounding box").not.toBeNull();
  expect(transactionHeadingBox, "transaction heading should have a bounding box").not.toBeNull();
  expect(transactionHeaderGroupBox, "transaction header group should have a bounding box").not.toBeNull();
  expect(transactionLedgerBox, "transaction ledger head should have a bounding box").not.toBeNull();
  expect(transactionTableBox, "transaction table should have a bounding box").not.toBeNull();
  expect(
    transactionControlStripBox?.height ?? 0,
    "inactive transaction control strip should not consume vertical space",
  ).toBeLessThanOrEqual(2);
  expect(mobileTopbarBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(88);
  expect(transactionToolbarBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    (mobileTopbarBox?.y ?? 0) + (mobileTopbarBox?.height ?? 0) + 112,
  );
  expect(transactionHeadingBox?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual((transactionToolbarBox?.y ?? 0) - 2);
  expect(transactionHeaderGroupBox?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual((transactionHeadingBox?.y ?? 0) - 8);
  expect(transactionHeaderGroupBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(transactionLedgerBox?.y ?? 0);
  expect(transactionToolbarBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(220);
  expect(transactionLedgerBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(transactionTableBox?.y ?? 0);
  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible();
  const mobileRowBox = await mobileRow.boundingBox();
  expect(mobileRowBox, "mobile transaction row should have a bounding box").not.toBeNull();
  expect((transactionLedgerBox?.y ?? Number.POSITIVE_INFINITY)).toBeLessThan((mobileRowBox?.y ?? 0));
  await typeFilterTrigger.click();
  const mobileFilterPanel = page.getByTestId("tx-ledger-filter-panel");
  await expect(mobileFilterPanel).toBeVisible();
  await expect(mobileFilterPanel).toContainText("유형 필터");
  await mobileFilterPanel.getByLabel("유형").selectOption("income");
  await expect(page.locator("tr.transaction-row", { hasText: incomeMemo })).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: investmentMemo })).toHaveCount(0);
  await memoFilterTrigger.click();
  await expect(mobileFilterPanel).toContainText("메모 필터");
  await mobileFilterPanel.getByPlaceholder("메모 검색").fill(incomeMemo);
  await expect(page.locator("tr.transaction-row", { hasText: incomeMemo })).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: memo })).toHaveCount(0);
  await dateFilterTrigger.click();
  await expect(mobileFilterPanel).toContainText("일자 필터");
  await expect(mobileFilterPanel.getByLabel("시작일")).toBeVisible();
  await expect(mobileFilterPanel.getByLabel("종료일")).toBeVisible();
  await mobileFilterPanel.getByRole("button", { name: "필터 초기화" }).click();
  await expect(mobileFilterPanel).toBeHidden();
  await expect(mobileRow).toBeVisible();
  await amountFilterTrigger.click();
  await expect(mobileFilterPanel).toContainText("금액 필터");
  await mobileFilterPanel.getByLabel("최소 금액").fill("44000");
  await mobileFilterPanel.getByLabel("최대 금액").fill("45000");
  await expect(page.locator("tr.transaction-row", { hasText: investmentMemo })).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: incomeMemo })).toHaveCount(0);
  await expect(page.locator("tr.transaction-row", { hasText: memo })).toHaveCount(0);
  await mobileFilterPanel.getByRole("button", { name: "필터 초기화" }).click();
  await expect(mobileFilterPanel).toBeHidden();
  await expect(mobileRow).toBeVisible();
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await expect(mobileRow.locator(".transaction-memo-text").first()).toHaveAttribute("aria-label", `메모 ${memo}`);
  await expect(mobileRow.locator(".transaction-memo-text-full").first()).toBeHidden();
  await expect(mobileRow.locator(".transaction-memo-text-compact").first()).toBeVisible();
  await expectCompactLedgerRow(mobileRow, 96);
  await expectSingleLineText(mobileRow.locator(".transaction-memo-text").first());
  await expect(mobileRow.locator(".transaction-mobile-category-cue").first()).toBeVisible();
  const collapsedRowMetrics = await page.locator("tr.transaction-row").evaluateAll((rows) =>
    rows.slice(0, 8).map((row) => {
      const box = row.getBoundingClientRect();
      return { height: box.height, expanded: row.getAttribute("data-row-expanded") };
    })
  );
  expect(
    collapsedRowMetrics.every((row) => row.expanded !== "true" && row.height <= 96),
    `mobile ledger rows should stay compact while showing key ledger details: ${JSON.stringify(collapsedRowMetrics)}`
  ).toBe(true);
  await expectBackgroundNotPlainWhite(mobileRow);
  await expectTransparentBackground(mobileRow.locator(".transaction-col-memo").first());
  const mobileOwnerCompact = mobileRow.locator(".transaction-owner-compact").first();
  await expect(mobileOwnerCompact).toHaveText(Array.from(displayName.trim()).slice(0, 1).join(""));
  await expect(mobileOwnerCompact).toBeVisible();
  await expect(mobileOwnerCompact).toHaveAttribute("aria-label", new RegExp(displayName));
  await expect(mobileRow.locator(".transaction-col-owner .transaction-mobile-detail-value").first()).toBeHidden();
  await expect(mobileRow.locator(".transaction-flow-short").first()).toBeVisible();
  const mobileOwnerlessRow = page.locator("tr.transaction-row", { hasText: ownerlessMemo }).first();
  await expect(mobileOwnerlessRow).toBeVisible();
  await expect(mobileOwnerlessRow.locator(".transaction-owner-compact-empty").first()).toHaveText("-");
  await expect(mobileOwnerlessRow.locator(".transaction-owner-compact")).toHaveCount(1);
  await expect(mobileRow.locator(".transaction-col-actions button")).toHaveCount(0);
  const expectMobileRowSelectsWithoutExpanding = async (viewport, label) => {
    await page.setViewportSize(viewport);
    await mobileRow.scrollIntoViewIfNeeded();
    await expect(mobileRow, `${label} target row should remain visible`).toBeVisible();
    await mobileRow.click({ position: { x: 88, y: 22 } });
    await expect(mobileRow, `${label} row tap should expand details`).toHaveClass(/mobile-row-expanded/);
    await expect(mobileRow, `${label} row tap should not select`).toHaveAttribute("data-row-selected", "false");
    await mobileRow.click({ position: { x: 88, y: 22 } });
    await expect(mobileRow, `${label} second row tap should collapse details`).not.toHaveClass(/mobile-row-expanded/);
    await longPressTransactionRow(page, mobileRow);
    await expect(mobileRow, `${label} long press should select`).toHaveAttribute("data-row-selected", "true");
    await expect(mobileRow, `${label} long press should not expand`).not.toHaveClass(/mobile-row-expanded/);
    await expectTransactionSelectionSummary(page, 1);
    await clearTransactionSelection(page);
    await expect(mobileRow, `${label} toolbar clear should deselect`).toHaveAttribute("data-row-selected", "false");
    await expectTransactionSelectionSummary(page, 0);
  };
  await expectMobileRowSelectsWithoutExpanding({ width: 880, height: 500 }, "880px landscape transaction ledger");
  await expectMobileRowSelectsWithoutExpanding({ width: 390, height: 844 }, "390px transaction ledger");
  await capture(page, "transactions-mobile-summary");
  const toastMessage = page.locator(".message").first();
  if ((await toastMessage.count()) > 0) {
    const toastClose = toastMessage.locator(".message-close");
    if ((await toastClose.count()) > 0) {
      await toastClose.click();
    }
  }
  await expect(page.locator(".message")).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 380));
  await page.waitForTimeout(250);
  const transactionScrollTop = page.getByTestId("transactions-scroll-top");
  await expect(transactionScrollTop).toBeVisible();
  await expect(transactionScrollTop).toHaveAccessibleName("거래 목록 맨 위로 이동");
  const scrollTopGeometry = await page.evaluate(() => {
    const scrollTop = document.querySelector('[data-testid="transactions-scroll-top"]');
    const fab = document.querySelector('[data-testid="transactions-fab"]');
    const nav = document.querySelector("nav.tabs.topbar-tabs") || document.querySelector("nav.tabs");
    if (!scrollTop || !fab || !nav) {
      return { ok: false, reason: "missing-controls" };
    }
    const scrollRect = scrollTop.getBoundingClientRect();
    const fabRect = fab.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const intersects = (left, right) =>
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
    return {
      ok: true,
      bottomDelta: Math.abs(scrollRect.bottom - fabRect.bottom),
      intersectsNav: intersects(scrollRect, navRect),
      intersectsFab: intersects(scrollRect, fabRect),
      documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(scrollTopGeometry.ok, `scroll-top geometry controls should exist: ${JSON.stringify(scrollTopGeometry)}`).toBe(true);
  expect(
    scrollTopGeometry.bottomDelta,
    `scroll-top and FAB bottoms should align: ${JSON.stringify(scrollTopGeometry)}`,
  ).toBeLessThanOrEqual(4);
  expect(scrollTopGeometry.intersectsNav, `scroll-top must not intersect bottom tabs: ${JSON.stringify(scrollTopGeometry)}`).toBe(
    false,
  );
  expect(scrollTopGeometry.intersectsFab, `scroll-top must not intersect FAB: ${JSON.stringify(scrollTopGeometry)}`).toBe(false);
  expect(scrollTopGeometry.documentOverflowX, "mobile transaction page should not overflow horizontally").toBeLessThanOrEqual(1);
  const scrollBeforeTopClick = await page.evaluate(() => window.scrollY);
  await transactionScrollTop.click();
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), { timeout: 4000 })
    .toBeLessThan(Math.max(80, scrollBeforeTopClick - 120));
  await page.evaluate(() => window.scrollTo(0, 380));
  await page.waitForTimeout(250);
  await expect(transactionScrollTop).toBeVisible();
  const scrollBeforeSheet = await page.evaluate(() => window.scrollY);
  const fabScrolledBox = await transactionFab.boundingBox();
  expect(fabScrolledBox, "transaction add action should have a bounding box after scroll").not.toBeNull();
  expect(fabScrolledBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(844);
  const intersects = (left, right) =>
    Boolean(
      left &&
        right &&
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y
    );
  await expect(page.locator(".transaction-row .transaction-col-actions .mobile-toggle-btn")).toHaveCount(0);
  await expect(page.locator(".transaction-row .transaction-col-actions .mobile-select-btn")).toHaveCount(0);
  await transactionFab.evaluate((element) => element.click());
  await expect(transactionSheet).toBeVisible();
  await expect(page.locator("header.topbar")).toBeVisible();
  await expect(page.locator("nav.tabs")).toBeVisible();
  expect(page.url()).toBe(routeBeforeMobileSheet);
  await expect(page.locator("nav.tabs button.active").first()).toHaveText(activeTabBeforeMobileSheet);
  const transactionSheetBox = await transactionSheet.boundingBox();
  expect(transactionSheetBox, "transaction sheet should have a bounding box").not.toBeNull();
  expect(transactionSheetBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(844);
  await expect(labeledField(transactionSheet, "금액", "input")).toBeVisible();
  await expect(page.getByTestId("transaction-entry-category-manage")).toHaveCount(0);
  await transactionSheetClose.click();
  await expect(transactionSheet).toBeHidden();
  const scrollAfterSheetClose = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollAfterSheetClose - scrollBeforeSheet)).toBeLessThanOrEqual(16);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await scrollTransactionLedgerIntoStickyRange(page);
  await expect(page.locator(".transactions-mobile-ledger-head")).toHaveAttribute("data-sticky-active", "true");
  await expectMobileTransactionMonthStepperSticky(page);
  await expectStickyStack(
    page.getByTestId("transaction-sticky-toolbar"),
    page.locator(".transactions-mobile-ledger-head"),
    { maxLedgerY: 260, gapAllowance: 4 }
  );
  const stickyLedgerHead = page.locator(".transactions-mobile-ledger-head");
  const stickyToolbarBox = await page.getByTestId("transaction-sticky-toolbar").boundingBox();
  const stickyLedgerBox = await stickyLedgerHead.boundingBox();
  const stickyLedgerBottom = (stickyLedgerBox?.y ?? 0) + (stickyLedgerBox?.height ?? 0);
  const stickyVisibleRowBox = await page.locator(".transaction-row").evaluateAll((nodes, ledgerBottom) => {
    const viewportHeight = window.innerHeight;
    return nodes
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
      })
      .find((box) => box.y >= ledgerBottom - 1 && box.y < viewportHeight);
  }, stickyLedgerBottom);
  const fabStickyBox = await transactionFab.boundingBox();
  expect(stickyToolbarBox, "sticky transaction toolbar should have a bounding box").not.toBeNull();
  expect(stickyLedgerBox, "sticky ledger head should have a bounding box").not.toBeNull();
  await expect(mobileHeaderFilters).toBeHidden();
  expect(stickyVisibleRowBox, "a mobile transaction row should remain visible below sticky stack").toBeTruthy();
  expect(stickyToolbarBox?.y ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(0);
  expect(stickyToolbarBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(18);
  expect((stickyLedgerBox?.y ?? 0) - ((stickyToolbarBox?.y ?? 0) + (stickyToolbarBox?.height ?? 0))).toBeGreaterThanOrEqual(-4);
  expect(stickyVisibleRowBox?.y ?? 0).toBeGreaterThanOrEqual(stickyLedgerBottom - 1);
  expect(intersects(fabStickyBox, stickyLedgerBox)).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await expect(transactionScrollTop).toBeHidden();
  const mobileRowTapBox = await mobileRow.boundingBox();
  expect(mobileRowTapBox, "mobile transaction row should have a bounding box").not.toBeNull();
  expect(
    (mobileRowTapBox?.height ?? 0) >= 44,
    `mobile transaction row should keep a row-sized tap target: ${JSON.stringify(mobileRowTapBox)}`,
  ).toBe(true);
  await expectStableButtonPosition(mobileRow, async () => {
    await mobileRow.click({ position: { x: 88, y: 22 } });
  });
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);
  const expandedDetailRow = mobileRow.locator(
    "xpath=following-sibling::tr[contains(@class,'transaction-mobile-expanded-detail-row')][1]",
  );
  await expect(expandedDetailRow).toHaveCount(1);
  const expandedMemoMetrics = await expandedDetailRow
    .locator(".transaction-expanded-detail-memo .transaction-mobile-detail-value")
    .first()
    .evaluate((memoElement) => {
    const style = getComputedStyle(memoElement);
    return {
      text: memoElement.textContent?.trim() || "",
      title: memoElement.getAttribute("title"),
      ariaLabel: memoElement.getAttribute("aria-label"),
      clientWidth: memoElement.clientWidth,
      scrollWidth: memoElement.scrollWidth,
      clientHeight: memoElement.clientHeight,
      scrollHeight: memoElement.scrollHeight,
      overflowX: style.overflowX,
      overflowWrap: style.overflowWrap,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(expandedMemoMetrics.text).toBe(memo);
  expect(expandedMemoMetrics.title).toBe(memo);
  expect(expandedMemoMetrics.ariaLabel).toBe(`메모 ${memo}`);
  expect(
    expandedMemoMetrics.scrollWidth,
    `expanded mobile memo should wrap within the row: ${JSON.stringify(expandedMemoMetrics)}`,
  ).toBeLessThanOrEqual(expandedMemoMetrics.clientWidth + 1);
  expect(
    expandedMemoMetrics.scrollHeight,
    `expanded mobile memo should not be vertically clipped: ${JSON.stringify(expandedMemoMetrics)}`,
  ).toBeLessThanOrEqual(expandedMemoMetrics.clientHeight + 1);
  expect(expandedMemoMetrics.whiteSpace, `expanded memo should allow wrapping: ${JSON.stringify(expandedMemoMetrics)}`).not.toBe("nowrap");
  expect(expandedMemoMetrics.overflowWrap, `expanded memo should wrap long unbroken text: ${JSON.stringify(expandedMemoMetrics)}`).toBe(
    "anywhere",
  );
  expect(expandedMemoMetrics.textOverflow, `expanded memo should not visually ellipsize: ${JSON.stringify(expandedMemoMetrics)}`).toBe(
    "clip",
  );
  const expandedActionRow = mobileRow.locator("xpath=following-sibling::tr[1][contains(@class,'transaction-mobile-expanded-actions-row')]");
  await expect(expandedActionRow).toHaveCount(0);
  await expect(expandedDetailRow.locator(".transaction-mobile-detail-label")).toHaveText([
    "거래자명",
    "카테고리",
    "메모",
    "금액",
    "최종 수정일",
  ]);
  const expandedDetailMetrics = await mobileRow.evaluate((row) => {
    const rowBox = row.getBoundingClientRect();
    const actionRow = row.nextElementSibling?.classList.contains("transaction-mobile-expanded-actions-row")
      ? row.nextElementSibling
      : null;
    const actionBox = actionRow?.getBoundingClientRect() || null;
    const detailCells = Array.from(
      row.querySelectorAll(".transaction-col-category, .transaction-col-owner, .transaction-col-updated"),
    ).map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        className: cell.className,
        clientHeight: cell.clientHeight,
        scrollHeight: cell.scrollHeight,
        renderedHeight: box.height,
        hasVerticalOverflow: cell.scrollHeight > cell.clientHeight + 1,
      };
    });
    return {
      clientHeight: row.clientHeight,
      scrollHeight: row.scrollHeight,
      renderedHeight: rowBox.height,
      hasVerticalOverflow: row.scrollHeight > row.clientHeight + 1,
      actionRowCount: actionRow ? 1 : 0,
      actionStartsAfterRow: !actionBox || actionBox.top >= rowBox.bottom - 1,
      detailCells,
    };
  });
  const expandedDetailRowMetrics = await expandedDetailRow.evaluate((row) => {
    const detailCells = Array.from(row.querySelectorAll(".transaction-expanded-detail-item")).map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        className: cell.className,
        clientHeight: cell.clientHeight,
        scrollHeight: cell.scrollHeight,
        renderedHeight: box.height,
        hasVerticalOverflow: cell.scrollHeight > cell.clientHeight + 1,
      };
    });
    return {
      clientHeight: row.clientHeight,
      scrollHeight: row.scrollHeight,
      hasVerticalOverflow: row.scrollHeight > row.clientHeight + 1,
      detailCells,
    };
  });
  expect(
    expandedDetailMetrics.hasVerticalOverflow,
    `expanded compact transaction row should stay within table height: ${JSON.stringify(expandedDetailMetrics)}`,
  ).toBe(false);
  expect(
    expandedDetailRowMetrics.hasVerticalOverflow,
    `expanded detail row should fit readable detail content: ${JSON.stringify(expandedDetailRowMetrics)}`,
  ).toBe(false);
  expect(
    expandedDetailMetrics.actionStartsAfterRow,
    `expanded detail area should not overlap removed row actions: ${JSON.stringify(expandedDetailMetrics)}`,
  ).toBe(true);
  expect(expandedDetailMetrics.actionRowCount, `expanded row actions should be moved to the toolbar: ${JSON.stringify(expandedDetailMetrics)}`).toBe(0);
  for (const cell of expandedDetailMetrics.detailCells) {
    expect(cell.hasVerticalOverflow, `${cell.className} should not clip detail text`).toBe(false);
  }
  for (const cell of expandedDetailRowMetrics.detailCells) {
    expect(cell.hasVerticalOverflow, `${cell.className} should not clip expanded detail text`).toBe(false);
  }
  await expect(mobileRow.locator(".transaction-col-actions .row-delete-btn")).toHaveCount(0);
  if ((await mobileRow.getAttribute("data-row-selected")) !== "true") {
    await selectTransactionRowForToolbar(page, mobileRow);
  }
  await expect(mobileRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1);
  await expect(page.getByTestId("transaction-selection-edit")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-above")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-below")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-delete")).toBeVisible();
  await mobileRow.click({ position: { x: 88, y: 22 } });
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  const compactFlowSummaryLines = page.getByTestId("tx-flow-summary-line");
  await expect(compactFlowSummaryLines).toHaveCount(3);
  await expect(compactFlowSummaryLines.nth(0)).toContainText(/(수입|지출|투자)/);
  await expect(compactFlowSummaryLines.nth(0)).toContainText("원");
  const incomeSummaryToggle = page.getByTestId("tx-flow-summary-toggle-income");
  if ((await incomeSummaryToggle.getAttribute("aria-expanded")) !== "true") {
    await incomeSummaryToggle.click();
  }
  await expect(incomeSummaryToggle).toHaveAttribute("aria-expanded", "true");
  const incomeSummaryPanel = page.getByTestId("tx-flow-summary-panel-income");
  await expect(incomeSummaryPanel).toBeVisible();
  await expect(incomeSummaryPanel).toContainText("%");
  await expect(incomeSummaryPanel.getByTestId("tx-flow-summary-chart-income")).toBeVisible();
  await assertResponsiveShell(page, 12);
  await expectNoHorizontalOverflow(page, 12);

  await page.setViewportSize({ width: 1366, height: 960 });
  await openTab(page, "거래");
  for (const cleanupMemo of [memo, incomeMemo, investmentMemo, ownerlessMemo, ...extraMemos]) {
    await clearTransactionSelection(page);
    const cleanupRow = page.locator("tr.transaction-row", { hasText: cleanupMemo }).first();
    await cleanupRow.evaluate((row) => row.scrollIntoView({ block: "center", inline: "nearest" }));
    await page.waitForTimeout(50);
    await cleanupRow.locator(".transaction-col-memo").click();
    await expect(cleanupRow).toHaveAttribute("data-row-selected", "true");
    await expectTransactionSelectionSummary(page, 1);
    await page.getByTestId("transaction-selection-delete").click();
    const confirmDialog = page.locator(".confirm-dialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "삭제" }).click();
    await expect(page.locator("tr.transaction-row", { hasText: cleanupMemo })).toHaveCount(0);
  }
});
