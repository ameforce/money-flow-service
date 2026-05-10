import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

export const TEST_PASSWORD = "Password1234";
const SHARED_E2E_LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);
const SHARED_AUTH_READY_TIMEOUT_MS = 12_000;
const SHARED_E2E_UNIQUE_ACCOUNT_PREFIXES = ["auth-user", "dashboard-user", "owner-user", "guest-user"];

export function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function isSharedE2EBaseUrl(baseUrl = process.env.E2E_BASE_URL || "") {
  const normalized = String(baseUrl || "").trim();
  if (!normalized) {
    return false;
  }
  try {
    const { hostname } = new URL(normalized);
    return !SHARED_E2E_LOCAL_HOSTS.has(String(hostname || "").trim().toLowerCase());
  } catch {
    return false;
  }
}

export function normalizeSharedIdentityStem(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  const withoutDomain = trimmed.includes("@") ? trimmed.split("@", 1)[0] : trimmed;
  const normalized = withoutDomain
    .replace(/-\d{10,}-\d+$/u, "")
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "e2e-user";
}

export function shouldKeepUniqueSharedIdentity(stem) {
  const normalized = normalizeSharedIdentityStem(stem);
  return SHARED_E2E_UNIQUE_ACCOUNT_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}-`)
  );
}

export function resolveSharedAuthIdentity({ email, displayName }) {
  const directIdentity = {
    email: String(email || "").trim(),
    displayName: String(displayName || "").trim(),
    shared: false,
  };
  if (!isSharedE2EBaseUrl()) {
    return directIdentity;
  }
  const emailStem = normalizeSharedIdentityStem(email);
  if (shouldKeepUniqueSharedIdentity(emailStem)) {
    return {
      ...directIdentity,
      shared: true,
    };
  }
  const nameStem = normalizeSharedIdentityStem(displayName || emailStem).replace(/-/gu, " ").trim();
  const projectName = normalizeSharedIdentityStem(test.info()?.project?.name || "playwright");
  return {
    email: `${emailStem}@example.com`,
    displayName: `${nameStem || "e2e user"} ${projectName}`.trim(),
    shared: true,
  };
}

async function openAuthMode(page, mode) {
  const targetMode = String(mode || "").trim();
  const verifyButton = page.getByRole("button", { name: "이메일 인증 완료" });
  if (targetMode === "verify") {
    await expect(verifyButton).toBeVisible();
    return;
  }
  const emailInput = page.getByLabel("이메일", { exact: true });
  const passwordInput = page.getByLabel("비밀번호", { exact: true });
  const passwordConfirmInput = page.getByLabel("비밀번호 확인");
  const inVerifyMode = await verifyButton.isVisible().catch(() => false);
  if (inVerifyMode) {
    await page.getByRole("button", { name: "로그인으로 돌아가기" }).click();
  }
  const registerFieldsVisible = await passwordConfirmInput.isVisible().catch(() => false);
  if (targetMode === "register" && !registerFieldsVisible) {
    await page.getByRole("button", { name: "회원가입" }).click();
  } else if (targetMode === "login" && registerFieldsVisible) {
    await page.getByRole("button", { name: "로그인으로 돌아가기" }).click();
  }
  await expect(emailInput).toBeVisible();
  await expect(passwordInput).toBeVisible();
  if (targetMode === "register") {
    await expect(passwordConfirmInput).toBeVisible();
    await expect(page.getByRole("button", { name: "회원가입하고 시작" })).toBeVisible();
  } else if (targetMode === "login") {
    await expect(page.getByRole("button", { name: "로그인하기" })).toBeVisible();
  }
}

async function fillLoginForm(page, { email, password }) {
  await openAuthMode(page, "login");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
}

async function fillRegisterForm(page, { email, password, displayName }) {
  await openAuthMode(page, "register");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByLabel("본명").fill(displayName);
}

async function expectAuthReady(page, { timeout = 5_000 } = {}) {
  const appShell = page.locator("main.app-shell");
  const signedIn = await appShell
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (signedIn) {
    await expect(appShell).toHaveAttribute("translate", "no");
  }
  return signedIn;
}

async function loginFromAuthShell(page, credentials, { timeout = 5_000 } = {}) {
  await fillLoginForm(page, credentials);
  await page.getByRole("button", { name: "로그인하기" }).click();
  return expectAuthReady(page, { timeout });
}

async function completeEmailVerification(page) {
  await expect(page.getByText("인증 메일을 확인해 주세요.")).toBeVisible();
  await expect(page.getByLabel("인증 토큰")).toHaveCount(0);
  await page.getByRole("button", { name: "이메일 인증 완료" }).click();
  return expectAuthReady(page, { timeout: SHARED_AUTH_READY_TIMEOUT_MS });
}

export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ensureScreenshotDir() {
  const dir = path.resolve("output", "playwright", "e2e-flow");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function capture(page, name) {
  const screenshotDir = ensureScreenshotDir();
  const outputPath = path.join(screenshotDir, `${Date.now()}-${name}.png`);
  try {
    await page.screenshot({
      path: outputPath,
      fullPage: false,
      animations: "disabled",
      timeout: 15_000,
    });
  } catch {
    await page.screenshot({
      path: outputPath,
      fullPage: false,
      animations: "disabled",
      timeout: 15_000,
    });
  }
}

export function labeledField(container, label, selector = "input, select, textarea") {
  return container
    .locator("label")
    .filter({ hasText: new RegExp(`^\\s*${escapeRegex(label)}`) })
    .locator(selector)
    .first();
}

export async function expectNoHorizontalOverflow(page, allowance = 8) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(allowance);
}

export async function assertResponsiveShell(page, allowance = 12) {
  await expect(page.locator("header.topbar")).toBeVisible();
  await expect(page.locator("nav.tabs")).toBeVisible();
  await expectNoHorizontalOverflow(page, allowance);
}

export async function expectCompactLedgerRow(row, maxHeight = 60) {
  const box = await row.boundingBox();
  expect(box, "row bounding box should exist").not.toBeNull();
  expect(box?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(maxHeight);
}

export async function expectSingleLineText(locator, allowance = 3) {
  const metrics = await locator.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(metrics.scrollHeight - metrics.clientHeight).toBeLessThanOrEqual(allowance);
}

export async function expectBackgroundNotPlainWhite(locator) {
  const backgroundColor = await locator.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(backgroundColor).not.toBe("rgb(255, 255, 255)");
}

export async function expectTransparentBackground(locator) {
  const backgroundColor = await locator.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(backgroundColor);
}

export async function expectStickyHeadWithinTop(locator, maxY = 90) {
  const box = await locator.boundingBox();
  expect(box, "sticky head bounding box should exist").not.toBeNull();
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(maxY);
}

export async function expectStickyStack(headingLocator, ledgerLocator, { maxLedgerY = 110, gapAllowance = 6 } = {}) {
  const headingBox = await headingLocator.boundingBox();
  const ledgerBox = await ledgerLocator.boundingBox();
  expect(headingBox, "sticky heading bounding box should exist").not.toBeNull();
  expect(ledgerBox, "sticky ledger bounding box should exist").not.toBeNull();
  expect(ledgerBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(maxLedgerY);
  if ((headingBox?.y ?? -1) + (headingBox?.height ?? 0) > 0) {
    expect((ledgerBox?.y ?? 0) - ((headingBox?.y ?? 0) + (headingBox?.height ?? 0))).toBeGreaterThanOrEqual(-gapAllowance);
  }
}

export async function expectStableButtonPosition(locator, action, tolerance = 6) {
  const before = await locator.boundingBox();
  expect(before, `${action} before-box should exist`).not.toBeNull();
  await action();
  const after = await locator.boundingBox();
  expect(after, "after-box should exist").not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThanOrEqual(tolerance);
}

export async function expectCompactHeader(locator, maxHeight = 30) {
  const box = await locator.boundingBox();
  expect(box, "header bounding box should exist").not.toBeNull();
  expect(box?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(maxHeight);
}

export function hexToRgb(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  if (raw.length !== 6) {
    return "";
  }
  const value = Number.parseInt(raw, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgb(${red}, ${green}, ${blue})`;
}

