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
  registerAndVerify,
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

async function expectQuickCategoryLayoutStable(page, expectedHint = "추천 카테고리를 탭하면 바로 연결됩니다.") {
  const metrics = await page.locator(".transaction-quick-category-panel").evaluate((panel) => {
    const hint = panel.querySelector(".transaction-quick-section-title small");
    const chipContainer = panel.querySelector(".transaction-quick-category-chips");
    const chips = Array.from(panel.querySelectorAll("[data-testid='transaction-quick-category-chip']"));
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const hintStyle = hint ? getComputedStyle(hint) : null;
    const chipContainerStyle = chipContainer ? getComputedStyle(chipContainer) : null;
    const documentOverflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;

    return {
      hint: hint
        ? {
            text: hint.textContent?.trim() || "",
            clientWidth: hint.clientWidth,
            scrollWidth: hint.scrollWidth,
            clientHeight: hint.clientHeight,
            scrollHeight: hint.scrollHeight,
            overflowX: hintStyle?.overflowX || "",
            textOverflow: hintStyle?.textOverflow || "",
            whiteSpace: hintStyle?.whiteSpace || "",
          }
        : null,
      chips: chipContainer
        ? {
            clientWidth: chipContainer.clientWidth,
            scrollWidth: chipContainer.scrollWidth,
            overflowX: chipContainerStyle?.overflowX || "",
            display: chipContainerStyle?.display || "",
            flexWrap: chipContainerStyle?.flexWrap || "",
          }
        : null,
      outsideViewport: chips
        .map((chip) => {
          const rect = chip.getBoundingClientRect();
          return {
            text: chip.textContent?.trim() || "",
            left: rect.left,
            right: rect.right,
            viewportWidth,
          };
        })
        .filter((item) => item.left < -1 || item.right > item.viewportWidth + 1),
      chipMetrics: chips.map((chip) => {
        const rect = chip.getBoundingClientRect();
        const label = chip.querySelector("span");
        const subLabel = chip.querySelector("small");
        const labelStyle = label ? getComputedStyle(label) : null;
        const subLabelStyle = subLabel ? getComputedStyle(subLabel) : null;
        return {
          text: chip.textContent?.trim() || "",
          width: rect.width,
          height: rect.height,
          labelText: label?.textContent?.trim() || "",
          labelClientWidth: label?.clientWidth || 0,
          labelScrollWidth: label?.scrollWidth || 0,
          labelClientHeight: label?.clientHeight || 0,
          labelScrollHeight: label?.scrollHeight || 0,
          labelTextOverflow: labelStyle?.textOverflow || "",
          labelWhiteSpace: labelStyle?.whiteSpace || "",
          subLabelText: subLabel?.textContent?.trim() || "",
          subLabelClientWidth: subLabel?.clientWidth || 0,
          subLabelScrollWidth: subLabel?.scrollWidth || 0,
          subLabelClientHeight: subLabel?.clientHeight || 0,
          subLabelScrollHeight: subLabel?.scrollHeight || 0,
          subLabelTextOverflow: subLabelStyle?.textOverflow || "",
          subLabelWhiteSpace: subLabelStyle?.whiteSpace || "",
        };
      }),
      documentOverflowX,
    };
  });

  expect(metrics.hint).toBeTruthy();
  if (expectedHint !== null) {
    expect(metrics.hint.text).toBe(expectedHint);
  }
  expect(metrics.hint.whiteSpace).not.toBe("nowrap");
  expect(metrics.hint.scrollWidth).toBeLessThanOrEqual(metrics.hint.clientWidth + 1);
  expect(metrics.hint.scrollHeight).toBeLessThanOrEqual(metrics.hint.clientHeight + 1);
  expect(metrics.chips).toBeTruthy();
  expect(metrics.chips.display).toBe("flex");
  expect(metrics.chips.flexWrap).toBe("nowrap");
  expect(["auto", "scroll"]).toContain(metrics.chips.overflowX);
  expect(metrics.chips.scrollWidth).toBeGreaterThanOrEqual(metrics.chips.clientWidth);
  expect(metrics.documentOverflowX).toBeLessThanOrEqual(1);
  expect(metrics.chipMetrics.length).toBeGreaterThan(0);
  expect(
    metrics.chipMetrics.every((chip) => chip.height >= 44),
    `quick category chips should keep mobile touch height: ${JSON.stringify(metrics.chipMetrics)}`,
  ).toBe(true);
  expect(
    metrics.chipMetrics.every((chip) => chip.labelWhiteSpace === "nowrap" && chip.labelTextOverflow === "ellipsis"),
    `quick category labels should stay single-line with ellipsis on the compact rail: ${JSON.stringify(metrics.chipMetrics)}`,
  ).toBe(true);
  expect(
    metrics.chipMetrics.every((chip) => chip.labelClientWidth <= chip.width),
    `quick category labels should stay inside their chip: ${JSON.stringify(metrics.chipMetrics)}`,
  ).toBe(true);
  expect(
    metrics.chipMetrics.every((chip) => chip.labelScrollHeight <= chip.labelClientHeight + 1),
    `quick category labels should not clip vertically: ${JSON.stringify(metrics.chipMetrics)}`,
  ).toBe(true);
  expect(
    metrics.chipMetrics.every((chip) => chip.subLabelWhiteSpace === "nowrap" && chip.subLabelTextOverflow === "ellipsis"),
    `quick category sublabels should stay single-line with ellipsis on the compact rail: ${JSON.stringify(metrics.chipMetrics)}`,
  ).toBe(true);
  expect(
    metrics.chipMetrics.every((chip) => chip.subLabelClientWidth <= chip.width),
    `quick category sublabels should stay inside their chip: ${JSON.stringify(metrics.chipMetrics)}`,
  ).toBe(true);
  expect(
    metrics.chipMetrics.every((chip) => chip.subLabelScrollHeight <= chip.subLabelClientHeight + 1),
    `quick category sublabels should not clip vertically: ${JSON.stringify(metrics.chipMetrics)}`,
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

async function captureVisibleHistoryAnchor(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr.transaction-row[data-transaction-id]"));
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const threshold =
      [
        "header.topbar",
        ".transaction-list-card > .transaction-sticky-toolbar",
        ".transactions-mobile-ledger-head",
      ].reduce((bottom, selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        if (!box || box.bottom <= 0 || box.top >= viewportHeight) {
          return bottom;
        }
        return Math.max(bottom, box.bottom);
      }, 0) + 4;
    const row = rows.find((candidate) => {
      const box = candidate.getBoundingClientRect();
      return box.bottom > threshold && box.top < window.innerHeight;
    });
    if (!row) {
      return null;
    }
    return {
      id: row.getAttribute("data-transaction-id"),
      top: row.getBoundingClientRect().top,
    };
  });
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

async function expectTransactionFabBottomRightReachable(page, label = "transaction FAB") {
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
    const toolbarBox = toolbar?.getBoundingClientRect();
    const ledgerBox = ledgerHead?.getBoundingClientRect();
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
      hitTargetIsFab: topElement === element || element.contains(topElement),
      overlapsToolbar: intersects(box, toolbarBox),
      overlapsLedgerHead: intersects(box, ledgerBox),
      scrollY: window.scrollY,
    };
  });
  expect(metrics.position, `${label} should be fixed: ${JSON.stringify(metrics)}`).toBe("fixed");
  expect(metrics.zIndex, `${label} z-index should sit above sticky toolbar: ${JSON.stringify(metrics)}`).toBeGreaterThan(44);
  expect(metrics.box.width, `${label} width should remain touch-friendly: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(48);
  expect(metrics.box.height, `${label} height should remain touch-friendly: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(48);
  expect(metrics.box.right, `${label} should stay inside right viewport edge: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth - 8,
  );
  expect(metrics.box.left, `${label} should stay in the right half: ${JSON.stringify(metrics)}`).toBeGreaterThan(
    metrics.viewportWidth * 0.5,
  );
  expect(metrics.box.bottom, `${label} should stay inside bottom viewport edge: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportHeight - 8,
  );
  expect(metrics.box.top, `${label} should remain reachable after scroll: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(0);
  expect(metrics.hitTargetIsFab, `${label} should be topmost at its center: ${JSON.stringify(metrics)}`).toBe(true);
  expect(metrics.overlapsToolbar, `${label} should not cover the sticky toolbar: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.overlapsLedgerHead, `${label} should not cover the mobile ledger head: ${JSON.stringify(metrics)}`).toBe(false);
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

async function expectTransactionSelectionSummary(page, count, expectedAmountText = null) {
  const summary = page.getByTestId("transaction-sticky-toolbar").getByTestId("transaction-selection-summary");
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
  await expect(summary).toBeVisible();
  const clearButton = summary.getByRole("button", { name: "선택 해제" });
  if (await clearButton.isEnabled().catch(() => false)) {
    await clearButton.click();
  }
  await expectTransactionSelectionSummary(page, 0, "0원");
}

async function selectTransactionRowForToolbar(page, row) {
  await expect(row).toBeVisible();
  await row.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  if ((await row.getAttribute("data-row-selected")) !== "true") {
    const selectionTargets = [
      row.locator(".transaction-col-memo").first(),
      row.locator(".transaction-col-date").first(),
      row.locator(".transaction-col-type").first(),
    ];
    for (const target of selectionTargets) {
      if (!(await target.isVisible().catch(() => false))) {
        continue;
      }
      await target.click();
      if ((await row.getAttribute("data-row-selected")) === "true") {
        break;
      }
    }
    if ((await row.getAttribute("data-row-selected")) !== "true") {
      const checkbox = row.locator(".transaction-col-select input[type='checkbox']").first();
      if (await checkbox.isVisible().catch(() => false)) {
        await checkbox.click({ force: true });
      }
    }
  }
  await expect(row).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1);
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
  for (const columnLabel of ["일자", "유형", "카테고리", "메모", "금액", "거래자명", "최종 수정일", "세부"]) {
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
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const touchPoint = (y) => [{ x, y, radiusX: 6, radiusY: 6, force: 0.6 }];
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoint(startY) });
  await page.waitForTimeout(40);
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchPoint(Math.round((startY + endY) / 2)) });
  await page.waitForTimeout(40);
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchPoint(endY) });
  await page.waitForTimeout(40);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
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

async function scrollHistoryRowIntoViewport(page, text, expectedIsoDate, block = "center", loadDirection = "down") {
  await expect
    .poll(
      async () =>
        page.evaluate(
          ({ block: scrollBlock, expectedIsoDate: expectedDate, loadDirection: direction, text: rowText }) => {
            const rows = Array.from(document.querySelectorAll("tr.transaction-row"));
            const row = rows.find((element) => element.textContent?.includes(rowText));
            if (!row) {
              if (direction === "up") {
                if ((window.scrollY || window.pageYOffset || 0) <= 8) {
                  window.scrollTo(0, Math.min(document.body.scrollHeight, window.innerHeight * 0.75));
                } else {
                  window.scrollTo(0, 0);
                }
              } else {
                window.scrollTo(0, document.body.scrollHeight);
              }
              return "missing";
            }
            row.scrollIntoView({ block: scrollBlock, inline: "nearest", behavior: "auto" });
            const box = row.getBoundingClientRect();
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
            if (box.bottom <= 0 || box.top >= viewportHeight) {
              return "offscreen";
            }
            const dateKey = row.getAttribute("data-transaction-date") || "";
            return dateKey === expectedDate ? "ready" : `date:${dateKey}`;
          },
          { block, expectedIsoDate, loadDirection, text }
        ),
      { message: `scroll ${text} into the transaction viewport`, timeout: 40_000 }
    )
    .toBe("ready");
  await page.waitForTimeout(250);
}

