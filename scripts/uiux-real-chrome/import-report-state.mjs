import { delay } from "./app-runtime.mjs";
import { openRequestedTab, tryRegisterDashboard } from "./browser-session.mjs";
import { withBrowserEvidence } from "./scenario-runtime.mjs";

function createImportReportFixture() {
  const issues = Array.from({ length: 12 }, (_, index) => ({
    code: index % 2 === 0 ? "MISSING_REQUIRED_VALUE" : "INVALID_AMOUNT",
    severity: index % 2 === 0 ? "error" : "warning",
    sheet: "거래내역",
    row: index + 1,
    message: `Task 8 누락 필수값 ${index + 1}`,
  }));
  return {
    workbook_path: "C:\\Users\\epapyrus\\Documents\\MoneyFlow\\private-ledger.xlsx",
    sheets: 2,
    transaction_rows: 12,
    holding_rows: 0,
    applied_transactions: 0,
    applied_holdings_added: 0,
    applied_holdings_updated: 0,
    monthly_formula_mismatch_count: 12,
    detected_mismatch_cells: Array.from({ length: 12 }, (_, index) => `거래내역!M${index + 1}`),
    diagnostic: { source_path: "C:\\Users\\epapyrus\\Documents\\MoneyFlow\\private-ledger.xlsx" },
    issues,
  };
}

async function installImportReportRoute(page) {
  await page.route("**/api/v1/imports/workbook/upload?mode=dry_run", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createImportReportFixture()),
    });
  });
}

async function readImportStateMetrics(page) {
  return page.evaluate(() => {
    const boxOf = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        bottom: box.bottom,
        height: box.height,
        left: box.left,
        right: box.right,
        text: element.textContent?.replace(/\s+/gu, " ").trim() || element.getAttribute("aria-label") || "",
        top: box.top,
        visible: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
        width: box.width,
        withinViewportX: box.left >= -1 && box.right <= window.innerWidth + 1,
      };
    };
    const report = document.querySelector("section.import-report");
    const technical = report?.querySelector("details.report-technical") || null;
    const technicalPre = technical?.querySelector("pre.technical-report-json") || null;
    const workbench = report?.querySelector(".import-report-workbench") || null;
    const controls = Array.from(workbench?.querySelectorAll("input, select, button") || []).map((control) => {
      const box = boxOf(control);
      return { ...box, disabled: Boolean(control.disabled), label: control.getAttribute("aria-label") || control.textContent?.trim() || "" };
    });
    const excelPanel = document.querySelector(".import-excel-panel");
    const dryRun = Array.from(excelPanel?.querySelectorAll("button") || []).find((button) => button.textContent?.trim() === "미리 검증");
    const apply = Array.from(excelPanel?.querySelectorAll("button") || []).find((button) => button.textContent?.trim() === "적용");
    const helper = document.getElementById("excel-import-file-required");
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth - window.innerWidth > 1,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      noFile: {
        helper: boxOf(helper),
        dryRunDisabled: Boolean(dryRun?.disabled),
        applyDisabled: Boolean(apply?.disabled),
        dryRunDescribedBy: dryRun?.getAttribute("aria-describedby") || "",
        applyDescribedBy: apply?.getAttribute("aria-describedby") || "",
      },
      report: {
        visible: Boolean(boxOf(report)?.visible),
        rawCount: document.querySelectorAll(".report-raw").length,
        rawSummaryTextPresent: document.body.textContent?.includes("원본 JSON 보기") || false,
        technicalCount: report?.querySelectorAll("details.report-technical").length || 0,
        technicalOpen: Boolean(technical?.open),
        technicalSummary: technical?.querySelector("summary")?.textContent?.trim() || "",
        collapsedTextHasLocalPath: Boolean(report?.textContent?.includes("C:\\Users\\epapyrus")),
        technicalJsonText: technicalPre?.textContent || "",
        workbench: boxOf(workbench),
        controls,
      },
    };
  });
}

function decideImportReportStateVerdict(before, metrics, dashboard) {
  const failures = [];
  const requiredControls = ["정리 표 검색", "심각도 필터", "유형 필터", "정렬", "CSV 복사", "CSV 다운로드"];
  const labels = new Set(metrics.report.controls.map((control) => control.label));
  if (!dashboard.reached) failures.push("dashboard not reached");
  if (metrics.hasHorizontalOverflow) failures.push("import page has horizontal overflow");
  if (!before?.noFile?.helper?.visible) failures.push("no-file helper is not visible");
  if (!before?.noFile?.dryRunDisabled || !before?.noFile?.applyDisabled) failures.push("no-file actions are not disabled");
  if (before?.noFile?.dryRunDescribedBy !== "excel-import-file-required" || before?.noFile?.applyDescribedBy !== "excel-import-file-required") {
    failures.push("no-file actions are not connected to helper text");
  }
  if (!metrics.report.visible || !metrics.report.workbench?.visible) failures.push("import report workbench is not visible");
  if (requiredControls.some((label) => !labels.has(label))) failures.push("import report controls are missing");
  if (metrics.report.rawCount !== 0 || metrics.report.rawSummaryTextPresent) failures.push("raw JSON disclosure remains visible");
  if (metrics.report.technicalCount !== 1 || metrics.report.technicalSummary !== "기술 상세 보기") failures.push("technical details disclosure is missing or mislabeled");
  if (metrics.report.technicalOpen) failures.push("technical details are expanded by default");
  if (metrics.report.collapsedTextHasLocalPath) failures.push("collapsed report text exposes a local path");
  if (!metrics.report.technicalJsonText.includes('"workbook_path": "[redacted-path]"')) failures.push("workbook path is not redacted in technical JSON");
  if (!metrics.report.technicalJsonText.includes('"source_path": "[redacted-path]"')) failures.push("source path is not redacted in technical JSON");
  return { verdict: failures.length === 0 ? "pass" : "fail", failures };
}

export async function runImportReportState(options) {
  return withBrowserEvidence(options, { isolated: true }, "import-report-state", async ({ app, page }) => {
    await installImportReportRoute(page);
    const dashboard = await tryRegisterDashboard(page, app.url);
    if (dashboard.reached) {
      await openRequestedTab(page, "import");
      await page.locator(".import-excel-panel").waitFor({ state: "visible", timeout: 15_000 });
    }
    const before = dashboard.reached ? await readImportStateMetrics(page) : null;
    if (dashboard.reached) {
      await page.getByLabel("엑셀 파일 업로드").setInputFiles({
        name: "task-8-report.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: Buffer.from("task-8-report"),
      });
      await page.getByRole("button", { name: "미리 검증", exact: true }).click();
      await page.locator("section.import-report").waitFor({ state: "visible", timeout: 15_000 });
      await delay(150);
    }
    const after = dashboard.reached ? await readImportStateMetrics(page) : { report: { controls: [] } };
    const { verdict, failures } = decideImportReportStateVerdict(before, after, dashboard);
    return {
      url: page.url(),
      baseUrlSource: app.source,
      backendPort: app.backendPort,
      frontendPort: app.frontendPort,
      dashboardReached: dashboard.reached,
      dashboard,
      before,
      after,
      verdict,
      failures,
    };
  });
}
