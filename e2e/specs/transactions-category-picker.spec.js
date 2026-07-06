import { expect, test } from "@playwright/test";

import {
  capture,
  createCategoryViaApi,
  expectNoHorizontalOverflow,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

test("issue #269: transaction entry exposes existing categories as staged buttons without search suggestions", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-category-picker-list")}@example.com`;
  const displayName = unique("tx-category-picker-list-name");
  const categoryMajor = unique("목록대분류");
  const groceries = {
    major: categoryMajor,
    minor: unique("장보기"),
  };
  const transit = {
    major: categoryMajor,
    minor: unique("대중교통"),
  };

  await registerAndVerify(page, { email, displayName });
  await createCategoryViaApi(page, groceries);
  await createCategoryViaApi(page, transit);

  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("transactions-fab").click();
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();

  await expect(transactionSheet.getByTestId("transaction-category-quick-picker")).toHaveCount(0);
  await expect(transactionSheet.getByTestId("transaction-category-search-toggle")).toHaveCount(0);
  await expect(transactionSheet.getByTestId("transaction-category-search")).toHaveCount(0);

  const categoryStage = transactionSheet.getByTestId("transaction-staged-category");
  await expect(categoryStage).toBeVisible();
  await expect(categoryStage.getByTestId("transaction-category-group-choice").filter({ hasText: categoryMajor })).toBeVisible();
  await categoryStage.getByTestId("transaction-category-group-choice").filter({ hasText: categoryMajor }).click();

  await expect(categoryStage.getByTestId("transaction-category-choice").filter({ hasText: groceries.minor })).toBeVisible();
  const transitButton = categoryStage.getByTestId("transaction-category-choice").filter({ hasText: transit.minor });
  await expect(transitButton).toBeVisible();
  await transitButton.click();
  await expect(transitButton).toHaveAttribute("aria-pressed", "true");
  await expect(categoryStage.locator("select")).toHaveCount(0);
  await expect(transactionSheet).not.toContainText("추천 카테고리");

  await capture(page, "issue-269-transaction-staged-category-buttons");
  await expectNoHorizontalOverflow(page, 12);
});