async function openMobileTransactionQuickEntry(page) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width > 820) {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");
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
  await page.waitForLoadState("networkidle");
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

  await expect(details.locator("summary")).toBeVisible();
  const isOpen = await details.evaluate((element) => element.open);
  if (!isOpen) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveJSProperty("open", true);
  return details;
}

async function selectTransactionFormCategory(container, category) {
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
  const today = currentE2EHistoryDateIso();
  const dateInput = labeledField(transactionSheet, "일자", "input");
  if ((await dateInput.count()) > 0 && (await dateInput.isVisible().catch(() => false))) {
    await expect(dateInput).toHaveValue(today);
  }

  const typeSelect = labeledField(transactionSheet, "유형", "select");
  if ((await typeSelect.count()) > 0 && (await typeSelect.isVisible().catch(() => false))) {
    await expect(typeSelect).toHaveValue("expense");
  }
}

async function expectQuickEntryFieldClearOfStickyActions(transactionSheet, labelText, fieldSelector) {
  const field = labeledField(transactionSheet, labelText, fieldSelector);
  await expect(field).toBeVisible();
  await field.evaluate((element) => element.scrollIntoView({ block: "end", inline: "nearest" }));
  await transactionSheet.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

  const metrics = await field.evaluate((element) => {
    const sheet = element.closest("[data-testid='transaction-entry-sheet']");
    const actions = sheet?.querySelector(".transaction-quick-sticky-actions");
    const box = element.getBoundingClientRect();
    const sheetBox = sheet?.getBoundingClientRect();
    const actionBox = actions?.getBoundingClientRect();
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    const style = sheet ? getComputedStyle(sheet) : null;
    const fieldStyle = getComputedStyle(element);

    return {
      actionHeight: actionBox?.height ?? 0,
      actionTop: actionBox?.top ?? 0,
      coveredByActions: Boolean(topElement?.closest(".transaction-quick-sticky-actions")),
      fieldBottom: box.bottom,
      fieldHeight: box.height,
      fieldTop: box.top,
      label: element.closest("label")?.textContent?.replace(/\s+/g, " ").trim() || "",
      scrollMarginBottom: Number.parseFloat(fieldStyle.scrollMarginBottom || "0"),
      scrollPaddingBottom: style ? Number.parseFloat(style.scrollPaddingBottom || "0") : 0,
      sheetBottom: sheetBox?.bottom ?? 0,
      sheetClientHeight: sheet?.clientHeight ?? 0,
      sheetScrollHeight: sheet?.scrollHeight ?? 0,
      sheetScrollTop: sheet?.scrollTop ?? 0,
    };
  });

  expect(metrics.fieldHeight, `${labelText} field should have measurable height`).toBeGreaterThan(0);
  expect(metrics.coveredByActions, `${labelText} field center should not be under sticky actions`).toBe(false);
  expect(metrics.fieldBottom, `${labelText} field should clear sticky actions: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.actionTop - 6
  );
  expect(metrics.scrollMarginBottom, "field should reserve scroll margin for sticky actions").toBeGreaterThan(metrics.actionHeight);
  expect(metrics.scrollPaddingBottom, "sheet should reserve scroll padding for sticky actions").toBeGreaterThan(metrics.actionHeight);
}

async function expectQuickCategoryReflectedInFullFallback(transactionSheet, selectedChipText) {
  const categoryTrigger = transactionSheet
    .getByRole("button", { name: /추가 설정|날짜·유형·거래자·전체 카테고리|전체 카테고리|카테고리 선택|카테고리 변경|자세히|추가 입력/ })
    .first();
  if ((await categoryTrigger.count()) > 0 && (await categoryTrigger.isVisible().catch(() => false))) {
    await categoryTrigger.click();
  }

  const categorySelect = labeledField(transactionSheet, "카테고리", "select");
  const legacyMinorSelect = labeledField(transactionSheet, "중분류", "select");
  const selectedText = await (async () => {
    const target = (await categorySelect.count()) > 0 ? categorySelect : legacyMinorSelect;
    if ((await target.count()) === 0 || !(await target.isVisible().catch(() => false))) {
      return "";
    }
    return target.evaluate((select) => select.options[select.selectedIndex]?.textContent?.trim() || "");
  })();

  if (selectedText) {
    const normalizedChip = selectedChipText.replace(/\s+/g, " ").trim();
    expect(
      normalizedChip.includes(selectedText) || selectedText.includes(normalizedChip),
      `full category fallback should reflect quick chip ${normalizedChip}; selected ${selectedText}`
    ).toBe(true);
  }
}

async function expectTransactionEntryPrimaryPath(page, transactionSheet, label) {
  const quickForm = transactionSheet.getByTestId("transaction-quick-form");
  const amountInput = transactionSheet.getByTestId("transaction-quick-amount");
  const categoryPicker = transactionSheet.getByTestId("transaction-category-quick-picker");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  const saveButton = transactionSheet.getByTestId("transaction-quick-save");

  await expect(quickForm, `${label} should use the quick transaction form`).toBeVisible();
  await expect(amountInput, `${label} amount is the first primary field`).toBeVisible();
  await expect(amountInput, `${label} amount keeps initial focus`).toBeFocused();
  await expect(categoryPicker, `${label} category picker is in the primary path`).toBeVisible();
  await expect(memoInput, `${label} memo is in the primary path`).toBeVisible();
  await expect(saveButton, `${label} save is visible with primary fields`).toBeVisible();
  await expect(transactionSheet.locator("details.transaction-quick-details"), `${label} should have one secondary details block`).toHaveCount(1);
  await expect(transactionSheet.locator("details.transaction-quick-details[open]"), `${label} secondary details is not required`).toHaveCount(0);

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
    const amount = sheet.querySelector("[data-testid='transaction-quick-amount']");
    const category = sheet.querySelector("[data-testid='transaction-category-quick-picker']");
    const memo = Array.from(sheet.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim().startsWith("메모"))
      ?.querySelector("input");
    const save = sheet.querySelector("[data-testid='transaction-quick-save']");
    const actions = sheet.querySelector(".transaction-quick-sticky-actions");
    const details = Array.from(sheet.querySelectorAll("details.transaction-quick-details"));
    const sheetBox = rectFor(sheet);
    const primaryRects = [amount, category, memo, save].map(rectFor);
    const visiblePrimaryRects = [amount, category, memo, save].filter(visible).map(rectFor);
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const documentOverflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const sheetOverflowX = sheet.scrollWidth - sheet.clientWidth;
    const primaryTop = Math.min(...visiblePrimaryRects.map((rect) => rect.top));
    const primaryBottom = Math.max(...visiblePrimaryRects.map((rect) => rect.bottom));
    const primaryHeight = primaryBottom - primaryTop;
    const pointerDistance =
      amount && category && memo && save
        ? Math.round(
            Math.abs(rectFor(amount).centerY - rectFor(category).centerY) +
              Math.abs(rectFor(category).centerY - rectFor(memo).centerY) +
              Math.abs(rectFor(memo).centerY - rectFor(save).centerY)
          )
        : Number.POSITIVE_INFINITY;

    return {
      amount: primaryRects[0],
      category: primaryRects[1],
      memo: primaryRects[2],
      save: primaryRects[3],
      actions: rectFor(actions),
      details: details.map((detail) => {
        const summary = detail.querySelector("summary");
        const summaryLabel = detail.querySelector("summary > span");
        const summaryBox = rectFor(summary);
        const centerElement = summaryBox
          ? document.elementFromPoint(summaryBox.centerX, summaryBox.centerY)
          : null;
        return {
          open: detail.open,
          summary: summary?.textContent?.replace(/\s+/g, " ").trim() || "",
          summaryLabel: summaryLabel?.textContent?.replace(/\s+/g, " ").trim() || "",
          summaryLabelClipped: summaryLabel ? summaryLabel.scrollWidth - summaryLabel.clientWidth > 1 : true,
          summaryCoveredByActions: Boolean(centerElement?.closest(".transaction-quick-sticky-actions")),
          summaryRect: summaryBox,
          rect: rectFor(detail),
        };
      }),
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
  expect(metrics.amount.top, `${label} amount should precede category: ${JSON.stringify(metrics)}`).toBeLessThan(metrics.category.top);
  expect(metrics.category.top, `${label} category should precede memo: ${JSON.stringify(metrics)}`).toBeLessThan(metrics.memo.top);
  expect(metrics.memo.top, `${label} memo should remain close to save: ${JSON.stringify(metrics)}`).toBeLessThan(metrics.save.bottom);
  expect(metrics.details[0].rect.top, `${label} secondary details should be below primary input: ${JSON.stringify(metrics)}`).toBeGreaterThan(
    metrics.memo.top
  );
  expect(metrics.details[0].summaryLabel, `${label} secondary details title should stay short: ${JSON.stringify(metrics)}`).toBe("추가 설정");
  expect(metrics.details[0].summaryLabelClipped, `${label} secondary details title should not be clipped: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.details[0].summaryCoveredByActions, `${label} secondary details summary should not sit under sticky actions: ${JSON.stringify(metrics)}`).toBe(false);
  expect(
    metrics.details[0].summaryRect.bottom,
    `${label} secondary details summary should clear sticky actions: ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(metrics.actions.top - 6);
  expect(metrics.primaryHeight, `${label} primary path should fit as one compact work unit: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    Math.min(metrics.viewportHeight * 0.78, 620)
  );
  expect(metrics.pointerDistance, `${label} pointer travel should stay bounded: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    Math.min(metrics.viewportHeight * 0.95, 720)
  );
  expect(metrics.save.bottom, `${label} save action should stay in view: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewportHeight + 1);
}

async function installStaleCategoryHistoryFixture(page, { staleCategoryMajor, staleCategoryMinor, staleMemo }) {
  const staleCategoryId = `stale-category-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const staleRowId = `stale-row-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const routePattern = "**/api/v1/transactions/history**";
  let injected = false;

  await page.route(routePattern, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("direction") !== "initial") {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const payload = await response.json().catch(() => null);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (!payload || injected || items.length === 0) {
      await route.fulfill({ response, json: payload ?? {} });
      return;
    }

    const template = items.find((item) => String(item?.flow_type || "") === "expense") || items[0];
    const nowIso = new Date().toISOString();
    payload.items = [
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
    await route.fulfill({ response, json: payload });
  });

  return {
    wasInjected: () => injected,
    unroute: () => page.unroute(routePattern),
  };
}

test("mobile quick entry creates an expense through amount-first chip path", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-create")}@example.com`;
  const displayName = unique("tx-quick-create-name");
  const seedMemo = unique("tx-quick-seed");
  const memo = unique("tx-quick-created");

  await registerAndVerify(page, { email, displayName });
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
  const quickAmount = page.getByTestId("transaction-quick-amount");
  await expect(quickAmount).toBeVisible();
  await expect(quickAmount).toBeFocused();
  const amountBox = await quickAmount.boundingBox();
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
  expect(amountBox?.y ?? Number.POSITIVE_INFINITY, "quick amount should be the first meaningful sheet field").toBeLessThanOrEqual(
    firstSheetFieldTop + 4
  );
  await expectMobileQuickEntryDefaults(page, transactionSheet);

  await quickAmount.fill("24680");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  await expect(memoInput).toBeVisible();
  await quickAmount.press("Enter");
  await expect(memoInput).toBeFocused();
  await memoInput.fill(memo);

  const quickCategoryChip = page.getByTestId("transaction-quick-category-chip").first();
  await expect(quickCategoryChip).toBeVisible();
  const selectedChipText = String((await quickCategoryChip.textContent()) || "").trim();
  await quickCategoryChip.click();
  await expectQuickCategoryReflectedInFullFallback(transactionSheet, selectedChipText);
  await capture(page, "transactions-quick-entry-create");

  const quickSave = page.getByTestId("transaction-quick-save");
  await expect(quickSave).toBeVisible();
  await expect(quickSave).toBeEnabled();
  await quickSave.click();

  const createdRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(createdRow).toBeVisible({ timeout: 20_000 });
});

