import { expect, test } from "@playwright/test";

import {
  capture,
  createCategoryViaApi,
  createTransactionViaApi,
  expectNoHorizontalOverflow,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

const DESKTOP_PROFILE = { width: 1366, height: 860, font: "Malgun Gothic" };
const isProfileCompactTransactionUI = (profile) => profile.width <= 820 || profile.ledgerCompact;
const MOBILE_PROFILES = [
  { name: "mobile-iphone-narrow", width: 320, height: 568, font: "Malgun Gothic" },
  { name: "mobile-narrow", width: 360, height: 740, font: "Malgun Gothic" },
  { name: "mobile-standard", width: 390, height: 844, font: "Apple SD Gothic Neo" },
  { name: "mobile-android-tall", width: 412, height: 915, font: "Noto Sans KR" },
  { name: "mobile-landscape-compact", width: 880, height: 500, font: "Malgun Gothic", ledgerCompact: true },
];

async function applyFontProfile(page, fontFamily) {
  await page.addStyleTag({
    content: `
      body, button, input, select, textarea {
        font-family: "${fontFamily}", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif !important;
      }
    `,
  });
}

async function seedLedger(page) {
  const email = `${unique("ledger-layout")}@example.com`;
  const displayName = unique("ledger-layout-user");
  const memo = `${unique("ledger-layout-memo")}-긴메모-가계부-열정렬`;

  await registerAndVerify(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo,
    amount: "123456",
    ownerName: displayName,
  });
  const wideMemo = `${unique("ledger-layout-wide")}-큰금액`;
  await createTransactionViaApi(page, {
    memo: wideMemo,
    amount: "1234567890",
    ownerName: displayName,
  });
  await page.reload();
  return { memo, wideMemo };
}

async function openLedger(page, profile) {
  await page.setViewportSize({ width: profile.width, height: profile.height });
  await applyFontProfile(page, profile.font);
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("tr.transaction-row[data-transaction-id]").first()).toBeVisible({ timeout: 20_000 });
}

async function expectCompactFabKeyboardOrder(page, profileName) {
  const setup = await page.evaluate(() => {
    const labelOf = (element) =>
      element?.getAttribute("data-testid") ||
      element?.getAttribute("aria-label") ||
      element?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ||
      element?.tagName ||
      "";
    const isFocusable = (element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      if (element.matches("[disabled],[aria-disabled='true']") || element.tabIndex < 0) {
        return false;
      }
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const focusables = Array.from(document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]")).filter(isFocusable);
    const fab = document.querySelector('[data-testid="transactions-fab"]');
    const rows = Array.from(document.querySelectorAll("tr.transaction-row[data-transaction-id]")).filter(isFocusable);
    const fabIndex = focusables.indexOf(fab);
    const firstRow = rows[0] || null;
    const firstRowIndex = focusables.indexOf(firstRow);
    const previous = fabIndex > 0 ? focusables[fabIndex - 1] : null;
    previous?.focus();
    return {
      activeBefore: labelOf(document.activeElement),
      fabIndex,
      firstRowId: firstRow?.getAttribute("data-transaction-id") || "",
      firstRowIndex,
      previous: labelOf(previous),
      sample: focusables.slice(Math.max(0, fabIndex - 3), fabIndex + 8).map(labelOf),
    };
  });
  expect(setup.fabIndex, `${profileName} FAB should be tabbable: ${JSON.stringify(setup)}`).toBeGreaterThan(0);
  expect(setup.firstRowIndex, `${profileName} first row should be tabbable after FAB: ${JSON.stringify(setup)}`).toBeGreaterThan(
    setup.fabIndex,
  );
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("transactions-fab"), `${profileName} keyboard Tab should reach FAB before ledger rows`).toBeFocused();

  const visited = [];
  let reachedFirstRow = false;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const element = document.activeElement;
      const row = element?.closest?.("tr.transaction-row[data-transaction-id]");
      return {
        label:
          element?.getAttribute("data-testid") ||
          element?.getAttribute("aria-label") ||
          element?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ||
          element?.tagName ||
          "",
        rowId: row?.getAttribute("data-transaction-id") || "",
      };
    });
    visited.push(active);
    if (active.rowId) {
      reachedFirstRow = active.rowId === setup.firstRowId;
      break;
    }
  }
  expect(reachedFirstRow, `${profileName} first ledger row should be reachable only after FAB: ${JSON.stringify({ setup, visited })}`).toBe(
    true,
  );
}

async function openTransactionEntrySheet(page, profile) {
  await page.setViewportSize({ width: profile.width, height: profile.height });
  await applyFontProfile(page, profile.font);
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");
  const addAction = isProfileCompactTransactionUI(profile)
    ? page.getByTestId("transactions-fab")
    : page.getByTestId("transactions-desktop-add-action");
  await expect(addAction).toBeVisible();
  await expect(addAction).toBeEnabled();
  await addAction.click();
  const sheet = page.getByTestId("transaction-entry-sheet");
  await expect(sheet).toBeVisible();
  return sheet;
}

async function selectTransactionRow(page, memo) {
  const row = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(row).toBeVisible();
  if ((await row.getAttribute("data-row-selected")) !== "true") {
    await row.locator(".transaction-col-memo").click();
  }
  await expect(row).toHaveAttribute("data-row-selected", "true");
}

function expectClose(actual, expected, tolerance, label) {
  expect(Math.abs(actual - expected), `${label}: ${JSON.stringify({ actual, expected, tolerance })}`).toBeLessThanOrEqual(
    tolerance,
  );
}

function expectCloseCssPx(actual, expected, tolerance, label) {
  expectClose(Number.parseFloat(actual), Number.parseFloat(expected), tolerance, label);
}

