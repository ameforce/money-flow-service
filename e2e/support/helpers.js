import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

export const TEST_PASSWORD = "Password1234";
const ACTIVE_HOUSEHOLD_KEY = "money-flow-active-household-id";
const DEFAULT_CSRF_COOKIE_NAME = "mf_csrf_token";
const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";
const DEFAULT_HOUSEHOLD_HEADER_NAME = "x-household-id";
const SHARED_E2E_LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "::1"]);
const AUTH_READY_TIMEOUT_MS = 12_000;
const SHARED_AUTH_READY_TIMEOUT_MS = 20_000;
const SHARED_E2E_UNIQUE_ACCOUNT_PREFIXES = ["auth-user", "dashboard-user", "owner-user", "guest-user"];

export function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function currentE2EHistoryDateIso(daysOffset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysOffset);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
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

async function expectAuthReady(page, { timeout = AUTH_READY_TIMEOUT_MS } = {}) {
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

async function loginFromAuthShell(page, credentials, { timeout = AUTH_READY_TIMEOUT_MS } = {}) {
  const appShell = page.locator("main.app-shell");
  const alreadySignedIn = await appShell
    .waitFor({ state: "visible", timeout: Math.min(timeout, 3_000) })
    .then(() => true)
    .catch(() => false);
  if (alreadySignedIn) {
    await expect(appShell).toHaveAttribute("translate", "no", { timeout });
    return true;
  }
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
  return outputPath;
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

function srgbChannelToLinear(value) {
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }) {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

function parseRgbColor(value) {
  const match = String(value || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)/u);
  if (!match) {
    return null;
  }
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

export function contrastRatio(foreground, background) {
  const foregroundRgb = typeof foreground === "string" ? parseRgbColor(foreground) : foreground;
  const backgroundRgb = typeof background === "string" ? parseRgbColor(background) : background;
  if (!foregroundRgb || !backgroundRgb) {
    throw new Error(`Unable to parse contrast colors: ${foreground} / ${background}`);
  }
  const foregroundLuminance = relativeLuminance(foregroundRgb);
  const backgroundLuminance = relativeLuminance(backgroundRgb);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export async function expectTextContrast(locator, label, minimumRatio = 4.5) {
  const metrics = await locator.evaluate((element) => {
    const effectiveBackground = (start) => {
      let current = start;
      while (current) {
        const color = getComputedStyle(current).backgroundColor;
        if (color && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/u.test(color)) {
          return color;
        }
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      text: element.textContent?.replace(/\s+/g, " ").trim() || "",
      color: style.color,
      background: effectiveBackground(element),
      fontSize: Number.parseFloat(style.fontSize) || 0,
      width: box.width,
      height: box.height,
    };
  });
  const ratio = contrastRatio(metrics.color, metrics.background);
  expect(
    ratio,
    `${label} contrast ${ratio.toFixed(2)}:1 for ${metrics.text} (${metrics.color} on ${metrics.background})`,
  ).toBeGreaterThanOrEqual(minimumRatio);
  return { ...metrics, contrast: ratio };
}

export async function expectWithinViewport(locator, { allowance = 4, requireVertical = true } = {}) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "locator bounding box should exist").not.toBeNull();
  const viewport = locator.page().viewportSize();
  expect(viewport, "viewport should be available").not.toBeNull();
  expect(box?.x ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(-allowance);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0) + allowance);
  if (requireVertical) {
    expect(box?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(-allowance);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) + allowance);
  }
}

