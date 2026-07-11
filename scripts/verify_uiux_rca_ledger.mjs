#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const LEDGER_PATH = "docs/uiux-rca-evidence-ledger.md";
const REQUIRED_ISSUES = Array.from({ length: 20 }, (_, index) => `#${240 + index}`);
const REQUIRED_COLUMNS = ["RCA", "Code surface", "Wave", "Status and proof", "Remaining risk"];
const REQUIRED_WAVES = ["W1 repeated transaction journey", "W2 semantic accessibility", "W3 layout/system"];
const REQUIRED_GITHUB_SOURCE = ".omo/evidence/uiux-github-issues-240-259-current.json";
const REQUIRED_MOBILE_FINDING_IDS = Array.from({ length: 13 }, (_, index) => `MUI-${String(index + 1).padStart(3, "0")}`);
const REQUIRED_MOBILE_COLUMNS = ["ID", "Severity", "Surface", "RCA", "Evidence", "Wave", "Status", "Verification"];
const REQUIRED_SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const ALLOWED_FINDING_STATUSES = new Set(["Open", "In progress", "Fixed, pending verification", "Fixed and verified"]);
const VERIFIED_STATUS = "Fixed and verified";
const requireClosed = process.argv.includes("--require-closed");
const REQUIRED_CONTRACT_SNIPPETS = [
  "v0.1.48 baseline",
  "P0 / CRITICAL",
  "P1 / HIGH",
  "P2 / MEDIUM",
  "P3 / LOW",
  ".omo/evidence/mobile-uiux-v0.1.49/",
  "Unresolved-zero gate",
  "Accepted debt: none",
];

function parseMobileFindingRows(ledger) {
  return ledger
    .split(/\r?\n/u)
    .filter((line) => /^\|\s*MUI-\d{3}\s*\|/u.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

const failures = [];
let unresolvedFindings = [];
const unresolvedBySeverity = Object.fromEntries([...REQUIRED_SEVERITIES].map((severity) => [severity, 0]));
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
  for (const column of REQUIRED_MOBILE_COLUMNS) {
    if (!ledger.includes(column)) {
      failures.push(`missing mobile finding column ${column}`);
    }
  }
  for (const snippet of REQUIRED_CONTRACT_SNIPPETS) {
    if (!ledger.includes(snippet)) {
      failures.push(`missing mobile evidence contract text: ${snippet}`);
    }
  }

  const findingRows = parseMobileFindingRows(ledger);
  const findingRowsById = new Map(findingRows.map((row) => [row[0], row]));
  for (const findingId of REQUIRED_MOBILE_FINDING_IDS) {
    if (!findingRowsById.has(findingId)) {
      failures.push(`missing mobile finding row ${findingId}`);
    }
  }
  for (const row of findingRows) {
    const [findingId, severity, , , evidence, , status, verification] = row;
    if (row.length !== REQUIRED_MOBILE_COLUMNS.length) {
      failures.push(`${findingId || "unknown mobile finding"} must have ${REQUIRED_MOBILE_COLUMNS.length} columns`);
      continue;
    }
    if (!REQUIRED_SEVERITIES.has(severity)) {
      failures.push(`${findingId} has invalid severity ${severity}`);
    }
    if (!evidence || !evidence.includes("`")) {
      failures.push(`${findingId} must name repository or artifact evidence paths`);
    }
    if (!ALLOWED_FINDING_STATUSES.has(status)) {
      failures.push(`${findingId} has invalid status ${status}`);
    }
    if (status === VERIFIED_STATUS && !verification.includes(".omo/evidence/mobile-uiux-v0.1.49/")) {
      failures.push(`${findingId} is verified without a mobile evidence artifact path`);
    }
  }

  unresolvedFindings = findingRows
    .filter((row) => row[6] !== VERIFIED_STATUS)
    .map((row) => `${row[0]}:${row[6] || "missing status"}`);
  for (const row of findingRows.filter((findingRow) => findingRow[6] !== VERIFIED_STATUS)) {
    if (REQUIRED_SEVERITIES.has(row[1])) {
      unresolvedBySeverity[row[1]] += 1;
    }
  }
  if (requireClosed && unresolvedFindings.length > 0) {
    failures.push(`unresolved mobile findings must be zero: ${unresolvedFindings.join(", ")}`);
  }
}

const report = {
  ok: failures.length === 0,
  ledgerPath: LEDGER_PATH,
  requiredIssueCount: REQUIRED_ISSUES.length,
  requiredMobileFindingCount: REQUIRED_MOBILE_FINDING_IDS.length,
  unresolvedFindingCount: unresolvedFindings.length,
  unresolvedBySeverity,
  requireClosed,
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
