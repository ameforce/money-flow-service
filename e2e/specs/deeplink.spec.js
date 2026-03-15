import { expect, test } from "@playwright/test";

import { capture } from "../support/helpers";

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
  const verifyTokenInput = page.getByLabel("인증 토큰");
  await expect(verifyTokenInput).toBeVisible();
  await expect(verifyTokenInput).toHaveValue("hash-token");
  await expect.poll(() => page.url()).not.toContain("verify_token=hash-token");
  await capture(page, "deeplink-hash-token-accepted-result");
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