export async function openTab(page, label) {
  const tabButton = page.getByRole("button", { name: label, exact: true }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await tabButton.click();
    const isActive = await tabButton
      .evaluate((element) => element.classList.contains("active"))
      .catch(() => false);
    if (isActive) {
      return;
    }
    await page.waitForTimeout(250);
  }
  await expect(tabButton).toHaveClass(/active/);
}

export async function login(page, { email, password = TEST_PASSWORD }) {
  const identity = resolveSharedAuthIdentity({ email });
  const authReadyTimeout = identity.shared ? SHARED_AUTH_READY_TIMEOUT_MS : 5_000;
  await page.goto("/");
  const signedIn = await loginFromAuthShell(page, { email: identity.email, password }, { timeout: authReadyTimeout });
  if (!signedIn) {
    throw new Error(`로그인에 실패했습니다: ${identity.email}`);
  }
}

export async function logout(page) {
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.locator("form.auth-card")).toBeVisible();
  await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
}

export async function registerAndVerify(page, { email, password = TEST_PASSWORD, displayName }) {
  const identity = resolveSharedAuthIdentity({ email, displayName });
  const authReadyTimeout = identity.shared ? SHARED_AUTH_READY_TIMEOUT_MS : 5_000;
  await page.goto("/");
  if (identity.shared) {
    const signedInFromExistingAccount = await loginFromAuthShell(page, { email: identity.email, password }, { timeout: authReadyTimeout });
    if (signedInFromExistingAccount) {
      return;
    }
    await page.goto("/");
  }

  await fillRegisterForm(page, {
    email: identity.email,
    password,
    displayName: identity.displayName,
  });
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();

  const signedInDirectly = await expectAuthReady(page, { timeout: authReadyTimeout });
  if (signedInDirectly) {
    return;
  }

  const verifyButton = page.getByRole("button", { name: "이메일 인증 완료" });
  const verifyVisible = await verifyButton
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (verifyVisible) {
    const signedInAfterVerify = await completeEmailVerification(page);
    if (signedInAfterVerify) {
      return;
    }
    const signedInAfterVerifyLogin = await loginFromAuthShell(page, { email: identity.email, password }, { timeout: authReadyTimeout });
    if (signedInAfterVerifyLogin) {
      return;
    }
    await expect(page.locator("main.app-shell")).toHaveAttribute("translate", "no");
  }

  if (identity.shared) {
    await page.goto("/");
    const signedInAfterFallback = await loginFromAuthShell(page, { email: identity.email, password }, { timeout: authReadyTimeout });
    if (signedInAfterFallback) {
      return;
    }
  }

  const authMessage = String((await page.locator(".message").first().textContent().catch(() => "")) || "").trim();
  throw new Error(`회원가입/인증에 실패했습니다: ${identity.email}${authMessage ? ` :: ${authMessage}` : ""}`);
}

