import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const VERIFIER_PATH = fileURLToPath(new URL("./verify_uiux_rca_ledger.mjs", import.meta.url));
const FINDING_IDS = Array.from({ length: 13 }, (_, index) => `MUI-${String(index + 1).padStart(3, "0")}`);
const REQUIRED_ASSERTIONS = {
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
const REQUIRED_BROWSERS = ["chromium", "firefox", "webkit"];
const REQUIRED_VIEWPORTS = [
  [320, 568], [568, 320], [360, 800], [800, 360], [390, 844], [844, 390],
  [412, 915], [915, 412], [768, 1024], [1024, 768], [1280, 720], [1440, 900],
];

function runGit(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function createLedger() {
  const issueRows = Array.from({ length: 20 }, (_, index) => {
    const issue = 240 + index;
    return `| #${issue} | https://github.com/ameforce/money-flow-service/issues/${issue} | RCA | Code surface | W1 repeated transaction journey | Status and proof | Remaining risk |`;
  });
  const findingRows = FINDING_IDS.map((findingId) =>
    `| ${findingId} | P1 | Surface | Root cause | \`source.js:1\` | W0 | Fixed and verified | .omo/evidence/mobile-uiux-v0.1.49/${findingId}/ |`
  );
  return [
    "v0.1.48 baseline",
    "P0 / CRITICAL P1 / HIGH P2 / MEDIUM P3 / LOW",
    ".omo/evidence/mobile-uiux-v0.1.49/",
    "Unresolved-zero gate",
    "Accepted debt: none",
    ".omo/evidence/uiux-github-issues-240-259-current.json",
    "W1 repeated transaction journey W2 semantic accessibility W3 layout/system",
    "| Issue | Link | RCA | Code surface | Wave | Status and proof | Remaining risk |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...issueRows,
    "| ID | Severity | Surface | RCA | Evidence | Wave | Status | Verification |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...findingRows,
  ].join("\n");
}

function writeEvidence(workspace, findingId, sha, browser, viewport, suffix, artifact = `${suffix}.png`) {
  const evidenceDirectory = path.join(workspace, ".omo", "evidence", "mobile-uiux-v0.1.49", findingId);
  mkdirSync(evidenceDirectory, { recursive: true });
  if (artifact) writeFileSync(path.join(evidenceDirectory, artifact), "evidence");
  const metadata = {
    assertions: REQUIRED_ASSERTIONS[findingId],
    browser,
    command: "npm run e2e:matrix",
    findingId,
    orientation: viewport[0] > viewport[1] ? "landscape" : "portrait",
    result: "passed",
    scenario: suffix,
    testedSha: sha,
    viewport: { width: viewport[0], height: viewport[1] },
  };
  if (artifact !== null) metadata.artifact = artifact;
  writeFileSync(path.join(evidenceDirectory, `${suffix}.json`), JSON.stringify(metadata));
}

function createWorkspace({ invalidArtifact, completeMatrix, completeRequiredScenarios = false }) {
  const workspace = mkdtempSync(path.join(tmpdir(), "uiux-ledger-test-"));
  mkdirSync(path.join(workspace, "docs"));
  writeFileSync(path.join(workspace, "docs", "uiux-rca-evidence-ledger.md"), createLedger());
  writeFileSync(path.join(workspace, "tracked.txt"), "fixture");
  runGit(workspace, ["init", "--quiet"]);
  runGit(workspace, ["config", "user.email", "test@example.com"]);
  runGit(workspace, ["config", "user.name", "Test"]);
  runGit(workspace, ["add", "docs/uiux-rca-evidence-ledger.md", "tracked.txt"]);
  runGit(workspace, ["commit", "--quiet", "-m", "test fixture"]);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim();

  for (const findingId of FINDING_IDS.filter((id) => id !== "MUI-004")) {
    const artifact = findingId === "MUI-001" && invalidArtifact === "blank"
      ? ""
      : findingId === "MUI-001" && invalidArtifact === "missing"
        ? null
        : `${findingId}.png`;
    writeEvidence(workspace, findingId, sha, "chromium", [390, 844], findingId, artifact);
  }
  if (completeRequiredScenarios) {
    writeEvidence(workspace, "MUI-001", sha, "webkit", [390, 844], "webkit-zoom");
    writeEvidence(workspace, "MUI-006", sha, "chromium", [390, 844], "transaction-sheet");
    writeEvidence(workspace, "MUI-006", sha, "chromium", [390, 844], "holding-sheet");
    writeEvidence(workspace, "MUI-006", sha, "chromium", [390, 844], "confirmation-dialog");
  }
  if (completeMatrix) {
    for (const browser of REQUIRED_BROWSERS) {
      for (const viewport of REQUIRED_VIEWPORTS) {
        writeEvidence(workspace, "MUI-004", sha, browser, viewport, `${browser}-${viewport.join("x")}`);
      }
    }
  } else {
    for (const viewport of REQUIRED_VIEWPORTS) {
      writeEvidence(workspace, "MUI-004", sha, "chromium", viewport, `chromium-${viewport.join("x")}`);
    }
    writeEvidence(workspace, "MUI-004", sha, "firefox", REQUIRED_VIEWPORTS[0], "firefox-single");
    writeEvidence(workspace, "MUI-004", sha, "webkit", REQUIRED_VIEWPORTS[1], "webkit-single");
  }
  return workspace;
}

function runVerifier(workspace) {
  const result = spawnSync(process.execPath, [VERIFIER_PATH, "--require-closed"], {
    cwd: workspace,
    encoding: "utf8",
  });
  return { report: JSON.parse(result.stdout), status: result.status };
}

test("final gate rejects evidence metadata whose artifact name is missing or blank", () => {
  for (const invalidArtifact of ["missing", "blank"]) {
    const workspace = createWorkspace({ invalidArtifact, completeMatrix: true });
    try {
      const result = runVerifier(workspace);
      assert.equal(result.status, 1, invalidArtifact);
      assert.ok(result.report.failures.includes(`MUI-001 has no valid passing evidence for HEAD ${execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace, encoding: "utf8" }).trim()}`));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
});

test("final gate rejects metadata that names its own sidecar as the artifact", () => {
  const workspace = createWorkspace({ completeMatrix: true });
  try {
    const evidenceDirectory = path.join(workspace, ".omo", "evidence", "mobile-uiux-v0.1.49", "MUI-001");
    const metadataName = readdirSync(evidenceDirectory).find((file) => file.endsWith(".json"));
    const metadataPath = path.join(evidenceDirectory, metadataName);
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, artifact: metadataName }));

    const result = runVerifier(workspace);

    assert.equal(result.status, 1);
    assert.ok(result.report.failures.some((failure) => failure.startsWith("MUI-001 has no valid passing evidence")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("final gate rejects evidence sidecars that cross-reference one another as artifacts", () => {
  const workspace = createWorkspace({ completeMatrix: true });
  try {
    const evidenceDirectory = path.join(workspace, ".omo", "evidence", "mobile-uiux-v0.1.49", "MUI-004");
    const metadataNames = readdirSync(evidenceDirectory).filter((file) => file.endsWith(".json"));
    for (const [index, metadataName] of metadataNames.entries()) {
      const metadataPath = path.join(evidenceDirectory, metadataName);
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      const nextMetadataName = metadataNames[(index + 1) % metadataNames.length];
      writeFileSync(metadataPath, JSON.stringify({ ...metadata, artifact: nextMetadataName }));
    }

    const result = runVerifier(workspace);

    assert.equal(result.status, 1);
    assert.ok(result.report.failures.some((failure) => failure.startsWith("MUI-004 has no valid passing evidence")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("MUI-004 final gate requires every browser and viewport pair", () => {
  const workspace = createWorkspace({ completeMatrix: false });
  try {
    const result = runVerifier(workspace);
    assert.equal(result.status, 1);
    assert.ok(result.report.failures.includes("MUI-004 evidence is missing browser/viewport pair firefox/568x320"));
    assert.ok(result.report.failures.includes("MUI-004 evidence is missing browser/viewport pair webkit/320x568"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("MUI-004 requires pair-level engine and overflow assertions", () => {
  const workspace = createWorkspace({ completeMatrix: true });
  try {
    const evidenceDirectory = path.join(workspace, ".omo", "evidence", "mobile-uiux-v0.1.49", "MUI-004");
    for (const metadataName of readdirSync(evidenceDirectory).filter((file) => file.startsWith("firefox-") && file.endsWith(".json"))) {
      const metadataPath = path.join(evidenceDirectory, metadataName);
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      writeFileSync(metadataPath, JSON.stringify({ ...metadata, assertions: [] }));
    }

    const result = runVerifier(workspace);

    assert.equal(result.status, 1);
    assert.ok(result.report.failures.includes("MUI-004 evidence is missing pair assertions for firefox/320x568"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("MUI-004 requires a distinct artifact for every browser and viewport pair", () => {
  const workspace = createWorkspace({ completeMatrix: true });
  try {
    const evidenceDirectory = path.join(workspace, ".omo", "evidence", "mobile-uiux-v0.1.49", "MUI-004");
    const metadataNames = readdirSync(evidenceDirectory).filter((file) => file.endsWith(".json"));
    const sharedArtifact = JSON.parse(readFileSync(path.join(evidenceDirectory, metadataNames[0]), "utf8")).artifact;
    for (const metadataName of metadataNames) {
      const metadataPath = path.join(evidenceDirectory, metadataName);
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      writeFileSync(metadataPath, JSON.stringify({ ...metadata, artifact: sharedArtifact }));
    }

    const result = runVerifier(workspace);

    assert.equal(result.status, 1);
    assert.ok(result.report.failures.some((failure) => failure.startsWith("MUI-004 evidence reuses artifact")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("MUI-001 requires zoom evidence from Chromium and WebKit", () => {
  const workspace = createWorkspace({ completeMatrix: true });
  try {
    const result = runVerifier(workspace);

    assert.equal(result.status, 1);
    assert.ok(result.report.failures.includes("MUI-001 evidence is missing required scenario webkit zoom"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("MUI-006 requires each dialog surface to carry its own assertions", () => {
  const workspace = createWorkspace({ completeMatrix: true });
  try {
    const result = runVerifier(workspace);

    assert.equal(result.status, 1);
    assert.ok(result.report.failures.includes("MUI-006 evidence is missing required scenario holding sheet"));
    assert.ok(result.report.failures.includes("MUI-006 evidence is missing required scenario confirmation dialog"));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("final gate accepts complete browser and viewport evidence", () => {
  const workspace = createWorkspace({ completeMatrix: true, completeRequiredScenarios: true });
  try {
    const result = runVerifier(workspace);
    assert.equal(result.status, 0, JSON.stringify(result.report.failures));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
