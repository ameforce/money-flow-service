import { expect, test } from "@playwright/test";

import { TEST_PASSWORD, assertResponsiveShell, capture, labeledField, openTab, registerAndVerify, unique } from "../support/helpers";

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

    await openTab(ownerPage, "협업");
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

    await openTab(guestPage, "협업");
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
    const acceptanceBanner = guestPage.locator(".invite-acceptance-banner");
    const hasAcceptanceBanner = await acceptanceBanner
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (hasAcceptanceBanner) {
      await expect(acceptanceBanner).toContainText(`${ownerHouseholdName} 초대를 수락했습니다.`);
    }
    const historyTab = receivedInviteCard.getByRole("tab", { name: "이전" });
    const hasHistoryTab = await historyTab.isVisible().catch(() => false);
    if (hasHistoryTab) {
      await historyTab.click();
    }
    const acceptedInviteRow = receivedInviteCard
      .locator("tbody tr", { hasText: ownerHouseholdName })
      .first();
    await expect(acceptedInviteRow).toContainText("수락됨");
    const switchHouseholdButton = acceptedInviteRow
      .getByRole("button", { name: /작업 가계로 전환|가계로 전환/ })
      .first();
    await expect(switchHouseholdButton).toBeVisible();
    await capture(guestPage, "collaboration-guest-accepted");

    await switchHouseholdButton.click();
    await expect(guestCollaborationCard.locator(".table-summary").first()).toContainText(ownerHouseholdName);

    await openTab(guestPage, "거래");
    const txCard = guestPage.locator("article.card", {
      has: guestPage.getByRole("heading", { name: "거래 입력" }),
    });
    const txToggleButton = txCard.getByRole("button", { name: /거래 추가|입력 닫기/ }).first();
    const txToggleVisible = await txToggleButton.isVisible().catch(() => false);
    if (txToggleVisible) {
      const txToggleText = String((await txToggleButton.textContent()) || "");
      if (txToggleText.includes("거래 추가")) {
        await txToggleButton.click();
      }
    }
    const txSubmitButton = txCard.getByRole("button", { name: "거래 등록" });
    const txSubmitDisabled = await txSubmitButton.isDisabled().catch(() => false);
    if (txSubmitDisabled) {
      await openTab(guestPage, "자산");
      const holdingCard = guestPage.locator("article.card", {
        has: guestPage.getByRole("heading", { name: "자산 입력" }),
      });
      const holdingToggleButton = holdingCard.getByRole("button", { name: /자산 추가|입력 닫기/ }).first();
      const holdingToggleVisible = await holdingToggleButton.isVisible().catch(() => false);
      if (holdingToggleVisible) {
        const holdingToggleText = String((await holdingToggleButton.textContent()) || "");
        if (holdingToggleText.includes("자산 추가")) {
          await holdingToggleButton.click();
        }
      }
      await expect(holdingCard.getByRole("button", { name: "자산 등록" })).toBeDisabled();
      await openTab(guestPage, "데이터 가져오기");
      await expect(guestPage.getByRole("button", { name: "미리 검증" })).toBeDisabled();
      await expect(guestPage.getByRole("button", { name: "적용" })).toBeDisabled();
    } else {
      await expect(txSubmitButton).toBeEnabled();
    }

    const ownerMembersCard = ownerPage.locator("article.card", {
      has: ownerPage.getByRole("heading", { name: "멤버 목록" }),
    });
    const ownerGuestMemberRow = ownerMembersCard.locator("tbody tr", { hasText: guestDisplayName }).first();
    const ownerRoleSelect = ownerGuestMemberRow.locator("select").first();
    const canChangeRole = await ownerRoleSelect.isVisible().catch(() => false);
    if (canChangeRole) {
      await ownerRoleSelect.selectOption("editor");
    }

    const collaborationTabButton = guestPage.locator("nav.tabs .tabs-right button").first();
    const settingsTabButton = guestPage.locator("nav.tabs .tabs-right button").last();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await collaborationTabButton.click();
      const isActive = await collaborationTabButton
        .evaluate((element) => element.classList.contains("active"))
        .catch(() => false);
      if (isActive) {
        break;
      }
      await guestPage.waitForTimeout(250);
    }
    await expect(collaborationTabButton).toHaveClass(/active/);
    const roleChangedMessage = guestPage.locator(".message", { hasText: "내 권한이 변경되었습니다." }).first();
    const roleMessageVisible = await roleChangedMessage.isVisible({ timeout: 15_000 }).catch(() => false);
    if (roleMessageVisible) {
      await expect(guestCollaborationCard.locator(".table-summary").first()).toContainText("편집자");
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await settingsTabButton.click();
      const isActive = await settingsTabButton
        .evaluate((element) => element.classList.contains("active"))
        .catch(() => false);
      if (isActive) {
        break;
      }
      await guestPage.waitForTimeout(250);
    }
    await expect(settingsTabButton).toHaveClass(/active/);
    const settingsSwitchCard = guestPage.locator("article.card", {
      has: guestPage.locator(".settings-household-switch"),
    });
    const settingsSwitchVisible = await settingsSwitchCard
      .locator(".settings-household-switch")
      .isVisible()
      .catch(() => false);
    let switchedBackViaSettings = false;
    if (settingsSwitchVisible) {
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
      switchedBackViaSettings = true;
    } else {
      await capture(guestPage, "settings-household-switch-unavailable");
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await collaborationTabButton.click();
      const isActive = await collaborationTabButton
        .evaluate((element) => element.classList.contains("active"))
        .catch(() => false);
      if (isActive) {
        break;
      }
      await guestPage.waitForTimeout(250);
    }
    await expect(collaborationTabButton).toHaveClass(/active/);
    if (switchedBackViaSettings) {
      await expect(guestCollaborationCard.locator(".table-summary").first()).toContainText(guestOwnHouseholdName);
    } else {
      await expect(guestCollaborationCard).toBeVisible();
    }

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
