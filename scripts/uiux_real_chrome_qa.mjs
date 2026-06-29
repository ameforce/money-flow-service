#!/usr/bin/env node

import { HELP_TEXT, missingRequiredOptions, parseArgs, SCENARIOS } from "./uiux-real-chrome/cli.mjs";
import { runDashboardChartFilter } from "./uiux-real-chrome/dashboard-chart-filter.mjs";
import { runImportReportState } from "./uiux-real-chrome/import-report-state.mjs";
import { runNavAccessibility } from "./uiux-real-chrome/nav-accessibility.mjs";
import { runPerformanceBaseline } from "./uiux-real-chrome/performance-baseline.mjs";
import { runShellBaseline } from "./uiux-real-chrome/shell-baseline.mjs";
import { runWorkSurfaceLedger } from "./uiux-real-chrome/work-surface-ledger.mjs";

const RUNNERS = new Map([
  ["shell-baseline", runShellBaseline],
  ["nav-accessibility", runNavAccessibility],
  ["dashboard-chart-filter", runDashboardChartFilter],
  ["work-surface-ledger", runWorkSurfaceLedger],
  ["import-report-state", runImportReportState],
  ["performance-baseline", runPerformanceBaseline],
]);

const result = parseArgs(process.argv.slice(2));
if (!result.ok) {
  console.error(result.error);
  process.exit(2);
}

const options = result.value;
if (options.help) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

const missing = missingRequiredOptions(options);
if (missing.length > 0) {
  console.error(`Missing required option(s): ${missing.map((key) => `--${key}`).join(", ")}`);
  process.exit(2);
}

if (!SCENARIOS.has(options.scenario)) {
  console.error(`Unsupported scenario "${options.scenario}".`);
  process.exit(3);
}

RUNNERS.get(options.scenario)(options).then((code) => process.exit(code));
