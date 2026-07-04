import { expect, test } from "@playwright/test";

import {
  capture,
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
      const toggle = action?.querySelector(".mobile-toggle-btn");
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
        toggle: readBox(toggle?.getBoundingClientRect()),
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
    expect(mobileMetrics.toggle, `${profile.name} toggle should exist: ${JSON.stringify(mobileMetrics)}`).not.toBeNull();
    expect(
      mobileMetrics.action.width,
      `${profile.name} action column should contain the toggle: ${JSON.stringify(mobileMetrics)}`,
    ).toBeGreaterThanOrEqual(mobileMetrics.toggle.width - 0.5);
    expect(
      mobileMetrics.amount.right,
      `${profile.name} amount text should not overlap the row toggle: ${JSON.stringify(mobileMetrics)}`,
    ).toBeLessThanOrEqual(mobileMetrics.toggle.left + 0.5);
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