test("transaction entry primary path stays shallow across mobile tablet and desktop", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-entry-primary-path")}@example.com`;
  const displayName = unique("tx-entry-primary-path-name");
  const seedMemo = unique("tx-entry-primary-seed");
  await registerAndVerify(page, { email, displayName });
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
    const quickChips = transactionSheet.getByTestId("transaction-quick-category-chip");
    await expect(quickChips, `${testCase.name} should render recent chips plus the long fallback category chip`).toHaveCount(3);
    await expect(
      quickChips.first(),
      `${testCase.name} should keep the long CJK recent category in the compact rail`
    ).toContainText("초장문추천카테고리");
    await expect(
      quickChips.nth(2),
      `${testCase.name} should keep the long CJK fallback major label in the compact rail`
    ).toContainText(fallbackCategory.major);
    await expectTransactionEntryPrimaryPath(page, transactionSheet, testCase.name);
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, `transactions-entry-primary-path-${testCase.name}`);
    await transactionSheet.getByTestId("transaction-entry-sheet-close").click();
    await expect(transactionSheet).toBeHidden();
  }
});

test("desktop transaction entry keeps repeat context after save", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-repeat-desktop")}@example.com`;
  const displayName = unique("tx-repeat-desktop-name");
  const category = await (async () => {
    await registerAndVerify(page, { email, displayName });
    return createCategoryViaApi(page, {
      major: unique("반복입력"),
      minor: unique("영수증"),
    });
  })();
  await page.reload();
  await page.waitForLoadState("networkidle");
  const firstMemo = unique("tx-repeat-desktop-first");
  const secondMemo = unique("tx-repeat-desktop-second");
  const occurredOn = currentE2EHistoryDateIso(-2);

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await openTransactionQuickDetails(transactionSheet, "추가 입력");
  const amountInput = labeledField(transactionSheet, "금액", "input");
  const memoInput = labeledField(transactionSheet, "메모", "input");
  const dateInput = labeledField(transactionSheet, "일자", "input");
  const typeSelect = labeledField(transactionSheet, "유형", "select");
  const ownerSelect = labeledField(transactionSheet, "거래자", "select");

  await dateInput.fill(occurredOn);
  await typeSelect.selectOption("expense");
  const { majorSelect, categorySelect } = await selectTransactionFormCategory(transactionSheet, category);
  await selectFirstNonEmptyOption(ownerSelect);
  const ownerValue = await ownerSelect.inputValue();
  await amountInput.fill("12345");
  await memoInput.fill(firstMemo);
  await capture(page, "transactions-repeat-desktop-before-save");

  await transactionSheet.getByRole("button", { name: "거래 등록" }).click();
  await expect(page.locator("tr.transaction-row", { hasText: firstMemo }).first()).toBeVisible({ timeout: 20_000 });

  await expect(transactionSheet).toBeVisible();
  await expect(amountInput).toHaveValue("");
  await expect(memoInput).toHaveValue("");
  await expect(dateInput).toHaveValue(occurredOn);
  await expect(typeSelect).toHaveValue("expense");
  await expect(majorSelect).toHaveValue(category.major);
  await expect(categorySelect).toHaveValue(String(category.id));
  await expect(ownerSelect).toHaveValue(ownerValue);
  await expect(amountInput).toBeFocused();
  await capture(page, "transactions-repeat-desktop-context-preserved");

  await amountInput.fill("23456");
  await memoInput.fill(secondMemo);
  await transactionSheet.getByRole("button", { name: "거래 등록" }).click();
  await expect(page.locator("tr.transaction-row", { hasText: secondMemo }).first()).toBeVisible({ timeout: 20_000 });
});

