import { expect, test } from "@playwright/test";

import {
  TEST_PASSWORD,
  assertResponsiveShell,
  capture,
  expectNoHorizontalOverflow,
  labeledField,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

const ACTIVE_HOUSEHOLD_KEY = "money-flow-active-household-id";
const DEFAULT_CSRF_COOKIE_NAME = "mf_csrf_token";
const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";
const DEFAULT_HOUSEHOLD_HEADER_NAME = "x-household-id";

async function expectMemberRoleSelectAccessible(page, row, expectedName, label) {
  await row.scrollIntoViewIfNeeded();
  const roleSelect = row.locator("select").first();
  await expect(roleSelect, `${label} role select should name the target and action`).toHaveAccessibleName(expectedName);
  const metrics = await roleSelect.evaluate((select) => {
    const box = select.getBoundingClientRect();
    return {
      ariaLabel: select.getAttribute("aria-label") || "",
      width: box.width,
      height: box.height,
    };
  });
  expect(metrics.ariaLabel, `${label} role select should not rely on options as its name`).toBe(expectedName);
  expect(metrics.width, `${label} role select should remain visible`).toBeGreaterThan(80);
  expect(metrics.height, `${label} role select touch target`).toBeGreaterThanOrEqual(32);
  await expectNoHorizontalOverflow(page, 12);
}

async function renameHouseholdViaApi(page, name) {
  const result = await page.evaluate(
    async ({ activeHouseholdKey, csrfCookieName, csrfHeaderName, householdHeaderName, name }) => {
      const cookieValue = (cookieName) => {
        const prefix = `${cookieName}=`;
        return (
          String(document.cookie || "")
            .split(";")
            .map((item) => item.trim())
            .find((item) => item.startsWith(prefix))
            ?.slice(prefix.length) || ""
        );
      };
      const householdId = String(localStorage.getItem(activeHouseholdKey) || "").trim();
      const headers = {
        "Content-Type": "application/json",
        [csrfHeaderName]: decodeURIComponent(cookieValue(csrfCookieName)),
      };
      if (householdId) {
        headers[householdHeaderName] = householdId;
      }
      const response = await fetch("/api/v1/household/settings", {
        method: "PATCH",
        credentials: "include",
        headers,
        body: JSON.stringify({ name }),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      return { ok: response.ok, status: response.status, payload, text };
    },
    {
      activeHouseholdKey: ACTIVE_HOUSEHOLD_KEY,
      csrfCookieName: DEFAULT_CSRF_COOKIE_NAME,
      csrfHeaderName: DEFAULT_CSRF_HEADER_NAME,
      householdHeaderName: DEFAULT_HOUSEHOLD_HEADER_NAME,
      name,
    }
  );
  expect(result.ok, `household settings api update failed: ${result.status} ${result.text}`).toBe(true);
  return result.payload;
}

test("collaboration household selector keeps long mobile names readable", async ({ page }) => {
  const email = `${unique("collab-select")}@example.com`;
  const displayName = unique("collab-select-name");
  const householdName = `${unique("collaboration household")} desktop chromium mobile readability household`;

  await registerAndVerify(page, { email, displayName });
  await renameHouseholdViaApi(page, householdName);
  await page.reload();
  await page.setViewportSize({ width: 320, height: 568 });
  await openTab(page, "협업");

  const collaborationCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "가계 협업 관리" }),
  });
  await expect(collaborationCard).toBeVisible();
  const householdSelect = collaborationCard.locator("select.household-select").first();
  await expect(householdSelect).toBeVisible();
  const metrics = await householdSelect.evaluate((select) => {
    const summaryId = select.getAttribute("aria-describedby") || "";
    const summary = summaryId ? document.getElementById(summaryId) : null;
    const box = select.getBoundingClientRect();
    const summaryBox = summary?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentOverflowDelta: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      select: {
        optionText: select.options[select.selectedIndex]?.textContent?.trim() || "",
        optionAriaLabel: select.options[select.selectedIndex]?.getAttribute("aria-label") || "",
        clientWidth: select.clientWidth,
        scrollWidth: select.scrollWidth,
        box: {
          left: box.left,
          right: box.right,
          width: box.width,
          height: box.height,
        },
      },
      summary: summary
        ? {
            text: summary.textContent?.replace(/\s+/g, " ").trim() || "",
            clientWidth: summary.clientWidth,
            scrollWidth: summary.scrollWidth,
            clientHeight: summary.clientHeight,
            scrollHeight: summary.scrollHeight,
            box: summaryBox
              ? {
                  left: summaryBox.left,
                  right: summaryBox.right,
                  width: summaryBox.width,
                  height: summaryBox.height,
                }
              : null,
          }
        : null,
    };
  });

  expect(metrics.documentOverflowDelta, `collaboration page should not overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
  expect(metrics.select.box.right, `household select should stay in viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  expect(metrics.select.optionText.length, `select option should use compact visual text: ${JSON.stringify(metrics)}`).toBeLessThan(
    householdName.length,
  );
  expect(metrics.select.optionText, `select option should show truncation cue: ${JSON.stringify(metrics)}`).toContain("...");
  expect(metrics.select.scrollWidth - metrics.select.clientWidth, `compact select text should not clip: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    1,
  );
  expect(metrics.select.optionAriaLabel, `full name should remain available to assistive tech: ${JSON.stringify(metrics)}`).toBe(householdName);
  expect(metrics.summary, `full household summary should exist: ${JSON.stringify(metrics)}`).toBeTruthy();
  expect(metrics.summary.text, `summary should retain full household name: ${JSON.stringify(metrics)}`).toContain(householdName);
  expect(metrics.summary.scrollWidth - metrics.summary.clientWidth, `summary should wrap within card: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    1,
  );
  expect(metrics.summary.box.right, `summary should stay in viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.viewportWidth + 1,
  );
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "collaboration-household-select-mobile-long-name");
});

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
    const inviteArrivalBanner = guestPage.locator(".invite-arrival-banner");
    const collaborationTabBadge = guestPage.locator("nav.tabs .tabs-right .tab-badge").first();
    const receivedInviteRow = receivedInviteCard.locator("tbody tr", { hasText: ownerHouseholdName }).first();
    await expect(receivedInviteRow).toBeVisible();
    const hasArrivalBanner = await inviteArrivalBanner.isVisible().catch(() => false);
    if (hasArrivalBanner) {
      await expect(inviteArrivalBanner).toBeVisible();
      await expect(receivedInviteCard).toHaveClass(/invite-section-attention/);
    } else {
      await expect(collaborationTabBadge).toContainText("1");
    }
    await expect(receivedInviteRow).toContainText(ownerDisplayName);
    await expect(receivedInviteRow).toContainText("대기 중");
    await expect(receivedInviteRow).toHaveClass(/invite-row-new/);
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
    const guestDesktopTransactionAddAction = guestPage.getByTestId("transactions-desktop-add-action");
    await expect(guestDesktopTransactionAddAction).toBeVisible();
    await expect(guestDesktopTransactionAddAction).toBeDisabled();
    await expect(guestPage.locator(".onboarding-guide")).toHaveCount(0);
    await expect(
      guestPage.locator("article.card", { has: guestPage.getByRole("heading", { name: "거래 목록" }) }),
      "viewer should see the transaction shell instead of a blank/onboarding-only state",
    ).toBeVisible();
    await expect(guestPage.getByTestId("transaction-entry-sheet")).toHaveCount(0);
    await openTab(guestPage, "자산");
    const holdingCard = guestPage.locator("article.card", {
      has: guestPage.getByRole("heading", { name: "자산 입력" }),
    });
    const holdingToggleButton = holdingCard.getByRole("button", { name: /자산 추가|입력 닫기/ }).first();
    await expect(holdingToggleButton).toBeVisible();
    const holdingToggleText = String((await holdingToggleButton.textContent()) || "");
    if (holdingToggleText.includes("자산 추가")) {
      await holdingToggleButton.click();
    }
    await expect(holdingCard.getByRole("button", { name: "자산 등록" })).toBeDisabled();
    await openTab(guestPage, "데이터 가져오기");
    await expect(guestPage.getByRole("button", { name: "미리 검증", exact: true })).toBeDisabled();
    await expect(guestPage.getByRole("button", { name: "적용", exact: true })).toBeDisabled();

    const ownerMembersCard = ownerPage.locator("article.card", {
      has: ownerPage.getByRole("heading", { name: "멤버 목록" }),
    });
    const ownerSelfMemberRow = ownerMembersCard.locator("tbody tr", { hasText: ownerDisplayName }).first();
    const ownerSelfRoleSelect = ownerSelfMemberRow.locator("select").first();
    await expect(ownerSelfRoleSelect).toBeDisabled();
    await expectMemberRoleSelectAccessible(ownerPage, ownerSelfMemberRow, `${ownerDisplayName} 권한 변경`, "desktop self member");
    await expect(ownerSelfMemberRow.getByRole("button", { name: "본인" })).toBeDisabled();
    const ownerGuestMemberRow = ownerMembersCard.locator("tbody tr", { hasText: guestDisplayName }).first();
    const ownerRoleSelect = ownerGuestMemberRow.locator("select").first();
    const canChangeRole = await ownerRoleSelect.isVisible().catch(() => false);
    if (canChangeRole) {
      await expectMemberRoleSelectAccessible(ownerPage, ownerGuestMemberRow, `${guestDisplayName} 권한 변경`, "desktop guest member");
      await ownerPage.setViewportSize({ width: 390, height: 844 });
      await assertResponsiveShell(ownerPage, 12);
      await expectMemberRoleSelectAccessible(ownerPage, ownerGuestMemberRow, `${guestDisplayName} 권한 변경`, "mobile guest member");
      await expect(ownerRoleSelect).toBeEnabled();
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
    await expect(guestPage.locator("nav.tabs")).toBeVisible();
    await assertResponsiveShell(guestPage, 12);
    await expectNoHorizontalOverflow(guestPage, 12);
    await expect(guestPage.locator("article.table-card").first()).toBeVisible();
    await capture(guestPage, "collaboration-mobile");
  } finally {
    await ownerContext.close();
    await guestContext.close();
  }
});

test("collaboration invite accept shows invited-email guidance for same account", async ({ page }) => {
  test.setTimeout(180_000);

  const ownerDisplayName = unique("owner-self-accept");
  const ownerEmail = `${unique("owner-self-accept")}@example.com`;
  const invitedEmail = `${unique("guest-self-accept")}@example.com`;

  await page.setViewportSize({ width: 390, height: 844 });
  await registerAndVerify(page, {
    email: ownerEmail,
    password: TEST_PASSWORD,
    displayName: ownerDisplayName,
  });
  await openTab(page, "협업");

  const collaborationCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "가계 협업 관리" }),
  });
  await labeledField(collaborationCard, "초대할 이메일", "input").fill(invitedEmail);
  await labeledField(collaborationCard, "권한", "select").selectOption("viewer");
  await collaborationCard.getByRole("button", { name: "초대 발송" }).click();
  await expect(page.getByText("초대를 발송했습니다.")).toBeVisible();

  const acceptTokenInput = labeledField(collaborationCard, "초대 수락 토큰", "input");
  await expect(acceptTokenInput).not.toHaveValue("");
  await collaborationCard.getByRole("button", { name: "초대 수락" }).click();

  const message = page.locator(".message").first();
  await expect(message).toContainText("로그인한 이메일과 초대 이메일이 다릅니다.");
  await expect(message).toContainText("초대 받은 이메일로 로그인해 주세요.");
  await expect(message).not.toContainText("요청 처리 중 오류가 발생했습니다.");
  await capture(page, "collaboration-invite-same-account-guidance");
});

test("collaboration invite accept shows token guidance for invalid token", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("collab-invalid-token")}@example.com`;
  const displayName = unique("collab-invalid-token-name");

  await page.setViewportSize({ width: 390, height: 844 });
  await registerAndVerify(page, {
    email,
    password: TEST_PASSWORD,
    displayName,
  });
  await openTab(page, "협업");

  const collaborationCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "가계 협업 관리" }),
  });
  const acceptTokenInput = labeledField(collaborationCard, "초대 수락 토큰", "input");
  await acceptTokenInput.fill("invalid-token-for-browser-qa");
  await collaborationCard.getByRole("button", { name: "초대 수락" }).click();

  const message = page.locator(".message").first();
  await expect(message).toContainText("초대 토큰이 올바르지 않거나 만료되었습니다.");
  await expect(message).toContainText("새 초대를 요청해 주세요.");
  await expect(message).not.toContainText("요청 처리 중 오류가 발생했습니다.");
  await capture(page, "collaboration-invalid-invite-token-guidance");
});

test("collaboration invite token helper stays readable on narrow mobile", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("collab-token-helper")}@example.com`;
  const displayName = unique("collab-token-helper-name");

  await page.setViewportSize({ width: 320, height: 568 });
  await registerAndVerify(page, {
    email,
    password: TEST_PASSWORD,
    displayName,
  });
  await openTab(page, "협업");

  const collaborationCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "가계 협업 관리" }),
  });
  const acceptTokenInput = labeledField(collaborationCard, "초대 수락 토큰", "input");
  await expect(acceptTokenInput).toHaveAttribute("placeholder", "초대 token");
  await expect(acceptTokenInput).toHaveAttribute("aria-describedby", "invite-accept-token-helper");

  const helper = collaborationCard.locator("#invite-accept-token-helper");
  await expect(helper).toBeVisible();
  await expect(helper).toHaveText("메일 초대 링크에서 token 값을 복사해 붙여 넣으세요.");
  const helperMetrics = await helper.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(helperMetrics.whiteSpace).not.toBe("nowrap");
  expect(helperMetrics.textOverflow).not.toBe("ellipsis");
  expect(helperMetrics.scrollWidth).toBeLessThanOrEqual(helperMetrics.clientWidth + 1);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "collaboration-invite-token-mobile-helper");
});
