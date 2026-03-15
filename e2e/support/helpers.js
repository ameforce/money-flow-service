import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect } from "@playwright/test";

export const TEST_PASSWORD = "Password1234";

export function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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
  await page.screenshot({
    path: path.join(screenshotDir, `${Date.now()}-${name}.png`),
    fullPage: true,
  });
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
  await page.getByRole("button", { name: label, exact: true }).click();
}

export async function login(page, { email, password = TEST_PASSWORD }) {
  await page.goto("/");
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "로그인하기" }).click();
  await expect(page.locator("main.app-shell")).toHaveAttribute("translate", "no");
}

export async function logout(page) {
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.locator("form.auth-card")).toBeVisible();
  await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
}

export async function registerAndVerify(page, { email, password = TEST_PASSWORD, displayName }) {
  await page.goto("/");
  await page.getByRole("button", { name: "회원가입" }).click();
  await page.getByLabel("이메일", { exact: true }).fill(email);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByLabel("본명").fill(displayName);
  await page.getByRole("button", { name: "회원가입하고 시작" }).click();

  const appShell = page.locator("main.app-shell");
  const verifyTokenInput = page.getByLabel("인증 토큰");
  const signedInDirectly = await appShell
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (signedInDirectly) {
    await expect(appShell).toHaveAttribute("translate", "no");
    return;
  }

  await expect(verifyTokenInput).toBeVisible();
  await expect(verifyTokenInput).not.toHaveValue("");
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByLabel("비밀번호 확인").fill(password);
  await page.getByRole("button", { name: "이메일 인증 완료" }).click();
  await expect(appShell).toHaveAttribute("translate", "no");
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

export async function createBasicTransaction(page, { memo, amount = "12000" }) {
  await openTab(page, "거래");
  const transactionCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "거래 입력" }),
  });

  await labeledField(transactionCard, "금액", "input").fill(amount);
  await labeledField(transactionCard, "메모", "input").fill(memo);

  const ownerSelect = labeledField(transactionCard, "거래자", "select");
  await selectFirstNonEmptyOption(ownerSelect);

  const majorSelect = labeledField(transactionCard, "대분류", "select");
  const hasMajor = await selectFirstNonEmptyOption(majorSelect);
  if (hasMajor) {
    const minorSelect = labeledField(transactionCard, "중분류", "select");
    await selectFirstNonEmptyOption(minorSelect);
  }

  await transactionCard.getByRole("button", { name: "거래 등록" }).click();
  const row = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(row).toBeVisible();
  return row;
}

export async function createBasicHolding(page, { name }) {
  await openTab(page, "자산");
  const holdingCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "자산 입력" }),
  });
  await labeledField(holdingCard, "유형", "select").selectOption("cash");
  await labeledField(holdingCard, "자산명", "input").fill(name);
  await labeledField(holdingCard, "카테고리", "input").fill("현금성");
  await labeledField(holdingCard, "평가금액", "input").fill("300000");

  const ownerSelect = labeledField(holdingCard, "보유자", "select");
  await selectFirstNonEmptyOption(ownerSelect);

  await holdingCard.getByRole("button", { name: "자산 등록" }).click();
  const row = page.locator("tr", { hasText: name }).first();
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
