import { expect, test } from "@playwright/test";

import { assertResponsiveShell, capture, labeledField, registerAndVerify, unique } from "../support/helpers";

test("settings flow: profile, household, colors, categories CRUD", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("settings-user")}@example.com`;
  const displayName = unique("settings-real");
  const nickname = unique("settings-nick");
  const householdName = unique("settings-household");
  const expenseColor = "#E6F4EA";
  const majorSeed = unique("major");
  const minorSeed = unique("minor");
  const renamedMajor = `${majorSeed}-renamed`;
  const renamedMinor = `${minorSeed}-edited`;
  const deleteMajor = unique("delete-major");
  const deleteMinor = unique("delete-minor");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await capture(page, "settings-entry");

  const profileCard = page.locator("article.card", { has: page.getByRole("heading", { name: "내 프로필" }) });
  await labeledField(profileCard, "닉네임", "input").fill(nickname);
  await labeledField(profileCard, "표시명 방식", "select").selectOption("nickname");
  await profileCard.getByRole("button", { name: "프로필 저장" }).click();
  const profileSavedMessage = page.locator(".message").first();
  await expect(profileSavedMessage).toBeVisible();
  const dismissButton = profileSavedMessage.locator(".message-close").first();
  const canDismiss = await dismissButton.isVisible().catch(() => false);
  if (canDismiss) {
    await dismissButton.click();
    await expect(profileSavedMessage).toHaveCount(0);
  }
  await expect(page.locator(".topbar .meta")).toContainText(`사용자: ${nickname}`);

  const householdCard = page.locator("article.card", { has: page.getByRole("heading", { name: "가계 설정" }) });
  await labeledField(householdCard, "가계 이름", "input").fill(householdName);
  await householdCard.getByRole("button", { name: "가계 설정 저장" }).click();
  await expect(page.getByText("가계 설정을 저장했습니다.")).toBeVisible();
  await expect(page.locator(".topbar .meta")).toContainText(`가계: ${householdName}`);

  const colorCard = page.locator("article.card", { has: page.getByRole("heading", { name: "거래 행 색상" }) });
  await colorCard.locator("input[type='color']").nth(1).fill(expenseColor);
  await colorCard.getByRole("button", { name: "색상 저장" }).click();
  await expect(page.getByText("가계 설정을 저장했습니다.")).toBeVisible();

  const categoryCard = page.locator("article.card", { has: page.getByRole("heading", { name: "카테고리 관리" }) });
  await labeledField(categoryCard, "유형", "select").selectOption("expense");
  await labeledField(categoryCard, "새 대분류", "input").fill(majorSeed);
  await labeledField(categoryCard, "첫 중분류", "input").fill(minorSeed);
  await categoryCard.getByRole("button", { name: "카테고리 추가" }).click();
  await expect(page.getByText("카테고리를 추가했습니다.")).toBeVisible();

  await labeledField(categoryCard, "새 대분류", "input").fill(deleteMajor);
  await labeledField(categoryCard, "첫 중분류", "input").fill(deleteMinor);
  await categoryCard.getByRole("button", { name: "카테고리 추가" }).click();
  await expect(categoryCard).toContainText(deleteMinor);

  const createdGroup = categoryCard.locator(".settings-category-group", { hasText: majorSeed }).first();
  const createdRow = createdGroup.locator(".settings-category-row", { hasText: minorSeed }).first();
  await createdRow.getByRole("button", { name: "중분류 수정" }).click();
  const editingRow = createdGroup.locator(".category-row-editing").first();
  await editingRow.locator("input").fill(renamedMinor);
  await editingRow.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("카테고리를 수정했습니다.")).toBeVisible();

  const majorInput = createdGroup.locator("input[placeholder='새 대분류명']").first();
  await majorInput.fill(renamedMajor);
  await createdGroup.getByRole("button", { name: "대분류 변경" }).click();
  await expect(page.getByText("대분류 이름을 일괄 변경했습니다.")).toBeVisible();
  await expect(categoryCard).toContainText(renamedMajor);

  const deleteGroup = categoryCard.locator(".settings-category-group", { hasText: deleteMajor }).first();
  await deleteGroup.locator(".settings-category-row", { hasText: deleteMinor }).first().getByRole("button", { name: "삭제" }).click();
  const confirmDialog = page.locator(".confirm-dialog");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByText("카테고리를 삭제했습니다.")).toBeVisible();
  await expect(categoryCard).not.toContainText(deleteMajor);
  await capture(page, "settings-result");
});
