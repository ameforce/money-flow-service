import { expect, test } from "@playwright/test";

import { capture, labeledField, openTab, registerAndVerify, unique } from "../support/helpers";

async function expectMessageFullyVisible(page, text) {
  const message = page.locator(".message", { hasText: text }).first();
  await expect(message).toBeVisible();
  const metrics = await message.locator("span").first().evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollWidth: element.scrollWidth,
  }));
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 2);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 2);
  return message;
}

async function dismissVisibleMessage(page) {
  const closeButton = page.locator(".message .message-close").first();
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
}

test("localized form validation replaces native bubbles and mobile messages wrap", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("validation-ui")}@example.com`;
  await registerAndVerify(page, { email, displayName: unique("validation-name") });
  await page.setViewportSize({ width: 390, height: 844 });

  await openTab(page, "설정");
  const profileCard = page.locator("article.card", { has: page.getByRole("heading", { name: "내 프로필" }) });
  await profileCard.scrollIntoViewIfNeeded();
  const realNameInput = labeledField(profileCard, "본명", "input");
  await realNameInput.fill("");
  await profileCard.getByRole("button", { name: "프로필 저장" }).click();
  const profileValidationMessage = await realNameInput.evaluate((element) => element.validationMessage);
  expect(profileValidationMessage).toBe("본명을 입력해 주세요.");
  await realNameInput.fill(unique("validation-real"));
  await profileCard.getByRole("button", { name: "프로필 저장" }).click();
  await expectMessageFullyVisible(page, "표시명 변경 내용이 멤버 목록과 거래/자산 화면에 반영되었습니다.");
  await dismissVisibleMessage(page);

  const categoryCard = page.locator("article.card", { has: page.getByRole("heading", { name: "카테고리 관리" }) });
  await categoryCard.scrollIntoViewIfNeeded();
  await categoryCard.getByRole("button", { name: "카테고리 추가" }).click();
  await expectMessageFullyVisible(page, "새 대분류를 입력해 주세요.");
  await dismissVisibleMessage(page);

  const assetRules = page.locator("details.settings-asset-rules-card").first();
  await assetRules.scrollIntoViewIfNeeded();
  if (!(await assetRules.evaluate((element) => element.open))) {
    await assetRules.locator("summary").click();
  }
  await assetRules.getByRole("button", { name: "유형 추가" }).click();
  await expectMessageFullyVisible(page, "유형 키와 이름을 입력해 주세요.");
  await dismissVisibleMessage(page);

  await openTab(page, "거래");
  await page.getByTestId("transactions-fab").click();
  await page.getByTestId("transaction-quick-save").click();
  await expectMessageFullyVisible(page, "금액을 입력해 주세요.");
  await dismissVisibleMessage(page);
  await page.getByTestId("transaction-entry-sheet-close").click();

  await openTab(page, "자산");
  await page.getByTestId("holdings-fab").click();
  await page.getByRole("button", { name: "자산 등록" }).click();
  await expectMessageFullyVisible(page, "자산명을 입력해 주세요.");
  await dismissVisibleMessage(page);
  await page.getByTestId("holding-entry-sheet-close").click();

  await openTab(page, "협업");
  const collaborationCard = page.locator("article.card", { has: page.getByRole("heading", { name: "가계 협업 관리" }) });
  await collaborationCard.scrollIntoViewIfNeeded();
  await collaborationCard.getByRole("button", { name: "초대 발송" }).click();
  await expectMessageFullyVisible(page, "초대 이메일을 입력해 주세요.");
  await dismissVisibleMessage(page);

  await labeledField(collaborationCard, "초대할 이메일", "input").fill("not-an-email");
  await collaborationCard.getByRole("button", { name: "초대 발송" }).click();
  await expectMessageFullyVisible(page, "올바른 초대 이메일 주소를 입력해 주세요.");
  await capture(page, "validation-ui-mobile-message");
});
