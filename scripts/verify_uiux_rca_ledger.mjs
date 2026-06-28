#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const LEDGER_PATH = "docs/uiux-rca-evidence-ledger.md";
const REQUIRED_ISSUES = Array.from({ length: 20 }, (_, index) => `#${240 + index}`);
const REQUIRED_COLUMNS = ["RCA", "Code surface", "Wave", "Status and proof", "Remaining risk"];
const REQUIRED_WAVES = ["W1 repeated transaction journey", "W2 semantic accessibility", "W3 layout/system"];
const REQUIRED_GITHUB_SOURCE = ".omo/evidence/uiux-github-issues-240-259-current.json";

const failures = [];
if (!existsSync(LEDGER_PATH)) {
  failures.push(`${LEDGER_PATH} is missing`);
} else {
  const ledger = readFileSync(LEDGER_PATH, "utf8");
  for (const issue of REQUIRED_ISSUES) {
    if (!ledger.includes(`| ${issue} |`)) {
      failures.push(`missing issue row ${issue}`);
    }
    const issueNumber = issue.slice(1);
    if (!ledger.includes(`https://github.com/ameforce/money-flow-service/issues/${issueNumber}`)) {
      failures.push(`missing GitHub linkage for ${issue}`);
    }
  }
  for (const column of REQUIRED_COLUMNS) {
    if (!ledger.includes(column)) {
      failures.push(`missing column ${column}`);
    }
  }
  for (const wave of REQUIRED_WAVES) {
    if (!ledger.includes(wave)) {
      failures.push(`missing dependency wave ${wave}`);
    }
  }
  if (!ledger.includes(REQUIRED_GITHUB_SOURCE)) {
    failures.push(`missing GitHub linkage source ${REQUIRED_GITHUB_SOURCE}`);
  }
}

const report = {
  ok: failures.length === 0,
  ledgerPath: LEDGER_PATH,
  requiredIssueCount: REQUIRED_ISSUES.length,
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
