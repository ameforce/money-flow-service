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

// This spec creates two manual browser contexts per project and already captures
// flow evidence explicitly. Retained trace/video finalization can race under
// parallel local project runs after the assertions have passed.
test.use({ trace: "off", video: "off" });

async function clickTransactionRowAction(row, actionName) {
  const inlineAction = row.locator("td").last().getByRole("button", { name: actionName }).first();
  if (await inlineAction.isVisible().catch(() => false)) {
    await inlineAction.click();
    return;
  }

  const mobileExpand = row.getByRole("button", { name: /거래 세부 보기|거래 세부 접기/ }).first();
  if (await mobileExpand.isVisible().catch(() => false)) {
    const expanded = await mobileExpand.getAttribute("aria-expanded").catch(() => "");
    if (expanded !== "true") {
      await mobileExpand.click();
    }
  } else {
    await row.click();
  }

  const expandedActions = row.locator(
    "xpath=following-sibling::tr[contains(concat(' ', normalize-space(@class), ' '), ' transaction-mobile-expanded-actions-row ')][1]"
  );
  await expect(expandedActions).toBeVisible();
  await expandedActions.getByRole("button", { name: actionName }).click();
}

test("ws flow: connected state and cross-session transaction sync", async ({ browser }) => {
  test.setTimeout(300_000);

  const email = `${unique("ws-user")}@example.com`;
  const displayName = unique("ws-name");
  const txMemo = unique("ws-memo");
  const editedMemo = unique("ws-edited-memo");

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
    await createBasicTransaction(secondPage, { memo: txMemo, amount: "3333" });
    await capture(secondPage, "ws-secondary-created-tx");

    await expect(firstPage.locator("tr.transaction-row", { hasText: txMemo }).first()).toBeVisible({ timeout: 20_000 });
    await capture(firstPage, "ws-primary-received-update");

    const secondaryRow = secondPage.locator("tr.transaction-row", { hasText: txMemo }).first();
    await clickTransactionRowAction(secondaryRow, "수정");
    const editorRow = secondPage.locator("tr.transaction-inline-editor-row").first();
    await expect(editorRow).toBeVisible();
    await editorRow.getByLabel("메모").fill(editedMemo);
    await editorRow.getByRole("button", { name: "저장" }).click();

    await expect(firstPage.locator("tr.transaction-row", { hasText: editedMemo }).first()).toBeVisible({ timeout: 20_000 });
    await expect(firstPage.locator("tr.transaction-row", { hasText: txMemo })).toHaveCount(0);
    await capture(firstPage, "ws-primary-received-edit");

    const editedSecondaryRow = secondPage.locator("tr.transaction-row", { hasText: editedMemo }).first();
    await clickTransactionRowAction(editedSecondaryRow, "삭제");
    const confirmDialog = secondPage.locator(".confirm-dialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "삭제" }).click();

    await expect(firstPage.locator("tr.transaction-row", { hasText: editedMemo })).toHaveCount(0, { timeout: 20_000 });
    await capture(firstPage, "ws-primary-received-delete");
  } finally {
    await Promise.allSettled([firstContext.close(), secondContext.close()]);
  }
});
