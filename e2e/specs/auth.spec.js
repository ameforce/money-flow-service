import { expect, test } from "@playwright/test";

import { TEST_PASSWORD, assertResponsiveShell, capture, login, logout, registerAndVerify, unique } from "../support/helpers";

test("auth flow: register validation, verify, logout, relogin", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("auth-user")}@example.com`;
  const displayName = unique("auth-real");

  await page.goto("/");
  await capture(page, "auth-flow-entry");

  await page.getByRole("button", { name: "회원가입" }).click();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill("1234567");
  await page.getByLabel("비밀번호 확인").fill("1234567");
  await page.getByLabel("본명").fill(displayName);
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();
  await expect(page.getByText("비밀번호는 8자 이상이어야 합니다.")).toBeVisible();

  await page.getByLabel("비밀번호", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("비밀번호 확인").fill("Password9999");
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();
  await expect(page.getByText("비밀번호 확인이 일치하지 않습니다.")).toBeVisible();

  await page.getByLabel("비밀번호 확인").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();
  await expect(page.getByLabel("인증 토큰")).toBeVisible();
  await capture(page, "auth-flow-verify-screen");

  await page.getByLabel("비밀번호", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("비밀번호 확인").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "이메일 인증 완료" }).click();
  await expect(page.locator("main.app-shell")).toHaveAttribute("translate", "no");
  await assertResponsiveShell(page);

  await logout(page);
  await login(page, { email, password: TEST_PASSWORD });
  await expect(page.locator("main.app-shell")).toHaveAttribute("translate", "no");
  await assertResponsiveShell(page);
  await capture(page, "auth-flow-relogin-result");
});

test("auth helper registration keeps app shell stable", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("auth-helper")}@example.com`;
  const displayName = unique("auth-helper-name");

  await registerAndVerify(page, { email, displayName });
  await expect(page.getByText("실시간 연결:")).toBeVisible();
  await assertResponsiveShell(page);
  await capture(page, "auth-helper-register-result");
});
