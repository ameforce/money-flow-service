import { existsSync, readFileSync } from "node:fs";

import { delay } from "./app-runtime.mjs";
import { openRequestedTab, tryRegisterDashboard } from "./browser-session.mjs";
import { seedDashboardFixtures, seedWorkSurfaceLedgerFixtures } from "./fixtures.mjs";
import { withBrowserEvidence } from "./scenario-runtime.mjs";

const PERFORMANCE_BUDGETS_MS = Object.freeze({
  dashboardFirstUsableMs: 5000,
  dashboardChartSwitchMs: 1200,
  transactionsTabSwitchMs: 2000,
  ledgerToggleMs: 1200,
  importTabSwitchMs: 2000,
  importReportRenderMs: 2500,
});

async function afterPaint(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function measure(label, fn) {
  const started = performance.now();
  await fn();
  return { label, durationMs: Math.round((performance.now() - started) * 10) / 10 };
}

function createImportReportFixture() {
  return {
    workbook_path: "task-9-performance.xlsx",
    sheets: 2,
    transaction_rows: 10,
    holding_rows: 0,
    applied_transactions: 0,
    applied_holdings_added: 0,
    applied_holdings_updated: 0,
    monthly_formula_mismatch_count: 10,
    detected_mismatch_cells: Array.from({ length: 10 }, (_, index) => `거래내역!M${index + 1}`),
    issues: Array.from({ length: 10 }, (_, index) => ({
      code: index % 2 ? "INVALID_AMOUNT" : "MISSING_REQUIRED_VALUE",
      severity: index % 2 ? "warning" : "error",
      sheet: "거래내역",
      row: index + 1,
      message: `Task 9 performance issue ${index + 1}`,
    })),
  };
}

async function installImportReportRoute(page) {
  await page.route("**/api/v1/imports/workbook/upload?mode=dry_run", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(createImportReportFixture()) });
  });
}

async function readPageHealth(page) {
  return page.evaluate(() => ({
    documentScrollWidth: document.documentElement.scrollWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth - window.innerWidth > 1,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    appShell: Boolean(document.querySelector("main.app-shell")),
    dashboardCharts: document.querySelectorAll(".dashboard-flow-card canvas, .dashboard-portfolio-card canvas").length,
    transactionRows: document.querySelectorAll("tr.transaction-row").length,
    importReportRows: document.querySelectorAll(".import-report-table tbody tr").length,
  }));
}

function summarizeHealth(surfaceHealth, finalHealth) {
  const snapshots = {
    dashboard: surfaceHealth.dashboard || null,
    transactions: surfaceHealth.transactions || null,
    import: surfaceHealth.import || null,
    final: finalHealth || null,
  };
  const availableSnapshots = Object.values(snapshots).filter(Boolean);
  return {
    documentScrollWidth: Math.max(...availableSnapshots.map((item) => item.documentScrollWidth), 0),
    hasHorizontalOverflow: availableSnapshots.some((item) => item.hasHorizontalOverflow),
    viewport: finalHealth?.viewport || surfaceHealth.dashboard?.viewport || null,
    appShell: availableSnapshots.every((item) => item.appShell),
    dashboardCharts: Number(surfaceHealth.dashboard?.dashboardCharts || 0),
    transactionRows: Number(surfaceHealth.transactions?.transactionRows || 0),
    importReportRows: Number(surfaceHealth.import?.importReportRows || 0),
    finalSurface: "import",
    note: "Surface counters are captured on the tab where each surface is visible; final snapshot remains on import after report render.",
    snapshots,
  };
}

function readPriorBaseline(options) {
  const beforePath = String(options.evidence || "").replace(/after(?=\.json$)/u, "before");
  if (!beforePath || beforePath === options.evidence || !existsSync(beforePath)) return null;
  try {
    return JSON.parse(readFileSync(beforePath, "utf8"));
  } catch {
    return null;
  }
}

function compareToPrior(options, metrics) {
  const prior = readPriorBaseline(options);
  if (!prior?.metrics) return { available: false, regressions: [] };
  const keys = ["dashboardFirstUsableMs", "dashboardChartSwitchMs", "transactionsTabSwitchMs", "ledgerToggleMs", "importTabSwitchMs", "importReportRenderMs"];
  const thresholdPercent = 10;
  const regressions = keys
    .map((key) => {
      const before = Number(prior.metrics[key]);
      const after = Number(metrics[key]);
      if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
      const allowedDelta = before * (thresholdPercent / 100);
      return after > before + allowedDelta
        ? { key, before, after, allowedDelta: Math.round(allowedDelta * 10) / 10, thresholdPercent }
        : null;
    })
    .filter(Boolean);
  return { available: true, baselineScenario: prior.scenario, thresholdPercent, regressions };
}

