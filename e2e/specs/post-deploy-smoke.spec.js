import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  TEST_PASSWORD,
  assertResponsiveShell,
  capture,
  createBasicHolding,
  createBasicTransaction,
  createImportWorkbook,
  expectNoHorizontalOverflow,
  login,
  openTab,
  registerAndVerify,
  setLocalInputFile,
  unique,
} from "../support/helpers";

async function authenticateForPostDeploy(page) {
  const email = String(process.env.E2E_POST_DEPLOY_EMAIL || "").trim();
  const password = String(process.env.E2E_POST_DEPLOY_PASSWORD || TEST_PASSWORD).trim();
  if (email) {
    await login(page, { email, password });
    return email;
  }

  const localEmail = `${unique("post-deploy-local")}@example.com`;
  await registerAndVerify(page, {
    email: localEmail,
    password,
    displayName: unique("post-deploy-local-name"),
  });
  return localEmail;
}

test("post-deploy live smoke: auth shell and safe deeplinks", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto("/?verify_token=query-token");
  await expect(page.getByRole("button", { name: "로그인하기" })).toBeVisible();
  await expect(page.getByText("보안을 위해 URL query 토큰은 지원하지 않습니다.")).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("verify_token=query-token");
  await capture(page, "post-deploy-query-token-rejected");

  await authenticateForPostDeploy(page);
  await assertResponsiveShell(page);
  await page.goto("/?tab=holdings");
  await expect(page.locator("main.app-shell")).toHaveAttribute("translate", "no");
  await expect(page.getByRole("button", { name: "자산", exact: true }).first()).toHaveClass(/active/);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "post-deploy-login-tab-holdings");
});

test("post-deploy live smoke: transaction and holding flows", async ({ page }) => {
  test.setTimeout(120_000);

  await authenticateForPostDeploy(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);

  await openTab(page, "거래");
  const memo = unique("post-deploy-tx");
  await createBasicTransaction(page, { memo, amount: "13579" });
  await expect(page.locator("tr.transaction-row", { hasText: memo }).first()).toBeVisible();

  const holdingName = unique("post-deploy-holding");
  await createBasicHolding(page, {
    name: holdingName,
    category: "검증자산",
    marketValue: "246800",
  });
  await expect(page.locator("tr", { hasText: holdingName }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "post-deploy-transaction-holding");
});

test("post-deploy live smoke: workbook import dry-run and apply", async ({ page }, testInfo) => {
  test.setTimeout(150_000);

  await authenticateForPostDeploy(page);
  const txMemo = unique("post-deploy-import-tx");
  const holdingName = unique("post-deploy-import-holding");
  const categoryMinor = unique("post-deploy-import-minor");
  const workbookPath = testInfo.outputPath(`${unique("post-deploy-import")}.xlsx`);
  createImportWorkbook(workbookPath, { txMemo, holdingName, categoryMinor });

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "데이터 가져오기");
  await expectNoHorizontalOverflow(page, 12);

  const fileInput = page.getByLabel("엑셀 파일 업로드");
  const applyButton = page.getByRole("button", { name: "적용", exact: true });
  const workbookReport = page.locator("section.import-report", { hasText: "검증 리포트" });

  await setLocalInputFile(fileInput, workbookPath, {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await expect(page.getByText(path.basename(workbookPath))).toBeVisible();
  await page.getByRole("button", { name: "미리 검증", exact: true }).click();
  await expect(page.getByText("미리 검증 완료")).toBeVisible();
  await expect(workbookReport).toContainText(path.basename(workbookPath));

  await applyButton.click();
  await expect(page.getByText("적용 완료")).toBeVisible();
  await expect(workbookReport).toContainText("적용된 거래");

  await openTab(page, "거래");
  await page.getByLabel("연도", { exact: true }).fill("2026");
  await page.getByLabel("월", { exact: true }).fill("3");
  await page.getByLabel("월", { exact: true }).press("Enter");
  await expect(page.locator("tr.transaction-row", { hasText: txMemo }).first()).toBeVisible();
  await capture(page, "post-deploy-import-apply");
});