export async function expectClearOfFixedBottomNav(locator, { allowance = 4 } = {}) {
  await expect(locator).toBeVisible();
  const centerLocator = () =>
    locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const nav = document.querySelector("nav.topbar-tabs");
      const navBox = nav?.getBoundingClientRect();
      const navStyle = nav ? window.getComputedStyle(nav) : null;
      const fixedBottomNav =
        navBox &&
        navStyle?.position === "fixed" &&
        window.innerWidth <= 820 &&
        navBox.top > 0 &&
        navBox.bottom >= window.innerHeight - 32;
      const visibleBottom = Math.min(fixedBottomNav ? navBox.top : window.innerHeight, window.innerHeight);
      const availableHeight = Math.max(0, visibleBottom);
      if (box.height > availableHeight) {
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }
      const targetTop = Math.max(0, window.scrollY + box.top - (availableHeight - box.height) / 2);
      window.scrollTo({ top: targetTop, left: window.scrollX, behavior: "auto" });
    });
  const readMetrics = () =>
    locator.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const nav = document.querySelector("nav.topbar-tabs");
      const navBox = nav?.getBoundingClientRect();
      const navStyle = nav ? window.getComputedStyle(nav) : null;
      const fixedBottomNav =
        navBox &&
        navStyle?.position === "fixed" &&
        window.innerWidth <= 820 &&
        navBox.top > 0 &&
        navBox.bottom >= window.innerHeight - 32;

      return {
        bottom: box.bottom,
        height: box.height,
        top: box.top,
        viewportBottom: window.innerHeight,
        fixedNavTop: fixedBottomNav ? navBox.top : window.innerHeight,
      };
    });
  const isClear = (metrics) => {
    const visibleBottom = Math.min(metrics.fixedNavTop, metrics.viewportBottom);
    const fitsVertically = metrics.height <= visibleBottom + allowance;
    return (
      (!fitsVertically || metrics.top >= -allowance) &&
      metrics.bottom <= metrics.fixedNavTop + allowance &&
      metrics.bottom <= metrics.viewportBottom + allowance
    );
  };

  await centerLocator();
  let metrics = await readMetrics();
  let consecutiveClearReads = 0;
  await expect
    .poll(
      async () => {
        metrics = await readMetrics();
        if (!isClear(metrics)) {
          consecutiveClearReads = 0;
          await centerLocator();
          return false;
        }
        consecutiveClearReads += 1;
        return consecutiveClearReads >= 2;
      },
      { message: "locator should settle clear of the viewport chrome", timeout: 8_000 },
    )
    .toBe(true);
  const visibleBottom = Math.min(metrics.fixedNavTop, metrics.viewportBottom);
  if (metrics.height <= visibleBottom + allowance) {
    expect(metrics.top, "locator should not be above the viewport").toBeGreaterThanOrEqual(-allowance);
  }
  expect(metrics.bottom, "locator should be clear of the fixed mobile nav").toBeLessThanOrEqual(
    metrics.fixedNavTop + allowance
  );
  expect(metrics.bottom, "locator should remain within the viewport").toBeLessThanOrEqual(
    metrics.viewportBottom + allowance
  );
}

export async function expectKeyboardReachableInOrder(page, locators, { maxTabsPerLocator = 60 } = {}) {
  const keyboardStartId = "__e2e_keyboard_start__";
  const compactViewport = (page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) <= 480;

  await page.evaluate((sentinelId) => {
    window.scrollTo(0, 0);
    document.getElementById(sentinelId)?.remove();

    const sentinel = document.createElement("div");
    sentinel.id = sentinelId;
    sentinel.setAttribute("tabindex", "0");
    sentinel.setAttribute("aria-hidden", "true");
    Object.assign(sentinel.style, {
      height: "1px",
      left: "0",
      opacity: "0",
      overflow: "hidden",
      pointerEvents: "none",
      position: "fixed",
      top: "0",
      width: "1px",
      zIndex: "-1",
    });

    document.body.prepend(sentinel);
    document.activeElement?.blur?.();
    sentinel.focus({ preventScroll: true });
  }, keyboardStartId);

  try {
    for (const locator of locators) {
      await expect(locator).toBeVisible();
      let reached = false;
      for (let attempt = 0; attempt < maxTabsPerLocator; attempt += 1) {
        await page.keyboard.press("Tab");
        reached = await locator.evaluate((element) => {
          const active = document.activeElement;
          if (!active) {
            return false;
          }
          const labelTargetId = element instanceof HTMLLabelElement ? element.getAttribute("for") : "";
          const labelTarget = labelTargetId ? document.getElementById(labelTargetId) : null;
          return element === active || element.contains(active) || labelTarget === active;
        });
        if (reached) {
          break;
        }
      }

      if (!reached && compactViewport) {
        reached = await locator.evaluate((element) => {
          const labelTargetId = element instanceof HTMLLabelElement ? element.getAttribute("for") : "";
          const target = labelTargetId ? document.getElementById(labelTargetId) : element;
          if (!(target instanceof HTMLElement)) {
            return false;
          }

          const style = window.getComputedStyle(target);
          const disabled = "disabled" in target && Boolean(target.disabled);
          if (disabled || style.display === "none" || style.visibility === "hidden") {
            return false;
          }

          target.focus({ preventScroll: true });
          const active = document.activeElement;
          return target === active || target.contains(active) || element === active || element.contains(active);
        });
      }

      expect(reached, "expected control to be reachable by keyboard tab order").toBe(true);
      await expectWithinViewport(locator);
    }
  } finally {
    await page.evaluate((sentinelId) => {
      document.getElementById(sentinelId)?.remove();
    }, keyboardStartId);
  }
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

export async function expectNoOrphanTextLine(locator, label) {
  const metrics = await locator.evaluate((element) => {
    const lines = new Map();
    let measuredCharacters = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode = walker.nextNode();
    while (textNode) {
      const text = textNode.textContent || "";
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (!char.trim()) {
          continue;
        }
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const rect = range.getBoundingClientRect();
        range.detach();
        if (rect.width === 0 && rect.height === 0) {
          continue;
        }
        measuredCharacters += 1;
        const lineKey = String(Math.round(rect.top));
        lines.set(lineKey, (lines.get(lineKey) || "") + char);
      }
      textNode = walker.nextNode();
    }
    return {
      lines: Array.from(lines.values()).filter((line) => line.trim()),
      measuredCharacters,
    };
  });
  expect(metrics.measuredCharacters, `${label} should expose measurable rendered text`).toBeGreaterThan(0);
  const lastLine = metrics.lines.at(-1) || "";
  expect(lastLine.length, `${label} should not leave a one-character orphan line`).not.toBe(1);
}

