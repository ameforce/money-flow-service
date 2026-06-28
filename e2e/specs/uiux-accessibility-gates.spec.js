import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  capture,
  createHoldingViaApi,
  createTransactionViaApi,
  expectNoHorizontalOverflow,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function expectNoAxeViolations(page, label, includeSelector = "body") {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .include(includeSelector)
    .analyze();
  const violations = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.slice(0, 4).map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }));

  expect(violations, `${label} axe violations: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
}

test("issue #250: axe WCAG gate covers dashboard and transaction entry", async ({ page }) => {
  const email = `${unique("uiux-axe-gate")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-axe-gate-name") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "대시보드");
  await expect(page.locator(".dashboard-command-center")).toBeVisible();
  await expectNoAxeViolations(page, "dashboard command center", ".dashboard-command-center");

  await openTab(page, "거래");
  await page.getByTestId("transactions-fab").click();
  await expect(page.getByTestId("transaction-entry-sheet")).toBeVisible();
  await expectNoAxeViolations(page, "transaction entry sheet", "[data-testid='transaction-entry-sheet']");
  await capture(page, "issue-250-axe-transaction-entry-sheet");
});

test("issue #251: forced colors and text spacing keep transaction entry operable", async ({ page }) => {
  const email = `${unique("uiux-forced-colors")}@example.com`;

  await page.emulateMedia({ forcedColors: "active" });
  await registerAndVerify(page, { email, displayName: unique("uiux-forced-colors-name") });
  await page.setViewportSize({ width: 320, height: 568 });
  await openTab(page, "거래");
  await page.addStyleTag({
    content: `
      body, button, input, select, textarea {
        line-height: 1.5 !important;
        letter-spacing: 0.08em !important;
        word-spacing: 0.12em !important;
      }
      p, .table-summary {
        margin-bottom: 1.5em !important;
      }
    `,
  });

  await page.getByTestId("transactions-fab").click();
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();
  await expect(transactionSheet.getByTestId("transaction-quick-amount")).toBeVisible();
  await expect(transactionSheet.getByTestId("transaction-category-search-toggle")).toBeVisible();
  await expect(transactionSheet.getByTestId("transaction-quick-save")).toBeVisible();
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-251-forced-colors-text-spacing-transaction-entry");
});

