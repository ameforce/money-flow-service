import crypto from "node:crypto";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createImportWorkbook,
  createTransactionViaApi,
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

function createLargeImportReport() {
  const issues = Array.from({ length: 25 }, (_, index) => {
    const row = index + 1;
    return {
      code: row % 2 === 0 ? "INVALID_AMOUNT" : "MISSING_REQUIRED_VALUE",
      severity: row % 2 === 0 ? "warning" : "error",
      sheet: "거래내역",
      row,
      message: `누락 필수값 ${row}`,
    };
  });
  return {
    workbook_path: "large-import.xlsx",
    sheets: 2,
    transaction_rows: 25,
    holding_rows: 0,
    applied_transactions: 0,
    applied_holdings_added: 0,
    applied_holdings_updated: 0,
    monthly_formula_mismatch_count: 25,
    detected_mismatch_cells: Array.from({ length: 25 }, (_, index) => `거래내역!M${index + 1}`),
    issues,
  };
}

test("import flow: no-file actions stay disabled with helper text", async ({ page }) => {
  const email = `${unique("import-empty-user")}@example.com`;
  const displayName = unique("import-empty-name");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1440, height: 900 });
  await assertResponsiveShell(page);
  await page.getByRole("button", { name: "데이터 가져오기", exact: true }).click();

  const excelPanel = page.locator(".import-excel-panel");
  const excelDryRunButton = excelPanel.getByRole("button", { name: "미리 검증", exact: true });
  const excelApplyButton = excelPanel.getByRole("button", { name: "적용", exact: true });
  const excelFileRequiredHelp = excelPanel.locator("#excel-import-file-required");

  await expect(excelPanel.getByText("파일 대기")).toBeVisible();
  await expect(excelDryRunButton).toBeDisabled();
  await expect(excelApplyButton).toBeDisabled();
  await expect(excelDryRunButton).toHaveAttribute("aria-describedby", "excel-import-file-required");
  await expect(excelApplyButton).toHaveAttribute("aria-describedby", "excel-import-file-required");
  await expect(excelFileRequiredHelp).toHaveText("엑셀 파일을 선택하면 미리 검증과 적용을 사용할 수 있습니다.");
  await capture(page, "issue-217-excel-actions-disabled-without-file");

  const packagePanel = page.locator(".import-package-panel");
  const packageDryRunButton = packagePanel.getByRole("button", { name: "패키지 미리 검증", exact: true });
  const packageApplyButton = packagePanel.getByRole("button", { name: "패키지 적용", exact: true });
  const packageFileRequiredHelp = packagePanel.locator("#package-import-file-required");

  await expect(packageDryRunButton).toBeDisabled();
  await expect(packageApplyButton).toBeDisabled();
  await expect(packageDryRunButton).toHaveAttribute("aria-describedby", "package-import-file-required");
  await expect(packageApplyButton).toHaveAttribute("aria-describedby", "package-import-file-required");
  await expect(packageFileRequiredHelp).toHaveText("패키지 파일(.zip)을 선택하면 미리 검증과 적용을 사용할 수 있습니다.");
  await capture(page, "issue-217-package-actions-disabled-without-file");
});

test("import flow: mobile upload copy is touch oriented", async ({ page }) => {
  const email = `${unique("import-copy-user")}@example.com`;
  const displayName = unique("import-copy-name");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 320, height: 568 });
  await assertResponsiveShell(page);
  await page.getByRole("button", { name: "데이터 가져오기", exact: true }).click();

  const excelPanel = page.locator(".import-excel-panel");
  const workbookPlaceholder = excelPanel.locator(".upload-placeholder").first();
  await expect(workbookPlaceholder).toHaveText(
    "탭해서 엑셀 파일을 선택하세요. 파일 앱 또는 기기 저장소에서 업로드할 수 있습니다."
  );
  await expect(workbookPlaceholder).not.toContainText("드래그 앤 드롭");
  await expect(workbookPlaceholder).not.toContainText("클릭");
  await capture(page, "issue-229-mobile-import-upload-touch-copy");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(workbookPlaceholder).toContainText("드래그 앤 드롭");
  await expect(workbookPlaceholder).toContainText("클릭");
});