test("issue 193: desktop transaction entry searches category in one step", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-cat-entry")}@example.com`;
  const displayName = unique("tx-cat-entry-name");
  const targetCategory = {
    major: unique("빠른분류"),
    minor: unique("검색항목"),
  };

  await registerAndVerify(page, { email, displayName });
  const category = await createCategoryViaApi(page, targetCategory);
  await page.reload();
  await page.waitForLoadState("networkidle");

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  const picker = transactionSheet.getByTestId("transaction-category-quick-picker");
  await expect(picker).toBeVisible();

  const searchInput = await openTransactionCategorySearch(picker);
  await searchInput.fill(targetCategory.minor);

  const option = picker
    .locator("[data-testid='transaction-category-option'], [data-testid='transaction-quick-category-chip']")
    .filter({ hasText: targetCategory.minor })
    .first();
  await expect(option).toBeVisible();
  await option.click();
  await openTransactionQuickDetails(transactionSheet, "전체 카테고리");

  await expect(labeledField(transactionSheet, "카테고리 그룹", "select")).toHaveValue(targetCategory.major);
  const categorySelect = transactionSheet
    .locator("label")
    .filter({ hasText: /^\s*카테고리\s*\(/ })
    .locator("select")
    .first();
  await expect(categorySelect).toHaveValue(String(category.id));
  await capture(page, "issue-193-desktop-category-one-step-entry");
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

  await registerAndVerify(page, { email, displayName });
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
  await page.waitForLoadState("networkidle");
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

test("issue 194: desktop transaction entry creates and applies a missing category inline", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-cat-create-entry")}@example.com`;
  const displayName = unique("tx-cat-create-entry-name");
  const targetCategory = {
    major: unique("즉시분류"),
    minor: unique("즉시항목"),
  };

  await registerAndVerify(page, { email, displayName });

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  const picker = transactionSheet.getByTestId("transaction-category-quick-picker");
  await expect(picker).toBeVisible();
  await createTransactionCategoryFromQuickPicker(picker, targetCategory);
  await openTransactionQuickDetails(transactionSheet, "전체 카테고리");

  await expect(labeledField(transactionSheet, "카테고리 그룹", "select")).toHaveValue(targetCategory.major);
  const categorySelect = transactionSheet
    .locator("label")
    .filter({ hasText: /^\s*카테고리\s*\(/ })
    .locator("select")
    .first();
  await expect(categorySelect).not.toHaveValue("");
  await expect(categorySelect.locator("option:checked")).toContainText(targetCategory.minor);
  await capture(page, "issue-194-desktop-inline-category-create");
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

  await registerAndVerify(page, { email, displayName });
  const source = await createCategoryViaApi(page, sourceCategory);
  await createTransactionViaApi(page, {
    memo,
    amount: "12000",
    categoryId: source.id,
    occurredOn: currentE2EHistoryDateIso(),
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
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

  await registerAndVerify(page, { email, displayName });
  const expenseCategory = await createCategoryViaApi(page, {
    ...categoryPair,
    flowType: "expense",
  });
  const incomeCategory = await createCategoryViaApi(page, {
    ...categoryPair,
    flowType: "income",
  });
  await page.reload();
  await page.waitForLoadState("networkidle");

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await selectTransactionFormCategory(transactionSheet, expenseCategory);
  await labeledField(transactionSheet, "유형", "select").selectOption("income");

  await expect(labeledField(transactionSheet, "카테고리 그룹", "select")).toHaveValue(categoryPair.major);
  await expect(
    transactionSheet
      .locator("label")
      .filter({ hasText: /^\s*카테고리\s*\(/ })
      .locator("select")
      .first()
  ).toHaveValue(String(incomeCategory.id));
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

  await registerAndVerify(page, { email, displayName });
  const expenseCategory = await createCategoryViaApi(page, category);
  await page.reload();
  await page.waitForLoadState("networkidle");

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await selectTransactionFormCategory(transactionSheet, expenseCategory);
  const typeSelect = labeledField(transactionSheet, "유형", "select");
  await typeSelect.selectOption("income");

  const restoreNotice = transactionSheet.getByTestId("transaction-category-restore-notice");
  await expect(restoreNotice).toContainText("카테고리 선택을 비웠습니다.");
  await expect(restoreNotice).toContainText(category.minor);
  await expect(
    transactionSheet
      .locator("label")
      .filter({ hasText: /^\s*카테고리\s*\(/ })
      .locator("select")
      .first()
  ).toHaveValue("");

  await transactionSheet.getByTestId("transaction-category-restore-button").click();
  await expect(typeSelect).toHaveValue("expense");
  await expect(labeledField(transactionSheet, "카테고리 그룹", "select")).toHaveValue(category.major);
  await expect(
    transactionSheet
      .locator("label")
      .filter({ hasText: /^\s*카테고리\s*\(/ })
      .locator("select")
      .first()
  ).toHaveValue(String(expenseCategory.id));
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

  await registerAndVerify(page, { email, displayName });
  const expenseCategory = await createCategoryViaApi(page, category);
  await createTransactionViaApi(page, {
    memo,
    amount: "12000",
    categoryId: expenseCategory.id,
    occurredOn: currentE2EHistoryDateIso(),
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
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

  await registerAndVerify(page, { email, displayName });
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
  await page.waitForLoadState("networkidle");
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
  await labeledField(transactionSheet, "유형", "select").selectOption("expense");
  await selectTransactionFormCategory(transactionSheet, expenseCategory);
  await selectFirstNonEmptyOption(labeledField(transactionSheet, "거래자", "select"));
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

  await registerAndVerify(page, { email, displayName });

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

  await expect(transactionSheet).toContainText("금액, 카테고리, 메모 순서로 바로 저장합니다.");
});

test("mobile quick entry keeps repeat context and returns focus to amount", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-repeat-mobile")}@example.com`;
  const displayName = unique("tx-repeat-mobile-name");
  await registerAndVerify(page, { email, displayName });
  const category = await createCategoryViaApi(page, {
    major: unique("반복모바일"),
    minor: unique("영수증"),
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const firstMemo = unique("tx-repeat-mobile-first");
  const secondMemo = unique("tx-repeat-mobile-second");
  const occurredOn = currentE2EHistoryDateIso(-1);

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  const quickAmount = page.getByTestId("transaction-quick-amount");
  const memoInput = labeledField(transactionSheet, "메모", "input");

  await openTransactionQuickDetails(transactionSheet, "추가 입력");
  const dateInput = labeledField(transactionSheet, "일자", "input");
  const typeSelect = labeledField(transactionSheet, "유형", "select");
  const ownerSelect = labeledField(transactionSheet, "거래자", "select");
  await dateInput.fill(occurredOn);
  await typeSelect.selectOption("expense");
  await selectFirstNonEmptyOption(ownerSelect);
  const ownerValue = await ownerSelect.inputValue();
  await openTransactionQuickDetails(transactionSheet, "전체 카테고리");
  const { majorSelect, categorySelect } = await selectTransactionFormCategory(transactionSheet, category);
  await quickAmount.fill("12345");
  await memoInput.fill(firstMemo);
  await capture(page, "transactions-repeat-mobile-before-save");

  await page.getByTestId("transaction-quick-save").click();
  await expect(page.locator("tr.transaction-row", { hasText: firstMemo }).first()).toBeVisible({ timeout: 20_000 });

  await expect(transactionSheet).toBeVisible();
  await expect(quickAmount).toHaveValue("");
  await expect(memoInput).toHaveValue("");
  await expect(dateInput).toHaveValue(occurredOn);
  await expect(typeSelect).toHaveValue("expense");
  await expect(majorSelect).toHaveValue(category.major);
  await expect(categorySelect).toHaveValue(String(category.id));
  await expect(ownerSelect).toHaveValue(ownerValue);
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

  await registerAndVerify(page, { email, displayName });

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

test("mobile quick entry selected category chip remains readable while hovered", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-chip-hover")}@example.com`;
  const displayName = unique("tx-quick-chip-hover-name");
  const seedMemo = unique("tx-quick-chip-hover-seed");

  await registerAndVerify(page, { email, displayName });
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
  const quickCategoryChip = page.getByTestId("transaction-quick-category-chip").first();
  await expect(quickCategoryChip).toBeVisible();
  await quickCategoryChip.hover();
  await quickCategoryChip.click();
  await quickCategoryChip.hover();
  await expect(quickCategoryChip).toHaveAttribute("aria-pressed", "true");

  const selectedChipMetrics = await quickCategoryChip.evaluate((chip) => {
    const style = getComputedStyle(chip);
    const label = chip.querySelector("span");
    const labelStyle = label ? getComputedStyle(label) : style;
    return {
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      color: labelStyle.color || style.color,
      text: chip.textContent?.replace(/\s+/g, " ").trim() || "",
    };
  });
  expect(
    selectedChipMetrics.backgroundImage,
    `selected quick category chip should not inherit the global primary-button hover gradient: ${JSON.stringify(selectedChipMetrics)}`
  ).toBe("none");
  await expectTextContrast(quickCategoryChip.locator("span").first(), "selected quick category chip");
  await capture(page, "transactions-quick-entry-selected-chip-hover");
  await transactionSheet.getByTestId("transaction-entry-sheet-close").click();
});

test("mobile quick entry keeps expanded fields above sticky actions", async ({ page }) => {
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
  await registerAndVerify(page, { email, displayName });
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

    const quickCategoryChip = page.getByTestId("transaction-quick-category-chip").first();
    await expect(quickCategoryChip).toBeVisible();
    await quickCategoryChip.click();

    const quickDetailSummaryMetrics = await transactionSheet.locator("details.transaction-quick-details > summary").evaluateAll((summaries) =>
      summaries.map((summary) => {
        const box = summary.getBoundingClientRect();
        return {
          text: summary.textContent?.replace(/\s+/g, " ").trim() || "",
          width: box.width,
          height: box.height,
          clientWidth: summary.clientWidth,
          scrollWidth: summary.scrollWidth,
        };
      }),
    );
    expect(quickDetailSummaryMetrics.length, `${mobileCase.name} quick detail summaries`).toBeGreaterThanOrEqual(1);
    expect(
      quickDetailSummaryMetrics.every(({ height }) => height >= 44),
      `${mobileCase.name} quick detail summaries should keep 44px hit targets: ${JSON.stringify(quickDetailSummaryMetrics)}`,
    ).toBe(true);
    expect(
      quickDetailSummaryMetrics.every(({ clientWidth, scrollWidth }) => scrollWidth - clientWidth <= 1),
      `${mobileCase.name} quick detail summaries should not clip: ${JSON.stringify(quickDetailSummaryMetrics)}`,
    ).toBe(true);

    await openTransactionQuickDetails(transactionSheet, "추가 입력");

    await expectQuickEntryFieldClearOfStickyActions(transactionSheet, "일자", "input");
    await expectQuickEntryFieldClearOfStickyActions(transactionSheet, "유형", "select");
    await expectQuickEntryFieldClearOfStickyActions(transactionSheet, "거래자", "select");
    await expectNoHorizontalOverflow(page, 12);
    await capture(page, `transactions-quick-entry-sticky-clearance-${mobileCase.name}`);
    await page.getByTestId("transaction-entry-sheet-close").click();
  }
});

test("transaction mobile meta text keeps readable contrast", async ({ page }) => {
  const email = `${unique("tx-contrast")}@example.com`;
  const displayName = unique("tx-contrast-name");
  const memo = unique("tx-contrast-memo");
  const occurredOn = currentE2EHistoryDateIso();

  await registerAndVerify(page, { email, displayName });
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

  await registerAndVerify(page, { email, displayName });
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
  const previousMemo = unique("tx-month-apply-previous");
  const currentDate = currentE2EHistoryDateIso();
  const previousDate = currentE2EHistoryDateIso(-35);
  const previousMonth = yearMonthFromIso(previousDate);

  await registerAndVerify(page, { email, displayName });
  await createTransactionViaApi(page, { memo: currentMemo, amount: "12000", occurredOn: currentDate });
  await createTransactionViaApi(page, { memo: previousMemo, amount: "34000", occurredOn: previousDate });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");

  const listCard = page.locator(".transaction-list-card").first();
  await expect(listCard).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: currentMemo }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");

  const previousMonthRequests = [];
  page.on("response", (response) => {
    if (isMonthlyTransactionsResponse(response, previousMonth)) {
      previousMonthRequests.push(response.url());
    }
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
  await expect(page.locator("tr.transaction-row", { hasText: previousMemo }).first()).toBeVisible({ timeout: 20_000 });
  await capture(page, "issue-197-month-input-applied");
});

test("mobile transaction category flow summaries wrap long leading labels", async ({ page }) => {
  const email = `${unique("tx-flow-wrap")}@example.com`;
  const displayName = unique("tx-flow-wrap-name");
  const memo = unique("tx-flow-wrap-memo");
  const major = unique("issue175-flow-major");
  const minor = `${unique("issue175-flow-minor")} browser verify long representative category label`;

  await registerAndVerify(page, { email, displayName });
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

  await registerAndVerify(page, { email, displayName });
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

  await page.setViewportSize({ width: 812, height: 375 });
  await openTab(page, "거래");
  await page.waitForTimeout(250);
  await expectMobileTransactionFilterTriggersSeparated(page, "812px landscape transaction ledger");

  const landscapeLedgerHead = page.locator(".transactions-mobile-ledger-head").first();
  await landscapeLedgerHead.getByRole("button", { name: "유형 필터 열기" }).click();
  await expect(page.getByTestId("tx-ledger-filter-panel")).toBeVisible();

  const landscapeRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(landscapeRow).toBeVisible();
  await landscapeRow.locator(".mobile-toggle-btn").first().click();
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
    const rowToggle = row?.querySelector(".mobile-toggle-btn");
    const boxes = {
      listCard: boxOf(listCard),
      ledgerHead: boxOf(ledgerHead),
      filterPanel: boxOf(filterPanel),
      filterReset: boxOf(filterReset),
      row: boxOf(row),
      actionRow: boxOf(actionRow),
      fab: boxOf(fab),
      rowToggle: boxOf(rowToggle),
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
      fabToggleOverlap: intersects(boxes.fab, boxes.rowToggle),
      resetRowOverlap: intersects(boxes.filterReset, boxes.row),
    };
  });
  expect(landscapeMetrics.pageOverflowX, `812px landscape should not overflow: ${JSON.stringify(landscapeMetrics)}`).toBeLessThanOrEqual(1);
  expect(
    landscapeMetrics.listCard.scrollWidth - landscapeMetrics.listCard.clientWidth,
    `812px transaction list card content should not be clipped: ${JSON.stringify(landscapeMetrics)}`,
  ).toBeLessThanOrEqual(1);
  expect(landscapeMetrics.filterPanelBelowHead, `filter panel should sit below ledger head: ${JSON.stringify(landscapeMetrics)}`).toBe(true);
  expect(landscapeMetrics.filterResetBeforeRow, `filter reset should not overlap ledger row: ${JSON.stringify(landscapeMetrics)}`).toBe(true);
  expect(landscapeMetrics.actionStartsAfterRow, `expanded details should not overlap removed row actions: ${JSON.stringify(landscapeMetrics)}`).toBe(true);
  expect(landscapeMetrics.fabToggleOverlap, `transaction FAB should not overlap detail toggle: ${JSON.stringify(landscapeMetrics)}`).toBe(false);
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

  await registerAndVerify(page, { email, displayName });
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
  const quickCategoryChip = page.getByTestId("transaction-quick-category-chip").first();
  await expect(quickCategoryChip).toBeVisible();
  await quickCategoryChip.click();

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  const quickResume = page.getByTestId("transaction-quick-resume");
  const resumeVisible = await quickResume.isVisible().catch(() => false);
  if (resumeVisible) {
    await expect(quickResume).toBeEnabled();
  } else {
    await expect(quickAmount).toHaveValue("11,223");
    await expect(memoInput).toHaveValue(draftMemo);
  }

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

  await registerAndVerify(page, { email, displayName });
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
    .toContainEqual(expect.objectContaining({ label: expect.stringContaining("메모") }));
  await memoInput.fill("포커스 유지 메모");

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(memoInput).toBeFocused();

  const quickCategoryChip = page.getByTestId("transaction-quick-category-chip").first();
  await expect(quickCategoryChip).toBeVisible();
  await quickCategoryChip.click();
  await expect(memoInput).toBeFocused();
  await expect(quickAmount).not.toBeFocused();

  await capture(page, "transactions-quick-entry-focus-restore");
});

test("mobile quick entry defaults owner to current user over recent other member", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-quick-current-owner")}@example.com`;
  const displayName = "댕";
  const otherDisplayName = "찌";
  const otherUserId = `other-user-${Date.now()}`;
  const ownerCategory = {
    major: unique("현재거래자"),
    minor: unique("최근타인"),
  };

  await registerAndVerify(page, { email, displayName });
  const currentUser = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    return response.json();
  });
  const category = await createCategoryViaApi(page, ownerCategory);
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
  await page.route("**/api/v1/transactions/history**", async (route) => {
    const today = currentE2EHistoryDateIso();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "mock-other-owner-transaction",
            household_id: "mock-household",
            category_id: category.id,
            occurred_on: today,
            flow_type: "expense",
            amount: "1000",
            currency: "KRW",
            memo: "최근 타인 거래",
            owner_user_id: otherUserId,
            owner_name: otherDisplayName,
            source_ref: null,
            version: 1,
            created_at: createdAt,
            updated_at: createdAt,
          },
        ],
        older_cursor: null,
        newer_cursor: null,
        has_older: false,
        has_newer: false,
        anchor_date: today,
        today,
      }),
    });
  });
  await page.reload();

  const transactionSheet = await openMobileTransactionQuickEntry(page);
  await openTransactionQuickDetails(transactionSheet, "추가 입력");
  const ownerSelect = labeledField(transactionSheet, "거래자", "select");
  await expect(ownerSelect).toHaveValue(currentUser.id);
  await expect(ownerSelect.locator("option:checked")).toContainText(displayName);
  await expect(ownerSelect.locator("option:checked")).not.toContainText(otherDisplayName);

  await capture(page, "transactions-quick-entry-current-owner");
});

test("desktop transaction entry defaults owner and exposes quick member selection", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-owner-default-desktop")}@example.com`;
  const displayName = "댕";
  await registerAndVerify(page, { email, displayName });
  const currentUser = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    return response.json();
  });

  const transactionSheet = await openTransactionEntrySheet(page, { width: 1440, height: 900 });
  await openTransactionQuickDetails(transactionSheet, "추가 입력");
  const ownerSelect = labeledField(transactionSheet, "거래자", "select");
  await expect(ownerSelect).toHaveValue(currentUser.id);
  await expect(ownerSelect.locator("option:checked")).toContainText(displayName);

  const ownerQuickSelect = transactionSheet.getByTestId("transaction-owner-quick-select");
  await expect(ownerQuickSelect).toBeVisible();
  const currentUserChip = ownerQuickSelect.getByRole("button", { name: `${displayName} 거래자 선택` });
  await expect(currentUserChip).toBeVisible();
  await expect(currentUserChip).toHaveAttribute("aria-pressed", "true");
  await capture(page, "issue-201-transaction-owner-quick-select");
});

