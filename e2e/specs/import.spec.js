import path from "node:path";

import { expect, test } from "@playwright/test";

import { assertResponsiveShell, capture, createImportWorkbook, registerAndVerify, unique } from "../support/helpers";

test("import flow: workbook dry-run and apply", async ({ page }, testInfo) => {
  test.setTimeout(240_000);

  const email = `${unique("import-user")}@example.com`;
  const displayName = unique("import-name");
  const importTxMemo = unique("import-tx");
  const importHoldingName = unique("import-holding");
  const importCategoryMinor = unique("import-minor");
  const importWorkbookPath = testInfo.outputPath(`${unique("import-workbook")}.xlsx`);

  createImportWorkbook(importWorkbookPath, {
    txMemo: importTxMemo,
    holdingName: importHoldingName,
    categoryMinor: importCategoryMinor,
  });

  await registerAndVerify(page, { email, displayName });
  await assertResponsiveShell(page);
  await page.getByRole("button", { name: "데이터 가져오기", exact: true }).click();
  await capture(page, "import-entry");

  await page.getByLabel("엑셀 파일 업로드").setInputFiles(importWorkbookPath);
  await expect(page.getByText(path.basename(importWorkbookPath))).toBeVisible();

  await page.getByRole("button", { name: "미리 검증" }).click();
  await expect(page.getByText("미리 검증 완료")).toBeVisible();
  await expect(page.locator(".import-report")).toContainText(path.basename(importWorkbookPath));
  await capture(page, "import-dry-run");

  await page.getByRole("button", { name: "적용" }).click();
  await expect(page.getByText("적용 완료")).toBeVisible();
  await expect(page.locator(".import-report")).toContainText("적용된 거래");

  await page.getByRole("button", { name: "거래", exact: true }).click();
  await expect(page.locator("tr.transaction-row", { hasText: importTxMemo }).first()).toBeVisible();

  await page.getByRole("button", { name: "자산", exact: true }).click();
  await expect(page.locator("tr", { hasText: importHoldingName }).first()).toBeVisible();
  await capture(page, "import-apply-result");
});