export async function selectFirstNonEmptyOption(selectLocator) {
  const options = await selectLocator.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({
      value: String(node.value || ""),
      text: String(node.textContent || ""),
    }))
  );
  const candidate = options.find((item) => item.value.trim() !== "");
  if (!candidate) {
    return false;
  }
  await selectLocator.selectOption(candidate.value);
  return true;
}

function formatGroupedNumber(value) {
  const digits = String(value ?? "").replace(/[^\d-]/g, "");
  if (!digits) {
    return "";
  }
  const sign = digits.startsWith("-") ? "-" : "";
  const body = sign ? digits.slice(1) : digits;
  return `${sign}${body.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

async function ensureTransactionFormValues(container, { memo, amount }) {
  const amountInput = labeledField(container, "금액", "input");
  const memoInput = labeledField(container, "메모", "input");
  const expectedAmount = formatGroupedNumber(amount);

  await expect(amountInput).toBeEnabled();
  await expect(memoInput).toBeEnabled();

  if ((await amountInput.inputValue()) !== expectedAmount) {
    await amountInput.fill(String(amount));
  }
  if ((await memoInput.inputValue()) !== memo) {
    await memoInput.fill(memo);
  }

  await expect(amountInput).toHaveValue(expectedAmount);
  await expect(memoInput).toHaveValue(memo);
  return { amountInput, memoInput };
}

export async function createBasicTransaction(page, { memo, amount = "12000", flowType = "", ownerless = false }) {
  await openTab(page, "거래");
  const transactionCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "거래 입력" }),
  });
  const transactionFab = page.getByTestId("transactions-fab");
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  let transactionContainer = transactionCard;

  const txToggleButton = transactionCard.getByRole("button", { name: /거래 추가|입력 닫기/ }).first();
  const txToggleVisible = await txToggleButton.isVisible().catch(() => false);
  if (txToggleVisible) {
    const txToggleText = String((await txToggleButton.textContent()) || "");
    if (txToggleText.includes("거래 추가")) {
      await expect(txToggleButton).toBeEnabled();
      await txToggleButton.click();
    }
  } else if (await transactionFab.isVisible().catch(() => false)) {
    await expect(transactionFab).toBeEnabled();
    await transactionFab.click();
    await expect(transactionSheet).toBeVisible();
    transactionContainer = transactionSheet;
  }

  if (flowType) {
    await labeledField(transactionContainer, "유형", "select").selectOption(flowType);
  }

  const ownerSelect = labeledField(transactionContainer, "거래자", "select");
  await ensureTransactionFormValues(transactionContainer, { memo, amount });

  if (ownerless) {
    await ownerSelect.selectOption("");
    await expect(ownerSelect).toHaveValue("");
  } else {
    await selectFirstNonEmptyOption(ownerSelect);
  }

  const majorSelectNew = labeledField(transactionContainer, "카테고리 그룹", "select");
  const hasNewCategoryLabels = (await majorSelectNew.count()) > 0;
  const majorSelect = hasNewCategoryLabels
    ? majorSelectNew
    : labeledField(transactionContainer, "대분류", "select");
  const hasMajor = await selectFirstNonEmptyOption(majorSelect);
  if (hasMajor) {
    const minorSelect = hasNewCategoryLabels
      ? labeledField(transactionContainer, "카테고리", "select")
      : labeledField(transactionContainer, "중분류", "select");
    await selectFirstNonEmptyOption(minorSelect);
  }

  const { amountInput } = await ensureTransactionFormValues(transactionContainer, { memo, amount });
  const amountInputHandle = await amountInput.elementHandle();
  await transactionContainer.getByRole("button", { name: "거래 등록" }).click();
  const validationMessage = amountInputHandle
    ? await amountInputHandle
        .evaluate((element) => (element.isConnected ? element.validationMessage || "" : ""))
        .catch(() => "")
    : "";
  await amountInputHandle?.dispose();
  if (validationMessage) {
    await ensureTransactionFormValues(transactionContainer, { memo, amount });
    await transactionContainer.getByRole("button", { name: "거래 등록" }).click();
  }
  const row = page.locator("tr.transaction-row", { hasText: memo }).first();
  const rowVisible = await row
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!rowVisible) {
    const applyButton = page.getByRole("button", { name: "조회 적용" }).first();
    if ((await applyButton.count()) > 0) {
      await applyButton.click().catch(() => undefined);
      await row.waitFor({ state: "visible", timeout: 20_000 });
    }
  }
  await expect(row).toBeVisible();
  if (txToggleVisible) {
    await expect(txToggleButton).toContainText("거래 추가", { timeout: 20_000 });
    await expect(txToggleButton).toBeEnabled();
  } else if ((await transactionSheet.count()) > 0) {
    await expect(transactionSheet).toBeHidden({ timeout: 20_000 });
  }
  return row;
}

export async function createBasicHolding(page, { name, category = "현금성" }) {
  await openTab(page, "자산");
  const holdingCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "자산 입력" }),
  });
  let holdingContainer = holdingCard;
  const holdingToggleButton = holdingCard.getByRole("button", { name: /자산 추가|입력 닫기/ }).first();
  const holdingToggleVisible = await holdingToggleButton.isVisible().catch(() => false);
  if (holdingToggleVisible) {
    const holdingToggleText = String((await holdingToggleButton.textContent()) || "");
    if (holdingToggleText.includes("자산 추가")) {
      await holdingToggleButton.click();
    }
  }
  const holdingForm = holdingCard.locator("form.holdings-form-grid").first();
  if ((await holdingForm.count()) > 0 && !(await holdingForm.isVisible().catch(() => false))) {
    await holdingToggleButton.click();
  }
  if ((await holdingForm.count()) > 0 && (await holdingForm.isVisible().catch(() => false))) {
    holdingContainer = holdingForm;
  }
  const typeSelect = labeledField(holdingContainer, "유형", "select");
  const hasCashOption = (await typeSelect.locator("option[value='cash']").count()) > 0;
  if (hasCashOption) {
    await typeSelect.selectOption("cash");
  } else {
    await selectFirstNonEmptyOption(typeSelect);
  }
  const holdingNameTextarea = labeledField(holdingContainer, "자산명", "textarea");
  if ((await holdingNameTextarea.count()) > 0) {
    await holdingNameTextarea.fill(name);
  } else {
    await labeledField(holdingContainer, "자산명", "input").fill(name);
  }
  const categoryInput = labeledField(holdingContainer, "카테고리", "input");
  if ((await categoryInput.count()) > 0) {
    await categoryInput.fill(category);
  }
  await labeledField(holdingContainer, "평가금액", "input").fill("300000");

  const ownerSelect = labeledField(holdingContainer, "보유자", "select");
  await selectFirstNonEmptyOption(ownerSelect);

  await holdingContainer.getByRole("button", { name: "자산 등록" }).click();
  const row = page.locator("tr", { hasText: name }).first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await expect(row).toBeVisible();
  return row;
}

export function createImportWorkbook(workbookPath, { txMemo, holdingName, categoryMinor }) {
  const script = `
from datetime import date
import sys
from openpyxl import Workbook

path = sys.argv[1]
tx_memo = sys.argv[2]
holding_name = sys.argv[3]
category_minor = sys.argv[4]

wb = Workbook()
category_ws = wb.active
category_ws.title = "가계부 분류"
category_ws["C5"] = "지출"
category_ws["D5"] = category_minor

month_ws = wb.create_sheet("3")
month_ws["B10"] = date(2026, 3, 12)
month_ws["C10"] = "지출"
month_ws["D10"] = category_minor
month_ws["E10"] = tx_memo
month_ws["F10"] = 43210

cash_ws = wb.create_sheet("3) 저축 및 현금성")
cash_ws["B7"] = "현금성"
cash_ws["C7"] = holding_name
cash_ws["D7"] = "테스트은행"
cash_ws["E7"] = "입출금"
cash_ws["H7"] = 123456

wb.save(path)
`
    .trim();
  execFileSync("uv", ["run", "python", "-c", script, workbookPath, txMemo, holdingName, categoryMinor], {
    stdio: "pipe",
  });
}
