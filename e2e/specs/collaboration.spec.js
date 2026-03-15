import { expect, test } from "@playwright/test";

import { TEST_PASSWORD, assertResponsiveShell, capture, labeledField, registerAndVerify, unique } from "../support/helpers";

test("collaboration flow: invite, accept, switch household, responsive", async ({ browser }) => {
  test.setTimeout(300_000);

  const ownerDisplayName = unique("owner");
  const guestDisplayName = unique("guest");
  const ownerEmail = `${unique("owner-user")}@example.com`;
  const guestEmail = `${unique("guest-user")}@example.com`;

  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const guestPage = await guestContext.newPage();

  try {
    await ownerPage.setViewportSize({ width: 1366, height: 960 });
    await guestPage.setViewportSize({ width: 1366, height: 960 });

    await registerAndVerify(ownerPage, {
      email: ownerEmail,
      password: TEST_PASSWORD,
      displayName: ownerDisplayName,
    });
    await assertResponsiveShell(ownerPage);
    await registerAndVerify(guestPage, {
      email: guestEmail,
      password: TEST_PASSWORD,
      displayName: guestDisplayName,
    });
    await assertResponsiveShell(guestPage);

    await ownerPage.getByRole("button", { name: "협업", exact: true }).click();
    const ownerCollaborationCard = ownerPage.locator("article.card", {
      has: ownerPage.getByRole("heading", { name: "가계 협업 관리" }),
    });
    const ownerSummaryText = String((await ownerCollaborationCard.locator(".table-summary").first().textContent()) || "");
    const ownerHouseholdName = ownerSummaryText.split("/")[0].replace("현재 가계:", "").trim();
    expect(ownerHouseholdName).not.toBe("");

    await labeledField(ownerCollaborationCard, "초대할 이메일", "input").fill(guestEmail);
    await labeledField(ownerCollaborationCard, "권한", "select").selectOption("viewer");
    await ownerCollaborationCard.getByRole("button", { name: "초대 발송" }).click();
    await expect(ownerPage.getByText("초대를 발송했습니다.")).toBeVisible();
    await capture(ownerPage, "collaboration-owner-invite");

    await guestPage.getByRole("button", { name: "협업", exact: true }).click();
    const guestCollaborationCard = guestPage.locator("article.card", {
      has: guestPage.getByRole("heading", { name: "가계 협업 관리" }),
    });
    const guestSummaryText = String((await guestCollaborationCard.locator(".table-summary").first().textContent()) || "");
    const guestOwnHouseholdName = guestSummaryText.split("/")[0].replace("현재 가계:", "").trim();
    expect(guestOwnHouseholdName).not.toBe("");
    const receivedInviteCard = guestPage.locator("article.card", {
      has: guestPage.getByRole("heading", { name: "받은 초대" }),
    });
    const receivedInviteRow = receivedInviteCard.locator("tbody tr", { hasText: ownerHouseholdName }).first();
    await expect(receivedInviteRow).toContainText(ownerDisplayName);
    await expect(receivedInviteRow).toContainText("대기 중");
    await capture(guestPage, "collaboration-guest-received");

    await receivedInviteRow.getByRole("button", { name: "초대 수락" }).click();
    await expect(guestPage.locator(".invite-acceptance-banner")).toContainText(`${ownerHouseholdName} 초대를 수락했습니다.`);
    await expect(receivedInviteCard.locator("tbody tr", { hasText: ownerHouseholdName }).first()).toContainText("수락됨");
    await expect(guestPage.getByRole("button", { name: "작업 가계로 전환" }).first()).toBeVisible();
    await capture(guestPage, "collaboration-guest-accepted");

    await guestPage.getByRole("button", { name: "작업 가계로 전환" }).first().click();
    await expect(guestCollaborationCard.locator(".table-summary").first()).toContainText(ownerHouseholdName);

    await guestPage.locator("nav.tabs .tabs-right button").last().click();
    const settingsSwitchCard = guestPage.locator("article.card", {
      has: guestPage.locator(".settings-household-switch"),
    });
    await expect(settingsSwitchCard.locator(".settings-household-switch")).toBeVisible();
    const settingsHouseholdSelect = settingsSwitchCard.locator(".settings-household-switch select.household-select").first();
    const currentHouseholdId = await settingsHouseholdSelect.inputValue();
    const switchOptions = await settingsHouseholdSelect.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => ({
        value: String(node.value || ""),
        text: String(node.textContent || "").trim(),
      }))
    );
    const nextOption =
      switchOptions.find(
        (item) =>
          item.value &&
          item.value !== currentHouseholdId &&
          item.text.includes(guestOwnHouseholdName)
      ) || switchOptions.find((item) => item.value && item.value !== currentHouseholdId);
    expect(nextOption).toBeTruthy();
    await settingsHouseholdSelect.selectOption(nextOption.value);
    await expect(guestPage.locator(".topbar .meta")).toContainText(guestOwnHouseholdName);
    await capture(guestPage, "settings-household-switch");

    await guestPage.locator("nav.tabs .tabs-right button").first().click();
    await expect(guestCollaborationCard.locator(".table-summary").first()).toContainText(guestOwnHouseholdName);

    await guestPage.setViewportSize({ width: 390, height: 844 });
    await guestPage.waitForLoadState("networkidle");
    await assertResponsiveShell(guestPage, 12);
    await expect(guestPage.locator("article.table-card").first()).toBeVisible();
    await capture(guestPage, "collaboration-mobile");
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});
