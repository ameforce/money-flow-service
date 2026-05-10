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

test("ws flow: connected state and cross-session transaction sync", async ({ browser }) => {
  test.setTimeout(300_000);

  const email = `${unique("ws-user")}@example.com`;
  const displayName = unique("ws-name");
  const txMemo = unique("ws-memo");

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
  } finally {
    await firstContext.close();
    await secondContext.close();
  }
});
