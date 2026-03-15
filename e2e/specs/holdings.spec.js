import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicHolding,
  expectNoHorizontalOverflow,
  labeledField,
  registerAndVerify,
  unique,
} from "../support/helpers";

test("holdings flow: create, inline edit, delete, responsive", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("holding-user")}@example.com`;
  const displayName = unique("holding-name");
  const holdingName = unique("holding");
  const editedHoldingName = `${holdingName}-edited`;

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  await capture(page, "holdings-entry");

  const createdRow = await createBasicHolding(page, { name: holdingName });
  await expect(createdRow).toContainText(holdingName);
  await capture(page, "holdings-created");

  await createdRow.locator("td").last().getByRole("button", { name: "수정" }).click();
  const editorForm = page.locator("tr.holding-inline-editor-row form").first();
  await expect(editorForm).toBeVisible();
  await labeledField(editorForm, "자산명", "input").fill(editedHoldingName);
  await labeledField(editorForm, "평가금액", "input").fill("987654");
  await editorForm.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("자산을 수정했습니다.")).toBeVisible();

  const editedRow = page.locator("tr", { hasText: editedHoldingName }).first();
  await expect(editedRow).toBeVisible();

  await editedRow.locator("td").last().getByRole("button", { name: "삭제" }).click();
  const confirmDialog = page.locator(".confirm-dialog");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByText("자산을 삭제했습니다.")).toBeVisible();
  await expect(page.locator("tr", { hasText: editedHoldingName })).toHaveCount(0);

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole("button", { name: "자산", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await assertResponsiveShell(page, 12);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "holdings-tablet");
});

test("holdings stock fields keep grouped decimals", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("holding-format")}@example.com`;
  const displayName = unique("holding-format-name");
  await registerAndVerify(page, { email, displayName });
  await page.getByRole("button", { name: "자산", exact: true }).click();

  const holdingCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "자산 입력" }),
  });
  await labeledField(holdingCard, "유형", "select").selectOption("stock");
  const quantityInput = labeledField(holdingCard, "수량", "input");
  const unitCostInput = labeledField(holdingCard, "평균단가", "input");
  await quantityInput.fill("12345.6789");
  await unitCostInput.fill("9876543.21");
  await expect(quantityInput).toHaveValue("12,345.6789");
  await expect(unitCostInput).toHaveValue("9,876,543.21");
});