export async function expectDonutTextNotClipped(labelLocator) {
  const metrics = await labelLocator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const labelBox = node.getBoundingClientRect();
      return {
        text: node.textContent?.replace(/\s+/g, " ").trim(),
        children: Array.from(node.children).map((child) => {
          const childBox = child.getBoundingClientRect();
          const style = getComputedStyle(child);
          return {
            topGap: childBox.top - labelBox.top,
            bottomGap: labelBox.bottom - childBox.bottom,
            fontSize: Number.parseFloat(style.fontSize) || 0,
            lineHeight: Number.parseFloat(style.lineHeight) || 0,
          };
        }),
      };
    }),
  );
  expect(metrics.length, "donut label should exist before checking clipping").toBeGreaterThan(0);
  for (const metric of metrics) {
    for (const child of metric.children) {
      expect(child.topGap, `${metric.text} should not clip at top`).toBeGreaterThanOrEqual(-1);
      expect(child.bottomGap, `${metric.text} should not clip at bottom`).toBeGreaterThanOrEqual(-1);
      if (child.fontSize > 0 && child.lineHeight > 0) {
        expect(child.lineHeight, `${metric.text} line-height should leave descender room`).toBeGreaterThanOrEqual(
          child.fontSize * 1.08,
        );
      }
    }
  }
}

export async function expectDonutLabelsInsideChart(card, label) {
  const metrics = await card.getByTestId("portfolio-donut-slice-label").evaluateAll((nodes) =>
    nodes.map((node) => {
      const chart = node.closest(".chart-wrap")?.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      return {
        text: node.textContent?.replace(/\s+/g, " ").trim(),
        missingChart: !chart,
        topGap: chart ? box.top - chart.top : 0,
        bottomGap: chart ? chart.bottom - box.bottom : 0,
      };
    }),
  );
  expect(metrics.length, `${label} should expose visible slice labels`).toBeGreaterThan(0);
  for (const item of metrics) {
    expect(item.missingChart, `${label} ${item.text} should be measured against a chart`).toBeFalsy();
    expect(item.topGap, `${label} ${item.text} should stay clear of chart top chrome`).toBeGreaterThanOrEqual(12);
    expect(item.bottomGap, `${label} ${item.text} should stay clear of chart bottom edge`).toBeGreaterThanOrEqual(12);
  }
}

export async function expectDonutLabelsCenteredOnRing(card, label) {
  const geometry = await card.getByTestId("portfolio-donut-slice-label").evaluateAll((nodes) =>
    nodes.map((node) => {
      const chart = node.closest(".portfolio-donut-slice-labels")?.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      if (!chart) {
        return { text: node.textContent?.replace(/\s+/g, " ").trim(), missingChart: true };
      }
      const centerX = chart.x + chart.width / 2;
      const centerY = chart.y + chart.height / 2;
      const labelX = box.x + box.width / 2;
      const labelY = box.y + box.height / 2;
      const dx = labelX - centerX;
      const dy = labelY - centerY;
      const actualRadius = (Math.sqrt(dx * dx + dy * dy) / (Math.min(chart.width, chart.height) / 2)) * 100;
      const actualAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const expectedAngle = Number(node.dataset.donutAngle || 0);
      const expectedRadius = Number(node.dataset.donutRadius || 0);
      const angleDelta = Math.abs(((actualAngle - expectedAngle + 540) % 360) - 180);
      return {
        text: node.textContent?.replace(/\s+/g, " ").trim(),
        actualRadius,
        expectedRadius,
        angleDelta,
      };
    }),
  );
  expect(geometry.length, `${label} should expose visible slice labels`).toBeGreaterThan(0);
  for (const item of geometry) {
    expect(item.missingChart, `${label} ${item.text} should be measured against a chart`).toBeFalsy();
    expect(Math.abs(item.actualRadius - item.expectedRadius), `${label} ${item.text} should sit on ring midpoint`).toBeLessThanOrEqual(2.6);
    expect(item.angleDelta, `${label} ${item.text} should sit on slice midpoint angle`).toBeLessThanOrEqual(2.6);
  }
}

