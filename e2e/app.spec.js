import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://127.0.0.1:8000";
const API_REQUEST_ORIGIN =
  process.env.E2E_API_REQUEST_ORIGIN || process.env.E2E_BASE_URL || "http://127.0.0.1:5173";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function resolveWorkbookPath() {
  try {
    const legacyDir = path.resolve("legacy");
    if (!fs.existsSync(legacyDir)) return "dummy.xlsx";
    const fileName = fs.readdirSync(legacyDir).find((name) => name.toLowerCase().endsWith(".xlsx"));
    if (!fileName) return "dummy.xlsx";
    return path.join(legacyDir, fileName);
  } catch (e) {
    return "dummy.xlsx";
  }
}

function ensureScreenshotDir() {
  const dir = path.resolve("output", "playwright", "e2e-flow");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test("auth deep-link token policy: query token rejected", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/?verify_token=query-token");
  await expect(page.getByRole("button", { name: "로그인하기" })).toBeVisible();
  await expect(page.getByLabel("인증 토큰")).toHaveCount(0);
  await expect(page.getByText("보안을 위해 URL query 토큰은 지원하지 않습니다.")).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("verify_token=query-token");
});

test("auth deep-link token policy: hash token accepted", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/#verify_token=hash-token");
  const verifyTokenInput = page.getByLabel("인증 토큰");
  await expect(verifyTokenInput).toBeVisible();
  await expect(verifyTokenInput).toHaveValue("hash-token");
  await expect.poll(() => page.url()).not.toContain("verify_token=hash-token");
});

