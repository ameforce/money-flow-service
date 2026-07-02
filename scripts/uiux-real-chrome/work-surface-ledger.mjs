import { delay } from "./app-runtime.mjs";
import { openRequestedTab, tryRegisterDashboard } from "./browser-session.mjs";
import { seedWorkSurfaceLedgerFixtures } from "./fixtures.mjs";
import { withBrowserEvidence } from "./scenario-runtime.mjs";

async function installWorkSurfaceMetricsScript(page) {
  await page.addInitScript(() => {
    window.__mfReadWorkSurfaceMetricsScript = () => {
      const boxOf = (element) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        const topElement =
          centerX >= 0 && centerX <= window.innerWidth && centerY >= 0 && centerY <= window.innerHeight
            ? document.elementFromPoint(centerX, centerY)
            : null;
        return {
          bottom: box.bottom,
          display: style.display,
          height: box.height,
          hitVisible: Boolean(topElement && (topElement === element || element.contains(topElement))),
          left: box.left,
          right: box.right,
          text: element.textContent?.replace(/\s+/gu, " ").trim() || element.getAttribute("aria-label") || "",
          top: box.top,
          visibility: style.visibility,
          visible: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
          width: box.width,
        };
      };
      const firstRowBelow = (rows, threshold) =>
        rows.map((row) => boxOf(row)).find((box) => box && box.top >= threshold - 1 && box.top < window.innerHeight) || null;
      return { boxOf, firstRowBelow };
    };
  });
}

async function resetScroll(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 1_500 }).catch(() => {});
  await delay(120);
}

async function scrollLocatorBelowStickyStack(locator) {
  await locator.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
  await delay(150);
}