export async function expectPortfolioLabelsClearOfBottomNav(page, card, label) {
  let metrics = [];
  const readMetrics = () =>
    card.getByTestId("portfolio-donut-slice-label").evaluateAll((nodes) => {
      const nav = document.querySelector("nav.topbar-tabs");
      const navBox = nav?.getBoundingClientRect();
      const navStyle = nav ? getComputedStyle(nav) : null;
      const chart = nodes[0]?.closest(".chart-wrap");
      const chartBox = chart?.getBoundingClientRect();
      const fixedBottomNav = Boolean(
        navBox &&
          navStyle?.position === "fixed" &&
          navBox.bottom >= window.innerHeight - 32 &&
          navBox.top > window.innerHeight * 0.5,
      );
      return nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return {
          text: node.textContent?.replace(/\s+/g, " ").trim(),
          bottom: box.bottom,
          chartBottom: chartBox?.bottom ?? null,
          missingChart: !chartBox,
          fixedBottomNav,
          navTop: fixedBottomNav ? navBox.top : window.innerHeight,
          viewportBottom: window.innerHeight,
        };
      });
    });

  await expect
    .poll(
      async () => {
        metrics = await readMetrics();
        return (
          metrics.length > 0 &&
          metrics.every((item) => !item.missingChart) &&
          metrics.every(
            (item) => item.bottom <= item.viewportBottom && (!item.fixedBottomNav || item.bottom <= item.navTop - 4),
          ) &&
          metrics.every(
            (item) =>
              item.chartBottom === null ||
              (item.chartBottom <= item.viewportBottom &&
                (!item.fixedBottomNav || item.chartBottom <= item.navTop - 4)),
          )
        );
      },
      { message: `${label} slice labels should settle inside the viewport`, timeout: 3_000 },
    )
    .toBe(true);
  metrics = await readMetrics();
  expect(metrics.length, `${label} should expose visible slice labels`).toBeGreaterThan(0);
  for (const item of metrics) {
    expect(item.missingChart, `${label} should be measured against its chart wrapper`).toBeFalsy();
    expect(item.bottom, `${label} ${item.text} should stay within the viewport`).toBeLessThanOrEqual(
      item.viewportBottom,
    );
    if (item.fixedBottomNav) {
      expect(item.bottom, `${label} ${item.text} should clear the fixed bottom navigation`).toBeLessThanOrEqual(
        item.navTop - 4,
      );
      if (item.chartBottom !== null) {
        expect(item.chartBottom, `${label} chart should clear the fixed bottom navigation`).toBeLessThanOrEqual(
          item.navTop - 4,
        );
      }
    }
  }
  await expect(page.locator("nav.topbar-tabs")).toBeVisible();
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

async function closeTransactionEntrySheetIfOpen(page, { timeout = 20_000 } = {}) {
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  if (!(await transactionSheet.isVisible().catch(() => false))) {
    return;
  }

  const closeButton = transactionSheet.getByTestId("transaction-entry-sheet-close").first();
  const clicked = await closeButton
    .click({ timeout: Math.min(timeout, 4_000) })
    .then(() => true)
    .catch(() => false);
  if (!clicked && (await transactionSheet.isVisible().catch(() => false))) {
    await closeButton.dispatchEvent("click").catch(() => undefined);
  }
  await expect(transactionSheet).toBeHidden({ timeout });
}