test("import flow: large report exposes full table filters and CSV export", async ({ page }, testInfo) => {
  const email = `${unique("import-large-report-user")}@example.com`;
  const displayName = unique("import-large-report-name");
  const workbookPath = testInfo.outputPath(`${unique("large-import-report")}.xlsx`);
  createImportWorkbook(workbookPath, {
    txMemo: unique("large-import-report-tx"),
    holdingName: unique("large-import-report-holding"),
    categoryMinor: unique("large-import-report-minor"),
  });

  await page.route("**/api/v1/imports/workbook/upload?mode=dry_run", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createLargeImportReport()),
    });
  });

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1440, height: 900 });
  await assertResponsiveShell(page);
  await page.getByRole("button", { name: "데이터 가져오기", exact: true }).click();

  await page.getByLabel("엑셀 파일 업로드").setInputFiles(workbookPath);
  await page.getByRole("button", { name: "미리 검증", exact: true }).click();

  const workbench = page.locator(".import-report-workbench");
  await expect(workbench.getByRole("heading", { name: "문제 정리 표" })).toBeVisible();
  await expect(workbench.getByLabel("정리 표 검색")).toBeVisible();
  await expect(workbench.getByLabel("심각도 필터")).toBeVisible();
  await expect(workbench.getByLabel("유형 필터")).toBeVisible();
  await expect(workbench.getByLabel("정렬")).toBeVisible();
  await expect(workbench.getByRole("button", { name: "CSV 복사" })).toBeVisible();

  await expect(workbench.getByText("누락 필수값 25")).toBeVisible();
  await expect(workbench.getByText("거래내역!M25")).toBeVisible();

  await workbench.getByLabel("정리 표 검색").fill("누락 필수값 25");
  await expect(workbench.getByText("누락 필수값 25")).toBeVisible();
  await expect(workbench.getByText("누락 필수값 24")).toHaveCount(0);

  await workbench.getByLabel("정리 표 검색").fill("");
  await workbench.getByLabel("심각도 필터").selectOption("error");
  await expect(workbench.getByText("누락 필수값 25")).toBeVisible();
  await expect(workbench.getByText("거래내역!M25")).toHaveCount(0);

  await workbench.getByLabel("심각도 필터").selectOption("all");
  await workbench.getByLabel("정렬").selectOption("row_desc");
  await expect(workbench.locator("tbody tr").first()).toContainText("25");
  await workbench.getByLabel("정렬").selectOption("row_asc");

  await workbench.getByLabel("유형 필터").selectOption("formula_mismatch");
  await expect(workbench.getByText("거래내역!M25")).toBeVisible();
  await expect(workbench.getByText("누락 필수값 25")).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await workbench.getByRole("button", { name: "CSV 다운로드" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^import-report-issues-.*\.csv$/);
  await capture(page, "issue-204-import-report-workbench");
});

