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
const MOBILE_PROFILES = [
  { name: "mobile-standard", width: 390, height: 844, font: "Apple SD Gothic Neo" },
  { name: "mobile-narrow", width: 360, height: 740, font: "Malgun Gothic" },
  { name: "mobile-android-tall", width: 412, height: 915, font: "Noto Sans KR" },
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
  await page.reload();
  return { memo };
}

async function openLedger(page, profile) {
  await page.setViewportSize({ width: profile.width, height: profile.height });
  await applyFontProfile(page, profile.font);
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("tr.transaction-row[data-transaction-id]").first()).toBeVisible({ timeout: 20_000 });
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

  const { memo } = await seedLedger(page);
  await openLedger(page, DESKTOP_PROFILE);

  const desktopMetrics = await page.evaluate(() => {
    const columnSpecs = [
      { key: "select", head: ".transaction-col-select", body: ".transaction-col-select" },
      { key: "occurred_on", head: '[data-field-key="occurred_on"]', body: '[data-field-key="occurred_on"]' },
      { key: "flow_type", head: '[data-field-key="flow_type"]', body: '[data-field-key="flow_type"]' },
      { key: "category", head: '[data-field-key="category"]', body: '[data-field-key="category"]' },
      { key: "memo", head: '[data-field-key="memo"]', body: '[data-field-key="memo"]' },
      { key: "amount", head: '[data-field-key="amount"]', body: '[data-field-key="amount"]' },
      { key: "owner_name", head: '[data-field-key="owner_name"]', body: '[data-field-key="owner_name"]' },
      { key: "updated_at", head: '[data-field-key="updated_at"]', body: '[data-field-key="updated_at"]' },
      { key: "actions", head: ".transaction-col-actions", body: ".transaction-col-actions" },
    ];
    const header = document.querySelector(".transactions-desktop-ledger-head");
    const row = document.querySelector("tr.transaction-row[data-transaction-id]");
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
    return {
      rowHeight: row?.getBoundingClientRect().height ?? 0,
      headerDisplay: header ? getComputedStyle(header).display : "missing",
      columns: columnSpecs.map((spec) => {
        const head = header?.querySelector(spec.head);
        const body = row?.querySelector(spec.body);
        const headBox = boxOf(head);
        const bodyBox = boxOf(body);
        const labelBox = boxOf(head?.querySelector(".sort-header") || head);
        const style = head ? getComputedStyle(head) : null;
        return {
          key: spec.key,
          headBox,
          bodyBox,
          labelBox,
          justifyContent: style?.justifyContent || "",
          textAlign: style?.textAlign || "",
        };
      }),
    };
  });

  expect(desktopMetrics.headerDisplay, `desktop header should be rendered: ${JSON.stringify(desktopMetrics)}`).toBe("grid");
  expect(
    desktopMetrics.rowHeight,
    `desktop transaction row should stay ledger-dense: ${JSON.stringify(desktopMetrics)}`,
  ).toBeLessThanOrEqual(36);
  for (const column of desktopMetrics.columns) {
    expect(column.headBox, `${column.key} header box should exist: ${JSON.stringify(desktopMetrics)}`).not.toBeNull();
    expect(column.bodyBox, `${column.key} body box should exist: ${JSON.stringify(desktopMetrics)}`).not.toBeNull();
    expect(column.labelBox, `${column.key} label box should exist: ${JSON.stringify(desktopMetrics)}`).not.toBeNull();
    expectClose(column.headBox.left, column.bodyBox.left, 2, `${column.key} left edge`);
    expectClose(column.headBox.width, column.bodyBox.width, 2.5, `${column.key} width`);
    expectClose(column.labelBox.centerX, column.headBox.centerX, 1.5, `${column.key} header label center`);
    expect(column.justifyContent, `${column.key} header should center content: ${JSON.stringify(column)}`).toBe("center");
    expect(column.textAlign, `${column.key} header should center text: ${JSON.stringify(column)}`).toBe("center");
  }

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
      const navBox = nav?.getBoundingClientRect();
      const fabBox = fab?.getBoundingClientRect();
      const rowBox = row?.getBoundingClientRect();
      const readBox = (box) =>
        box
          ? {
              left: box.left,
              right: box.right,
              width: box.width,
              height: box.height,
            }
          : null;
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
              right: fabBox.right,
              bottom: fabBox.bottom,
              width: fabBox.width,
              height: fabBox.height,
              rightGap: window.innerWidth - fabBox.right,
            }
          : null,
        rowHeight: rowBox?.height ?? 0,
        amount: readBox(amount?.getBoundingClientRect()),
        action: readBox(action?.getBoundingClientRect()),
        actionButtonCount: row?.querySelectorAll(".transaction-col-actions button").length ?? 0,
        documentOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(mobileMetrics.nav, `${profile.name} bottom nav should exist: ${JSON.stringify(mobileMetrics)}`).not.toBeNull();
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
    expect(mobileMetrics.fab.position, `${profile.name} FAB should be fixed: ${JSON.stringify(mobileMetrics)}`).toBe("fixed");
    expect(
      mobileMetrics.fab.rightGap,
      `${profile.name} FAB should align to the visual right edge: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(14);
    expect(mobileMetrics.fab.width, `${profile.name} FAB touch width: ${JSON.stringify(mobileMetrics)}`).toBeGreaterThanOrEqual(44);
    expect(mobileMetrics.fab.height, `${profile.name} FAB touch height: ${JSON.stringify(mobileMetrics)}`).toBeGreaterThanOrEqual(44);
    expect(
      mobileMetrics.rowHeight,
      `${profile.name} transaction row should stay dense: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(46);
    expect(mobileMetrics.amount, `${profile.name} amount cell should exist: ${JSON.stringify(mobileMetrics)}`).not.toBeNull();
    expect(mobileMetrics.action, `${profile.name} action cell should exist: ${JSON.stringify(mobileMetrics)}`).not.toBeNull();
    expect(mobileMetrics.actionButtonCount, `${profile.name} mobile transaction row should not expose row action buttons: ${JSON.stringify(mobileMetrics)}`).toBe(0);
    expect(
      mobileMetrics.amount.right,
      `${profile.name} amount text should stay inside the viewport: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(mobileMetrics.viewportWidth - 8);
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

test("transaction ledger aligns desktop cells and keeps mobile rows compact", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("ledger-consistency")}@example.com`;
  const displayName = "댕댕 가족비서";
  const memoPrefix = `${unique("ledger-consistency-memo")}-생활비`;

  await registerAndVerify(page, { email, displayName });
  const category = await createCategoryViaApi(page, {
    major: "생활용품",
    minor: "건강",
  });
  for (let index = 0; index < 14; index += 1) {
    await createTransactionViaApi(page, {
      memo: `${memoPrefix}-${String(index).padStart(2, "0")}`,
      amount: String(15000 + index),
      categoryId: category.id,
      ownerName: displayName,
    });
  }
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
        cueVisible: visible(ownerCell?.querySelector(".transaction-owner-cue")),
        cueText: ownerCell?.querySelector(".transaction-owner-cue")?.textContent?.replace(/\s+/g, " ").trim() || "",
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

  expect(desktopMetrics.owner.compactVisible, `desktop should not show mobile owner initials: ${JSON.stringify(desktopMetrics)}`).toBe(false);
  expect(desktopMetrics.owner.cueVisible, `desktop should show the full owner cue: ${JSON.stringify(desktopMetrics)}`).toBe(true);
  expect(desktopMetrics.owner.cueText).toBe(displayName);
  expect(desktopMetrics.category.desktopCueVisible, `desktop should use the compact category cue: ${JSON.stringify(desktopMetrics)}`).toBe(true);
  expect(desktopMetrics.category.desktopCueText).toBe("건강");
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
  await expect(desktopFilterPanel.locator("[data-transaction-filter-field='amount_min']")).toBeFocused();

  const desktopTypeFilter = page.locator(".transactions-desktop-ledger-head").getByRole("button", { name: "유형 필터 열기" });
  await desktopTypeFilter.click();
  await expect(desktopFilterPanel.locator("[data-transaction-filter-field='flow_type']")).toBeFocused();

  for (const profile of MOBILE_PROFILES) {
    await openLedger(page, profile);
    const mobileMetrics = await page.locator("tr.transaction-row", { hasText: `${memoPrefix}-00` }).first().evaluate((row) => {
      const head = document.querySelector(".transactions-mobile-ledger-head");
      const toolbar = document.querySelector("[data-testid='transaction-sticky-toolbar']");
      const rowBox = row.getBoundingClientRect();
      const memo = row.querySelector(".transaction-col-memo");
      const memoText = row.querySelector(".transaction-memo-text");
      const headerItems = Array.from(head?.children || []).filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      });
      const headBox = head?.getBoundingClientRect();
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
      const countSummary = toolbar?.querySelector(".surface-count-summary");
      return {
        viewportWidth: document.documentElement.clientWidth,
        rowHeight: rowBox.height,
        rowTopGap: memoText ? memoText.getBoundingClientRect().top - rowBox.top : 0,
        rowBottomGap: memoText ? rowBox.bottom - memoText.getBoundingClientRect().bottom : 0,
        memoWidth: memo?.getBoundingClientRect().width || 0,
        dateHeadText: head?.querySelector(".ledger-head-date")?.textContent?.replace(/\s+/g, " ").trim() || "",
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
    expect(
      mobileMetrics.headerCenterDeltas.every((item) => item.delta <= 3),
      `${profile.name} header labels should be vertically centered: ${JSON.stringify(mobileMetrics.headerCenterDeltas)}`,
    ).toBe(true);
    expect(
      mobileMetrics.memoWidth,
      `${profile.name} memo text column should have enough room: ${JSON.stringify(mobileMetrics)}`,
    ).toBeGreaterThanOrEqual(profile.width <= 360 ? 86 : 104);
    expect(
      mobileMetrics.rowHeight,
      `${profile.name} collapsed rows should stay dense: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(44.5);
    expect(
      Math.min(mobileMetrics.rowTopGap, mobileMetrics.rowBottomGap),
      `${profile.name} row text should not sit against row borders: ${JSON.stringify(mobileMetrics)}`,
    ).toBeGreaterThanOrEqual(4);
    expect(mobileMetrics.toolbar.summaryText).toContain("총 14건 중 14건 표시");
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
