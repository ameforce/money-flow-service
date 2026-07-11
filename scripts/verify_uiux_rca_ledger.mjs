#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

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
const currentHeadSha = requireClosed ? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : null;
const REQUIRED_ASSERTIONS_BY_FINDING = {
  "MUI-001": ["zoom-enabled"],
  "MUI-002": ["keyboard-upload"],
  "MUI-003": ["horizontal-pan"],
  "MUI-004": ["engine-matrix", "matrix-complete", "orientation-state-preservation", "zero-overflow"],
  "MUI-005": ["font-size-16"],
  "MUI-006": ["focus-trap", "background-inert", "escape", "return-focus", "nested-confirmation"],
  "MUI-007": ["target-size-44"],
  "MUI-008": ["tab-semantics", "arrow-navigation"],
  "MUI-009": ["assertive-error", "polite-status"],
  "MUI-010": ["reduced-motion"],
  "MUI-011": ["first-task-visible", "chart-readable"],
  "MUI-012": ["token-audit"],
  "MUI-013": ["react-doctor-zero", "react-scan-stable", "state-preservation"],
};
const MUI_004_REQUIRED_BROWSERS = ["chromium", "firefox", "webkit"];
const MUI_004_REQUIRED_VIEWPORTS = [
  "320x568", "568x320", "360x800", "800x360", "390x844", "844x390",
  "412x915", "915x412", "768x1024", "1024x768", "1280x720", "1440x900",
];
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
    const evidenceRelativePath = `.omo/evidence/mobile-uiux-v0.1.49/${findingId}`;
    if (status === VERIFIED_STATUS && !verification.includes(`${evidenceRelativePath}/`)) {
      failures.push(`${findingId} is verified without its mobile evidence artifact path`);
    }
    if (requireClosed && status === VERIFIED_STATUS) {
      const evidenceDirectory = path.resolve(evidenceRelativePath);
      if (!existsSync(evidenceDirectory)) {
        failures.push(`${findingId} evidence directory is missing: ${evidenceRelativePath}`);
        continue;
      }
      const metadataFiles = readdirSync(evidenceDirectory).filter((file) => file.endsWith(".json"));
      if (metadataFiles.length === 0) {
        failures.push(`${findingId} evidence metadata is missing`);
        continue;
      }
      const metadataFileNames = new Set(metadataFiles);
      const validEvidence = metadataFiles.flatMap((file) => {
        try {
          const metadata = JSON.parse(readFileSync(path.join(evidenceDirectory, file), "utf8"));
          const artifactName = String(metadata.artifact || "");
          const artifactPath = path.join(evidenceDirectory, artifactName);
          const valid = metadata.findingId === findingId
            && metadata.testedSha === currentHeadSha
            && metadata.result === "passed"
            && Boolean(metadata.command)
            && Boolean(metadata.browser)
            && Boolean(metadata.viewport?.width)
            && Boolean(metadata.viewport?.height)
            && Boolean(metadata.orientation)
            && Boolean(metadata.scenario)
            && artifactName.length > 0
            && artifactName === path.basename(artifactName)
            && !metadataFileNames.has(artifactName)
            && statSync(artifactPath).isFile();
          return valid ? [metadata] : [];
        } catch {
          return [];
        }
      });
      if (validEvidence.length === 0) {
        failures.push(`${findingId} has no valid passing evidence for HEAD ${currentHeadSha}`);
        continue;
      }
      const assertionIds = new Set(validEvidence.flatMap((metadata) => metadata.assertions || []));
      for (const assertionId of REQUIRED_ASSERTIONS_BY_FINDING[findingId] || []) {
        if (!assertionIds.has(assertionId)) failures.push(`${findingId} evidence is missing assertion ${assertionId}`);
      }
      if (findingId === "MUI-004") {
        const pairAssertions = ["engine-matrix", "zero-overflow"];
        const usedPairArtifacts = new Map();
        for (const browser of MUI_004_REQUIRED_BROWSERS) {
          for (const viewport of MUI_004_REQUIRED_VIEWPORTS) {
            const pair = `${browser}/${viewport}`;
            const pairEvidence = validEvidence.filter(
              (metadata) => `${metadata.browser}/${metadata.viewport.width}x${metadata.viewport.height}` === pair
            );
            if (pairEvidence.length === 0) {
              failures.push(`${findingId} evidence is missing browser/viewport pair ${pair}`);
              continue;
            }
            const assertedEvidence = pairEvidence.filter((metadata) => {
              const assertions = new Set(metadata.assertions || []);
              return pairAssertions.every((assertionId) => assertions.has(assertionId));
            });
            if (assertedEvidence.length === 0) {
              failures.push(`${findingId} evidence is missing pair assertions for ${pair}`);
              continue;
            }
            const distinctEvidence = assertedEvidence.find((metadata) => !usedPairArtifacts.has(metadata.artifact));
            if (!distinctEvidence) {
              failures.push(`${findingId} evidence reuses artifact ${assertedEvidence[0].artifact} across browser/viewport pairs`);
              continue;
            }
            usedPairArtifacts.set(distinctEvidence.artifact, pair);
          }
        }
      }
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