test("import flow: legacy owner values can be explained and bulk remapped", async ({ page }) => {
  const email = `${unique("import-owner-remap-user")}@example.com`;
  const displayName = unique("import-owner-remap-name");
  const legacyOwner = unique("legacy-owner");
  const firstMemo = unique("legacy-owner-first");
  const secondMemo = unique("legacy-owner-second");

  await registerAndVerify(page, { email, displayName });
  await createTransactionViaApi(page, { memo: firstMemo, amount: "11111", ownerName: legacyOwner });
  await createTransactionViaApi(page, { memo: secondMemo, amount: "22222", ownerName: legacyOwner });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertResponsiveShell(page);
  await page.getByRole("button", { name: "데이터 가져오기", exact: true }).click();

  const cleanup = page.locator(".owner-remap-cleanup");
  await expect(cleanup.getByRole("heading", { name: "기존 소유자 정리" })).toBeVisible();
  await expect(cleanup).toContainText("기존 값은 현재 가계 구성원과 연결되지 않은 과거/가져오기 소유자명입니다.");
  const legacyRow = cleanup.locator(".owner-remap-row", { hasText: legacyOwner });
  await expect(legacyRow).toContainText("거래 2건");
  await expect(legacyRow.getByLabel(`${legacyOwner} 매핑 대상`)).toContainText(displayName);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "issue-202-legacy-owner-remap-mobile-ready");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(cleanup.getByRole("heading", { name: "기존 소유자 정리" })).toBeVisible();
  await capture(page, "issue-202-legacy-owner-remap-ready");

  await legacyRow.getByRole("button", { name: "현재 구성원으로 매핑" }).click();
  await expect(page.getByText(new RegExp(`${legacyOwner} 2건.*${displayName}`))).toBeVisible();
  await expect(cleanup.locator(".owner-remap-row", { hasText: legacyOwner })).toHaveCount(0);
  await capture(page, "issue-202-legacy-owner-remap-applied");

  const remappedRows = await page.evaluate(
    async ({ firstMemo, secondMemo }) => {
      const activeHouseholdKey = "money-flow-active-household-id";
      const householdHeaderName = "x-household-id";
      const householdId = String(localStorage.getItem(activeHouseholdKey) || "").trim();
      const headers = householdId ? { [householdHeaderName]: householdId } : {};
      const response = await fetch("/api/v1/transactions?limit=1000", { credentials: "include", headers });
      const rows = await response.json();
      return rows
        .filter((item) => [firstMemo, secondMemo].includes(String(item.memo || "")))
        .map((item) => ({
          memo: item.memo,
          owner_name: item.owner_name,
          owner_user_id: item.owner_user_id,
        }));
    },
    { firstMemo, secondMemo }
  );

  expect(remappedRows).toHaveLength(2);
  expect(remappedRows.every((item) => item.owner_name === displayName && item.owner_user_id)).toBe(true);
});

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

  await fileInput.setInputFiles(importWorkbookPath);
  await expect(page.getByText(path.basename(importWorkbookPath))).toBeVisible();
  await expect(dryRunButton).toBeEnabled();
  await expect(applyButton).toBeEnabled();
  await expectWithinViewport(dryRunButton);
  await expectKeyboardReachableInOrder(page, [dryRunButton, applyButton], { maxTabsPerLocator: 40 });

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

  const postApplyActions = workbookReport.locator(".import-post-apply-actions");
  await expect(postApplyActions.getByRole("button", { name: "가져온 거래 보기", exact: true })).toBeVisible();
  await expect(postApplyActions.getByRole("button", { name: "가져온 자산 보기", exact: true })).toBeVisible();
  await expect(postApplyActions.getByRole("button", { name: "수정 시작", exact: true })).toBeVisible();

  await postApplyActions.getByRole("button", { name: "가져온 거래 보기", exact: true }).click();
  const importedTransactionRow = page.locator("tr.transaction-row.transaction-row-imported", { hasText: importTxMemo }).first();
  await expect(importedTransactionRow).toBeVisible();
  await expect(importedTransactionRow).toHaveAttribute("data-import-highlight", "true");

  await page.getByRole("button", { name: "데이터 가져오기", exact: true }).click();
  await postApplyActions.getByRole("button", { name: "가져온 자산 보기", exact: true }).click();
  const importedHoldingRow = page.locator("tr.holding-row.holding-row-imported", { hasText: importHoldingName }).first();
  await expect(importedHoldingRow).toBeVisible();
  await expect(importedHoldingRow).toHaveAttribute("data-import-highlight", "true");

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
  await expect(dryRunButton).toBeEnabled();
  await applyButton.scrollIntoViewIfNeeded();
  await expect(applyButton).toBeEnabled();
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