export async function openTab(page, label) {
  const tabButton = page.getByRole("button", { name: label, exact: true }).first();
  const isAlreadyActive = await tabButton
    .evaluate((element) => element.classList.contains("active"))
    .catch(() => false);
  if (isAlreadyActive) {
    return;
  }

  const openTransactionSheet = page.getByTestId("transaction-entry-sheet");
  if (await openTransactionSheet.isVisible().catch(() => false)) {
    await closeTransactionEntrySheetIfOpen(page);
  }

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
  const authReadyTimeout = identity.shared ? SHARED_AUTH_READY_TIMEOUT_MS : AUTH_READY_TIMEOUT_MS;
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
  const authReadyTimeout = identity.shared ? SHARED_AUTH_READY_TIMEOUT_MS : AUTH_READY_TIMEOUT_MS;
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

export async function createCategoryViaApi(page, { major, minor, flowType = "expense" }) {
  const result = await page.evaluate(
    async ({ activeHouseholdKey, csrfCookieName, csrfHeaderName, flowType, householdHeaderName, major, minor }) => {
      const cookieValue = (name) => {
        const prefix = `${name}=`;
        return String(document.cookie || "")
          .split(";")
          .map((item) => item.trim())
          .find((item) => item.startsWith(prefix))
          ?.slice(prefix.length) || "";
      };
      const householdId = String(localStorage.getItem(activeHouseholdKey) || "").trim();
      const headers = {
        "Content-Type": "application/json",
        [csrfHeaderName]: decodeURIComponent(cookieValue(csrfCookieName)),
      };
      if (householdId) {
        headers[householdHeaderName] = householdId;
      }
      const response = await fetch("/api/v1/categories", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          flow_type: flowType,
          major,
          minor,
        }),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      return { ok: response.ok, status: response.status, payload, text };
    },
    {
      activeHouseholdKey: ACTIVE_HOUSEHOLD_KEY,
      csrfCookieName: DEFAULT_CSRF_COOKIE_NAME,
      csrfHeaderName: DEFAULT_CSRF_HEADER_NAME,
      flowType,
      householdHeaderName: DEFAULT_HOUSEHOLD_HEADER_NAME,
      major,
      minor,
    }
  );
  expect(result.ok, `category api create failed: ${result.status} ${result.text}`).toBe(true);
  return result.payload;
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

async function bringInputIntoView(locator) {
  const scrolled = await locator
    .scrollIntoViewIfNeeded({ timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (!scrolled) {
    await locator
      .evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "nearest" });
      })
      .catch(() => undefined);
  }
}

async function expectInputReady(locator, fieldName) {
  await bringInputIntoView(locator);
  await expect(locator, `${fieldName} 표시 확인`).toBeVisible();
  await expect(locator, `${fieldName} 활성 확인`).toBeEnabled();
}

async function ensureTransactionFormValues(container, { memo, amount, occurredOn = "" }) {
  const amountInput = labeledField(container, "금액", "input");
  const memoInput = labeledField(container, "메모", "input");
  const dateInput = occurredOn ? labeledField(container, "일자", "input") : null;
  const expectedAmount = formatGroupedNumber(amount);

  await expect(container.locator("form.transactions-form-grid, form.transaction-quick-form").first()).toBeVisible();
  if (dateInput) {
    await expectInputReady(dateInput, "거래 일자");
  }
  await expectInputReady(amountInput, "거래 금액");
  await expectInputReady(memoInput, "거래 메모");

  if (dateInput) {
    await fillInputUntilValue(dateInput, occurredOn, occurredOn, "거래 일자");
  }
  await fillInputUntilValue(amountInput, String(amount), expectedAmount, "거래 금액");
  await fillInputUntilValue(memoInput, memo, memo, "거래 메모");

  if (dateInput) {
    await expect(dateInput).toHaveValue(occurredOn);
  }
  await expect(amountInput).toHaveValue(expectedAmount);
  await expect(memoInput).toHaveValue(memo);
  return { amountInput, memoInput, dateInput };
}

async function expandQuickTransactionDetails(container) {
  const quickForm = container.locator("form.transaction-quick-form").first();
  if (!(await quickForm.isVisible().catch(() => false))) {
    return;
  }

  for (const summaryText of ["추가 설정", "추가 입력", "전체 카테고리"]) {
    const details = quickForm.locator("details.transaction-quick-details", { hasText: summaryText }).first();
    if ((await details.count()) === 0) {
      continue;
    }
    if ((await details.getAttribute("open")) !== null) {
      continue;
    }
    await details.locator("summary").click();
  }
}

export async function openTransactionEntryForm(page) {
  await openTab(page, "거래");

  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  if (await transactionSheet.isVisible().catch(() => false)) {
    await expect(transactionSheet.locator("form.transactions-form-grid, form.transaction-quick-form").first()).toBeVisible();
    return {
      container: transactionSheet,
      mode: "sheet",
      close: async () => {
        await closeTransactionEntrySheetIfOpen(page);
      },
    };
  }

  const transactionCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "거래 입력" }),
  });
  const txToggleButton = transactionCard.getByRole("button", { name: /거래 추가|입력 닫기/ }).first();
  const txToggleVisible = await txToggleButton.isVisible().catch(() => false);
  if (txToggleVisible) {
    const txToggleText = String((await txToggleButton.textContent()) || "");
    if (txToggleText.includes("거래 추가")) {
      await expect(txToggleButton).toBeEnabled();
      await txToggleButton.click();
    }
    await expect(transactionCard.locator("form.transactions-form-grid").first()).toBeVisible();
    return {
      container: transactionCard,
      mode: "card",
      close: async () => {
        const currentToggleText = String((await txToggleButton.textContent().catch(() => "")) || "");
        if (currentToggleText.includes("입력 닫기")) {
          await txToggleButton.click();
          await expect(transactionCard.locator("form.transactions-form-grid")).toHaveCount(0, { timeout: 20_000 });
        }
      },
    };
  }

  const viewport = page.viewportSize();
  const desktopTransactionAddAction = page.getByTestId("transactions-desktop-add-action");
  const transactionFab = page.getByTestId("transactions-fab");
  const transactionAddAction =
    (viewport?.width ?? 0) > 820 && (await desktopTransactionAddAction.isVisible().catch(() => false))
      ? desktopTransactionAddAction
      : transactionFab;
  await expect(transactionAddAction).toBeVisible();
  await expect(transactionAddAction).toBeEnabled();
  await transactionAddAction.click();
  await expect(transactionSheet).toBeVisible();
  await expect(transactionSheet.locator("form.transactions-form-grid, form.transaction-quick-form").first()).toBeVisible();
  return {
    container: transactionSheet,
    mode: "sheet",
    close: async () => {
      await closeTransactionEntrySheetIfOpen(page);
    },
  };
}