test("full flow: auth -> transactions -> holdings -> import dry_run -> conflict API", async ({ page, request }) => {
  test.setTimeout(180_000);
  const screenshotDir = ensureScreenshotDir();
  const capture = async (name) => {
    await page.screenshot({
      path: path.join(screenshotDir, `${Date.now()}-${name}.png`),
      fullPage: true,
    });
  };
  const email = `${unique("user")}@example.com`;
  const password = "Password1234";
  const unknownEmail = `${unique("missing")}@example.com`;
  const holdingName = unique("E2E-비상금");
  const editedHoldingName = `${holdingName}-수정`;
  const traderName = unique("E2E-거래자");
  const uiEditedMemo = "e2e-coffee-ui-updated";
  const inviteEmail = `${unique("invite")}@example.com`;
  const workbookPath = resolveWorkbookPath();
  const workbookName = path.basename(workbookPath);

  const initialDashboardApiPatterns = [
    /\/api\/v1\/dashboard\/overview\?/,
    /\/api\/v1\/transactions\?.*limit=1000/,
    /\/api\/v1\/holdings$/,
    /\/api\/v1\/dashboard\/portfolio(?:\?.*)?$/,
    /\/api\/v1\/prices\/status$/,
  ];
  const delayedPatternHits = new Map();

  for (const pattern of initialDashboardApiPatterns) {
    await page.route(pattern, async (route) => {
      const key = pattern.toString();
      const hits = delayedPatternHits.get(key) || 0;
      delayedPatternHits.set(key, hits + 1);
      if (hits < 2) {
        await sleep(600);
      }
      await route.continue();
    });
  }

  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang), {
      timeout: 10_000,
      message: "html lang은 ko 여야 함",
    })
    .toBe("ko");
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const meta = document.querySelector('meta[name="google"]');
          return String(meta?.getAttribute("content") || "");
        }),
      {
        timeout: 10_000,
        message: "google notranslate meta 필요",
      }
    )
    .toBe("notranslate");
  await capture("01-login-initial");
  const keepSignedIn = page.getByLabel("로그인 상태 유지");
  const saveAccountInfo = page.getByLabel("계정 정보 저장 (이메일)");
  await expect(keepSignedIn).toBeVisible();
  await expect(saveAccountInfo).toBeVisible();
  if (!(await keepSignedIn.isChecked())) {
    await keepSignedIn.check();
  }
  if (!(await saveAccountInfo.isChecked())) {
    await saveAccountInfo.check();
  }

  await expect(page.locator(".auth-card button[type='submit']")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "로그인하기" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "회원가입" })).toHaveCount(1);

  await page.getByLabel("이메일", { exact: true }).fill(unknownEmail);
  await page.getByLabel("비밀번호").fill(password);
  await page.locator(".auth-card button[type='submit']").click();
  await expect(page.getByText("로그인에 실패했습니다.")).toBeVisible();
  await expect(page.getByText("이메일과 비밀번호를 확인한 뒤 다시 시도해 주세요.")).toBeVisible();
  await capture("02-login-error");

  await page.getByRole("button", { name: "회원가입" }).click();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByLabel("이름").fill("E2E User");
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();
  await expect(page.getByRole("button", { name: "이메일 인증 완료" })).toBeVisible();
  const verifyTokenInput = page.getByLabel("인증 토큰");
  await expect(verifyTokenInput).toBeVisible();
  if (!(await verifyTokenInput.inputValue())) {
    throw new Error("dev/test 모드에서 인증 토큰이 자동 주입되지 않았습니다.");
  }
  await page.getByRole("button", { name: "이메일 인증 완료" }).click();

  await expect(page.getByText("money-flow")).toBeVisible();
  await expect(page.getByText("가계:")).toBeVisible();
  await expect(page.locator("main.app-shell")).toHaveAttribute("translate", "no");
  await capture("03-after-signup-dashboard");
  await page.reload();
  await expect(page.getByText("가계:")).toBeVisible();
  await capture("04-after-reload-still-signed-in");

  const readYearMonth = async () => ({
    year: Number(await page.getByLabel("연도").inputValue()),
    month: Number(await page.getByLabel("월").inputValue()),
  });
  const baselineYearMonth = await readYearMonth();
  await page.getByRole("button", { name: "이전 달" }).click();
  const shiftedPrev = await readYearMonth();
  const expectedPrev =
    baselineYearMonth.month === 1
      ? { year: baselineYearMonth.year - 1, month: 12 }
      : { year: baselineYearMonth.year, month: baselineYearMonth.month - 1 };
  expect(shiftedPrev).toEqual(expectedPrev);
  await page.getByRole("button", { name: "다음 달" }).click();
  await expect(page.getByLabel("연도")).toHaveValue(String(baselineYearMonth.year));
  await expect(page.getByLabel("월")).toHaveValue(String(baselineYearMonth.month));
  await page.getByRole("button", { name: "이번 달" }).click();
  await expect(page.getByRole("button", { name: "다음 달" })).toBeDisabled();

  const heights = [];
  for (let i = 0; i < 6; i += 1) {
    // Dashboard charts should settle to a bounded height, not grow indefinitely.
    heights.push(await page.evaluate(() => document.documentElement.scrollHeight));
    await sleep(500);
  }
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  expect(maxHeight).toBeLessThan(8000);
  expect(maxHeight - minHeight).toBeLessThan(1200);

  await page.getByRole("button", { name: "거래" }).click();
  await capture("05-transactions-tab");
  // UI Visual Regression Test
  const transactionToolbar = page.locator(".month-toolbar").first();
  // Visual regression skipped
  // await expect(transactionToolbar).toHaveScreenshot("transaction-toolbar.png", { maxDiffPixelRatio: 0.05 });
  await expect(page.getByRole("button", { name: "이전 달" })).toBeVisible();
  await expect(page.getByRole("button", { name: "조회 적용" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다음 달" })).toBeDisabled();
  const expectedToday = await page.evaluate(() => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${mm}-${dd}`;
  });
  await page.getByLabel("일자").fill("2026-02-01");
  await page.getByRole("button", { name: "오늘" }).click();
  await expect(page.getByLabel("일자")).toHaveValue(expectedToday);
  await page.getByLabel("금액").fill("12000");
  await page.getByLabel("메모").fill("e2e-coffee");
  await page.getByLabel("거래자명").fill(traderName);
  await page.getByRole("button", { name: "거래 등록" }).click();
  await expect(page.locator("tbody")).toContainText("e2e-coffee", { timeout: 30_000 });
  await expect(page.locator("tbody")).toContainText(traderName, { timeout: 30_000 });
  await page.getByPlaceholder("메모, 거래자, 카테고리").fill("e2e-coffee");
  await expect(page.locator("tbody")).toContainText("e2e-coffee");
  const viewport = page.viewportSize();
  if (viewport && viewport.width <= 500) {
    const transactionTableCard = page.locator("article.table-card", {
      has: page.getByRole("heading", { name: "거래 목록" }),
    });
    await expect(transactionTableCard).toBeVisible();
    const hasHorizontalScroll = await transactionTableCard.evaluate((node) => node.scrollWidth > node.clientWidth);
    expect(hasHorizontalScroll).toBeTruthy();
  }
  await page.getByRole("button", { name: "필터 초기화" }).click();

  await page.getByRole("button", { name: "자산" }).click();
  await capture("06-holdings-tab");
  await expect(page.getByLabel("심볼", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("평가금액")).toBeVisible();
  await page.getByLabel("자산명").fill(holdingName);
  await page.getByLabel("카테고리").fill("현금성");
  await page.getByLabel("평가금액").fill("3000000");
  let autoPriceRefreshTriggered = false;
  const onRequest = (req) => {
    if (req.method() === "POST" && req.url().includes("/api/v1/prices/refresh")) {
      autoPriceRefreshTriggered = true;
    }
  };
  page.on("request", onRequest);
  await page.getByRole("button", { name: "자산 등록" }).click();
  await expect(page.locator("tbody")).toContainText(holdingName, { timeout: 30_000 });
  const holdingRow = page.locator("tr", { hasText: holdingName }).first();
  const editButton = holdingRow.getByRole("button", { name: "수정" });
  const inlineEditor = page.locator(".holdings-inline-editor").first();
  let inlineHoldingPatchPayload = null;
  await page.route(/\/api\/v1\/holdings\/[^/]+$/, async (route) => {
    const request = route.request();
    if (request.method() === "PATCH" && inlineHoldingPatchPayload === null) {
      inlineHoldingPatchPayload = JSON.parse(request.postData() || "{}");
    }
    await route.continue();
  });
  await expect(editButton).toBeVisible({ timeout: 10_000 });
  const openInlineEditorAttempts = [
    async () => {
      await editButton.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
      await editButton.click({ timeout: 5_000 });
    },
    async () => {
      await editButton.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
      await editButton.click({ force: true, timeout: 5_000 });
    },
    async () => {
      await editButton.evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "nearest" });
        if (element instanceof HTMLElement) {
          element.click();
        }
      });
    },
    async () => {
      await editButton.dispatchEvent("click");
    },
  ];
  let inlineEditorOpened = false;
  for (const openInlineEditor of openInlineEditorAttempts) {
    try {
      await openInlineEditor();
    } catch {
      // 모바일 viewport에서 sticky 요소에 가려지는 경우 다음 전략으로 재시도한다.
    }
    if (await inlineEditor.isVisible()) {
      inlineEditorOpened = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  expect(inlineEditorOpened).toBeTruthy();
  await expect(inlineEditor).toBeVisible();
  await inlineEditor.getByLabel("자산명").fill(editedHoldingName);
  const saveButton = inlineEditor.getByRole("button", { name: "저장" });
  await expect(saveButton).toBeVisible({ timeout: 5_000 });
  try {
    await saveButton.click({ timeout: 5_000 });
  } catch {
    try {
      await saveButton.click({ force: true, timeout: 5_000 });
    } catch {
      await inlineEditor.evaluate((form) => {
        if (form instanceof HTMLFormElement) {
          form.requestSubmit();
        }
      });
    }
  }
  await expect(page.locator("tbody")).toContainText(editedHoldingName, { timeout: 30_000 });
  expect(inlineHoldingPatchPayload).toBeTruthy();
  expect(Object.keys(inlineHoldingPatchPayload).sort()).toEqual(["base_version", "name"]);
  await page.unroute(/\/api\/v1\/holdings\/[^/]+$/);
  await page.waitForTimeout(1500);
  page.off("request", onRequest);
  expect(autoPriceRefreshTriggered).toBeFalsy();

  await page.getByRole("button", { name: "협업" }).click();
  await expect(page.getByRole("heading", { name: "가계 협업 관리" })).toBeVisible();
  await page.getByLabel("초대할 이메일").fill(inviteEmail);
  await page.locator(".collaboration-form-grid").getByLabel("권한").selectOption("viewer");
  await page.getByRole("button", { name: "초대 발송" }).click();
  await expect(page.getByText("초대를 발송했습니다.")).toBeVisible();
  const inviteRow = page.locator("tr", { hasText: inviteEmail });
  await expect(inviteRow).toBeVisible();
  await inviteRow.getByRole("button", { name: "초대 취소" }).click();
  await expect(page.getByText("초대를 취소했습니다.")).toBeVisible();
  await expect(inviteRow).toContainText("revoked");
  await capture("07-collaboration-tab");

  await page.getByRole("button", { name: "데이터 가져오기" }).click();
  await capture("08-import-tab");
  const fileDropArea = page.locator(".file-drop-area");
  await expect(fileDropArea).toBeVisible();
  
  await page.getByLabel("엑셀 파일 업로드").setInputFiles(workbookPath);
  await expect(page.getByText(`선택된 파일: ${workbookName}`)).toBeVisible();

  await page.getByRole("button", { name: "미리 검증" }).click();
  await expect(page.getByText("미리 검증 완료")).toBeVisible();
  await expect(page.getByRole("heading", { name: /수식 불일치 셀/i })).toBeVisible();

  const applyButton = page.getByRole("button", { name: /^적용$/ });
  await applyButton.click();
  await expect(page.getByRole("button", { name: "적용 중..." })).toBeVisible();
  await expect(page.getByRole("button", { name: "적용 중..." })).toBeHidden({ timeout: 120_000 });
  await expect(applyButton).toBeVisible();
  await capture("09-import-applied");

  await page.getByRole("button", { name: "대시보드" }).click();
  await expect(page.getByRole("heading", { name: "포트폴리오" })).toBeVisible();
  const paletteRaw = await page.locator("[data-portfolio-palette]").first().getAttribute("data-portfolio-palette");
  const paletteColors = String(paletteRaw || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  expect(paletteColors.length).toBeGreaterThan(0);
  expect(new Set(paletteColors).size).toBe(paletteColors.length);

  await page.getByRole("button", { name: "자산" }).click();
  await expect(page.getByRole("tab", { name: "현금성" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "전체" })).toBeVisible();
  await page.getByRole("tab", { name: "현금성" }).click();
  await page.getByRole("tab", { name: "전체" }).click();
  await expect(page.locator(".section-header-cell").first()).toBeVisible();

  await page.getByRole("button", { name: "거래" }).click();
  const transactionCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "거래 입력 / 수정" }),
  });
  await transactionCard.getByLabel("유형").selectOption("expense");
  await expect(transactionCard.getByLabel("중분류")).toBeDisabled();
  await expect
    .poll(async () => transactionCard.getByLabel("대분류").locator("option").count(), {
      timeout: 20_000,
      message: "대분류 옵션이 로딩될 때까지 대기",
    })
    .toBeGreaterThan(1);
  await transactionCard.getByLabel("대분류").selectOption({ index: 1 });
  await expect(transactionCard.getByLabel("중분류")).toBeEnabled();
  await expect
    .poll(async () => transactionCard.getByLabel("중분류").locator("option").count(), {
      timeout: 20_000,
      message: "중분류 옵션이 로딩될 때까지 대기",
    })
    .toBeGreaterThan(1);
  await transactionCard.getByLabel("중분류").selectOption({ index: 1 });

  let inlineTransactionPatchPayload = null;
  await page.route(/\/api\/v1\/transactions\/[^/]+$/, async (route) => {
    const request = route.request();
    if (request.method() === "PATCH" && inlineTransactionPatchPayload === null) {
      inlineTransactionPatchPayload = JSON.parse(request.postData() || "{}");
    }
    await route.continue();
  });
  const txRowForEdit = page.locator("tr", { hasText: "e2e-coffee" }).first();
  await expect(txRowForEdit).toBeVisible();
  await txRowForEdit.getByRole("button", { name: "수정" }).click();
  await transactionCard.getByLabel("메모").fill(uiEditedMemo);
  await transactionCard.getByRole("button", { name: "거래 수정 저장" }).click();
  await expect(page.locator("tbody")).toContainText(uiEditedMemo, { timeout: 30_000 });
  expect(inlineTransactionPatchPayload).toBeTruthy();
  expect(Object.keys(inlineTransactionPatchPayload).sort()).toEqual(["base_version", "memo"]);
  await page.unroute(/\/api\/v1\/transactions\/[^/]+$/);

  const loginForApi = await request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    headers: { "x-auth-token-mode": "body", Origin: API_REQUEST_ORIGIN },
    data: { email, password },
  });
  expect(loginForApi.ok()).toBeTruthy();
  const loginPayload = await loginForApi.json();
  const token = loginPayload.access_token;
  expect(token).toBeTruthy();

  const holdingsRes = await request.get(`${API_BASE_URL}/api/v1/holdings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(holdingsRes.ok()).toBeTruthy();
  const holdingsData = await holdingsRes.json();
  const vooRows = holdingsData.filter((item) => item.market_symbol === "VOO");
  expect(vooRows.length).toBeGreaterThanOrEqual(2);
  const vooDca = vooRows.find((item) => Number(item.quantity) < 1);
  expect(vooDca).toBeTruthy();
  expect(vooDca.currency).toBe("KRW");
  expect(Number(vooDca.average_cost)).toBeGreaterThan(100_000);
  expect(Number(vooDca.average_cost)).toBeLessThan(1_000_000);
  expect(holdingsData.some((item) => item.market_symbol === "QQQM")).toBeTruthy();
  expect(holdingsData.some((item) => item.market_symbol === "QQQM.KR")).toBeFalsy();

  const refreshStartedAt = Date.now();
  const refreshRes = await request.post(`${API_BASE_URL}/api/v1/prices/refresh`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const refreshElapsedMs = Date.now() - refreshStartedAt;
  expect(refreshRes.ok()).toBeTruthy();
  expect(refreshElapsedMs).toBeLessThan(3000);
  const refreshPayload = await refreshRes.json();
  expect(Boolean(refreshPayload.accepted)).toBeTruthy();
  expect(Boolean(refreshPayload.in_progress)).toBeTruthy();

  let finalStatus = null;
  for (let idx = 0; idx < 120; idx += 1) {
    const statusRes = await request.get(`${API_BASE_URL}/api/v1/prices/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(statusRes.ok()).toBeTruthy();
    finalStatus = await statusRes.json();
    if (!finalStatus.refresh_in_progress) break;
    await sleep(500);
  }
  expect(finalStatus).toBeTruthy();
  expect(Boolean(finalStatus.refresh_in_progress)).toBeFalsy();

  const portfolioRes = await request.get(`${API_BASE_URL}/api/v1/dashboard/portfolio`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(portfolioRes.ok()).toBeTruthy();
  const portfolio = await portfolioRes.json();
  const expectedSymbols = new Set(["VOO", "360750.KR", "489250.KR", "0046A0.KR", "0072R0.KR"]);
  const pricedItems = portfolio.items.filter(
    (item) =>
      expectedSymbols.has(item.market_symbol) &&
      item.latest_price !== null &&
      Number(item.market_value_krw) > 0
  );
  expect(pricedItems.length).toBeGreaterThanOrEqual(4);

  const txRes = await request.get(`${API_BASE_URL}/api/v1/transactions?limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(txRes.ok()).toBeTruthy();
  const txList = await txRes.json();
  const target = txList.find((item) => item.memo === uiEditedMemo);
  expect(target).toBeTruthy();

  const patch1 = await request.patch(`${API_BASE_URL}/api/v1/transactions/${target.id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: { base_version: target.version, memo: "e2e-coffee-updated" },
  });
  expect(patch1.ok()).toBeTruthy();

  const patchConflict = await request.patch(`${API_BASE_URL}/api/v1/transactions/${target.id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    data: { base_version: target.version, memo: "e2e-conflict" },
  });
  expect(patchConflict.status()).toBe(409);

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByLabel("이메일", { exact: true })).toHaveValue(email);
  await expect(page.getByRole("button", { name: "로그인하기" })).toBeVisible();
  await capture("10-after-logout");
});
