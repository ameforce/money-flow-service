import { expect, test } from "@playwright/test";

import { TEST_PASSWORD, assertResponsiveShell, capture, login, logout, registerAndVerify, unique } from "../support/helpers";

async function expectAuthFooterClear(page) {
  const metrics = await page.evaluate(() => {
    const footer = document.querySelector(".auth-shell > .app-copyright");
    const card = document.querySelector("form.auth-card");
    const switcher = document.querySelector(".auth-switch");
    const boxOf = (element) => {
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const footerBox = boxOf(footer);
    const cardBox = boxOf(card);
    const switcherBox = boxOf(switcher);
    const intersects = (a, b) =>
      Boolean(
        a &&
          b &&
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top
      );

    return {
      present: Boolean(footerBox),
      position: footer ? getComputedStyle(footer).position : "",
      cardGap: footerBox && cardBox ? footerBox.top - cardBox.bottom : -1,
      switcherGap: footerBox && switcherBox ? footerBox.top - switcherBox.bottom : -1,
      overlapsCard: intersects(footerBox, cardBox),
      overlapsSwitcher: intersects(footerBox, switcherBox),
    };
  });

  expect(metrics.present).toBe(true);
  expect(metrics.position).not.toBe("fixed");
  expect(metrics.position).not.toBe("absolute");
  expect(metrics.overlapsCard).toBe(false);
  expect(metrics.overlapsSwitcher).toBe(false);
  expect(metrics.cardGap).toBeGreaterThanOrEqual(6);
  expect(metrics.switcherGap).toBeGreaterThanOrEqual(6);
}

test("auth switch controls keep mobile touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");

  const measureSwitchButton = async (name) =>
    page.getByRole("button", { name, exact: true }).evaluate((button) => {
      const box = button.getBoundingClientRect();
      const styles = getComputedStyle(button);
      return {
        width: box.width,
        height: box.height,
        background: styles.backgroundColor,
        boxShadow: styles.boxShadow,
        display: styles.display,
        viewportWidth: document.documentElement.clientWidth,
        pageWidth: document.documentElement.scrollWidth,
      };
    });

  const loginSwitch = await measureSwitchButton("회원가입");
  expect(loginSwitch.height).toBeGreaterThanOrEqual(40);
  expect(loginSwitch.height).toBeLessThanOrEqual(48);
  expect(loginSwitch.width).toBeGreaterThanOrEqual(44);
  expect(loginSwitch.background).toBe("rgba(0, 0, 0, 0)");
  expect(loginSwitch.boxShadow).toBe("none");
  expect(["inline-flex", "flex"]).toContain(loginSwitch.display);
  expect(loginSwitch.pageWidth - loginSwitch.viewportWidth).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect(page.locator("form.auth-card-register")).toBeVisible();

  const signupSwitch = await measureSwitchButton("로그인으로 돌아가기");
  expect(signupSwitch.height).toBeGreaterThanOrEqual(40);
  expect(signupSwitch.height).toBeLessThanOrEqual(48);
  expect(signupSwitch.width).toBeGreaterThanOrEqual(44);
  expect(signupSwitch.background).toBe("rgba(0, 0, 0, 0)");
  expect(signupSwitch.boxShadow).toBe("none");
  expect(["inline-flex", "flex"]).toContain(signupSwitch.display);
  expect(signupSwitch.pageWidth - signupSwitch.viewportWidth).toBeLessThanOrEqual(1);

  await capture(page, "auth-switch-touch-targets");
});

test("auth forms show Korean required-field validation", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "로그인하기" }).click();
  await expect(page.getByText("이메일을 입력해 주세요.")).toBeVisible();

  await page.getByLabel("이메일", { exact: true }).fill("not-an-email");
  await page.getByRole("button", { name: "로그인하기" }).click();
  await expect(page.getByText("올바른 이메일 주소를 입력해 주세요.")).toBeVisible();

  await page.getByLabel("이메일", { exact: true }).fill("login-required@example.com");
  await page.getByRole("button", { name: "로그인하기" }).click();
  await expect(page.getByText("비밀번호를 입력해 주세요.")).toBeVisible();

  await page.getByRole("button", { name: "회원가입" }).click();
  await page.getByLabel("이메일", { exact: true }).fill("");
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();
  await expect(page.getByText("이메일을 입력해 주세요.")).toBeVisible();

  await page.getByLabel("이메일", { exact: true }).fill("register-required@example.com");
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();
  await expect(page.getByText("비밀번호를 입력해 주세요.")).toBeVisible();

  await page.getByLabel("비밀번호", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();
  await expect(page.getByText("비밀번호 확인을 입력해 주세요.")).toBeVisible();

  await page.getByLabel("비밀번호 확인").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();
  await expect(page.getByText("본명을 입력해 주세요.")).toBeVisible();
});