test("mobile quick entry keeps owner override and filters ordered category chips", async ({ page }) => {
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

  await registerAndVerify(page, { email, displayName });
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
  expect(staleHistoryFixture.wasInjected(), "stale category fixture should be present in transaction history").toBe(true);
  await expect(page.locator("tr.transaction-row", { hasText: staleMemo }).first()).toBeVisible();
  const chips = page.getByTestId("transaction-quick-category-chip");
  await expect(chips.first()).toBeVisible();
  await expectQuickCategoryLayoutStable(page);
  await expect(chips.first()).toContainText(recentExpenseCategory.minor);
  const chipTexts = (await chips.allTextContents()).join(" ");
  expect(chipTexts).toContain(recentExpenseCategory.minor);
  expect(chipTexts).toContain(olderExpenseCategory.minor);
  expect(chipTexts).not.toContain(incomeCategory.minor);
  expect(chipTexts).not.toContain(staleCategory.minor);

  await openTransactionQuickDetails(transactionSheet, "추가 입력");
  const ownerSelect = labeledField(transactionSheet, "거래자", "select");
  await expect(ownerSelect).toBeVisible();
  await ownerSelect.selectOption("");
  await expect(ownerSelect).toHaveValue("");
  await page.waitForTimeout(500);
  await expect(ownerSelect).toHaveValue("");
  await capture(page, "transactions-quick-entry-owner-order");
  await staleHistoryFixture.unroute();
});

test("issue 82: mobile quick category guidance and chips stay readable at 320px", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-issue-82")}@example.com`;
  const displayName = unique("tx-issue-82-name");
  const memo = unique("tx-issue-82-memo");
  const category = {
    major: unique("지출"),
    minor: unique("테스트긴분류명"),
  };

  await registerAndVerify(page, { email, displayName });
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
  await expect(page.getByTestId("transaction-quick-category-chip").first()).toBeVisible();
  await expectQuickCategoryLayoutStable(page);

  const issueMetrics = await page.locator(".transaction-quick-category-panel").evaluate((panel) => {
    const hint = panel.querySelector(".transaction-quick-section-title small");
    const chips = Array.from(panel.querySelectorAll("[data-testid='transaction-quick-category-chip']"));
    return {
      hintText: hint?.textContent?.trim() || "",
      hintClientWidth: hint?.clientWidth || 0,
      hintScrollWidth: hint?.scrollWidth || 0,
      hintClientHeight: hint?.clientHeight || 0,
      hintScrollHeight: hint?.scrollHeight || 0,
      chipHeights: chips.map((chip) => chip.getBoundingClientRect().height),
      chipTexts: chips.map((chip) => chip.textContent?.trim() || ""),
    };
  });

  expect(issueMetrics.hintText).toBe("추천 카테고리를 탭하면 바로 연결됩니다.");
  expect(issueMetrics.hintScrollWidth, JSON.stringify(issueMetrics)).toBeLessThanOrEqual(issueMetrics.hintClientWidth + 1);
  expect(issueMetrics.hintScrollHeight, JSON.stringify(issueMetrics)).toBeLessThanOrEqual(issueMetrics.hintClientHeight + 1);
  expect(issueMetrics.chipHeights.every((height) => height >= 44), JSON.stringify(issueMetrics)).toBe(true);
  expect(issueMetrics.chipTexts.join(" ")).toContain(category.minor);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-82-mobile-category-guidance-fit");
  await page.getByTestId("transaction-quick-category-chip").first().scrollIntoViewIfNeeded();
  await capture(page, "issue-82-mobile-category-chip-fit");
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

  await registerAndVerify(page, { email, displayName });
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
    await expect(page.getByTestId("transaction-quick-category-chip").first()).toBeVisible();
    await expectQuickCategoryLayoutStable(page);
    await expectNoHorizontalOverflow(page, 12);
    const sheetBox = await transactionSheet.boundingBox();
    expect(sheetBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(scenario.width);
    await capture(page, `transactions-quick-entry-${scenario.slug}`);
    await page.getByTestId("transaction-entry-sheet-close").click();
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

  await registerAndVerify(page, { email, displayName });
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
  await page.waitForLoadState("networkidle");

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
  await targetRow.locator("td").first().locator("input[type='checkbox']").check();
  await expect(targetRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1, `${amounts[0].toLocaleString("ko-KR")}원`);
  await clearTransactionSelection(page);

  const headerCheckbox = page.getByLabel("표시된 거래 전체 선택");
  await headerCheckbox.check();
  const selectedAfterHeaderCheck = await page.locator("tr.transaction-row[data-row-selected='true']").count();
  expect(selectedAfterHeaderCheck, "header checkbox should select at least this test's visible seeded rows").toBeGreaterThanOrEqual(
    memos.length,
  );
  await expectTransactionSelectionSummary(page, selectedAfterHeaderCheck);
  await headerCheckbox.uncheck();
  await expectTransactionSelectionSummary(page, 0, "0원");

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
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
  await page.waitForLoadState("networkidle");

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

test("issue 233: desktop transaction selection checkboxes expose a 32px hit target", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-checkbox-hitarea")}@example.com`;
  const displayName = unique("tx-checkbox-hitarea-name");
  const memo = unique("tx-checkbox-hitarea-memo");

  await registerAndVerify(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "23300",
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 1024, height: 768 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

  const headerCheckbox = page.getByLabel("표시된 거래 전체 선택");
  const targetRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  const rowCheckbox = targetRow.locator(".transaction-col-select input[type='checkbox']").first();
  await expect(rowCheckbox).toBeVisible({ timeout: 20_000 });
  const checkboxMetrics = await Promise.all(
    [headerCheckbox, rowCheckbox].map((locator) =>
      locator.evaluate((input) => {
        const rect = input.getBoundingClientRect();
        const cellRect = input.closest(".transaction-col-select")?.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          cellWidth: cellRect?.width || 0,
          cellHeight: cellRect?.height || 0,
        };
      }),
    ),
  );
  for (const metric of checkboxMetrics) {
    expect(metric.width, "desktop transaction checkbox width should be at least 32px").toBeGreaterThanOrEqual(32);
    expect(metric.height, "desktop transaction checkbox height should be at least 32px").toBeGreaterThanOrEqual(32);
    expect(metric.cellWidth, "desktop transaction selection cell should contain the checkbox target").toBeGreaterThanOrEqual(32);
  }

  await rowCheckbox.check();
  await expect(targetRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1, "23,300원");
  await capture(page, "issue-233-desktop-transaction-checkbox-hitarea");
});

test("desktop transaction sticky column titles and sweep auto-scroll selection toggle work", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("tx-row-sweep-scroll")}@example.com`;
  const displayName = unique("tx-row-sweep-scroll-name");
  const memoPrefix = unique("tx-row-sweep-scroll-memo");
  const rowCount = 52;
  const amounts = Array.from({ length: rowCount }, (_, index) => 1000 + index * 111);
  const memos = amounts.map((_, index) => `${memoPrefix}-${String(index).padStart(2, "0")}`);

  await registerAndVerify(page, { email, displayName });
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
  await page.waitForLoadState("networkidle");
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

  await registerAndVerify(page, { email, displayName });
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
    await page.waitForLoadState("networkidle");
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
    await targetRow.locator(".transaction-col-memo").click();
    await expect(targetRow).toHaveAttribute("data-row-selected", "true");
    await expect(targetRow).toHaveClass(/mobile-row-expanded/);
    await expect(
      targetRow.locator("xpath=following-sibling::tr[1][contains(@class,'transaction-mobile-expanded-actions-row')]"),
    ).toHaveCount(0);
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

    await clearTransactionSelection(page);
    const scrollRow = page.locator("tr.transaction-row", { hasText: memos[scenario.scrollIndex] }).first();
    await scrollRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
    await page.waitForTimeout(150);
    const touchMetrics = await performTouchScrollGestureOnRow(page, scrollRow);
    expect(touchMetrics.touchAction, `${scenario.label} rows should preserve vertical touch scrolling`).toBe("pan-y");
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

test("transaction FAB and sticky toolbar stay reachable after ledger scroll", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-fab-sticky")}@example.com`;
  const displayName = unique("tx-fab-sticky-name");
  const memoPrefix = unique("tx-fab-sticky-row");

  await registerAndVerify(page, { email, displayName });
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
  await page.waitForLoadState("networkidle");
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
  await expectTransactionFabBottomRightReachable(page, "mobile transaction FAB after ledger scroll");
  await expectMobileTransactionMonthStepperSticky(page);

  const mobileScrollBeforeSheet = await page.evaluate(() => window.scrollY);
  await page.getByTestId("transactions-fab").evaluate((element) => element.click());
  const mobileSheet = page.getByTestId("transaction-entry-sheet");
  await expect(mobileSheet).toBeVisible();
  await expect(labeledField(mobileSheet, "금액", "input")).toBeVisible();
  await capture(page, "transactions-fab-sticky-entry-sheet");
  await page.getByTestId("transaction-entry-sheet-close").click();
  await expect(mobileSheet).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") || "")).toBe("transactions-fab");
  const mobileScrollAfterSheet = await page.evaluate(() => window.scrollY);
  expect(Math.abs(mobileScrollAfterSheet - mobileScrollBeforeSheet)).toBeLessThanOrEqual(16);
});

test("issue 211: transaction add opens a visible sheet from a scrolled list", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-add-visible")}@example.com`;
  const displayName = unique("tx-add-visible-name");
  const memoPrefix = unique("tx-add-visible-row");

  await registerAndVerify(page, { email, displayName });
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
  await page.waitForLoadState("networkidle");
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

test("issue 213: mobile transaction add inherits the visible month date context", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-add-month-context")}@example.com`;
  const displayName = unique("tx-add-month-context-name");
  const monthContextDate = isoDaysFromToday(-75);
  const { year, month } = yearMonthFromIso(monthContextDate);
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const monthMemo = unique("tx-add-month-context-row");

  await registerAndVerify(page, { email, displayName });
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
  await expect(transactionSheet).toContainText("금액, 카테고리, 메모 순서로 바로 저장합니다.");

  const details = await openTransactionQuickDetails(transactionSheet, "추가 입력");
  const dateInput = labeledField(details, "일자", "input");
  await expect(dateInput).toBeVisible();
  await expect(dateInput).toHaveValue(new RegExp(`^${monthPrefix}-`));
  await capture(page, "issue-213-mobile-add-date-in-visible-month-context");
});