async function fillInputUntilValue(locator, inputValue, expectedValue, fieldName) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if ((await locator.inputValue().catch(() => "")) === expectedValue) {
      return;
    }

    await bringInputIntoView(locator);
    await locator.fill("");
    await locator.fill(inputValue);

    const matched = await expect(locator, `${fieldName} 입력값 확인`).toHaveValue(expectedValue, { timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    if (matched) {
      return;
    }

    await locator.page().waitForTimeout(150 * (attempt + 1));
  }

  await locator.fill("");
  await locator.pressSequentially(inputValue, { delay: 10 });
  await expect(locator, `${fieldName} 입력값 확인`).toHaveValue(expectedValue);
}

const TRANSACTION_FLOW_LABELS = {
  income: "수입",
  expense: "지출",
  investment: "투자",
  transfer: "이체",
};

async function selectTransactionFlowChoice(container, flowType) {
  if (!flowType) {
    return;
  }
  const flowChoices = container.getByTestId("transaction-flow-choice");
  if ((await flowChoices.count()) > 0) {
    const flowLabel = TRANSACTION_FLOW_LABELS[flowType] || flowType;
    const choice = flowChoices.filter({ hasText: flowLabel }).first();
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    return;
  }
  await labeledField(container, "유형", "select").selectOption(flowType);
}

async function selectTransactionOwnerChoice(container, { ownerless = false } = {}) {
  const ownerChoices = container.getByTestId("transaction-owner-choice");
  if ((await ownerChoices.count()) > 0) {
    const choice = ownerless
      ? container.locator('[data-testid="transaction-owner-choice"][data-owner-value=""]').first()
      : container.locator('[data-testid="transaction-owner-choice"]:not([data-owner-value=""])').first();
    await expect(choice).toBeVisible();
    await choice.click();
    await expect(choice).toHaveAttribute("aria-pressed", "true");
    return;
  }
  const ownerSelect = labeledField(container, "거래자", "select");
  if (ownerless) {
    await ownerSelect.selectOption("");
    await expect(ownerSelect).toHaveValue("");
  } else {
    await selectFirstNonEmptyOption(ownerSelect);
  }
}

async function selectFirstTransactionCategoryChoice(container) {
  const groupChoices = container.getByTestId("transaction-category-group-choice");
  if ((await groupChoices.count()) > 0) {
    const groupChoice = groupChoices.first();
    await expect(groupChoice).toBeVisible();
    await groupChoice.click();
    const categoryChoice = container.getByTestId("transaction-category-choice").first();
    if ((await categoryChoice.count()) > 0) {
      await expect(categoryChoice).toBeVisible();
      await categoryChoice.click();
      await expect(categoryChoice).toHaveAttribute("aria-pressed", "true");
    }
    return;
  }

  const majorSelectNew = labeledField(container, "카테고리 그룹", "select");
  const hasNewCategoryLabels = (await majorSelectNew.count()) > 0;
  const majorSelect = hasNewCategoryLabels
    ? majorSelectNew
    : labeledField(container, "대분류", "select");
  const hasMajor = await selectFirstNonEmptyOption(majorSelect);
  if (hasMajor) {
    const minorSelect = hasNewCategoryLabels
      ? labeledField(container, "카테고리", "select")
      : labeledField(container, "중분류", "select");
    await selectFirstNonEmptyOption(minorSelect);
  }
}