test("auth signup switch after failed login clears password fields", async ({ page }) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "AUTH_INVALID_CREDENTIALS",
          message: "이메일 또는 비밀번호가 올바르지 않습니다.",
        },
      }),
    });
  });

  await page.goto("/");
  const failedEmail = `${unique("issue-205-login")}@example.com`;
  await page.getByLabel("이메일", { exact: true }).fill(failedEmail);
  await page.getByLabel("비밀번호", { exact: true }).fill("WrongPassword1234");
  await capture(page, "issue-205-login-filled");

  await page.getByRole("button", { name: "로그인하기" }).click();
  await expect(page.getByText("로그인에 실패했습니다.")).toBeVisible();
  await capture(page, "issue-205-login-failed");

  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect(page.locator("form.auth-card-register")).toBeVisible();
  await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(failedEmail);
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("비밀번호 확인")).toHaveValue("");
  await capture(page, "issue-205-signup-password-cleared");
});

test("auth verification submit waits for a link token or 6-digit code", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.route("**/api/v1/auth/register", async (route) => {
    const request = route.request();
    const payload = request.postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        status: "verification_required",
        email: payload.email,
        verification_expires_in_seconds: 600,
        verification_resend_limit: 3,
        verification_resend_window_seconds: 300,
        verification_resend_cooldown_seconds: 60,
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page.getByLabel("이메일", { exact: true }).fill(`${unique("verify-cta-user")}@example.com`);
  await page.getByLabel("비밀번호", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("비밀번호 확인").fill(TEST_PASSWORD);
  await page.getByLabel("본명").fill(unique("verify-cta-name"));
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();

  await expect(page.getByText("인증 메일을 확인해 주세요.")).toBeVisible();
  const verifyButton = page.getByRole("button", { name: "이메일 인증 완료" });
  await expect(verifyButton).toBeDisabled();
  await expect(page.getByText("메일 버튼으로 접속하거나 6자리 인증번호를 입력하면")).toBeVisible();

  await page.getByLabel("6자리 인증번호").fill("12345");
  await expect(verifyButton).toBeDisabled();
  await page.getByLabel("6자리 인증번호").fill("123456");
  await expect(verifyButton).toBeEnabled();
  await capture(page, "auth-verify-submit-waits-for-code");
});

test("auth login shows origin guidance for CSRF origin rejection", async ({ page }) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "AUTH_CSRF_ORIGIN_FORBIDDEN",
          message: "허용되지 않은 출처(origin) 요청입니다.",
          action: "동일한 출처에서 다시 시도해 주세요.",
        },
      }),
    });
  });

  await page.goto("/");
  await page.getByLabel("이메일", { exact: true }).fill("custom-port-login@example.com");
  await page.getByLabel("비밀번호", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "로그인하기" }).click();

  await expect(page.getByText("허용되지 않은 출처(origin) 요청입니다.")).toBeVisible();
  await expect(page.getByText("백엔드 허용 출처")).toBeVisible();
  await expect(page.getByText("요청 처리 중 오류가 발생했습니다.")).toHaveCount(0);
  await capture(page, "auth-origin-guidance");
});

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
  await expect(page.getByText("인증 메일을 확인해 주세요.")).toBeVisible();
  await expect(page.locator("form.auth-card-verify > .message")).toHaveCount(0);
  await expect(page.getByText("인증 메일을 보냈습니다.")).toHaveCount(0);
  await expect(page.getByLabel("인증 토큰")).toHaveCount(0);
  await expect(page.getByText("남은 유효시간")).toBeVisible();
  await expect(page.getByText("재전송 대기")).toBeVisible();
  await expect(page.getByText("남은 재전송")).toBeVisible();
  await expectAuthFooterClear(page);
  await capture(page, "auth-flow-verify-screen");

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