test("issue #254: mobile transaction entry exposes input semantics", async ({ page }) => {
  const email = `${unique("uiux-mobile-input-semantics")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-mobile-input-semantics-name") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.getByTestId("transactions-fab").click();

  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();
  await expect(transactionSheet.getByText("미선택 저장 가능")).toBeVisible();
  await expect(transactionSheet.getByText("검색 결과가 없습니다.")).toHaveCount(0);
  await expect(transactionSheet.getByTestId("transaction-category-create-toggle")).toHaveCount(0);
  const metrics = await transactionSheet.evaluate((sheet) => {
    const amount = sheet.querySelector("[data-testid='transaction-quick-amount']");
    const memo = Array.from(sheet.querySelectorAll("label")).find((label) => label.textContent?.includes("메모"))?.querySelector("input");
    const searchToggle = sheet.querySelector("[data-testid='transaction-category-search-toggle']");
    return {
      amount: {
        type: amount?.getAttribute("type") || "",
        inputMode: amount?.getAttribute("inputmode") || "",
        autoComplete: amount?.getAttribute("autocomplete") || "",
        enterKeyHint: amount?.getAttribute("enterkeyhint") || "",
        hasLabel: Boolean(amount?.closest("label")?.textContent?.includes("금액")),
      },
      memo: {
        type: memo?.getAttribute("type") || "",
        enterKeyHint: memo?.getAttribute("enterkeyhint") || "",
        hasLabel: Boolean(memo?.closest("label")?.textContent?.includes("메모")),
      },
      searchToggle: {
        text: searchToggle?.textContent?.trim() || "",
        type: searchToggle?.getAttribute("type") || "",
      },
    };
  });

  expect(metrics.amount).toMatchObject({
    type: "text",
    inputMode: "numeric",
    autoComplete: "off",
    enterKeyHint: "next",
    hasLabel: true,
  });
  expect(metrics.memo).toMatchObject({
    type: "",
    enterKeyHint: "done",
    hasLabel: true,
  });
  expect(metrics.searchToggle).toMatchObject({
    text: "카테고리 선택",
    type: "button",
  });

  await transactionSheet.getByTestId("transaction-category-search-toggle").click();
  const searchInput = transactionSheet.getByTestId("transaction-category-search");
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toHaveAttribute("type", "search");
  await searchInput.fill("없는카테고리");
  await expect(transactionSheet.getByText("검색 결과가 없습니다.")).toBeVisible();
  await expect(transactionSheet.getByTestId("transaction-category-create-toggle")).toBeVisible();
  await capture(page, "issue-254-mobile-transaction-entry-input-semantics");
});

test("issue #246: transaction validation errors are linked to blocking fields", async ({ page }) => {
  const email = `${unique("uiux-field-errors")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-field-errors-name") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.getByTestId("transactions-fab").click();

  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();
  const amountInput = transactionSheet.getByTestId("transaction-quick-amount");

  await amountInput.fill("");
  await transactionSheet.getByTestId("transaction-quick-save").click();

  await expect(amountInput).toHaveAttribute("aria-invalid", "true");
  await expect(amountInput).toHaveAttribute("aria-describedby", "transaction-quick-amount-error");
  const amountError = transactionSheet.locator("#transaction-quick-amount-error");
  await expect(amountError).toBeVisible();
  await expect(amountError).toHaveAttribute("role", "alert");
  await expect(amountError).toContainText("금액");
  await expect(amountInput).toBeFocused();
  await capture(page, "issue-246-transaction-field-linked-error");
});

test("issue #246 regression: transaction validation feedback clears across sheet reopen", async ({ page }) => {
  const email = `${unique("uiux-field-error-reset")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-field-error-reset-name") });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.getByTestId("transactions-fab").click();

  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();
  const amountInput = transactionSheet.getByTestId("transaction-quick-amount");
  await transactionSheet.getByTestId("transaction-quick-save").click();
  await expect(amountInput).toHaveAttribute("aria-invalid", "true");
  await expect(transactionSheet.locator("#transaction-quick-amount-error")).toBeVisible();

  await transactionSheet.getByTestId("transaction-entry-sheet-close").click();
  await expect(transactionSheet).toBeHidden();
  await expect(page.locator(".message", { hasText: "금액을 입력해 주세요." })).toHaveCount(0);

  await page.getByTestId("transactions-fab").click();
  await expect(transactionSheet).toBeVisible();
  await expect(amountInput).toBeFocused();
  await expect(amountInput).not.toHaveAttribute("aria-invalid", "true");
  await expect(amountInput).not.toHaveAttribute("aria-describedby", "transaction-quick-amount-error");
  await expect(transactionSheet.locator("#transaction-quick-amount-error")).toHaveCount(0);
  await capture(page, "issue-246-transaction-field-error-reset");
});

test("issue #245: transaction ledger exposes one native table header contract", async ({ page }) => {
  const email = `${unique("uiux-ledger-semantics")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-ledger-semantics-name") });
  await page.setViewportSize({ width: 1366, height: 900 });
  await createTransactionViaApi(page, {
    memo: unique("semantic-ledger-row"),
    amount: "12000",
    flowType: "expense",
  });
  await page.reload();
  await openTab(page, "거래");

  const semanticContract = await page.evaluate(() => {
    const visualHead = document.querySelector(".transactions-desktop-ledger-head");
    const table = document.querySelector(".transactions-surface-table");
    const nativeHeaders = table?.querySelectorAll("thead th") || [];
    return {
      visualHeadRole: visualHead?.getAttribute("role") || "",
      visualColumnHeaderCount: visualHead?.querySelectorAll('[role="columnheader"]').length || 0,
      nativeHeaderCount: nativeHeaders.length,
      nativeHeaderTexts: Array.from(nativeHeaders).map((header) => header.textContent?.replace(/\s+/g, " ").trim() || ""),
      nativeHeadDisplay: table ? getComputedStyle(table.querySelector("thead")).display : "",
    };
  });

  expect(semanticContract.visualHeadRole).toBe("");
  expect(semanticContract.visualColumnHeaderCount).toBe(0);
  expect(semanticContract.nativeHeaderCount).toBeGreaterThanOrEqual(8);
  expect(semanticContract.nativeHeaderTexts.join(" ")).toContain("금액");
  expect(semanticContract.nativeHeadDisplay).not.toBe("none");
  await capture(page, "issue-245-transaction-ledger-semantic-header");
});

test("issue #247 and #255: dashboard charts expose exact text alternatives", async ({ page }) => {
  const email = `${unique("uiux-chart-alternatives")}@example.com`;

  await registerAndVerify(page, { email, displayName: unique("uiux-chart-alternatives-name") });
  await createTransactionViaApi(page, {
    memo: unique("chart-income"),
    amount: "12000",
    flowType: "income",
  });
  await createTransactionViaApi(page, {
    memo: unique("chart-expense"),
    amount: "5000",
    flowType: "expense",
  });
  await createHoldingViaApi(page, {
    name: unique("chart-holding"),
    averageCost: "300000",
    quantity: "2",
  });
  await page.reload();
  await page.setViewportSize({ width: 1366, height: 900 });
  await openTab(page, "대시보드");

  const flowTable = page.getByTestId("dashboard-flow-value-table");
  await expect(flowTable).toBeVisible();
  await expect(flowTable).toContainText("수입");
  await expect(flowTable).toContainText("지출");
  await expect(flowTable).toContainText("12,000원");
  await expect(flowTable).toContainText("5,000원");

  const dashboardBreakdown = page.getByTestId("dashboard-portfolio-breakdown");
  await expect(dashboardBreakdown).toBeVisible();
  await expect(dashboardBreakdown).toContainText("600,000원");
  await expect(dashboardBreakdown).toContainText("%");
  await capture(page, "issue-247-255-dashboard-chart-text-alternatives");
});
