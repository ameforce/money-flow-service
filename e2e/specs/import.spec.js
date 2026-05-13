import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createImportWorkbook,
  expectKeyboardReachableInOrder,
  expectNoHorizontalOverflow,
  expectWithinViewport,
  registerAndVerify,
  unique,
} from "../support/helpers";

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
  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);
  await page.getByRole("button", { name: "데이터 가져오기", exact: true }).click();
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "import-mobile-entry");

  const fileInput = page.getByLabel("엑셀 파일 업로드");
  const fileDropArea = page.locator(".file-drop-area");
  const dryRunButton = page.getByRole("button", { name: "미리 검증" });
  const applyButton = page.getByRole("button", { name: "적용" });
  await expect(fileInput).toBeEnabled();
  await expectWithinViewport(fileDropArea);
  await expectWithinViewport(dryRunButton);
  await expectKeyboardReachableInOrder(page, [dryRunButton, applyButton], { maxTabsPerLocator: 40 });

  await fileInput.setInputFiles(importWorkbookPath);
  await expect(page.getByText(path.basename(importWorkbookPath))).toBeVisible();

  await dryRunButton.click();
  await expect(page.getByText("미리 검증 완료")).toBeVisible();
  await expect(page.locator(".import-report")).toContainText(path.basename(importWorkbookPath));
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "import-mobile-dry-run");

  await expectWithinViewport(applyButton);
  await expectKeyboardReachableInOrder(page, [applyButton], { maxTabsPerLocator: 40 });
  await applyButton.click();
  await expect(page.getByText("적용 완료")).toBeVisible();
  await expect(page.locator(".import-report")).toContainText("적용된 거래");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "import-mobile-apply-result");

  await page.getByRole("button", { name: "거래", exact: true }).click();
  await page.getByLabel("연도", { exact: true }).fill("2026");
  await page.getByLabel("월", { exact: true }).fill("3");
  await page.getByLabel("월", { exact: true }).press("Enter");
  await expect(page.locator("tr.transaction-row", { hasText: importTxMemo }).first()).toBeVisible();

  await page.getByRole("button", { name: "자산", exact: true }).click();
  await expect(page.locator("tr", { hasText: importHoldingName }).first()).toBeVisible();
  await capture(page, "import-apply-result");
});

test("import flow: migration package export and upload", async ({ page }, testInfo) => {
  test.setTimeout(180_000);

  const email = `${unique("migration-user")}@example.com`;
  const displayName = unique("migration-name");
  const migrationPackagePath = testInfo.outputPath(`${unique("migration-package")}.zip`);

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);
  await page.getByRole("button", { name: "데이터 가져오기", exact: true }).click();
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "migration-package-mobile-entry");

  const exportButton = page.getByRole("button", { name: "현재 가계 패키지 추출" });
  await expectWithinViewport(exportButton);
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  await download.saveAs(migrationPackagePath);

  const packageInput = page.getByLabel("이식 패키지 업로드");
  await expect(packageInput).toBeEnabled();
  await packageInput.setInputFiles(migrationPackagePath);
  await expect(page.getByText(path.basename(migrationPackagePath))).toBeVisible();

  const dryRunButton = page.getByRole("button", { name: "패키지 미리 검증" });
  const applyButton = page.getByRole("button", { name: "패키지 적용" });
  await expectWithinViewport(dryRunButton);
  await expectWithinViewport(applyButton);
  await dryRunButton.click();
  await expect(page.getByText("미리 검증 완료")).toBeVisible();
  await expect(page.locator(".import-report")).toContainText(path.basename(migrationPackagePath));
  await capture(page, "migration-package-mobile-dry-run");

  await applyButton.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "교체 적용" }).click();
  await expect(page.getByText("적용 완료")).toBeVisible();
  await expect(page.locator(".import-report")).toContainText("적용 거래");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "migration-package-mobile-apply");
});
