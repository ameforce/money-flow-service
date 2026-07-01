import { expect, test } from "@playwright/test";

import {
  TEST_PASSWORD,
  assertResponsiveShell,
  capture,
  createBasicTransaction,
  login,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

function previousMonthDateIso() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCDate(0);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

// This spec creates two manual browser contexts per project and already captures
// flow evidence explicitly. Retained trace/video finalization can race under
// parallel local project runs after the assertions have passed.
test.use({ trace: "off", video: "off" });

async function expectTransactionSelectionSummary(page, count) {
  const summary = page.getByTestId("transaction-sticky-toolbar").getByTestId("transaction-selection-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(`선택 ${count}건`);
  return summary;
}

async function selectTransactionRowForToolbar(page, row) {
  await expect(row).toBeVisible();
  await row.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  if ((await row.getAttribute("data-row-selected")) !== "true") {
    const checkbox = row.locator(".transaction-col-select input[type='checkbox']").first();
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.check({ force: true });
    } else {
      await row.locator(".transaction-col-memo").click();
    }
  }
  await expect(row).toHaveAttribute("data-row-selected", "true");
  await expectTransactionSelectionSummary(page, 1);
}

async function clickTransactionRowAction(page, row, actionName) {
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

test("ws flow: connected state and cross-session transaction sync", async ({ browser }) => {
  test.setTimeout(300_000);

  const email = `${unique("ws-user")}@example.com`;
  const displayName = unique("ws-name");
  const txMemo = unique("ws-memo");
  const editedMemo = unique("ws-edited-memo");
  const txOccurredOn = previousMonthDateIso();

  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  try {
    await registerAndVerify(firstPage, { email, password: TEST_PASSWORD, displayName });
    await firstPage.setViewportSize({ width: 1366, height: 960 });
    await assertResponsiveShell(firstPage);
    await expect(firstPage.getByText("실시간 연결: 연결됨")).toBeVisible({ timeout: 20_000 });
    await capture(firstPage, "ws-primary-connected");

    await login(secondPage, { email, password: TEST_PASSWORD });
    await assertResponsiveShell(secondPage);
    await expect(secondPage.getByText("실시간 연결: 연결됨")).toBeVisible({ timeout: 20_000 });

    await openTab(firstPage, "거래");
    await openTab(secondPage, "거래");
    await createBasicTransaction(secondPage, { memo: txMemo, amount: "3333", occurredOn: txOccurredOn });
    await capture(secondPage, "ws-secondary-created-tx");

    await expect(firstPage.locator("tr.transaction-row", { hasText: txMemo }).first()).toBeVisible({ timeout: 20_000 });
    await capture(firstPage, "ws-primary-received-update");

    const secondaryRow = secondPage.locator("tr.transaction-row", { hasText: txMemo }).first();
    await clickTransactionRowAction(secondPage, secondaryRow, "수정");
    const editorRow = secondPage.locator("tr.transaction-inline-editor-row").first();
    await expect(editorRow).toBeVisible();
    await editorRow.getByLabel("메모").fill(editedMemo);
    await editorRow.getByRole("button", { name: "저장" }).click();

    await expect(firstPage.locator("tr.transaction-row", { hasText: editedMemo }).first()).toBeVisible({ timeout: 20_000 });
    await expect(firstPage.locator("tr.transaction-row", { hasText: txMemo })).toHaveCount(0);
    await capture(firstPage, "ws-primary-received-edit");

    const editedSecondaryRow = secondPage.locator("tr.transaction-row", { hasText: editedMemo }).first();
    await clickTransactionRowAction(secondPage, editedSecondaryRow, "삭제");
    const confirmDialog = secondPage.locator(".confirm-dialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "삭제" }).click();

    await expect(firstPage.locator("tr.transaction-row", { hasText: editedMemo })).toHaveCount(0, { timeout: 20_000 });
    await capture(firstPage, "ws-primary-received-delete");
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});
