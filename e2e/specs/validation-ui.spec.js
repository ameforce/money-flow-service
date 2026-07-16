import { expect, test } from "@playwright/test";

import { capture, labeledField, openTab, bootstrapVerifiedSession, unique } from "../support/helpers";

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

test("collaboration invite empty email uses Korean inline validation", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("issue-215-invite-validation")}@example.com`;
  await bootstrapVerifiedSession(page, { email, displayName: unique("issue-215-owner") });
  await page.setViewportSize({ width: 390, height: 844 });

  await openTab(page, "협업");
  const collaborationCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "가계 협업 관리" }),
  });
  await collaborationCard.scrollIntoViewIfNeeded();
  const inviteEmailInput = labeledField(collaborationCard, "초대할 이메일", "input");
  await expect(inviteEmailInput).toBeVisible();
  await inviteEmailInput.fill("");
  await capture(page, "issue-215-invite-email-empty-entry");

  await collaborationCard.getByRole("button", { name: "초대 발송" }).click();

  const inlineError = collaborationCard.locator("#collaboration-invite-email-error");
  await expect(inlineError).toBeVisible();
  await expect(inlineError).toHaveText("초대할 이메일을 입력해 주세요.");
  await expect(inviteEmailInput).toBeFocused();
  await expect(inviteEmailInput).toHaveAttribute("aria-invalid", "true");
  await expect(inviteEmailInput).toHaveAttribute("aria-describedby", "collaboration-invite-email-error");
  const validationMessage = await inviteEmailInput.evaluate((element) => element.validationMessage);
  expect(validationMessage).toBe("초대할 이메일을 입력해 주세요.");
  await capture(page, "issue-215-invite-email-korean-inline-error");
});

test("localized form validation replaces native bubbles and mobile messages wrap", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("validation-ui")}@example.com`;
  await bootstrapVerifiedSession(page, { email, displayName: unique("validation-name") });
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
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await page.getByTestId("transaction-quick-save").click();
  await expect(transactionSheet.locator("#transaction-quick-amount-error")).toHaveText("금액을 입력해 주세요.");
  await expect(page.locator(".message", { hasText: "금액을 입력해 주세요." })).toHaveCount(0);
  await transactionSheet.getByTestId("transaction-entry-sheet-close").click();

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
  await expectMessageFullyVisible(page, "초대할 이메일을 입력해 주세요.");
  await dismissVisibleMessage(page);

  await labeledField(collaborationCard, "초대할 이메일", "input").fill("not-an-email");
  await collaborationCard.getByRole("button", { name: "초대 발송" }).click();
  await expectMessageFullyVisible(page, "올바른 초대할 이메일 주소를 입력해 주세요.");
  await capture(page, "validation-ui-mobile-message");
});
