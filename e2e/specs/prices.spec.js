import { expect, test } from "@playwright/test";

import { assertResponsiveShell, capture, registerAndVerify, unique } from "../support/helpers";

test("prices flow: refresh action and status endpoint", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("price-user")}@example.com`;
  const displayName = unique("price-name");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  await capture(page, "prices-entry");

  const refreshButton = page.getByRole("button", { name: /시세 갱신/ });
  await expect(refreshButton).toBeVisible();
  await refreshButton.click();

  const message = page.locator(".message");
  await expect
    .poll(
      async () => {
        const text = (await message.textContent()) || "";
        if (text.includes("시세 갱신을 백그라운드로 시작했습니다.")) {
          return "queued";
        }
        if (text.includes("이미 시세 갱신이 진행 중입니다.")) {
          return "already-running";
        }
        if (text.includes("시세 갱신 완료")) {
          return "done";
        }
        return "";
      },
      { timeout: 15_000 }
    )
    .not.toBe("");

  const statusResp = await page.request.get("/api/v1/prices/status");
  expect(statusResp.ok()).toBeTruthy();
  const statusPayload = await statusResp.json();
  expect(typeof statusPayload).toBe("object");
  await capture(page, "prices-result");
});