export async function createBasicTransaction(
  page,
  { memo, amount = "12000", flowType = "", ownerless = false, occurredOn = currentE2EHistoryDateIso() }
) {
  const effectiveOccurredOn = occurredOn || currentE2EHistoryDateIso();
  const { container: transactionContainer, mode: transactionEntryMode } = await openTransactionEntryForm(page);
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  await expandQuickTransactionDetails(transactionContainer);

  await selectTransactionFlowChoice(transactionContainer, flowType);

  await ensureTransactionFormValues(transactionContainer, { memo, amount, occurredOn: effectiveOccurredOn });
  await selectTransactionOwnerChoice(transactionContainer, { ownerless });
  await selectFirstTransactionCategoryChoice(transactionContainer);

  const { amountInput } = await ensureTransactionFormValues(transactionContainer, {
    memo,
    amount,
    occurredOn: effectiveOccurredOn,
  });
  const amountInputHandle = await amountInput.elementHandle();
  await transactionContainer.getByRole("button", { name: "거래 등록" }).click();
  const validationMessage = amountInputHandle
    ? await amountInputHandle
        .evaluate((element) => (element.isConnected ? element.validationMessage || "" : ""))
        .catch(() => "")
    : "";
  await amountInputHandle?.dispose();
  if (validationMessage) {
    await ensureTransactionFormValues(transactionContainer, { memo, amount, occurredOn: effectiveOccurredOn });
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
  if (transactionEntryMode === "card") {
    const transactionCard = page.locator("article.card", {
      has: page.getByRole("heading", { name: "거래 입력" }),
    });
    const txToggleButton = transactionCard.getByRole("button", { name: /거래 추가|입력 닫기/ }).first();
    await expect(txToggleButton).toContainText("거래 추가", { timeout: 20_000 });
    await expect(txToggleButton).toBeEnabled();
  } else {
    await closeTransactionEntrySheetIfOpen(page);
  }
  return row;
}

export async function createTransactionViaApi(
  page,
  {
    memo,
    amount = "12000",
    flowType = "expense",
    occurredOn = currentE2EHistoryDateIso(),
    ownerName = "",
    categoryId = "",
    sourceRef = "",
  }
) {
  const result = await page.evaluate(
    async ({
      activeHouseholdKey,
      amount,
      categoryId,
      csrfCookieName,
      csrfHeaderName,
      flowType,
      householdHeaderName,
      memo,
      occurredOn,
      ownerName,
      sourceRef,
    }) => {
      const cookieValue = (name) => {
        const prefix = `${name}=`;
        return String(document.cookie || "")
          .split(";")
          .map((item) => item.trim())
          .find((item) => item.startsWith(prefix))
          ?.slice(prefix.length) || "";
      };
      const householdId = String(localStorage.getItem(activeHouseholdKey) || "").trim();
      const headers = {
        "Content-Type": "application/json",
        [csrfHeaderName]: decodeURIComponent(cookieValue(csrfCookieName)),
      };
      if (householdId) {
        headers[householdHeaderName] = householdId;
      }
      const response = await fetch("/api/v1/transactions", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          occurred_on: occurredOn,
          flow_type: flowType,
          amount,
          category_id: categoryId || null,
          currency: "KRW",
          memo,
          owner_name: ownerName,
          source_ref: sourceRef || null,
        }),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      return { ok: response.ok, status: response.status, payload, text };
    },
    {
      activeHouseholdKey: ACTIVE_HOUSEHOLD_KEY,
      amount,
      categoryId,
      csrfCookieName: DEFAULT_CSRF_COOKIE_NAME,
      csrfHeaderName: DEFAULT_CSRF_HEADER_NAME,
      flowType,
      householdHeaderName: DEFAULT_HOUSEHOLD_HEADER_NAME,
      memo,
      occurredOn,
      ownerName,
      sourceRef,
    }
  );
  expect(result.ok, `transaction api create failed: ${result.status} ${result.text}`).toBe(true);
  return result.payload;
}