async function readTransactionLedgerMetrics(page, longMemo) {
  await openRequestedTab(page, "transactions");
  await resetScroll(page);
  const row = page.locator("tr.transaction-row", { hasText: longMemo }).first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await scrollLocatorBelowStickyStack(row);
  const before = await page.evaluate((memo) => {
    const { boxOf, firstRowBelow } = window.__mfReadWorkSurfaceMetricsScript();
    const rows = Array.from(document.querySelectorAll("tr.transaction-row"));
    const targetRow = rows.find((item) => item.textContent?.includes(memo));
    const toolbar = document.querySelector('[data-testid="transaction-sticky-toolbar"]');
    const head = document.querySelector(".transactions-mobile-ledger-head");
    const headBox = boxOf(head);
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      hasHorizontalOverflow: document.documentElement.scrollWidth - window.innerWidth > 1,
      rowCount: rows.length,
      targetRow: boxOf(targetRow),
      toolbar: boxOf(toolbar),
      ledgerHead: headBox,
      firstRowBelowHead: firstRowBelow(rows, headBox?.bottom ?? 0),
      toggle: boxOf(targetRow?.querySelector(".mobile-toggle-btn")),
      selectionStatus: boxOf(document.querySelector('[data-testid="transaction-selection-summary"], .transaction-selection-status')),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, longMemo);
  const toggle = row.locator(".mobile-toggle-btn").first();
  await toggle.click();
  await row.waitFor({ state: "visible", timeout: 5_000 });
  await delay(120);
  const expanded = await page.evaluate((memo) => {
    const { boxOf } = window.__mfReadWorkSurfaceMetricsScript();
    const rows = Array.from(document.querySelectorAll("tr.transaction-row"));
    const targetRow = rows.find((item) => item.textContent?.includes(memo));
    const memoElement = targetRow?.querySelector(".transaction-memo-text");
    const memoStyle = memoElement ? getComputedStyle(memoElement) : null;
    const actionRow = targetRow?.nextElementSibling?.classList.contains("transaction-mobile-expanded-actions-row") ? targetRow.nextElementSibling : null;
    const editButton = actionRow ? Array.from(actionRow.querySelectorAll("button")).find((button) => button.textContent?.includes("수정")) : null;
    const deleteButton = actionRow ? Array.from(actionRow.querySelectorAll("button")).find((button) => button.textContent?.includes("삭제")) : null;
    return {
      expanded: Boolean(targetRow?.classList.contains("mobile-row-expanded")),
      row: boxOf(targetRow),
      memo: memoElement
        ? {
            ariaLabel: memoElement.getAttribute("aria-label"),
            clientHeight: memoElement.clientHeight,
            clientWidth: memoElement.clientWidth,
            overflowWrap: memoStyle?.overflowWrap || "",
            scrollHeight: memoElement.scrollHeight,
            scrollWidth: memoElement.scrollWidth,
            text: memoElement.textContent?.trim() || "",
            textOverflow: memoStyle?.textOverflow || "",
            whiteSpace: memoStyle?.whiteSpace || "",
          }
        : null,
      actionRow: boxOf(actionRow),
      editButton: boxOf(editButton),
      deleteButton: boxOf(deleteButton),
    };
  }, longMemo);
  await row.evaluate((element) => element.click());
  await delay(120);
  const selection = await page.evaluate(() => {
    const { boxOf } = window.__mfReadWorkSurfaceMetricsScript();
    return boxOf(document.querySelector('[data-testid="transaction-selection-summary"], .transaction-selection-status'));
  });
  return { before, expanded, selection };
}

async function readHoldingLedgerMetrics(page, holdingName) {
  await openRequestedTab(page, "holdings");
  await resetScroll(page);
  const row = page.locator("tr.holding-row", { hasText: holdingName }).first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  await scrollLocatorBelowStickyStack(row);
  const before = await page.evaluate((name) => {
    const { boxOf, firstRowBelow } = window.__mfReadWorkSurfaceMetricsScript();
    const rows = Array.from(document.querySelectorAll("tr.holding-row"));
    const targetRow = rows.find((item) => item.textContent?.includes(name));
    const head = document.querySelector(".holdings-mobile-ledger-head");
    const headBox = boxOf(head);
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      hasHorizontalOverflow: document.documentElement.scrollWidth - window.innerWidth > 1,
      rowCount: rows.length,
      targetRow: boxOf(targetRow),
      ledgerHead: headBox,
      firstRowBelowHead: firstRowBelow(rows, headBox?.bottom ?? 0),
      toggle: boxOf(targetRow?.querySelector(".mobile-toggle-btn")),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, holdingName);
  await row.locator(".mobile-toggle-btn").first().click();
  await delay(120);
  const expanded = await page.evaluate((name) => {
    const { boxOf } = window.__mfReadWorkSurfaceMetricsScript();
    const rows = Array.from(document.querySelectorAll("tr.holding-row"));
    const targetRow = rows.find((item) => item.textContent?.includes(name));
    const actionRow = targetRow?.nextElementSibling?.classList.contains("holding-mobile-expanded-actions-row") ? targetRow.nextElementSibling : null;
    const labels = Array.from(targetRow?.querySelectorAll(".holding-mobile-detail-label") || []).map((item) => item.textContent?.trim() || "");
    const editButton = actionRow ? Array.from(actionRow.querySelectorAll("button")).find((button) => button.textContent?.includes("수정")) : null;
    const deleteButton = actionRow ? Array.from(actionRow.querySelectorAll("button")).find((button) => button.textContent?.includes("삭제")) : null;
    return { expanded: Boolean(targetRow?.classList.contains("mobile-row-expanded")), row: boxOf(targetRow), actionRow: boxOf(actionRow), detailLabels: labels, editButton: boxOf(editButton), deleteButton: boxOf(deleteButton) };
  }, holdingName);
  return { before, expanded };
}

function decideWorkSurfaceLedgerVerdict(metrics, dashboard) {
  const failures = [];
  const touchOk = (box) => Boolean(box?.visible && box.width >= 44 && box.height >= 44 && box.hitVisible);
  const rowBelowHead = (surface) =>
    Boolean(surface?.before?.ledgerHead?.visible && surface?.before?.firstRowBelowHead && surface.before.firstRowBelowHead.top >= surface.before.ledgerHead.bottom - 1);
  const transactionMemoWraps =
    metrics.transactions?.expanded?.memo &&
    metrics.transactions.expanded.memo.scrollWidth <= metrics.transactions.expanded.memo.clientWidth + 1 &&
    metrics.transactions.expanded.memo.scrollHeight <= metrics.transactions.expanded.memo.clientHeight + 1 &&
    metrics.transactions.expanded.memo.whiteSpace !== "nowrap" &&
    metrics.transactions.expanded.memo.overflowWrap === "anywhere" &&
    metrics.transactions.expanded.memo.textOverflow === "clip";

  if (!dashboard.reached) failures.push("dashboard not reached");
  if (metrics.transactions?.before?.hasHorizontalOverflow) failures.push("transaction ledger has horizontal overflow");
  if (metrics.holdings?.before?.hasHorizontalOverflow) failures.push("holding ledger has horizontal overflow");
  if (!metrics.transactions?.before?.toolbar?.visible) failures.push("transaction sticky toolbar is not visible");
  if (!metrics.transactions?.before?.ledgerHead?.visible) failures.push("transaction mobile ledger head is not visible");
  if (!rowBelowHead(metrics.transactions)) failures.push("transaction row is not visible below sticky ledger head");
  if (!touchOk(metrics.transactions?.before?.toggle)) failures.push("transaction detail toggle is not 44px and directly hittable");
  if (!metrics.transactions?.expanded?.expanded) failures.push("transaction row did not expand");
  if (!transactionMemoWraps) failures.push("expanded transaction memo does not wrap without clipping");
  if (!metrics.transactions?.expanded?.editButton?.visible || !metrics.transactions?.expanded?.deleteButton?.visible) failures.push("expanded transaction edit/delete actions are not visible");
  if (!metrics.transactions?.selection?.visible || !metrics.transactions.selection.text.includes("선택")) failures.push("transaction selection status is not visible after row selection");
  if (!metrics.holdings?.before?.ledgerHead?.visible) failures.push("holding mobile ledger head is not visible");
  if (!rowBelowHead(metrics.holdings)) failures.push("holding row is not visible below ledger head");
  if (!touchOk(metrics.holdings?.before?.toggle)) failures.push("holding detail toggle is not 44px and directly hittable");
  if (!metrics.holdings?.expanded?.expanded) failures.push("holding row did not expand");
  if (!metrics.holdings?.expanded?.detailLabels?.includes("보유자")) failures.push("expanded holding detail labels are missing");
  if (!metrics.holdings?.expanded?.editButton?.visible || !metrics.holdings?.expanded?.deleteButton?.visible) failures.push("expanded holding edit/delete actions are not visible");
  return { verdict: failures.length === 0 ? "pass" : "fail", failures };
}

export async function runWorkSurfaceLedger(options) {
  return withBrowserEvidence(options, { isolated: true }, "work-surface-ledger", async ({ app, page }) => {
    await installWorkSurfaceMetricsScript(page);
    const dashboard = await tryRegisterDashboard(page, app.url);
    let seed = null;
    if (dashboard.reached) {
      seed = await seedWorkSurfaceLedgerFixtures(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("main.app-shell").waitFor({ state: "visible", timeout: 15_000 });
    }
    const metrics = dashboard.reached
      ? { transactions: await readTransactionLedgerMetrics(page, seed.longMemo), holdings: await readHoldingLedgerMetrics(page, seed.holdingName) }
      : { transactions: null, holdings: null };
    const { verdict, failures } = decideWorkSurfaceLedgerVerdict(metrics, dashboard);
    return {
      url: page.url(),
      baseUrlSource: app.source,
      backendPort: app.backendPort,
      frontendPort: app.frontendPort,
      dashboardReached: dashboard.reached,
      dashboard,
      seed,
      metrics,
      verdict,
      failures,
    };
  });
}
