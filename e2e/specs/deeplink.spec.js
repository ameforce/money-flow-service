import { expect, test } from "@playwright/test";

import { TEST_PASSWORD, capture, unique } from "../support/helpers";

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
  await expect(page.getByText("가계부 초대 링크를 확인했습니다.", { exact: true })).toBeVisible();
  const inviteTokenInput = page.getByLabel("감지된 초대 토큰");
  await expect(inviteTokenInput).toBeVisible();
  await expect(inviteTokenInput).toHaveValue("invite-hash-token");
  await expect(inviteTokenInput).toHaveAttribute("readonly", "");
  await expect.poll(() => page.url()).not.toContain("invite_token=invite-hash-token");
  await capture(page, "deeplink-invite-token-result");
});