test("issue 234: mobile transaction add keeps saved context in secondary details", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-add-context-first-screen")}@example.com`;
  const displayName = unique("tx-add-context-first-screen-name");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 320, height: 568 });
  const transactionSheet = await openMobileTransactionQuickEntry(page);
  await expect(page.getByRole("dialog", { name: "거래 추가 레이어" })).toBeVisible();
  await expect(page.getByTestId("transaction-quick-save")).toBeVisible();
  await expect(page.getByTestId("transaction-quick-amount")).toBeFocused();

  const secondaryDetails = transactionSheet.locator("details.transaction-quick-details").first();
  const secondarySummaryLabel = secondaryDetails.locator("summary > span").first();
  await expect(secondarySummaryLabel).toHaveText("추가 설정");
  await expect(transactionSheet.locator("details.transaction-quick-details[open]")).toHaveCount(0);

  const metrics = await transactionSheet.evaluate((sheet) => {
    const amount = sheet.querySelector("[data-testid='transaction-quick-amount']");
    const recommendation = sheet.querySelector(".transaction-quick-category-panel");
    const memo = Array.from(sheet.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.replace(/\s+/g, " ").trim().startsWith("메모"))
      ?.querySelector("input");
    const details = sheet.querySelector("details.transaction-quick-details");
    const saveButton = sheet.querySelector("[data-testid='transaction-quick-save']");
    const amountRect = amount?.getBoundingClientRect();
    const recommendationRect = recommendation?.getBoundingClientRect();
    const memoRect = memo?.getBoundingClientRect();
    const detailsRect = details?.getBoundingClientRect();
    const saveRect = saveButton?.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    return {
      viewportHeight,
      amountTop: amountRect?.top || 0,
      amountBottom: amountRect?.bottom || 0,
      recommendationTop: recommendationRect?.top || 0,
      recommendationBottom: recommendationRect?.bottom || 0,
      memoTop: memoRect?.top || 0,
      memoBottom: memoRect?.bottom || 0,
      detailsTop: detailsRect?.top || 0,
      saveTop: saveRect?.top || 0,
      saveBottom: saveRect?.bottom || 0,
    };
  });

  expect(metrics.amountTop, JSON.stringify(metrics)).toBeGreaterThanOrEqual(0);
  expect(metrics.recommendationTop, "recommendation should remain below amount").toBeGreaterThan(metrics.amountBottom);
  expect(metrics.memoTop, "memo should remain below category").toBeGreaterThan(metrics.recommendationTop);
  expect(metrics.detailsTop, "secondary details should not precede primary fields").toBeGreaterThan(metrics.memoTop);
  expect(metrics.saveTop, JSON.stringify(metrics)).toBeLessThan(metrics.viewportHeight);
  await openTransactionQuickDetails(transactionSheet, "추가 입력");
  const contextItems = [
    ["transaction-quick-context-flow", "유형"],
    ["transaction-quick-context-date", "일자"],
    ["transaction-quick-context-owner", "거래자"],
    ["transaction-quick-context-category", "카테고리"],
  ];
  for (const [testId, label] of contextItems) {
    await expect(page.getByTestId(testId)).toContainText(label);
  }
  await capture(page, "issue-234-mobile-add-context-secondary-details");
});

