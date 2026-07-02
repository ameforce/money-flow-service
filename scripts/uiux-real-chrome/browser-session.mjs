import { chromium } from "playwright";

export const TAB_LABELS = new Map([
  ["dashboard", "대시보드"],
  ["transactions", "거래"],
  ["holdings", "자산"],
  ["settings", "설정"],
  ["collaboration", "협업"],
  ["import", "데이터 가져오기"],
]);

export async function launchBrowser() {
  try {
    const browser = await chromium.launch({ channel: "chrome" });
    return { browser, chromeChannel: "chrome", fallbackReason: null };
  } catch (error) {
    const browser = await chromium.launch();
    return { browser, chromeChannel: "chromium", fallbackReason: error instanceof Error ? error.message : String(error) };
  }
}

export async function tryRegisterDashboard(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const authVisible = await page.locator(".auth-shell").waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false);
  if (!authVisible) {
    return { reached: await page.locator("main.app-shell").isVisible().catch(() => false), fallbackReason: null };
  }

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const email = `uiux-shell-${suffix}@example.com`;
  const password = "Password1234";
  try {
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.getByLabel("이메일", { exact: true }).fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(password);
    await page.getByLabel("비밀번호 확인").fill(password);
    await page.getByLabel("본명").fill(`uiux shell ${suffix}`);
    await page.getByRole("button", { name: "회원가입하고 시작" }).click();

    const direct = await page.locator("main.app-shell").waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
    if (direct) {
      return { reached: true, fallbackReason: null };
    }
    const verify = page.getByRole("button", { name: "이메일 인증 완료" });
    if (await verify.isVisible().catch(() => false)) {
      await verify.click();
      const verified = await page.locator("main.app-shell").waitFor({ state: "visible", timeout: 12_000 }).then(() => true).catch(() => false);
      return { reached: verified, fallbackReason: verified ? null : "email verification did not reach dashboard" };
    }
    return { reached: false, fallbackReason: "registration submitted but dashboard did not become visible" };
  } catch (error) {
    return { reached: false, fallbackReason: error instanceof Error ? error.message : String(error) };
  }
}

export async function openRequestedTab(page, tab) {
  const label = TAB_LABELS.get(tab);
  if (!label || tab === "dashboard") {
    return { requested: tab, opened: tab === "dashboard" };
  }
  const button = page.getByRole("button", { name: label, exact: true }).first();
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return { requested: tab, opened: true };
  }
  return { requested: tab, opened: false };
}
