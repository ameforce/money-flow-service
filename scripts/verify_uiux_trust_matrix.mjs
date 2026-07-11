#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const MATRIX_PATH = "docs/uiux-data-lifecycle-trust-matrix.md";
const REQUIRED_STATE_IDS = [
  "TX-ENTRY-READY",
  "TX-ENTRY-VALIDATION",
  "TX-SAVE-COMMIT",
  "DASHBOARD-REALTIME",
  "PRICE-STALE-REFRESH",
  "IMPORT-PREFLIGHT",
  "IMPORT-APPLY",
  "IMPORT-ISSUE-REMEDIATION",
  "IMPORT-TECHNICAL-DETAILS",
  "AUTH-PERMISSION",
  "GLOBAL-ERROR-RECOVERY",
];

const REQUIRED_DOC_SNIPPETS = [
  "user-facing surface",
  "Current evidence",
  "aria-invalid",
  "role=alert",
  "realtime socket chip",
  "post-apply navigation",
  "technical details",
];

const REQUIRED_CODE_SNIPPETS = [
  { path: "frontend/src/components/AppShell.jsx", text: "socket-chip" },
  { path: "frontend/src/components/AppShell.jsx", text: "aria-live=\"polite\"" },
  { path: "frontend/src/components/AppShell.jsx", text: "role=\"status\"" },
  { path: "frontend/src/App.jsx", text: "role=\"alert\"" },
  { path: "frontend/src/pages/importing/WorkbookImportPanel.jsx", text: "className=\"import-progress\" role=\"status\" aria-live=\"polite\"" },
  { path: "frontend/src/components/worksurface/TransactionSurfaceTable.jsx", text: "transaction-row-imported" },
  { path: "e2e/specs/import.spec.js", text: "large report exposes full table filters and CSV export" },
  { path: "e2e/specs/uiux-accessibility-gates.spec.js", text: "issue #246" },
  { path: "e2e/specs/dashboard.spec.js", text: "realtime status remains readable" },
];

function readRequired(path) {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing`);
  }
  return readFileSync(path, "utf8");
}

const failures = [];
const matrix = existsSync(MATRIX_PATH) ? readFileSync(MATRIX_PATH, "utf8") : "";
if (!matrix) {
  failures.push(`${MATRIX_PATH} is missing or empty`);
}

for (const stateId of REQUIRED_STATE_IDS) {
  if (!matrix.includes(`| ${stateId} |`)) {
    failures.push(`matrix missing required state ${stateId}`);
  }
}

for (const snippet of REQUIRED_DOC_SNIPPETS) {
  if (!matrix.includes(snippet)) {
    failures.push(`matrix missing required text: ${snippet}`);
  }
}

for (const requirement of REQUIRED_CODE_SNIPPETS) {
  try {
    const source = readRequired(requirement.path);
    if (!source.includes(requirement.text)) {
      failures.push(`${requirement.path} missing ${requirement.text}`);
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

const report = {
  ok: failures.length === 0,
  matrixPath: MATRIX_PATH,
  requiredStateCount: REQUIRED_STATE_IDS.length,
  checkedCodeSnippets: REQUIRED_CODE_SNIPPETS.length,
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
