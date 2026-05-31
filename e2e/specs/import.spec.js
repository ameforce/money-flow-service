import crypto from "node:crypto";
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

const E2E_TOSS_SOURCE_SECRET =
  process.env.E2E_SECRET_KEY || "test-secret-key-for-e2e-toss-import-1234567890";

function signedTossSource(sourceRef) {
  return {
    source_ref: sourceRef,
    source_ref_signature: crypto.createHmac("sha256", E2E_TOSS_SOURCE_SECRET).update(sourceRef).digest("hex"),
  };
}

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
  const fileDropArea = page.locator(".file-drop-area").first();
  const dryRunButton = page.getByRole("button", { name: "미리 검증", exact: true });
  const applyButton = page.getByRole("button", { name: "적용", exact: true });
  const workbookReport = page.locator("section.import-report", { hasText: "검증 리포트" });
  await expect(fileInput).toBeEnabled();
  await expectWithinViewport(fileDropArea);
  await expectWithinViewport(dryRunButton);
  await expectKeyboardReachableInOrder(page, [dryRunButton, applyButton], { maxTabsPerLocator: 40 });

  await fileInput.setInputFiles(importWorkbookPath);
  await expect(page.getByText(path.basename(importWorkbookPath))).toBeVisible();

  await dryRunButton.click();
  await expect(page.getByText("미리 검증 완료")).toBeVisible();
  await expect(workbookReport).toContainText(path.basename(importWorkbookPath));
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "import-mobile-dry-run");

  await expectWithinViewport(applyButton);
  await expectKeyboardReachableInOrder(page, [applyButton], { maxTabsPerLocator: 40 });
  await applyButton.click();
  await expect(page.getByText("적용 완료")).toBeVisible();
  await expect(workbookReport).toContainText("적용된 거래");
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
  const migrationReport = page.locator(".import-package-panel", { hasText: "환경 이식 패키지" });
  await expect(packageInput).toBeEnabled();
  await packageInput.setInputFiles(migrationPackagePath);
  await expect(page.getByText(path.basename(migrationPackagePath))).toBeVisible();

  const dryRunButton = page.getByRole("button", { name: "패키지 미리 검증", exact: true });
  const applyButton = page.getByRole("button", { name: "패키지 적용", exact: true });
  await dryRunButton.scrollIntoViewIfNeeded();
  await expect(dryRunButton).toBeVisible();
  await applyButton.scrollIntoViewIfNeeded();
  await expect(applyButton).toBeVisible();
  await dryRunButton.click();
  await expect(page.getByText("미리 검증 완료")).toBeVisible();
  await expect(migrationReport).toContainText(path.basename(migrationPackagePath));
  await capture(page, "migration-package-mobile-dry-run");

  await applyButton.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "교체 적용" }).click();
  await expect(page.getByText("적용 완료")).toBeVisible();
  await expect(migrationReport).toContainText("적용 거래");
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "migration-package-mobile-apply");
});

test("import flow: Toss screenshot preview review and apply", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("toss-import-user")}@example.com`;
  const displayName = unique("toss-import-name");
  const tossMemo = unique("toss-e2e-income");
  const skippedMemo = unique("toss-e2e-duplicate");

  await page.route("**/api/v1/imports/toss-screenshots/preview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [
          {
            row_id: "toss-e2e-income-row",
            ...signedTossSource("toss:e2e-income-row"),
            source_image_name: "toss.png",
            source_image_index: 0,
            occurred_on: "2026-05-22",
            time: "12:07",
            item_name: "토스E2E급여",
            detail: "",
            amount: "4112948",
            signed_amount: "4112948",
            balance: "7436967",
            flow_type: "income",
            category_id: null,
            category_recommendation: {
              suggested_major: "수입",
              suggested_minor: "기타수입",
              reason: "income_fallback",
              create_allowed: false,
            },
            included: true,
            duplicate_group_id: null,
            exclusion_reason: null,
          },
          {
            row_id: "toss-e2e-duplicate-row",
            ...signedTossSource("toss:e2e-duplicate-row"),
            source_image_name: "toss.png",
            source_image_index: 0,
            occurred_on: "2026-05-22",
            time: "09:15",
            item_name: skippedMemo,
            detail: "",
            amount: "1900",
            signed_amount: "-1900",
            balance: "4024514",
            flow_type: "expense",
            category_id: null,
            category_recommendation: null,
            included: false,
            duplicate_group_id: "dup-1",
            exclusion_reason: "duplicate_candidate",
          },
        ],
        excluded_candidates: [
          {
            source_image_name: "toss.png",
            source_image_index: 0,
            item_name: "흐린 행",
            raw_text: "흐린 행\n-20,310원",
            exclusion_reason: "missing_required_fields",
          },
        ],
        summary: {
          image_count: 1,
          parsed_rows: 2,
          excluded_candidates: 1,
          duplicate_candidates: 1,
        },
        issues: [],
      }),
    });
  });

  await registerAndVerify(page, { email, displayName });
  await assertResponsiveShell(page);
  await page.getByRole("button", { name: "데이터 가져오기", exact: true }).click();
  await page.getByRole("button", { name: "토스 이미지" }).click();
  await capture(page, "toss-import-entry");

  await page.getByLabel("토스 스크린샷 업로드").setInputFiles({
    name: "toss.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake image bytes"),
  });
  await expect(page.getByText("toss.png")).toBeVisible();

  await page.getByRole("button", { name: "검토 표 만들기" }).click();
  const reviewRows = page.locator(".toss-review-table tbody tr");
  await expect(reviewRows).toHaveCount(2);
  const incomeRow = reviewRows.nth(0);
  const duplicateRow = reviewRows.nth(1);
  await expect(incomeRow.locator('td[data-label="항목명"] input').first()).toHaveValue("토스E2E급여");
  await expect(duplicateRow.locator(".status-pill")).toHaveText("중복 후보");
  await expect(page.getByText("제외된 후보 / 인식 불가")).toBeVisible();
  await expect(incomeRow.locator(".toss-category-recommendation")).toContainText("추천 카테고리");

  await incomeRow.locator('td[data-label="항목명"] input').first().fill(tossMemo);
  await expect(duplicateRow.locator('td[data-label="항목명"] input').first()).toHaveValue(skippedMemo);
  await expect(duplicateRow.getByRole("checkbox")).not.toBeChecked();
  await capture(page, "toss-import-preview");

  await page.getByRole("button", { name: "포함 행 적용" }).click();
  await expect(page.getByText(/토스 거래 적용 완료/)).toBeVisible();

  await page.getByRole("button", { name: "거래", exact: true }).click();
  await page.getByLabel("연도", { exact: true }).fill("2026");
  await page.getByLabel("월", { exact: true }).fill("5");
  await page.getByLabel("월", { exact: true }).press("Enter");
  await expect(page.locator("tr.transaction-row", { hasText: tossMemo }).first()).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: skippedMemo })).toHaveCount(0);
  await capture(page, "toss-import-apply-result");
});