function compareToAbsoluteBudgets(metrics) {
  const failures = Object.entries(PERFORMANCE_BUDGETS_MS)
    .map(([key, budgetMs]) => {
      const actualMs = Number(metrics[key]);
      if (!Number.isFinite(actualMs) || actualMs <= 0) {
        return { key, budgetMs, actualMs, reason: "missing-or-invalid" };
      }
      return actualMs > budgetMs ? { key, budgetMs, actualMs, overByMs: Math.round((actualMs - budgetMs) * 10) / 10 } : null;
    })
    .filter(Boolean);
  return { budgetsMs: PERFORMANCE_BUDGETS_MS, failures };
}

export async function runPerformanceBaseline(options) {
  return withBrowserEvidence(options, { isolated: true }, "performance-baseline", async ({ app, page }) => {
    await installImportReportRoute(page);
    const dashboard = await tryRegisterDashboard(page, app.url);
    let seed = null;
    if (dashboard.reached) {
      seed = { dashboard: await seedDashboardFixtures(page), ledger: await seedWorkSurfaceLedgerFixtures(page) };
    }
    const measurements = {};
    const surfaceHealth = {};
    if (dashboard.reached) {
      measurements.dashboardFirstUsableMs = (await measure("dashboard-first-usable", async () => {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator("main.app-shell").waitFor({ state: "visible", timeout: 15_000 });
        await page.locator(".dashboard-portfolio-card").waitFor({ state: "visible", timeout: 15_000 });
        await afterPaint(page);
      })).durationMs;
      measurements.dashboardChartSwitchMs = (await measure("dashboard-chart-switch", async () => {
        const select = page.locator(".dashboard-portfolio-chart-select select");
        if ((await select.count()) > 0) await select.selectOption("transaction_flow");
        await page.locator(".dashboard-portfolio-card canvas").first().waitFor({ state: "visible", timeout: 10_000 });
        await afterPaint(page);
      })).durationMs;
      surfaceHealth.dashboard = await readPageHealth(page);
      measurements.transactionsTabSwitchMs = (await measure("transactions-tab-switch", async () => {
        await openRequestedTab(page, "transactions");
        await page.locator("tr.transaction-row", { hasText: seed.ledger.longMemo }).first().waitFor({ state: "visible", timeout: 15_000 });
        await afterPaint(page);
      })).durationMs;
      surfaceHealth.transactions = await readPageHealth(page);
      measurements.ledgerToggleMs = (await measure("ledger-toggle", async () => {
        const row = page.locator("tr.transaction-row", { hasText: seed.ledger.longMemo }).first();
        const toggle = row.locator(".mobile-toggle-btn").first();
        if (await toggle.isVisible().catch(() => false)) {
          await toggle.click();
          await page.locator(".transaction-mobile-expanded-actions-row").first().waitFor({ state: "visible", timeout: 10_000 });
        } else {
          await row.click();
          await row.waitFor({ state: "visible", timeout: 10_000 });
          const selected = await row.evaluate((element) => element.getAttribute("data-row-selected") === "true");
          if (!selected) {
            throw new Error("desktop ledger row did not become selected");
          }
          await page.locator("tr.transaction-row[data-row-selected='true']", { hasText: seed.ledger.longMemo }).first().waitFor({ state: "visible", timeout: 10_000 });
        }
        await afterPaint(page);
      })).durationMs;
      measurements.importTabSwitchMs = (await measure("import-tab-switch", async () => {
        await openRequestedTab(page, "import");
        await page.locator(".import-excel-panel").waitFor({ state: "visible", timeout: 15_000 });
        await afterPaint(page);
      })).durationMs;
      measurements.importReportRenderMs = (await measure("import-report-render", async () => {
        await page.getByLabel("엑셀 파일 업로드").setInputFiles({
          name: "task-9-performance.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from("task-9-performance"),
        });
        await page.getByRole("button", { name: "미리 검증", exact: true }).click();
        await page.locator(".import-report-workbench").waitFor({ state: "visible", timeout: 15_000 });
        await afterPaint(page);
      })).durationMs;
      surfaceHealth.import = await readPageHealth(page);
    }
    await delay(50);
    const health = summarizeHealth(surfaceHealth, await readPageHealth(page));
    const comparison = compareToPrior(options, measurements);
    const absoluteBudgets = compareToAbsoluteBudgets(measurements);
    const failures = [];
    if (!dashboard.reached) failures.push("dashboard not reached");
    if (health.hasHorizontalOverflow) failures.push("document has horizontal overflow");
    if (Object.values(measurements).some((value) => !Number.isFinite(value) || value <= 0)) failures.push("one or more performance measurements are invalid");
    if (absoluteBudgets.failures.length > 0) failures.push("absolute performance budget exceeded");
    if (comparison.regressions.length > 0) failures.push("performance regression beyond tolerance");
    return {
      url: page.url(),
      baseUrlSource: app.source,
      backendPort: app.backendPort,
      frontendPort: app.frontendPort,
      dashboardReached: dashboard.reached,
      seed,
      metrics: measurements,
      health,
      absoluteBudgets,
      comparison,
      verdict: failures.length === 0 ? "pass" : "fail",
      failures,
    };
  });
}
