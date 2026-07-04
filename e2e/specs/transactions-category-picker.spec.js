import { expect, test } from "@playwright/test";

import {
  capture,
  createCategoryViaApi,
  expectNoHorizontalOverflow,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

test("issue #269: transaction category picker exposes existing category list while keeping search suggestions", async ({
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
  const transitCategory = await createCategoryViaApi(page, transit);

  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("transactions-fab").click();
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expect(transactionSheet).toBeVisible();

  const picker = transactionSheet.getByTestId("transaction-category-quick-picker");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("기존 카테고리");

  const categoryList = picker.getByTestId("transaction-category-list");
  await expect(categoryList).toBeVisible();
  await expect(categoryList).toBeEnabled();

  const optionTexts = await categoryList.locator("option").evaluateAll((options) =>
    options.map((option) => option.textContent?.replace(/\s+/g, " ").trim() || "")
  );
  expect(optionTexts).toEqual(
    expect.arrayContaining([
      `${groceries.major} / ${groceries.minor}`,
      `${transit.major} / ${transit.minor}`,
    ])
  );

  await categoryList.selectOption(String(transitCategory.id));
  await expect(categoryList).toHaveValue(String(transitCategory.id));
  await expect(picker).toContainText(`${transit.major} / ${transit.minor}`);

  await categoryList.selectOption("");
  await expect(categoryList).toHaveValue("");

  await expect(picker.getByTestId("transaction-category-search-toggle")).toBeVisible();
  await picker.getByTestId("transaction-category-search-toggle").click();
  const searchInput = picker.getByTestId("transaction-category-search");
  await expect(searchInput).toBeVisible();
  await searchInput.fill(groceries.minor);
  await expect(picker.getByTestId("transaction-quick-category-chip").filter({ hasText: groceries.minor })).toBeVisible();

  await capture(page, "issue-269-transaction-category-picker-list");
  await expectNoHorizontalOverflow(page, 12);
});