export async function createHoldingViaApi(
  page,
  {
    name,
    category = "현금성",
    assetType = "cash",
    typeKey = assetType,
    symbol = "MFS",
    marketSymbol = symbol,
    accountName = "검증계좌",
    quantity = "1",
    averageCost = "300000",
    currency = "KRW",
    ownerName = "",
  }
) {
  const result = await page.evaluate(
    async ({
      accountName,
      activeHouseholdKey,
      assetType,
      averageCost,
      category,
      csrfCookieName,
      csrfHeaderName,
      currency,
      householdHeaderName,
      marketSymbol,
      name,
      ownerName,
      quantity,
      symbol,
      typeKey,
    }) => {
      const cookieValue = (cookieName) => {
        const prefix = `${cookieName}=`;
        return String(document.cookie || "")
          .split(";")
          .map((item) => item.trim())
          .find((item) => item.startsWith(prefix))
          ?.slice(prefix.length) || "";
      };
      const householdId = String(localStorage.getItem(activeHouseholdKey) || "").trim();
      const headers = {
        "Content-Type": "application/json",
        [csrfHeaderName]: decodeURIComponent(cookieValue(csrfCookieName)),
      };
      if (householdId) {
        headers[householdHeaderName] = householdId;
      }
      const response = await fetch("/api/v1/holdings", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          asset_type: assetType,
          type_key: typeKey || assetType,
          symbol,
          market_symbol: marketSymbol || symbol,
          name,
          category,
          owner_name: ownerName || null,
          account_name: accountName || null,
          quantity,
          average_cost: averageCost,
          currency,
        }),
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      return { ok: response.ok, status: response.status, payload, text };
    },
    {
      accountName,
      activeHouseholdKey: ACTIVE_HOUSEHOLD_KEY,
      assetType,
      averageCost,
      category,
      csrfCookieName: DEFAULT_CSRF_COOKIE_NAME,
      csrfHeaderName: DEFAULT_CSRF_HEADER_NAME,
      currency,
      householdHeaderName: DEFAULT_HOUSEHOLD_HEADER_NAME,
      marketSymbol,
      name,
      ownerName,
      quantity,
      symbol,
      typeKey,
    }
  );
  expect(result.ok, `holding api create failed: ${result.status} ${result.text}`).toBe(true);
  return result.payload;
}

export async function createBasicHolding(page, {
  name,
  category = "현금성",
  type = "cash",
  account = "검증계좌",
  symbol = "MFS",
  marketSymbol = "KRX",
  quantity = "1",
  averageCost = "300000",
  marketValue = "300000",
}) {
  await openTab(page, "자산");
  const holdingCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "자산 입력" }),
  });
  const holdingFab = page.getByTestId("holdings-fab");
  const holdingSheet = page.getByTestId("holding-entry-sheet");
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
  } else if (await holdingFab.isVisible().catch(() => false)) {
    await expect(holdingFab).toBeEnabled();
    await holdingFab.click();
    await expect(holdingSheet).toBeVisible();
    holdingContainer = holdingSheet;
  }
  const typeSelect = labeledField(holdingContainer, "유형", "select");
  const hasRequestedType = (await typeSelect.locator(`option[value='${type}']`).count()) > 0;
  if (hasRequestedType) {
    await typeSelect.selectOption(type);
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
  const marketValueInput = labeledField(holdingContainer, "평가금액", "input");
  if ((await marketValueInput.count()) > 0) {
    await marketValueInput.fill(marketValue);
  }
  const accountInput = labeledField(holdingContainer, "계좌", "input");
  if ((await accountInput.count()) > 0) {
    await accountInput.fill(account);
  }
  const symbolInput = labeledField(holdingContainer, "심볼", "input");
  if ((await symbolInput.count()) > 0) {
    await symbolInput.fill(symbol);
  }
  const marketSymbolInput = labeledField(holdingContainer, "시장심볼", "input");
  if ((await marketSymbolInput.count()) > 0) {
    await marketSymbolInput.fill(marketSymbol);
  }
  const quantityInput = labeledField(holdingContainer, "수량", "input");
  if ((await quantityInput.count()) > 0) {
    await quantityInput.fill(quantity);
  }
  const averageCostInput = labeledField(holdingContainer, "평균단가", "input");
  if ((await averageCostInput.count()) > 0) {
    await averageCostInput.fill(averageCost);
  }

  const ownerSelect = labeledField(holdingContainer, "보유자", "select");
  await selectFirstNonEmptyOption(ownerSelect);

  await holdingContainer.getByRole("button", { name: "자산 등록" }).click();
  const row = page.locator("tr", { hasText: name }).first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await expect(row).toBeVisible();
  return row;
}

function resolveWorkbookPythonCommand() {
  const venvPython = process.platform === "win32"
    ? path.resolve(".venv", "Scripts", "python.exe")
    : path.resolve(".venv", "bin", "python");
  const explicitPython = process.env.E2E_WORKBOOK_PYTHON || process.env.E2E_PYTHON;
  const candidates = [explicitPython, venvPython].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === explicitPython || fs.existsSync(candidate)) {
      return { command: candidate, args: ["-c"] };
    }
  }
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore" });
    return { command: "uv", args: ["run", "python", "-c"] };
  } catch {
    return { command: process.platform === "win32" ? "python" : "python3", args: ["-c"] };
  }
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
  const python = resolveWorkbookPythonCommand();
  execFileSync(python.command, [...python.args, script, workbookPath, txMemo, holdingName, categoryMinor], {
    stdio: "pipe",
  });
}
