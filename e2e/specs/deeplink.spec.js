import { expect, test } from "@playwright/test";

import { TEST_PASSWORD, capture, openTab, registerAndVerify, unique } from "../support/helpers";

const PENDING_INVITE_NEUTRAL_TITLE = "초대 토큰을 감지했습니다.";
const PENDING_INVITE_UNVALIDATED_COPY =
  "아직 초대 유효성은 확인되지 않았습니다. 로그인 또는 회원가입 후 협업 탭에서 초대를 확인하고 수락해 주세요.";
const PENDING_INVITE_CONFIRMED_TITLE = "가계부 초대 링크를 확인했습니다.";

test("auth deep-link token policy: query token rejected", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/?verify_token=query-token");
  await capture(page, "deeplink-query-token-rejected-entry");
  await expect(page.getByRole("button", { name: "로그인하기" })).toBeVisible();
  await expect(page.getByLabel("인증 토큰")).toHaveCount(0);
  await expect(page.getByText("보안을 위해 URL query 토큰은 지원하지 않습니다.")).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("verify_token=query-token");
  await capture(page, "deeplink-query-token-rejected-result");
});

test("auth deep-link token policy: hash token accepted", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/#verify_token=hash-token");
  await capture(page, "deeplink-hash-token-accepted-entry");
  await expect(page.getByLabel("인증 토큰")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "이메일 인증 완료" })).toBeVisible();
  await expect(page.getByText(/인증 토큰이 유효하지 않습니다|인증 링크를 바로 완료할 수 없습니다/)).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("verify_token=hash-token");
  await capture(page, "deeplink-hash-token-accepted-result");
});

test("auth deep-link token policy: different browser asks for password setup", async ({ page, request }) => {
  test.setTimeout(120_000);

  const email = `${unique("deeplink-cross-browser")}@example.com`;
  const displayName = unique("deeplink-cross-name");
  const apiBaseUrl = String(process.env.E2E_API_BASE_URL || "").replace(/\/$/, "");
  const requestOrigin = process.env.E2E_API_REQUEST_ORIGIN || process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
  const response = await request.post(`${apiBaseUrl}/api/v1/auth/register`, {
    headers: {
      origin: requestOrigin,
      "x-debug-token-opt-in": "true",
    },
    data: {
      email,
      password: TEST_PASSWORD,
      display_name: displayName,
      remember_me: true,
    },
  });
  expect(response.status()).toBe(201);
  const payload = await response.json();
  const verifyToken = String(payload.debug_verification_token || "");
  expect(verifyToken).toBeTruthy();

  await page.goto(`/#verify_token=${encodeURIComponent(verifyToken)}`);
  await capture(page, "deeplink-cross-browser-password-setup-entry");
  await expect(page.getByLabel("인증 토큰")).toHaveCount(0);
  await expect(page.getByText("다른 브라우저에서 인증 링크를 열었습니다.", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "회원가입을 시작했던 브라우저와 현재 브라우저가 달라, 이전에 입력한 비밀번호를 보안상 그대로 사용할 수 없습니다.",
      { exact: true }
    )
  ).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("verify_token=");

  const newPassword = "CrossDevice1234";
  await page.getByLabel("새 비밀번호", { exact: true }).fill(newPassword);
  await page.getByLabel("새 비밀번호 확인").fill(newPassword);
  await page.getByRole("button", { name: "비밀번호 설정하고 가입 완료" }).click();
  await expect(page.locator("main.app-shell")).toHaveAttribute("translate", "no");
  await capture(page, "deeplink-cross-browser-password-setup-complete");
});

test("household invite deep-link token is surfaced before login", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/#invite_token=invite-hash-token");
  await capture(page, "deeplink-invite-token-entry");
  await expect(page.getByText(PENDING_INVITE_NEUTRAL_TITLE, { exact: true })).toBeVisible();
  await expect(page.getByText(PENDING_INVITE_UNVALIDATED_COPY, { exact: true })).toBeVisible();
  await expect(page.getByText(PENDING_INVITE_CONFIRMED_TITLE, { exact: true })).toHaveCount(0);
  const inviteTokenInput = page.getByLabel("감지된 초대 토큰");
  await expect(inviteTokenInput).toBeVisible();
  await expect(inviteTokenInput).toHaveValue("invite-hash-token");
  await expect(inviteTokenInput).toHaveAttribute("readonly", "");
  await expect.poll(() => page.url()).not.toContain("invite_token=invite-hash-token");
  await capture(page, "issue-207-invite-token-neutral-copy");
  await capture(page, "deeplink-invite-token-result");
});

test("household invite hash link refreshes after rejected query token in same tab", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/?verify_token=query-token");
  await expect(page.getByRole("button", { name: "로그인하기" })).toBeVisible();
  await expect(page.getByText("보안을 위해 URL query 토큰은 지원하지 않습니다.")).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("verify_token=query-token");

  await page.goto("/#invite_token=invite-hash-token");
  await expect(page.getByText(PENDING_INVITE_NEUTRAL_TITLE, { exact: true })).toBeVisible();
  await expect(page.getByText(PENDING_INVITE_UNVALIDATED_COPY, { exact: true })).toBeVisible();
  await expect(page.getByText(PENDING_INVITE_CONFIRMED_TITLE, { exact: true })).toHaveCount(0);
  await expect(page.getByText("보안을 위해 URL query 토큰은 지원하지 않습니다.")).toHaveCount(0);
  const inviteTokenInput = page.getByLabel("감지된 초대 토큰");
  await expect(inviteTokenInput).toBeVisible();
  await expect(inviteTokenInput).toHaveValue("invite-hash-token");
  await expect(inviteTokenInput).toHaveAttribute("readonly", "");
  await expect.poll(() => page.url()).not.toContain("invite_token=invite-hash-token");
  await capture(page, "deeplink-invite-token-after-query-reject-result");
});

test("tab query overrides the previously saved active tab", async ({ page }) => {
  test.setTimeout(90_000);

  await registerAndVerify(page, {
    email: `${unique("deeplink-tab-user")}@example.com`,
    displayName: unique("deeplink-tab-name"),
  });
  await openTab(page, "설정");
  await expect(page.getByRole("button", { name: "설정", exact: true }).first()).toHaveClass(/active/);

  await page.goto("/?tab=holdings");
  await expect(page.locator("main.app-shell")).toHaveAttribute("translate", "no");
  await expect(page.getByRole("button", { name: "자산", exact: true }).first()).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "설정", exact: true }).first()).not.toHaveClass(/active/);
  await capture(page, "deeplink-tab-holdings-overrides-saved-settings");

  await page.goto("/?tab=collaboration");
  await expect(page.locator("main.app-shell")).toHaveAttribute("translate", "no");
  await expect(page.getByRole("button", { name: "협업", exact: true }).first()).toHaveClass(/active/);
  await capture(page, "deeplink-tab-collaboration-overrides-saved-settings");

  await openTab(page, "설정");
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("settings");
  await capture(page, "deeplink-tab-query-stays-in-sync");
});