test("issue 237: mobile transaction edit keeps completion controls in the first viewport", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-mobile-edit-save-flow")}@example.com`;
  const displayName = unique("tx-mobile-edit-save-flow-name");
  const memo = unique("tx-mobile-edit-save-flow-memo");
  const occurredOn = currentE2EHistoryDateIso();

  await registerAndVerify(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "23700",
    occurredOn,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible({ timeout: 20_000 });
  await mobileRow.locator(".transaction-col-memo").click();
  await expect(mobileRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1);
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
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
  await page.waitForLoadState("networkidle");

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
      owner: visible(".transaction-owner-summary"),
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
  expect(metrics.memo?.text || "", `collapsed memo should keep the memo text: ${JSON.stringify(metrics)}`).toBe(memo);
  expect(metrics.owner?.hidden, `collapsed owner summary should be visible: ${JSON.stringify(metrics)}`).toBe(false);
  expect(metrics.owner?.text || "", `collapsed owner summary should use the full owner label: ${JSON.stringify(metrics)}`).toBe(displayName);
  for (const label of ["거래 세부 보기"]) {
    const button = metrics.actions.find((action) => action.text === label || action.ariaLabel === label);
    expect(button, `${label} action should exist in the collapsed row: ${JSON.stringify(metrics)}`).toBeTruthy();
    expect(button?.hidden, `${label} action should be directly visible in the collapsed row: ${JSON.stringify(metrics)}`).toBe(false);
    expect(button?.height ?? 0, `${label} action should keep a touchable height: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(32);
  }
  expect(
    metrics.actions.some((action) => ["수정", "삭제"].includes(action.text) || ["수정", "삭제"].includes(action.ariaLabel)),
    `edit/delete should move out of the collapsed row actions: ${JSON.stringify(metrics)}`
  ).toBe(false);
  expect(metrics.row.height, `collapsed row should stay compact enough for scanning: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(96);
  expect(metrics.pageOverflowX, `collapsed row should not cause horizontal overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-198-mobile-row-key-details-actions");
  await selectTransactionRowForToolbar(page, mobileRow);
  await expect(page.getByTestId("transaction-selection-edit")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-above")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-below")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-delete")).toBeVisible();
});

test("issue 220: mobile collapsed transaction row scans as one ledger line", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-one-line-row")}@example.com`;
  const displayName = unique("tx-one-line-owner");
  const memo = unique("tx-one-line-memo");
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
  await page.waitForLoadState("networkidle");

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
    const rowBox = row.getBoundingClientRect();
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
    const lineItems = [
      read(".mobile-date-text"),
      read(".transaction-flow-short"),
      read(".transaction-mobile-category-cue"),
      read(".transaction-memo-text"),
      read(".transaction-owner-summary"),
      read(".transaction-amount-text"),
      ...buttons,
    ].filter((item) => item && !item.hidden);
    const centers = lineItems.map((item) => item.center);
    const centerBandCount = new Set(lineItems.map((item) => Math.round(item.center / 4) * 4)).size;
    return {
      row: {
        height: rowBox.height,
        expanded: row.getAttribute("data-row-expanded"),
      },
      lineItems,
      buttons,
      centerBandCount,
      centerSpread: Math.max(...centers) - Math.min(...centers),
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.row.expanded, `row should stay collapsed: ${JSON.stringify(metrics)}`).toBe("false");
  expect(metrics.row.height, `collapsed row should fit a one-line ledger scan: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(58);
  expect(metrics.centerBandCount, `collapsed row should not split visible content into stacked center lines: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(2);
  expect(metrics.centerSpread, `date/type/memo/amount/actions should share one scan line: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(12);
  for (const label of ["거래 세부 보기"]) {
    const button = metrics.buttons.find((action) => action.text === label || action.ariaLabel === label);
    expect(button, `${label} action should remain direct in the one-line row: ${JSON.stringify(metrics)}`).toBeTruthy();
    expect(button?.hidden, `${label} action should remain visible in the one-line row: ${JSON.stringify(metrics)}`).toBe(false);
    expect(button?.height ?? 0, `${label} action should keep a touchable height: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(32);
  }
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

test("issue 221: mobile transaction status chips keep clear action in viewport", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-status-chip-row")}@example.com`;
  const displayName = unique("tx-status-chip-owner");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

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

  expect(metrics.strip.flexWrap, `status chips should wrap instead of hiding overflow: ${JSON.stringify(metrics)}`).toBe("wrap");
  expect(metrics.strip.scrollWidth, `status chip strip should not require hidden horizontal scroll: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.strip.clientWidth + 1
  );
  expect(metrics.clippedItems, `status chips and clear action should stay in the viewport: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.visibleItems.map((item) => item.text).join(" ")).toContain("선택 해제");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-221-mobile-status-chips-visible");
});

test("issue 222: mobile transaction add FAB does not cover bottom ledger rows", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-fab-clearance")}@example.com`;
  const displayName = unique("tx-fab-clearance-owner");
  const memoPrefix = unique("tx-fab-clearance-row");
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
  await page.waitForLoadState("networkidle");

  const transactionFab = page.getByTestId("transactions-fab");
  await expect(transactionFab).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);

  const metrics = await page.evaluate(() => {
    const fab = document.querySelector("[data-testid='transactions-fab']");
    const fabBox = fab?.getBoundingClientRect();
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
    const rows = Array.from(document.querySelectorAll("tr.transaction-row"))
      .map((row) => {
        const rowBox = row.getBoundingClientRect();
        const targets = [
          ".mobile-date-text",
          ".transaction-flow-short",
          ".transaction-mobile-category-cue",
          ".transaction-memo-text",
          ".transaction-owner-summary",
          ".transaction-amount-text",
        ]
          .map((selector) => boxOf(row.querySelector(selector)))
          .concat(Array.from(row.querySelectorAll(".transaction-col-actions button")).map((button) => boxOf(button)))
          .filter((target) => target && !target.hidden);
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
          rowIntersectsFab: intersects(rowBox, fabBox, 1),
        };
      })
      .filter((row) => row.row.top < window.innerHeight && row.row.bottom > 0);
    return {
      scrollY: window.scrollY,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fab: fabBox
        ? {
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
      visibleRowCount: rows.length,
      lowestVisibleRowBottom: rows.reduce((maxBottom, row) => Math.max(maxBottom, row.row.bottom), 0),
      bottomFabClearance: fabBox ? fabBox.top - rows.reduce((maxBottom, row) => Math.max(maxBottom, row.row.bottom), 0) : null,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.fab, `transaction FAB should have geometry: ${JSON.stringify(metrics)}`).toBeTruthy();
  expect(metrics.visibleRowCount, `test should exercise visible ledger rows: ${JSON.stringify(metrics)}`).toBeGreaterThan(0);
  expect(metrics.bottomFabClearance, `bottom rows should stop above the fixed FAB safe zone: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(16);
  expect(metrics.coveredRows, `FAB should not cover readable or tappable row content: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.pageOverflowX, `FAB clearance should not create horizontal overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-222-mobile-fab-bottom-row-clearance");
});

test("issue 223: desktop transaction add action does not cover bottom row actions", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-desktop-fab-clearance")}@example.com`;
  const displayName = unique("tx-desktop-fab-owner");
  const memoPrefix = unique("tx-desktop-fab-row");
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    const fab = document.querySelector("[data-testid='transactions-fab']");
    const row = Array.from(document.querySelectorAll("tr.transaction-row"))[Math.min(28, document.querySelectorAll("tr.transaction-row").length - 1)];
    const actionButton = row?.querySelector(".transaction-col-select input[type='checkbox'], .transaction-col-actions button");
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

  const metrics = await page.evaluate(() => {
    const fixedFab = document.querySelector("[data-testid='transactions-fab']");
    const desktopAdd = document.querySelector("[data-testid='transactions-desktop-add-action']");
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
      document.querySelectorAll("tr.transaction-row .transaction-col-select input[type='checkbox'], tr.transaction-row .transaction-col-actions button"),
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
    return {
      scrollY: window.scrollY,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fixedFab: fabBox,
      desktopAdd: boxOf(desktopAdd),
      coveredActionTargets: actionTargets.filter((target) => intersects(target, fabBox, 1)),
      centerCoveredActionTargets: actionTargets.filter((target) => target.centerCoveredByFab && !target.hitVisible),
      visibleActionTargetCount: actionTargets.length,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.visibleActionTargetCount, `test should exercise visible row targets: ${JSON.stringify(metrics)}`).toBeGreaterThan(0);
  expect(metrics.coveredActionTargets, `desktop add affordance should not cover row targets: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.centerCoveredActionTargets, `desktop row target centers should remain directly hittable: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.desktopAdd, `desktop add action should be docked in the toolbar: ${JSON.stringify(metrics)}`).toBeTruthy();
  expect(metrics.desktopAdd.display, `desktop add action should be visible: ${JSON.stringify(metrics)}`).not.toBe("none");
  expect(metrics.desktopAdd.visibility, `desktop add action should be visible: ${JSON.stringify(metrics)}`).toBe("visible");
  expect(metrics.pageOverflowX, `desktop add clearance should not create horizontal overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-223-desktop-add-action-row-clearance");
});

test("issue 224: desktop transaction row edit and delete targets stay comfortable", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-desktop-row-actions")}@example.com`;
  const displayName = unique("tx-desktop-row-actions-owner");
  const memoPrefix = unique("tx-desktop-row-actions-row");
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
  await page.waitForLoadState("networkidle");
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

test("issue 227: 1024px transaction row actions stay inside the viewport", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-1024-actions")}@example.com`;
  const displayName = unique("tx-1024-actions-owner");
  const memoPrefix = unique("tx-1024-actions-row");
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
  await page.waitForLoadState("networkidle");

  const targetMemo = `${memoPrefix}-00`;
  const targetRow = page.locator("tr.transaction-row", { hasText: targetMemo }).first();
  await expect(targetRow).toBeVisible({ timeout: 20_000 });
  await page.locator(".transaction-list-card").first().evaluate((element) => element.scrollIntoView({ block: "start" }));
  await targetRow.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await page.locator(".transactions-surface-scroll").first().evaluate((element) => {
    element.scrollLeft = 0;
  });
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

  expect(metrics.headerAction, `desktop action header should exist: ${JSON.stringify(metrics)}`).toBeTruthy();
  expect(metrics.actionCell, `target row action cell should exist: ${JSON.stringify(metrics)}`).toBeTruthy();
  expect(metrics.actionButtons.length, `row-level edit/delete targets should move out of the ledger row: ${JSON.stringify(metrics)}`).toBe(0);
  expect(metrics.pageOverflowX, `1024px desktop page should not overflow horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.scroller.scrollOverflowX, `1024px transaction table should not need horizontal scroll for row actions: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.outsideViewport, `desktop action header/cell should stay inside viewport: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.undersizedTargets, `desktop row should not expose undersized edit/delete targets: ${JSON.stringify(metrics)}`).toEqual([]);
  expect(metrics.hiddenHitTargets, `desktop row should not expose hidden edit/delete centers: ${JSON.stringify(metrics)}`).toEqual([]);
  await targetRow.locator("input[type='checkbox']").check({ force: true });
  await expectTransactionSelectionSummary(page, 1);
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
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
  await page.waitForLoadState("networkidle");

  for (const memo of memos) {
    const row = page.locator("tr.transaction-row", { hasText: memo }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.locator(".transaction-col-select input[type='checkbox']").check({ force: true });
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
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
    await page.waitForLoadState("networkidle");
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

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

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

  await memoFilterTrigger.click();
  const mobileFilterPanel = page.getByTestId("tx-ledger-filter-panel");
  await expect(mobileFilterPanel).toContainText("메모 필터");
  await expect(mobileFilterPanel.getByPlaceholder("메모 검색")).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "필터 닫기", exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-228-mobile-memo-filter-direct");

  await mobileFilterPanel.getByRole("button", { name: "닫기" }).click();
  await expect(mobileFilterPanel).toBeHidden();
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-228-mobile-filter-closed");
});

test("issue #249: mobile transaction sticky stack uses measured heights", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-sticky-measured")}@example.com`;
  const displayName = unique("tx-sticky-measured-owner");
  const memo = unique("tx-sticky-measured-row");

  await registerAndVerify(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "49000",
    occurredOn: isoDaysAgo(0),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

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

  await registerAndVerify(page, { email, displayName });
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
  await page.waitForLoadState("networkidle");
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

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 768 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

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
  await page.waitForLoadState("networkidle");

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
  await mobileRow.locator(".transaction-col-memo").click();
  await expect(mobileRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1);
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

  await registerAndVerify(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "21900",
    occurredOn,
    ownerName: displayName,
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible({ timeout: 20_000 });
  await mobileRow.locator(".transaction-col-memo").click();
  await expect(mobileRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1);
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

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 320, height: 568 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

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
  const category = await registerAndVerify(page, { email, displayName }).then(() =>
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
  await page.waitForLoadState("networkidle");

  const mobileLedgerHead = page.locator(".transactions-mobile-ledger-head").first();
  await mobileLedgerHead.getByRole("button", { name: "유형 필터 열기" }).click();
  await expect(page.getByTestId("tx-ledger-filter-panel")).toBeVisible();

  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible();
  await mobileRow.locator(".mobile-toggle-btn").first().click();
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);

  const metrics = await mobileRow.evaluate((row) => {
    const rowBox = row.getBoundingClientRect();
    const actionRow = row.nextElementSibling?.classList.contains("transaction-mobile-expanded-actions-row")
      ? row.nextElementSibling
      : null;
    const actionBox = actionRow?.getBoundingClientRect() || null;
    const detailCells = Array.from(row.querySelectorAll(".transaction-mobile-detail-cell")).map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        className: cell.className,
        width: box.width,
        clientHeight: cell.clientHeight,
        scrollHeight: cell.scrollHeight,
        hasVerticalOverflow: cell.scrollHeight > cell.clientHeight + 1,
      };
    });
    const categoryValue = row.querySelector(".transaction-col-category .transaction-mobile-detail-value");
    const categoryText = row.querySelector(".transaction-col-category .category-cell");
    return {
      rowWidth: rowBox.width,
      rowClientHeight: row.clientHeight,
      rowScrollHeight: row.scrollHeight,
      rowHasVerticalOverflow: row.scrollHeight > row.clientHeight + 1,
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

  await registerAndVerify(page, { email, displayName });
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
  await page.waitForLoadState("networkidle");

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
  await registerAndVerify(page, { email, displayName });

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

  await registerAndVerify(page, { email, displayName });

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

  await registerAndVerify(page, { email, displayName });
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

test("transactions history shows compact date groups with fixed chronological order", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-history")}@example.com`;
  const displayName = unique("tx-history-name");
  const olderDate = isoDaysAgo(45);
  const middleDate = isoDaysAgo(20);
  const todayDate = isoDaysAgo(0);
  const olderMemo = unique("tx-history-older");
  const middleMemo = unique("tx-history-middle");
  const todayMemo = unique("tx-history-today");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });

  await createBasicTransaction(page, { memo: olderMemo, amount: "10101", occurredOn: olderDate });
  await createBasicTransaction(page, { memo: middleMemo, amount: "20202", occurredOn: middleDate });
  await createBasicTransaction(page, { memo: todayMemo, amount: "30303", occurredOn: todayDate });

  await openTab(page, "거래");
  await expect(page.locator("tr.transaction-row", { hasText: todayMemo })).toBeVisible();
  await expect(page.locator(".transactions-desktop-ledger-head .sort-header-static").first()).toHaveAttribute(
    "aria-label",
    /연속 내역순 고정/,
  );
  await expect(page.locator(".transaction-history-date-row", { hasText: olderDate })).toHaveCount(1);
  await expect(page.locator(".transaction-history-date-row", { hasText: middleDate })).toHaveCount(1);
  await expect(page.locator(".transaction-history-date-row", { hasText: todayDate })).toHaveCount(1);

  const renderedMemos = await page.locator("tr.transaction-row .transaction-memo-text").evaluateAll((nodes) =>
    nodes.map((node) => String(node.textContent || "").trim())
  );
  expect(renderedMemos.indexOf(olderMemo)).toBeLessThan(renderedMemos.indexOf(middleMemo));
  expect(renderedMemos.indexOf(middleMemo)).toBeLessThan(renderedMemos.indexOf(todayMemo));

  const dateHeaderHeights = await page.locator(".transaction-history-date-row").evaluateAll((rows) =>
    rows.map((row) => row.getBoundingClientRect().height)
  );
  expect(
    dateHeaderHeights.every((height) => height <= 32),
    `history date headers should stay thin: ${JSON.stringify(dateHeaderHeights)}`
  ).toBe(true);
  await capture(page, "transactions-history-groups");
});

test("transactions history scrolls older and newer without future rows while keeping compact anchors", async ({ page }) => {
  test.skip(process.env.E2E_INCLUDE_SLOW !== "1", "slow history pagination regression is opt-in via npm run e2e:slow");
  test.setTimeout(300_000);

  const email = `${unique("tx-history-scroll")}@example.com`;
  const displayName = unique("tx-history-scroll-name");
  const prefix = unique("tx-history-scroll-row");
  const seeded = [];
  const totalSeedRows = 90;
  const oldestDaysAgo = totalSeedRows - 1;
  const createAnchorDate = isoDaysAgo(45);
  const futureDate = isoDaysFromToday(3);
  const futureMemo = `${prefix}-future`;

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });

  await createTransactionViaApi(page, {
    memo: futureMemo,
    amount: "99999",
    occurredOn: futureDate,
    ownerName: displayName,
  });
  for (let index = 0; index < totalSeedRows; index += 1) {
    const daysAgo = oldestDaysAgo - index;
    const memo = `${prefix}-${String(index).padStart(2, "0")}`;
    const occurredOn = isoDaysAgo(daysAgo);
    seeded.push({ memo, occurredOn, daysAgo });
    await createTransactionViaApi(page, {
      memo,
      amount: String(10000 + index),
      occurredOn,
      ownerName: displayName,
    });
  }

  await page.reload();
  await assertResponsiveShell(page);
  await openTab(page, "거래");

  const oldestMemo = seeded[0].memo;
  const initialAnchorMemo = seeded[10].memo;
  const todayMemo = seeded[seeded.length - 1].memo;
  await expect(page.locator("tr.transaction-row", { hasText: todayMemo }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("tr.transaction-row", { hasText: oldestMemo })).toHaveCount(0);
  await expect(page.locator("tr.transaction-row", { hasText: futureMemo })).toHaveCount(0);
  await expect(page.locator(".transaction-history-date-row", { hasText: futureDate })).toHaveCount(0);
  await expect(page.locator(".transactions-desktop-ledger-head .sort-header-static").first()).toHaveAttribute(
    "aria-label",
    /연속 내역순 고정/,
  );
  await expect(page.locator(".transactions-desktop-ledger-head button.sort-header")).toHaveCount(0);
  await expectTransactionMonthControls(page, seeded[seeded.length - 1].occurredOn, "initial today anchor");
  expectMonthStepperCentered(await readTransactionMonthStepperLayout(page), "desktop transaction month stepper");
  await expectDesktopSidebarSticky(page);

  const historyRoutePattern = "**/api/v1/transactions/history**";
  let resolveOlderRoute;
  let heldOlderRoute = null;
  const olderRoutePromise = new Promise((resolve) => {
    resolveOlderRoute = resolve;
  });
  const holdOlderHistoryRoute = async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("direction") === "older" && !heldOlderRoute) {
      heldOlderRoute = route;
      resolveOlderRoute(route);
      return;
    }
    await route.continue();
  };
  await page.route(historyRoutePattern, holdOlderHistoryRoute);

  const anchorRow = page.locator("tr.transaction-row", { hasText: initialAnchorMemo }).first();
  await anchorRow.scrollIntoViewIfNeeded();
  await expect(anchorRow).toBeVisible();

  const oldestRow = page.locator("tr.transaction-row", { hasText: oldestMemo }).first();
  let olderRoute = await Promise.race([olderRoutePromise, page.waitForTimeout(750).then(() => null)]);
  for (let attempt = 0; attempt < 5 && !olderRoute; attempt += 1) {
    if (await oldestRow.isVisible().catch(() => false)) {
      break;
    }
    await page.evaluate(() => window.scrollBy(0, -2400));
    olderRoute = await Promise.race([olderRoutePromise, page.waitForTimeout(1_000).then(() => null)]);
  }
  const anchorBefore = await captureVisibleHistoryAnchor(page);
  expect(anchorBefore?.id, "history anchor row should be capturable while older page is loading").toBeTruthy();
  if (olderRoute) {
    await olderRoute.continue();
  }
  await page.unroute(historyRoutePattern, holdOlderHistoryRoute);
  await expect(oldestRow).toBeVisible({ timeout: 40_000 });
  const anchorLocator = page.locator(`tr.transaction-row[data-transaction-id="${anchorBefore.id}"]`);
  await expect
    .poll(
      async () => {
        const anchorAfter = await anchorLocator.boundingBox();
        if (!anchorAfter) {
          return Number.POSITIVE_INFINITY;
        }
        return Math.abs(anchorAfter.y - (anchorBefore?.top ?? 0));
      },
      { message: "history anchor row should settle near its previous viewport position", timeout: 4_000 }
    )
    .toBeLessThanOrEqual(120);
  await scrollHistoryRowIntoViewport(page, oldestMemo, seeded[0].occurredOn, "start", "up");
  await expect(page.locator(".transaction-history-date-row", { hasText: seeded[0].occurredOn })).toBeVisible();
  await expect(page.locator(".transaction-list-card").first().getByText("조회 가능 월")).toContainText(
    seeded[0].occurredOn.slice(0, 7)
  );
  const rowIds = await page.locator("tr.transaction-row").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-transaction-id")).filter(Boolean)
  );
  expect(new Set(rowIds).size).toBe(rowIds.length);

  const monthAnchorSeed = seeded.find((item) => item.occurredOn === createAnchorDate) || seeded[3];
  await jumpTransactionListToMonth(page, monthAnchorSeed.occurredOn);
  await expect(page.locator("tr.transaction-row", { hasText: monthAnchorSeed.memo }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_000);

  const unsolicitedHistoryDirections = [];
  const trackUnsolicitedHistoryRoute = async (route) => {
    const url = new URL(route.request().url());
    const direction = url.searchParams.get("direction");
    if (direction === "older" || direction === "newer") {
      unsolicitedHistoryDirections.push(direction);
    }
    await route.continue();
  };
  await page.route(historyRoutePattern, trackUnsolicitedHistoryRoute);
  await page.evaluate(() => {
    const midpoint = Math.max(0, (document.documentElement.scrollHeight - window.innerHeight) / 2);
    window.scrollTo(0, midpoint);
  });
  await page.waitForTimeout(750);
  await page.unroute(historyRoutePattern, trackUnsolicitedHistoryRoute);
  expect(
    unsolicitedHistoryDirections,
    `mid-list history anchor should not trigger unsolicited edge pagination: ${JSON.stringify(unsolicitedHistoryDirections)}`
  ).toEqual([]);

  const backdatedMemo = `${prefix}-backdated-create`;
  const backdatedRow = await createBasicTransaction(page, {
    memo: backdatedMemo,
    amount: "90909",
    occurredOn: monthAnchorSeed.occurredOn,
  });
  await expect(backdatedRow).toBeVisible();

  await scrollHistoryRowIntoViewport(page, todayMemo, seeded[seeded.length - 1].occurredOn, "end");
  const todayRow = page.locator("tr.transaction-row", { hasText: todayMemo }).first();
  await expect(todayRow).toBeVisible({ timeout: 40_000 });
  await expectTransactionMonthControls(page, seeded[seeded.length - 1].occurredOn, "newer visible anchor");
  await expect(page.locator("tr.transaction-row", { hasText: futureMemo })).toHaveCount(0);
  await expect(page.locator(".transaction-history-date-row", { hasText: futureDate })).toHaveCount(0);
  await expectDesktopTransactionMonthStepperSticky(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await scrollHistoryRowIntoViewport(page, todayMemo, seeded[seeded.length - 1].occurredOn, "end", "down");
  await expectTransactionMonthControls(page, seeded[seeded.length - 1].occurredOn, "mobile today anchor before older scroll");
  await scrollHistoryRowIntoViewport(page, oldestMemo, seeded[0].occurredOn, "start", "up");
  await expect(page.locator(".transaction-history-date-row", { hasText: seeded[0].occurredOn })).toBeVisible();
  expectMonthStepperCentered(await readTransactionMonthStepperLayout(page), "mobile transaction month stepper");
  await expectMobileTransactionMonthStepperSticky(page);
  await capture(page, "transactions-history-scroll-continuity");
});

test("transactions list affordance: top filters, compact ledger, ownerless marker", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("tx-affordance")}@example.com`;
  const displayName = unique("tx-affordance-name");
  const memo = unique("tx-affordance-memo");
  const incomeMemo = unique("tx-income-memo");
  const investmentMemo = unique("tx-investment-memo");
  const ownerlessMemo = unique("tx-ownerless-memo");

  await registerAndVerify(page, { email, displayName });
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
  await expect(ownerlessRow.locator(".transaction-col-owner .transaction-owner-cue")).toHaveText("-");
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

  const staticDateSort = page.locator(".transactions-desktop-ledger-head .sort-header-static").first();
  await expect(staticDateSort).toBeVisible();
  await expect(staticDateSort).toHaveAttribute("aria-label", /연속 내역순 고정/);
  await expect(page.locator(".transactions-desktop-ledger-head button.sort-header")).toHaveCount(0);
  await expectDesktopTransactionRowsSingleLine(page);

  await createdRow.locator("td").first().locator("input[type='checkbox']").check();
  await expectTransactionSelectionSummary(page, 1, "22,222원");

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
  await page.waitForLoadState("networkidle");
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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
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
  await expect(transactionStickyToolbar.locator(".surface-control-strip").first()).toBeVisible();
  const transactionControlStripBox = await transactionStickyToolbar.locator(".surface-control-strip").first().boundingBox();
  const transactionHeaderGroupBox = await transactionStickyToolbar.locator(".table-header-group").first().boundingBox();
  const transactionLedgerBox = await page.locator(".transactions-mobile-ledger-head").boundingBox();
  const transactionTableBox = await page.locator(".transactions-surface-table").boundingBox();
  expect(mobileTopbarBox, "mobile topbar should have a bounding box").not.toBeNull();
  expect(transactionToolbarBox, "transaction sticky toolbar should have a bounding box").not.toBeNull();
  expect(transactionHeadingBox, "transaction heading should have a bounding box").not.toBeNull();
  expect(transactionControlStripBox, "transaction control strip should have a bounding box").not.toBeNull();
  expect(transactionHeaderGroupBox, "transaction header group should have a bounding box").not.toBeNull();
  expect(transactionLedgerBox, "transaction ledger head should have a bounding box").not.toBeNull();
  expect(transactionTableBox, "transaction table should have a bounding box").not.toBeNull();
  expect(mobileTopbarBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(88);
  expect(transactionToolbarBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    (mobileTopbarBox?.y ?? 0) + (mobileTopbarBox?.height ?? 0) + 112,
  );
  expect(transactionHeadingBox?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual((transactionToolbarBox?.y ?? 0) - 2);
  expect(transactionControlStripBox?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual((transactionHeadingBox?.y ?? 0) - 2);
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
  await expect(mobileRow.getByText(memo, { exact: true })).toBeVisible();
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
    `mobile ledger rows should stay compact while showing key details and actions: ${JSON.stringify(collapsedRowMetrics)}`
  ).toBe(true);
  await expectBackgroundNotPlainWhite(mobileRow);
  await expectTransparentBackground(mobileRow.locator(".transaction-col-memo").first());
  await expect(mobileRow.locator(".transaction-owner-chip").first()).toHaveText(displayName.slice(0, 1));
  await expect(mobileRow.locator(".transaction-owner-chip").first()).toBeVisible();
  await expect(mobileRow.locator(".transaction-owner-summary").first()).toHaveText(displayName);
  await expect(mobileRow.locator(".transaction-owner-summary").first()).toBeVisible();
  await expect(mobileRow.locator(".transaction-flow-short").first()).toBeVisible();
  const mobileOwnerlessRow = page.locator("tr.transaction-row", { hasText: ownerlessMemo }).first();
  await expect(mobileOwnerlessRow).toBeVisible();
  await expect(mobileOwnerlessRow.locator(".transaction-owner-empty").first()).toHaveText("-");
  await expect(mobileOwnerlessRow.locator(".transaction-owner-chip")).toHaveCount(0);
  await mobileRow.click({ position: { x: 88, y: 22 } });
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);
  await mobileRow.click({ position: { x: 88, y: 22 } });
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await capture(page, "transactions-mobile-summary");
  await page.evaluate(() => window.scrollTo(0, 380));
  await page.waitForTimeout(250);
  const scrollBeforeSheet = await page.evaluate(() => window.scrollY);
  const fabScrolledBox = await transactionFab.boundingBox();
  expect(fabScrolledBox, "transaction FAB should have a bounding box after scroll").not.toBeNull();
  expect(fabScrolledBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(844);
  const visibleRowActionBoxes = await page.locator(".transaction-row .transaction-col-actions .mobile-toggle-btn").evaluateAll((nodes, fabBox) =>
    nodes
      .map((node) => {
        const box = node.getBoundingClientRect();
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);
        const centerInsideFab = Boolean(
          fabBox &&
            centerX >= fabBox.x &&
            centerX <= fabBox.x + fabBox.width &&
            centerY >= fabBox.y &&
            centerY <= fabBox.y + fabBox.height
        );
        return {
          centerInsideFab,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          hitVisible: Boolean(topElement && (topElement === node || node.contains(topElement))),
        };
      })
      .filter((box) => box.y < window.innerHeight && box.y + box.height > 0),
    fabScrolledBox
  );
  const intersects = (left, right) =>
    Boolean(
      left &&
        right &&
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y
    );
  expect(visibleRowActionBoxes.some((box) => box.hitVisible), "at least one visible row action should remain directly hittable").toBe(true);
  expect(
    visibleRowActionBoxes.some((box) => box.centerInsideFab && !box.hitVisible),
    `transaction FAB should not cover row action centers: ${JSON.stringify({ fabScrolledBox, visibleRowActionBoxes })}`
  ).toBe(false);
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
  const mobileToggleButton = mobileRow.locator(".mobile-toggle-btn").first();
  const transactionToggleBox = await mobileToggleButton.boundingBox();
  expect(transactionToggleBox, "mobile transaction detail toggle should have a bounding box").not.toBeNull();
  expect(
    (transactionToggleBox?.width ?? 0) >= 44 && (transactionToggleBox?.height ?? 0) >= 44,
    `mobile transaction detail toggle should keep a 44px hit target: ${JSON.stringify(transactionToggleBox)}`,
  ).toBe(true);
  await expectStableButtonPosition(mobileToggleButton, async () => {
    await mobileToggleButton.evaluate((element) => element.click());
  });
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);
  const expandedMemoMetrics = await mobileRow.locator(".transaction-memo-text").first().evaluate((memoElement) => {
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
  await expect(mobileRow.locator(".transaction-mobile-detail-label")).toHaveText([
    "카테고리",
    "거래자명",
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
  expect(
    expandedDetailMetrics.hasVerticalOverflow,
    `expanded transaction row should fit its detail content: ${JSON.stringify(expandedDetailMetrics)}`,
  ).toBe(false);
  expect(
    expandedDetailMetrics.actionStartsAfterRow,
    `expanded detail area should not overlap removed row actions: ${JSON.stringify(expandedDetailMetrics)}`,
  ).toBe(true);
  expect(expandedDetailMetrics.actionRowCount, `expanded row actions should be moved to the toolbar: ${JSON.stringify(expandedDetailMetrics)}`).toBe(0);
  for (const cell of expandedDetailMetrics.detailCells) {
    expect(cell.hasVerticalOverflow, `${cell.className} should not clip detail text`).toBe(false);
  }
  await expect(mobileRow.locator(".transaction-col-actions .row-delete-btn")).toHaveCount(0);
  if ((await mobileRow.getAttribute("data-row-selected")) !== "true") {
    await mobileRow.locator(".transaction-col-memo").click();
  }
  await expect(mobileRow).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1);
  await expect(page.getByTestId("transaction-selection-edit")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-above")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-insert-below")).toBeVisible();
  await expect(page.getByTestId("transaction-selection-delete")).toBeVisible();
  await mobileRow.locator("td").last().getByRole("button", { name: "거래 세부 접기" }).click();
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