test("transaction ledger keeps dense columns, bottom mobile chrome, and quiet selection actions", async ({ page }) => {
  test.setTimeout(180_000);

  const { memo, wideMemo } = await seedLedger(page);
  await openLedger(page, DESKTOP_PROFILE);

  const desktopMetrics = await page.evaluate(() => {
    const columnSpecs = [
      { key: "occurred_on", head: '[data-field-key="occurred_on"]', body: '[data-field-key="occurred_on"]' },
      { key: "flow_type", head: '[data-field-key="flow_type"]', body: '[data-field-key="flow_type"]' },
      { key: "category", head: '[data-field-key="category"]', body: '[data-field-key="category"]' },
      { key: "memo", head: '[data-field-key="memo"]', body: '[data-field-key="memo"]' },
      { key: "amount", head: '[data-field-key="amount"]', body: '[data-field-key="amount"]' },
      { key: "owner_name", head: '[data-field-key="owner_name"]', body: '[data-field-key="owner_name"]' },
      { key: "updated_at", head: '[data-field-key="updated_at"]', body: '[data-field-key="updated_at"]' },
    ];
    const header = document.querySelector(".transactions-desktop-ledger-head");
    const row = document.querySelector("tr.transaction-row[data-transaction-id]");
    const typeBadge = row?.querySelector(".transaction-col-type .transaction-flow-full");
    const ownerCompact = row?.querySelector(".transaction-col-owner .transaction-owner-compact");
    const ownerText = row?.querySelector(".transaction-col-owner .transaction-owner-cue");
    const boxOf = (element) => {
      const box = element?.getBoundingClientRect();
      return box
        ? {
            left: box.left,
            right: box.right,
            width: box.width,
            height: box.height,
            centerX: box.left + box.width / 2,
          }
        : null;
    };
    const visible = (element) => {
      if (!element) {
        return false;
      }
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    return {
      rowHeight: row?.getBoundingClientRect().height ?? 0,
      headerDisplay: header ? getComputedStyle(header).display : "missing",
      visibleSelectColumns: [header?.querySelector(".transaction-col-select"), row?.querySelector(".transaction-col-select")].filter(
        visible
      ).length,
      visibleActionColumns: [
        header?.querySelector(".transaction-col-actions"),
        row?.querySelector(".transaction-col-actions"),
      ].filter(visible).length,
      typeBadge: typeBadge
        ? {
            text: typeBadge.textContent?.trim() || "",
            clientWidth: typeBadge.clientWidth,
            scrollWidth: typeBadge.scrollWidth,
          }
        : null,
      owner: {
        compactVisible: visible(ownerCompact),
        compactText: ownerCompact?.textContent?.trim() || "",
        cueText: ownerText?.textContent?.trim() || "",
      },
      columns: columnSpecs.map((spec) => {
        const head = header?.querySelector(spec.head);
        const body = row?.querySelector(spec.body);
        const headAction = head?.querySelector(".sort-header, .ledger-head-action");
        const headBox = boxOf(head);
        const bodyBox = boxOf(body);
        const labelBox = boxOf(headAction || head);
        const style = head ? getComputedStyle(head) : null;
        const actionStyle = headAction ? getComputedStyle(headAction) : null;
        return {
          key: spec.key,
          headBox,
          bodyBox,
          labelBox,
          justifyContent: style?.justifyContent || "",
          textAlign: style?.textAlign || "",
          actionJustifyContent: actionStyle?.justifyContent || "",
          actionTextAlign: actionStyle?.textAlign || "",
        };
      }),
    };
  });

  expect(desktopMetrics.headerDisplay, `desktop header should be rendered: ${JSON.stringify(desktopMetrics)}`).toBe("grid");
  expect(desktopMetrics.visibleSelectColumns, `desktop should not show selection checkbox columns: ${JSON.stringify(desktopMetrics)}`).toBe(0);
  expect(desktopMetrics.visibleActionColumns, `desktop should not show detail/status columns: ${JSON.stringify(desktopMetrics)}`).toBe(0);
  expect(
    desktopMetrics.rowHeight,
    `desktop transaction row should stay ledger-dense: ${JSON.stringify(desktopMetrics)}`,
  ).toBeLessThanOrEqual(38);
  expect(desktopMetrics.typeBadge, `desktop type badge should exist: ${JSON.stringify(desktopMetrics)}`).not.toBeNull();
  expect(desktopMetrics.typeBadge.text).toBe("지출");
  expect(
    desktopMetrics.typeBadge.scrollWidth,
    `desktop type badge should not clip: ${JSON.stringify(desktopMetrics.typeBadge)}`,
  ).toBeLessThanOrEqual(desktopMetrics.typeBadge.clientWidth + 1);
  expect(desktopMetrics.owner.compactVisible, `desktop owner initial should be visible: ${JSON.stringify(desktopMetrics.owner)}`).toBe(true);
  expect(Array.from(desktopMetrics.owner.compactText)).toHaveLength(1);
  expect(desktopMetrics.owner.cueText).toBeTruthy();
  for (const column of desktopMetrics.columns) {
    expect(column.headBox, `${column.key} header box should exist: ${JSON.stringify(desktopMetrics)}`).not.toBeNull();
    expect(column.bodyBox, `${column.key} body box should exist: ${JSON.stringify(desktopMetrics)}`).not.toBeNull();
    expect(column.labelBox, `${column.key} label box should exist: ${JSON.stringify(desktopMetrics)}`).not.toBeNull();
    expectClose(column.headBox.left, column.bodyBox.left, 2, `${column.key} left edge`);
    expectClose(column.headBox.width, column.bodyBox.width, 2.5, `${column.key} width`);
    if (column.key === "amount") {
      expectClose(column.labelBox.right, column.headBox.right, 3, `${column.key} header label right edge`);
      expect(column.justifyContent, `${column.key} header cell should right-align numeric content: ${JSON.stringify(column)}`).toBe("flex-end");
      expect(column.textAlign, `${column.key} header cell should right-align numeric text: ${JSON.stringify(column)}`).toBe("right");
      expect(
        column.actionJustifyContent,
        `${column.key} header button should right-align its visible label: ${JSON.stringify(column)}`,
      ).toBe("flex-end");
      expect(column.actionTextAlign, `${column.key} header button should right-align text: ${JSON.stringify(column)}`).toBe("right");
    } else {
      expectClose(column.labelBox.centerX, column.headBox.centerX, 1.5, `${column.key} header label center`);
      expect(column.justifyContent, `${column.key} header should center content: ${JSON.stringify(column)}`).toBe("center");
      expect(column.textAlign, `${column.key} header should center text: ${JSON.stringify(column)}`).toBe("center");
      if (column.actionJustifyContent) {
        expect(column.actionJustifyContent, `${column.key} header button should center its visible label: ${JSON.stringify(column)}`).toBe("center");
      }
    }
  }

  const hoverTarget = page.locator(".transactions-desktop-ledger-head .ledger-head-action").first();
  await hoverTarget.hover();
  const hoverMetrics = await hoverTarget.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow,
      transform: style.transform,
    };
  });
  expect(hoverMetrics.transform, `desktop header hover should not float: ${JSON.stringify(hoverMetrics)}`).toBe("none");
  expect(hoverMetrics.backgroundImage, `desktop header hover should not paint blue: ${JSON.stringify(hoverMetrics)}`).toBe(
    "none"
  );
  expect(hoverMetrics.boxShadow, `desktop header hover should remain flat: ${JSON.stringify(hoverMetrics)}`).toBe("none");

  await expectNoHorizontalOverflow(page, 8);
  await capture(page, "transactions-ledger-layout-desktop");

  for (const profile of MOBILE_PROFILES) {
    await openLedger(page, profile);
    const mobileMetrics = await page.evaluate(() => {
      const nav = document.querySelector("nav.topbar-tabs");
      const fab = document.querySelector('[data-testid="transactions-fab"]');
      const row = document.querySelector("tr.transaction-row[data-transaction-id]");
      const amount = row?.querySelector(".transaction-col-amount");
      const action = row?.querySelector(".transaction-col-actions");
      const cellLabels = Array.from(row?.querySelectorAll("td[data-label]") || []).map((cell) => cell.getAttribute("aria-label") || "");
      const navBox = nav?.getBoundingClientRect();
      const fabBox = fab?.getBoundingClientRect();
      const rowBox = row?.getBoundingClientRect();
      const amountText = amount?.querySelector(".transaction-amount-text");
      const amountTextBox = amountText?.getBoundingClientRect();
      const readBox = (box) =>
        box
          ? {
              left: box.left,
              right: box.right,
              width: box.width,
              height: box.height,
            }
          : null;
      const boxesOverlap = (a, b) =>
        Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        nav: navBox
          ? {
              position: getComputedStyle(nav).position,
              top: navBox.top,
              bottom: navBox.bottom,
              left: navBox.left,
              right: navBox.right,
              height: navBox.height,
              bottomGap: window.innerHeight - navBox.bottom,
            }
          : null,
        fab: fabBox
          ? {
              position: getComputedStyle(fab).position,
              inListHeading: Boolean(fab.closest(".surface-list-heading")),
              top: fabBox.top,
              left: fabBox.left,
              right: fabBox.right,
              bottom: fabBox.bottom,
              width: fabBox.width,
              height: fabBox.height,
              rightGap: window.innerWidth - fabBox.right,
              bottomGap: window.innerHeight - fabBox.bottom,
            }
          : null,
        cellLabels,
        rowHeight: rowBox?.height ?? 0,
        tableDisplay: row?.closest("table") ? getComputedStyle(row.closest("table")).display : "missing",
        tbodyDisplay: row?.parentElement ? getComputedStyle(row.parentElement).display : "missing",
        rowDisplay: row ? getComputedStyle(row).display : "missing",
        rowGridAreas: row ? getComputedStyle(row).gridTemplateAreas : "",
        rowMarginBottom: row ? Number.parseFloat(getComputedStyle(row).marginBottom || "0") : 0,
        rowBorderRadius: row ? getComputedStyle(row).borderRadius : "",
        amountDisplay: amount ? getComputedStyle(amount).display : "missing",
        amount: readBox(amount?.getBoundingClientRect()),
        amountText: amountText
          ? {
              text: amountText.textContent?.trim() || "",
              clientWidth: amountText.clientWidth,
              scrollWidth: amountText.scrollWidth,
              box: readBox(amountTextBox),
            }
          : null,
        fabOverlapsRow: boxesOverlap(fabBox, rowBox),
        fabOverlapsAmount: boxesOverlap(fabBox, amount?.getBoundingClientRect()),
        action: readBox(action?.getBoundingClientRect()),
        actionButtonCount: row?.querySelectorAll(".transaction-col-actions button").length ?? 0,
        actionCellCount: row?.querySelectorAll(".transaction-col-actions").length ?? 0,
        documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(mobileMetrics.nav, `${profile.name} bottom nav should exist: ${JSON.stringify(mobileMetrics)}`).not.toBeNull();
    expect(
      mobileMetrics.cellLabels,
      `${profile.name} mobile cells should expose column labels without relying on hidden table head layout: ${JSON.stringify(mobileMetrics.cellLabels)}`,
    ).toEqual(expect.arrayContaining(["일자", "유형", "거래자명", "카테고리", "메모", "금액"].map((label) => expect.stringMatching(new RegExp(`^${label}\\s+`)))));
    expect(mobileMetrics.nav.position, `${profile.name} nav should be fixed to the bottom: ${JSON.stringify(mobileMetrics)}`).toBe("fixed");
    expect(
      mobileMetrics.nav.top,
      `${profile.name} nav should live in the lower screen: ${JSON.stringify(mobileMetrics)}`,
    ).toBeGreaterThan(mobileMetrics.viewportHeight * 0.72);
    expect(
      mobileMetrics.nav.bottomGap,
      `${profile.name} nav should respect bottom safe area: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(16);
    expect(
      mobileMetrics.nav.left,
      `${profile.name} nav should stay inside left edge: ${JSON.stringify(mobileMetrics)}`,
    ).toBeGreaterThanOrEqual(6);
    expect(
      mobileMetrics.nav.right,
      `${profile.name} nav should stay inside right edge: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(mobileMetrics.viewportWidth - 6);
    expect(mobileMetrics.fab, `${profile.name} FAB should exist: ${JSON.stringify(mobileMetrics)}`).not.toBeNull();
    expect(mobileMetrics.fab.position, `${profile.name} add action should stay fixed at the bottom-right: ${JSON.stringify(mobileMetrics)}`).toBe("fixed");
    expect(mobileMetrics.fab.inListHeading, `${profile.name} add action should be outside sticky/filtered heading containing blocks while remaining early in DOM order: ${JSON.stringify(mobileMetrics)}`).toBe(false);
    expect(
      mobileMetrics.fabOverlapsRow,
      `${profile.name} add action should not cover transaction rows: ${JSON.stringify(mobileMetrics)}`,
    ).toBe(false);
    expect(
      mobileMetrics.fabOverlapsAmount,
      `${profile.name} add action should not cover transaction amounts: ${JSON.stringify(mobileMetrics)}`,
    ).toBe(false);
    expect(mobileMetrics.fab.width, `${profile.name} FAB touch width: ${JSON.stringify(mobileMetrics)}`).toBeGreaterThanOrEqual(44);
    expect(mobileMetrics.fab.height, `${profile.name} FAB touch height: ${JSON.stringify(mobileMetrics)}`).toBeGreaterThanOrEqual(44);
    expect(mobileMetrics.fab.rightGap, `${profile.name} FAB should hug the right edge: ${JSON.stringify(mobileMetrics)}`).toBeLessThanOrEqual(20);
    expect(mobileMetrics.fab.top, `${profile.name} FAB should live below the ledger body area: ${JSON.stringify(mobileMetrics)}`).toBeGreaterThan(
      mobileMetrics.viewportHeight * (profile.ledgerCompact ? 0.7 : 0.72),
    );
    expect(mobileMetrics.fab.bottom, `${profile.name} FAB should stay above bottom navigation: ${JSON.stringify(mobileMetrics)}`).toBeLessThan(
      mobileMetrics.nav.top - 4,
    );
    expect(
      mobileMetrics.rowHeight,
      `${profile.name} transaction row should stay dense: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(46);
    expect(mobileMetrics.tableDisplay, `${profile.name} transaction ledger should keep table semantics: ${JSON.stringify(mobileMetrics)}`).toBe(
      "table"
    );
    expect(mobileMetrics.tbodyDisplay, `${profile.name} transaction ledger body should keep table semantics: ${JSON.stringify(mobileMetrics)}`).toBe(
      "table-row-group"
    );
    expect(mobileMetrics.rowDisplay, `${profile.name} transaction row should be a table row: ${JSON.stringify(mobileMetrics)}`).toBe(
      "table-row"
    );
    expect(mobileMetrics.amountDisplay, `${profile.name} amount should be a table cell: ${JSON.stringify(mobileMetrics)}`).toBe(
      "table-cell"
    );
    expect(mobileMetrics.rowGridAreas, `${profile.name} table row should not be a card/grid: ${JSON.stringify(mobileMetrics)}`).toBe("none");
    expect(mobileMetrics.rowMarginBottom, `${profile.name} table rows should not use card margins: ${JSON.stringify(mobileMetrics)}`).toBe(0);
    expect(mobileMetrics.rowBorderRadius, `${profile.name} table rows should not look like cards: ${JSON.stringify(mobileMetrics)}`).toBe(
      "0px"
    );
    expect(mobileMetrics.amount, `${profile.name} amount cell should exist: ${JSON.stringify(mobileMetrics)}`).not.toBeNull();
    expect(mobileMetrics.amountText, `${profile.name} amount text should exist: ${JSON.stringify(mobileMetrics)}`).not.toBeNull();
    expect(mobileMetrics.actionCellCount, `${profile.name} action cell should not be rendered: ${JSON.stringify(mobileMetrics)}`).toBe(0);
    expect(mobileMetrics.action, `${profile.name} action cell should not take layout space: ${JSON.stringify(mobileMetrics)}`).toBeNull();
    expect(mobileMetrics.actionButtonCount, `${profile.name} mobile transaction row should not expose row action buttons: ${JSON.stringify(mobileMetrics)}`).toBe(0);
    expect(
      mobileMetrics.amount.right,
      `${profile.name} amount text should stay inside the viewport: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(mobileMetrics.viewportWidth - 8);
    expect(
      mobileMetrics.amountText.scrollWidth,
      `${profile.name} amount text should fit within its cell: ${JSON.stringify(mobileMetrics.amountText)}`,
    ).toBeLessThanOrEqual(mobileMetrics.amountText.clientWidth + 1);
    const wideAmountMetrics = await page.locator("tr.transaction-row", { hasText: wideMemo }).first().evaluate((row) => {
      const amount = row.querySelector(".transaction-col-amount");
      const amountText = amount?.querySelector(".transaction-amount-text");
      const amountBox = amount?.getBoundingClientRect();
      return {
        viewportWidth: document.documentElement.clientWidth,
        amountClass: amountText?.className || "",
        text: amountText?.textContent?.trim() || "",
        clientWidth: amountText?.clientWidth || 0,
        scrollWidth: amountText?.scrollWidth || 0,
        amountRight: amountBox?.right || 0,
      };
    });
    expect(
      wideAmountMetrics.amountClass,
      `${profile.name} wide amount should use the compact wide-amount path: ${JSON.stringify(wideAmountMetrics)}`,
    ).toContain("transaction-amount-text-wide");
    expect(wideAmountMetrics.text, `${profile.name} wide amount text should render: ${JSON.stringify(wideAmountMetrics)}`).toContain(
      "1,234,567,890원",
    );
    expect(
      wideAmountMetrics.scrollWidth,
      `${profile.name} wide amount text should fit inside its cell: ${JSON.stringify(wideAmountMetrics)}`,
    ).toBeLessThanOrEqual(wideAmountMetrics.clientWidth + 1);
    expect(
      wideAmountMetrics.amountRight,
      `${profile.name} wide amount cell should stay inside the viewport: ${JSON.stringify(wideAmountMetrics)}`,
    ).toBeLessThanOrEqual(wideAmountMetrics.viewportWidth - 8);
    expect(
      mobileMetrics.documentOverflowX,
      `${profile.name} document should not overflow: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(1);
    await capture(page, `transactions-ledger-layout-${profile.name}`);
  }

  await openLedger(page, DESKTOP_PROFILE);
  await selectTransactionRow(page, memo);
  const selectionMetrics = await page.evaluate(() => {
    const deleteButton = document.querySelector('[data-testid="transaction-selection-delete"]');
    const clearButton = Array.from(document.querySelectorAll(".transaction-selection-clear")).find((button) =>
      button.textContent?.includes("선택 해제"),
    );
    const read = (button) => {
      const box = button?.getBoundingClientRect();
      const style = button ? getComputedStyle(button) : null;
      return box && style
        ? {
            width: box.width,
            height: box.height,
            borderRadius: style.borderRadius,
            borderTopWidth: style.borderTopWidth,
            backgroundColor: style.backgroundColor,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            lineHeight: style.lineHeight,
            paddingInlineStart: style.paddingInlineStart,
            paddingInlineEnd: style.paddingInlineEnd,
          }
        : null;
    };
    return {
      deleteButton: read(deleteButton),
      clearButton: read(clearButton),
    };
  });

  expect(selectionMetrics.deleteButton, `delete button metrics should exist: ${JSON.stringify(selectionMetrics)}`).not.toBeNull();
  expect(selectionMetrics.clearButton, `clear button metrics should exist: ${JSON.stringify(selectionMetrics)}`).not.toBeNull();
  expectClose(selectionMetrics.deleteButton.height, selectionMetrics.clearButton.height, 1, "selection button height");
  expect(selectionMetrics.deleteButton.borderRadius).toBe(selectionMetrics.clearButton.borderRadius);
  expect(selectionMetrics.deleteButton.borderTopWidth).toBe(selectionMetrics.clearButton.borderTopWidth);
  expect(selectionMetrics.deleteButton.backgroundColor).toBe(selectionMetrics.clearButton.backgroundColor);
  expectCloseCssPx(selectionMetrics.deleteButton.fontSize, selectionMetrics.clearButton.fontSize, 0.25, "selection button font size");
  expect(selectionMetrics.deleteButton.fontWeight).toBe(selectionMetrics.clearButton.fontWeight);
  expectCloseCssPx(selectionMetrics.deleteButton.lineHeight, selectionMetrics.clearButton.lineHeight, 0.5, "selection button line height");
  expectCloseCssPx(
    selectionMetrics.deleteButton.paddingInlineStart,
    selectionMetrics.clearButton.paddingInlineStart,
    0.5,
    "selection button inline start padding",
  );
  expectCloseCssPx(
    selectionMetrics.deleteButton.paddingInlineEnd,
    selectionMetrics.clearButton.paddingInlineEnd,
    0.5,
    "selection button inline end padding",
  );

  await capture(page, "transactions-ledger-layout-selection-buttons");
});

test("transaction entry sheet keeps date and amount on one compact primary row", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("entry-primary-row")}@example.com`;
  const displayName = unique("entry-primary-row-user");
  await registerAndVerify(page, { email, displayName });
  await createCategoryViaApi(page, {
    major: "생활",
    minor: "식비",
  });
  await page.reload();

  for (const profile of [DESKTOP_PROFILE, ...MOBILE_PROFILES]) {
    const sheet = await openTransactionEntrySheet(page, profile);
    const metrics = await sheet.evaluate((root) => {
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
              centerY: box.top + box.height / 2,
            }
          : null;
      };
      const primaryStack = root.querySelector(".transaction-quick-primary-stack");
      const primaryFields = root.querySelector(".transaction-quick-primary-fields");
      const dateField = root.querySelector(".transaction-quick-date-field");
      const amountField = root.querySelector(".transaction-quick-amount-field");
      const dateInput = root.querySelector("[data-testid='transaction-quick-date']");
      const amountInput = root.querySelector("[data-testid='transaction-quick-amount']");
      const fieldStyle = primaryFields ? getComputedStyle(primaryFields) : null;
      return {
        viewportWidth: document.documentElement.clientWidth,
        primaryStack: boxOf(primaryStack),
        primaryFields: boxOf(primaryFields),
        primaryFieldsDisplay: fieldStyle?.display || "missing",
        primaryFieldsColumns: fieldStyle?.gridTemplateColumns || "missing",
        dateField: boxOf(dateField),
        amountField: boxOf(amountField),
        dateInput: boxOf(dateInput),
        dateInputFit: dateInput
          ? {
              value: dateInput.value,
              clientWidth: dateInput.clientWidth,
              scrollWidth: dateInput.scrollWidth,
            }
          : null,
        amountInput: boxOf(amountInput),
      };
    });

    expect(metrics.primaryFields, `${profile.name || "desktop"} primary fields row should exist: ${JSON.stringify(metrics)}`).not.toBeNull();
    expect(metrics.primaryFieldsDisplay, `${profile.name || "desktop"} primary fields should use grid: ${JSON.stringify(metrics)}`).toBe("grid");
    expect(
      metrics.primaryFieldsColumns,
      `${profile.name || "desktop"} primary fields should expose two columns: ${JSON.stringify(metrics)}`,
    ).not.toBe("none");
    expect(metrics.dateField, `${profile.name || "desktop"} date field should exist: ${JSON.stringify(metrics)}`).not.toBeNull();
    expect(metrics.amountField, `${profile.name || "desktop"} amount field should exist: ${JSON.stringify(metrics)}`).not.toBeNull();
    expect(metrics.dateInput, `${profile.name || "desktop"} date input should exist: ${JSON.stringify(metrics)}`).not.toBeNull();
    expect(metrics.dateInputFit, `${profile.name || "desktop"} date input fit metrics should exist: ${JSON.stringify(metrics)}`).not.toBeNull();
    expect(metrics.amountInput, `${profile.name || "desktop"} amount input should exist: ${JSON.stringify(metrics)}`).not.toBeNull();
    expect(
      metrics.dateInputFit.scrollWidth,
      `${profile.name || "desktop"} date value should fit inside the date input: ${JSON.stringify(metrics.dateInputFit)}`,
    ).toBeLessThanOrEqual(metrics.dateInputFit.clientWidth + 1);
    expectClose(metrics.dateField.top, metrics.amountField.top, 3, `${profile.name || "desktop"} date and amount label row`);
    expectClose(metrics.dateInput.centerY, metrics.amountInput.centerY, 7, `${profile.name || "desktop"} date and amount input center`);
    expect(
      metrics.amountField.left,
      `${profile.name || "desktop"} amount should sit to the right of date: ${JSON.stringify(metrics)}`,
    ).toBeGreaterThanOrEqual(metrics.dateField.right - 1);
    expect(
      metrics.dateField.width,
      `${profile.name || "desktop"} date field should not consume a full row: ${JSON.stringify(metrics)}`,
    ).toBeLessThan(metrics.primaryFields.width * 0.62);
    if (isProfileCompactTransactionUI(profile)) {
      const groupChoice = sheet.getByTestId("transaction-category-group-choice").filter({ hasText: "생활" }).first();
      await expect(groupChoice).toBeVisible();
      await groupChoice.click();
      await expect(groupChoice).toHaveAttribute("aria-pressed", "true");
      const categoryChoice = sheet.getByTestId("transaction-category-choice").filter({ hasText: "식비" }).first();
      await expect(categoryChoice).toBeVisible();
      await categoryChoice.click();
      await expect(categoryChoice).toHaveAttribute("aria-pressed", "true");
      await sheet.getByTestId("transaction-quick-amount").fill("12345");
      await expect(groupChoice).toHaveAttribute("aria-pressed", "true");
      await expect(categoryChoice).toHaveAttribute("aria-pressed", "true");
      const quickCategoryMetrics = await sheet.evaluate((root) => {
        const read = (element) => ({
          clientWidth: element?.clientWidth || 0,
          scrollWidth: element?.scrollWidth || 0,
          width: element?.getBoundingClientRect().width || 0,
        });
        return {
          picker: read(root.querySelector(".transaction-category-picker-staged")),
          groupGrid: read(root.querySelector(".transaction-category-group-grid")),
          choiceGrid: read(root.querySelector(".transaction-category-choice-grid")),
        };
      });
      for (const [label, item] of Object.entries(quickCategoryMetrics)) {
        expect(
          item.scrollWidth,
          `${profile.name} quick category ${label} should not overflow after selection: ${JSON.stringify(quickCategoryMetrics)}`,
        ).toBeLessThanOrEqual(item.clientWidth + 1);
      }
    }
    await expectNoHorizontalOverflow(page, 2);
    await capture(page, `transactions-entry-primary-row-${profile.name || "desktop"}`);
    await page.getByTestId("transaction-entry-sheet-close").click();
    const closeDraftConfirm = page.getByRole("button", { name: "입력 닫기" });
    if (await closeDraftConfirm.isVisible().catch(() => false)) {
      await closeDraftConfirm.click();
    }
    await expect(sheet).toBeHidden();
  }
});

test("transaction ledger aligns desktop cells and keeps mobile rows compact", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("ledger-consistency")}@example.com`;
  const displayName = "댕댕 가족비서";
  const expectedOwnerInitial = "댕";
  const expectedOwnerCue = "댕 가족비서";
  const doubledOwnerName = "찌찌";
  const expectedDoubledOwnerInitial = "찌";
  const expectedDoubledOwnerCue = "찌";
  const doubledOwnerMemo = `${unique("ledger-consistency-owner")}-반복거래자`;
  const graphemeOwnerName = "e\u0301e\u0301";
  const expectedGraphemeOwnerInitial = "e\u0301";
  const expectedGraphemeOwnerCue = "e\u0301";
  const graphemeOwnerMemo = `${unique("ledger-consistency-owner")}-조합문자`;
  const memoPrefix = `${unique("ledger-consistency-memo")}-생활비`;

  await registerAndVerify(page, { email, displayName });
  const category = await createCategoryViaApi(page, {
    major: "생활",
    minor: "생활용품",
  });
  for (let index = 0; index < 14; index += 1) {
    await createTransactionViaApi(page, {
      memo: `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(15000 + index),
      categoryId: category.id,
      ownerName: displayName,
    });
  }
  await createTransactionViaApi(page, {
    memo: doubledOwnerMemo,
    amount: "8800",
    categoryId: category.id,
    ownerName: doubledOwnerName,
  });
  await createTransactionViaApi(page, {
    memo: graphemeOwnerMemo,
    amount: "9900",
    categoryId: category.id,
    ownerName: graphemeOwnerName,
  });
  await page.reload();

  await openLedger(page, DESKTOP_PROFILE);
  const desktopMetrics = await page.locator("tr.transaction-row", { hasText: `${memoPrefix}-00` }).first().evaluate((row) => {
    const header = document.querySelector(".transactions-desktop-ledger-head");
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
            centerY: box.top + box.height / 2,
          }
        : null;
    };
    const visible = (element) => {
      if (!element) {
        return false;
      }
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const ownerCell = row.querySelector(".transaction-col-owner");
    const categoryCell = row.querySelector(".transaction-col-category");
    const bodyCells = Array.from(row.querySelectorAll("td"));
    const dateHead = header?.querySelector('[data-field-key="occurred_on"]');
    const dateButton = dateHead?.querySelector(".sort-header");
    return {
      owner: {
        compactVisible: visible(ownerCell?.querySelector(".transaction-owner-compact")),
        compactText: ownerCell?.querySelector(".transaction-owner-compact")?.textContent?.replace(/\s+/g, " ").trim() || "",
        cueVisible: visible(ownerCell?.querySelector(".transaction-owner-cue")),
        cueText: ownerCell?.querySelector(".transaction-owner-cue")?.textContent?.replace(/\s+/g, " ").trim() || "",
        fullValueVisible: visible(ownerCell?.querySelector(".transaction-mobile-detail-value")),
      },
      category: {
        desktopCueVisible: visible(categoryCell?.querySelector(".transaction-desktop-category-cue")),
        desktopCueText: categoryCell?.querySelector(".transaction-desktop-category-cue")?.textContent?.replace(/\s+/g, " ").trim() || "",
        fullValueVisible: visible(categoryCell?.querySelector(".transaction-mobile-detail-value")),
      },
      dateHeader: {
        cell: boxOf(dateHead),
        button: boxOf(dateButton),
      },
      rowSeparators: bodyCells.slice(0, -1).map((cell) => {
        const style = getComputedStyle(cell);
        return {
          field: cell.getAttribute("data-field-key") || cell.className,
          borderRightWidth: Number.parseFloat(style.borderRightWidth || "0"),
        };
      }),
    };
  });

  expect(desktopMetrics.owner.compactVisible, `desktop should show the owner initial chip: ${JSON.stringify(desktopMetrics)}`).toBe(true);
  expect(desktopMetrics.owner.compactText).toBe(expectedOwnerInitial);
  expect(desktopMetrics.owner.cueVisible, `desktop should show the owner cue without the repeated initial: ${JSON.stringify(desktopMetrics)}`).toBe(true);
  expect(desktopMetrics.owner.cueText).toBe(expectedOwnerCue);
  expect(desktopMetrics.owner.fullValueVisible, `desktop should not render the full owner detail value next to the initial chip: ${JSON.stringify(desktopMetrics)}`).toBe(false);
  expect(desktopMetrics.category.desktopCueVisible, `desktop should use the compact category cue: ${JSON.stringify(desktopMetrics)}`).toBe(true);
  expect(desktopMetrics.category.desktopCueText).toBe("생활용품");
  expect(desktopMetrics.category.fullValueVisible, `desktop should not render the long category value in the tight column: ${JSON.stringify(desktopMetrics)}`).toBe(false);
  expect(desktopMetrics.dateHeader.cell, `date header cell should exist: ${JSON.stringify(desktopMetrics)}`).not.toBeNull();
  expect(desktopMetrics.dateHeader.button, `date sort button should fill the date header cell: ${JSON.stringify(desktopMetrics)}`).not.toBeNull();
  expectClose(desktopMetrics.dateHeader.button.centerY, desktopMetrics.dateHeader.cell.centerY, 1, "desktop date header vertical center");
  expect(desktopMetrics.dateHeader.button.height).toBeGreaterThanOrEqual(desktopMetrics.dateHeader.cell.height - 2);
  expect(
    desktopMetrics.rowSeparators.every((cell) => cell.borderRightWidth >= 1),
    `desktop body cells should carry the same vertical separators as the header: ${JSON.stringify(desktopMetrics.rowSeparators)}`,
  ).toBe(true);
  await capture(page, "transactions-ledger-consistency-desktop");

  const doubledOwnerMetrics = await page.locator("tr.transaction-row", { hasText: doubledOwnerMemo }).first().evaluate((row) => {
    const visible = (element) => {
      if (!element) {
        return false;
      }
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const ownerCell = row.querySelector(".transaction-col-owner");
    const compact = ownerCell?.querySelector(".transaction-owner-compact");
    const cue = ownerCell?.querySelector(".transaction-owner-cue");
    return {
      compactVisible: visible(compact),
      compactText: compact?.textContent?.replace(/\s+/g, " ").trim() || "",
      cueVisible: visible(cue),
      cueText: cue?.textContent?.replace(/\s+/g, " ").trim() || "",
    };
  });

  expect(doubledOwnerMetrics.compactVisible, `short repeated owner should keep the initial chip: ${JSON.stringify(doubledOwnerMetrics)}`).toBe(true);
  expect(doubledOwnerMetrics.compactText).toBe(expectedDoubledOwnerInitial);
  expect(doubledOwnerMetrics.cueVisible, `short repeated owner should preserve the second real character as cue text: ${JSON.stringify(doubledOwnerMetrics)}`).toBe(true);
  expect(doubledOwnerMetrics.cueText).toBe(expectedDoubledOwnerCue);

  const graphemeOwnerMetrics = await page.locator("tr.transaction-row", { hasText: graphemeOwnerMemo }).first().evaluate((row) => {
    const visible = (element) => {
      if (!element) {
        return false;
      }
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    const ownerCell = row.querySelector(".transaction-col-owner");
    const compact = ownerCell?.querySelector(".transaction-owner-compact");
    const cue = ownerCell?.querySelector(".transaction-owner-cue");
    return {
      compactVisible: visible(compact),
      compactText: compact?.textContent?.replace(/\s+/g, " ").trim() || "",
      cueVisible: visible(cue),
      cueText: cue?.textContent?.replace(/\s+/g, " ").trim() || "",
    };
  });

  expect(graphemeOwnerMetrics.compactVisible, `grapheme owner should keep the first cluster in the chip: ${JSON.stringify(graphemeOwnerMetrics)}`).toBe(true);
  expect(graphemeOwnerMetrics.compactText).toBe(expectedGraphemeOwnerInitial);
  expect(graphemeOwnerMetrics.cueVisible, `grapheme owner should move the second cluster into cue text: ${JSON.stringify(graphemeOwnerMetrics)}`).toBe(true);
  expect(graphemeOwnerMetrics.cueText).toBe(expectedGraphemeOwnerCue);

  const desktopMemoFilter = page.locator(".transactions-desktop-ledger-head").getByRole("button", { name: "메모 필터 열기" });
  await expect(desktopMemoFilter).toHaveAttribute("aria-controls", "transaction-filter-panel");
  await expect(desktopMemoFilter).toHaveAttribute("aria-expanded", "false");
  await desktopMemoFilter.click();
  await expect(desktopMemoFilter).toHaveAttribute("aria-expanded", "true");
  const desktopFilterPanel = page.locator("#transaction-filter-panel");
  await expect(desktopFilterPanel).toBeVisible();
  await expect(desktopFilterPanel.getByPlaceholder("검색")).toBeFocused();

  const desktopAmountFilter = page.locator(".transactions-desktop-ledger-head").getByRole("button", { name: "금액 필터 열기" });
  await desktopAmountFilter.click();
  const amountMinInput = desktopFilterPanel.locator("[data-transaction-filter-field='amount_min']");
  await expect(amountMinInput).toBeFocused();
  await amountMinInput.fill("abc");
  await expect(amountMinInput).toHaveValue("");
  await amountMinInput.fill("123456");
  await expect(amountMinInput).toHaveValue("123,456");
  const amountMaxInput = desktopFilterPanel.locator("[data-transaction-filter-field='amount_max']");
  await amountMaxInput.fill("987654");
  await expect(amountMaxInput).toHaveValue("987,654");
  await desktopFilterPanel.getByRole("button", { name: "초기화" }).click();
  await expect(amountMinInput).toHaveValue("");
  await expect(amountMaxInput).toHaveValue("");

  const desktopTypeFilter = page.locator(".transactions-desktop-ledger-head").getByRole("button", { name: "유형 필터 열기" });
  await desktopTypeFilter.click();
  await expect(desktopFilterPanel.locator("[data-transaction-filter-field='flow_type']")).toBeFocused();

  for (const profile of MOBILE_PROFILES) {
    await openLedger(page, profile);
    const mobileMetrics = await page.locator("tr.transaction-row", { hasText: `${memoPrefix}-00` }).first().evaluate((row) => {
      const head = document.querySelector(".transactions-mobile-ledger-head");
      const fab = document.querySelector('[data-testid="transactions-fab"]');
      const toolbar = document.querySelector("[data-testid='transaction-sticky-toolbar']");
      const rowBox = row.getBoundingClientRect();
      const memo = row.querySelector(".transaction-col-memo");
      const memoText = row.querySelector(".transaction-memo-text");
      const amount = row.querySelector(".transaction-col-amount");
      const amountText = amount?.querySelector(".transaction-amount-text");
      const type = row.querySelector(".transaction-col-type");
      const typeBadge = type?.querySelector(".transaction-flow-short");
      const table = row.closest(".transactions-surface-table");
      const listCard = row.closest(".transaction-list-card");
      const headerFit = (selector) => {
        const item = head?.querySelector(selector);
        return {
          text: item?.textContent?.replace(/\s+/g, " ").trim() || "",
          clientWidth: item?.clientWidth || 0,
          scrollWidth: item?.scrollWidth || 0,
        };
      };
      const categoryCue = row.querySelector(".transaction-mobile-category-cue");
      const headerItems = Array.from(head?.children || []).filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      });
      const headBox = head?.getBoundingClientRect();
      const rectBox = (box) =>
        box
          ? {
              top: box.top,
              bottom: box.bottom,
              left: box.left,
              right: box.right,
              width: box.width,
              height: box.height,
              centerX: box.left + box.width / 2,
              centerY: box.top + box.height / 2,
            }
          : null;
      const boxOf = (element) => rectBox(element?.getBoundingClientRect());
      const textBoxOf = (element) => {
        if (!element) {
          return null;
        }
        const target = element.querySelector?.(":scope > span") || element;
        const range = document.createRange();
        range.selectNodeContents(target);
        const box = rectBox(range.getBoundingClientRect());
        range.detach?.();
        return box;
      };
      const countSummary = toolbar?.querySelector(".surface-count-summary");
      const listCardStyle = listCard ? getComputedStyle(listCard) : null;
      const cellBox = (selector) => boxOf(row.querySelector(selector));
      return {
        viewportWidth: document.documentElement.clientWidth,
        fabBeforeFirstRow: Boolean(fab && row && (fab.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)),
        rowHeight: rowBox.height,
        rowDisplay: getComputedStyle(row).display,
        rowGridAreas: getComputedStyle(row).gridTemplateAreas,
        rowMarginBottom: Number.parseFloat(getComputedStyle(row).marginBottom || "0"),
        amountDisplay: amount ? getComputedStyle(amount).display : "missing",
        rowTopGap: memoText ? memoText.getBoundingClientRect().top - rowBox.top : 0,
        rowBottomGap: memoText ? rowBox.bottom - memoText.getBoundingClientRect().bottom : 0,
        memoWidth: memo?.getBoundingClientRect().width || 0,
        tableWidth: table?.getBoundingClientRect().width || 0,
        listCardBottomPadding: listCardStyle ? Number.parseFloat(listCardStyle.paddingBottom || "0") : 0,
        amountWidth: amount?.getBoundingClientRect().width || 0,
        amountTextWidth: amountText?.getBoundingClientRect().width || 0,
        amountTextScrollWidth: amountText?.scrollWidth || 0,
        typeBadge: typeBadge
          ? {
              text: typeBadge.textContent?.replace(/\s+/g, " ").trim() || "",
              width: typeBadge.getBoundingClientRect().width,
              clientWidth: typeBadge.clientWidth,
              scrollWidth: typeBadge.scrollWidth,
              height: typeBadge.getBoundingClientRect().height,
              fontSize: Number.parseFloat(getComputedStyle(typeBadge).fontSize || "0"),
              lineHeight: Number.parseFloat(getComputedStyle(typeBadge).lineHeight || "0"),
              cellWidth: type?.getBoundingClientRect().width || 0,
            }
          : null,
        columnWidths: {
          date: cellBox(".transaction-col-date")?.width || 0,
          type: cellBox(".transaction-col-type")?.width || 0,
          owner: cellBox(".transaction-col-owner")?.width || 0,
          category: cellBox(".transaction-col-category")?.width || 0,
          memo: cellBox(".transaction-col-memo")?.width || 0,
          amount: cellBox(".transaction-col-amount")?.width || 0,
        },
        headerBodyColumns: {
          date: { head: boxOf(head?.querySelector(".ledger-head-date")), body: cellBox(".transaction-col-date") },
          type: { head: boxOf(head?.querySelector(".ledger-head-cues")), body: cellBox(".transaction-col-type") },
          owner: { head: boxOf(head?.querySelector(".ledger-head-owner")), body: cellBox(".transaction-col-owner") },
          category: { head: boxOf(head?.querySelector(".ledger-head-category")), body: cellBox(".transaction-col-category") },
          memo: { head: boxOf(head?.querySelector(".ledger-head-main")), body: cellBox(".transaction-col-memo") },
          amount: { head: boxOf(head?.querySelector(".ledger-head-amount")), body: cellBox(".transaction-col-amount") },
        },
        headerHorizontalDeltas: Object.entries({
          date: ".ledger-head-date",
          type: ".ledger-head-cues",
          owner: ".ledger-head-owner",
          category: ".ledger-head-category",
          memo: ".ledger-head-main",
          amount: ".ledger-head-amount",
        }).map(([key, selector]) => {
          const item = head?.querySelector(selector);
          const cell = boxOf(item);
          const label = textBoxOf(item);
          return {
            key,
            text: item?.textContent?.replace(/\s+/g, " ").trim() || "",
            delta: cell && label ? Math.abs(label.centerX - cell.centerX) : Number.POSITIVE_INFINITY,
            rightDelta: cell && label ? Math.abs(label.right - cell.right) : Number.POSITIVE_INFINITY,
            cell,
            label,
          };
        }),
        dateHeadText: head?.querySelector(".ledger-head-date")?.textContent?.replace(/\s+/g, " ").trim() || "",
        labelFits: {
          owner: headerFit(".ledger-head-owner"),
          category: headerFit(".ledger-head-category"),
          categoryCue: {
            text: categoryCue?.textContent?.replace(/\s+/g, " ").trim() || "",
            clientWidth: categoryCue?.clientWidth || 0,
            scrollWidth: categoryCue?.scrollWidth || 0,
          },
        },
        gridLines: {
          header: headerItems
            .slice(0, -1)
            .map((item) => Number.parseFloat(getComputedStyle(item).borderRightWidth || "0")),
          row: Array.from(
            row.querySelectorAll(
              ".transaction-col-date, .transaction-col-type, .transaction-col-owner, .transaction-col-category, .transaction-col-memo",
            ),
          ).map((cell) => Number.parseFloat(getComputedStyle(cell).borderRightWidth || "0")),
        },
        headerCenterDeltas: headerItems.map((item) => ({
          className: item.className,
          text: item.textContent?.replace(/\s+/g, " ").trim() || "",
          delta: Math.abs((boxOf(item)?.centerY || 0) - ((headBox?.top || 0) + (headBox?.height || 0) / 2)),
        })),
        toolbar: {
          summaryText: countSummary?.textContent?.replace(/\s+/g, " ").trim() || "",
          summaryHeight: countSummary?.getBoundingClientRect().height || 0,
          controlStripHeight: toolbar?.querySelector(".surface-control-strip")?.getBoundingClientRect().height || 0,
        },
      };
    });

    expect(mobileMetrics.dateHeadText, `${profile.name} date header should not include a visible filter suffix: ${JSON.stringify(mobileMetrics)}`).toBe("일자");
    expect(mobileMetrics.labelFits.owner.text).toBe("거래자");
    expect(mobileMetrics.labelFits.category.text).toBe("카테고리");
    expect(mobileMetrics.labelFits.categoryCue.text).toBe("생활용품");
    for (const [label, metrics] of Object.entries(mobileMetrics.labelFits)) {
      expect(
        metrics.scrollWidth,
        `${profile.name} ${label} label should fit without horizontal clipping: ${JSON.stringify(metrics)}`,
      ).toBeLessThanOrEqual(metrics.clientWidth + 1);
    }
    for (const [name, geometry] of Object.entries(mobileMetrics.headerBodyColumns)) {
      expect(geometry.head, `${profile.name} ${name} header cell should exist: ${JSON.stringify(mobileMetrics.headerBodyColumns)}`).not.toBeNull();
      expect(geometry.body, `${profile.name} ${name} body cell should exist: ${JSON.stringify(mobileMetrics.headerBodyColumns)}`).not.toBeNull();
      expectClose(geometry.head.left, geometry.body.left, 2, `${profile.name} ${name} header/body left edge`);
      expectClose(geometry.head.width, geometry.body.width, 2.5, `${profile.name} ${name} header/body width`);
    }
    expect(
      mobileMetrics.gridLines.header.every((width) => width >= 1),
      `${profile.name} mobile header cells should use Excel-style vertical separators: ${JSON.stringify(mobileMetrics.gridLines)}`,
    ).toBe(true);
    expect(
      mobileMetrics.gridLines.row.every((width) => width >= 1),
      `${profile.name} mobile body cells should use Excel-style vertical separators like desktop: ${JSON.stringify(mobileMetrics.gridLines)}`,
    ).toBe(true);
    expect(
      mobileMetrics.headerCenterDeltas.every((item) => item.delta <= 3),
      `${profile.name} header labels should be vertically centered: ${JSON.stringify(mobileMetrics.headerCenterDeltas)}`,
    ).toBe(true);
    expect(
      mobileMetrics.headerHorizontalDeltas.every((item) => item.delta <= 2.5),
      `${profile.name} header labels should be horizontally centered: ${JSON.stringify(mobileMetrics.headerHorizontalDeltas)}`,
    ).toBe(true);
    expect(
      mobileMetrics.listCardBottomPadding,
      `${profile.name} transaction card should not reserve obsolete floating-FAB whitespace below the table: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(24);
    expect(mobileMetrics.typeBadge, `${profile.name} type badge should exist: ${JSON.stringify(mobileMetrics)}`).not.toBeNull();
    expect(
      mobileMetrics.fabBeforeFirstRow,
      `${profile.name} compact add action should stay before tabbable ledger rows in DOM order: ${JSON.stringify(mobileMetrics)}`,
    ).toBe(true);
    if (profile.name === "mobile-standard" || profile.name === "mobile-landscape-compact") {
      await expectCompactFabKeyboardOrder(page, profile.name);
    }
    expect(mobileMetrics.typeBadge.text, `${profile.name} type badge should show the flow label: ${JSON.stringify(mobileMetrics.typeBadge)}`).toBe("지출");
    expect(
      mobileMetrics.typeBadge.scrollWidth,
      `${profile.name} type badge should not clip: ${JSON.stringify(mobileMetrics.typeBadge)}`,
    ).toBeLessThanOrEqual(mobileMetrics.typeBadge.clientWidth + 1);
    expect(
      mobileMetrics.typeBadge.width,
      `${profile.name} type badge should visibly fill its allocated type column: ${JSON.stringify(mobileMetrics.typeBadge)}`,
    ).toBeGreaterThanOrEqual(Math.min(38, mobileMetrics.typeBadge.cellWidth * 0.68));
    expect(
      mobileMetrics.typeBadge.fontSize,
      `${profile.name} type badge font size should remain readable: ${JSON.stringify(mobileMetrics.typeBadge)}`,
    ).toBeGreaterThanOrEqual(10);
    expect(
      mobileMetrics.typeBadge.height,
      `${profile.name} type badge height should remain touch-readable: ${JSON.stringify(mobileMetrics.typeBadge)}`,
    ).toBeGreaterThanOrEqual(20);
    expect(
      mobileMetrics.amountWidth,
      `${profile.name} amount column should not over-reserve scarce mobile width: ${JSON.stringify(mobileMetrics.columnWidths)}`,
    ).toBeLessThanOrEqual(profile.width <= 360 ? 66 : 70);
    expect(
      mobileMetrics.memoWidth,
      `${profile.name} memo text column should gain the reclaimed type/amount space: ${JSON.stringify(mobileMetrics)}`,
    ).toBeGreaterThanOrEqual(profile.width <= 340 ? 40 : profile.width <= 360 ? 70 : 96);
    expect(
      mobileMetrics.memoWidth,
      `${profile.name} memo should remain wider than the amount slot: ${JSON.stringify(mobileMetrics.columnWidths)}`,
    ).toBeGreaterThan(mobileMetrics.amountWidth * (profile.width <= 340 ? 0.8 : 1.15));
    expect(
      mobileMetrics.amountTextScrollWidth,
      `${profile.name} amount text should fit without clipping: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(mobileMetrics.amountTextWidth + 1);
    expect(
      mobileMetrics.rowHeight,
      `${profile.name} collapsed rows should stay dense: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(44.5);
    expect(mobileMetrics.rowDisplay, `${profile.name} collapsed rows should keep PC-style table rows: ${JSON.stringify(mobileMetrics)}`).toBe(
      "table-row"
    );
    expect(mobileMetrics.amountDisplay, `${profile.name} amount should keep table cell layout: ${JSON.stringify(mobileMetrics)}`).toBe(
      "table-cell"
    );
    expect(mobileMetrics.rowGridAreas, `${profile.name} collapsed rows should not be card grids: ${JSON.stringify(mobileMetrics)}`).toBe("none");
    expect(mobileMetrics.rowMarginBottom, `${profile.name} collapsed rows should not use card spacing: ${JSON.stringify(mobileMetrics)}`).toBe(0);
    expect(
      Math.min(mobileMetrics.rowTopGap, mobileMetrics.rowBottomGap),
      `${profile.name} row text should not sit against row borders: ${JSON.stringify(mobileMetrics)}`,
    ).toBeGreaterThanOrEqual(4);
    expect(mobileMetrics.toolbar.summaryText).toContain("총 16건 중 16건 표시");
    expect(mobileMetrics.toolbar.summaryText).toContain("오래된순");
    expect(
      mobileMetrics.toolbar.summaryHeight,
      `${profile.name} count and sort meta should stay on one compact line: ${JSON.stringify(mobileMetrics.toolbar)}`,
    ).toBeLessThanOrEqual(18);
    expect(
      mobileMetrics.toolbar.controlStripHeight,
      `${profile.name} empty status chip row should not consume vertical space: ${JSON.stringify(mobileMetrics.toolbar)}`,
    ).toBeLessThanOrEqual(2);
    await capture(page, `transactions-ledger-consistency-${profile.name}`);
  }
});
