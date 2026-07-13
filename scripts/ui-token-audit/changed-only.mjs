import { execFileSync } from "node:child_process";
import { diffHunkPattern, jsxDynamicStylePattern, jsxInlineStylePattern, jsxScanFiles, repoRoot, scanFiles } from "./config.mjs";
import { extractLineRawValues } from "./scanner.mjs";

export function selectBaseRef({
  explicitBaseRef = "",
  environmentBaseRef = "",
  baseSha = "",
  targetBranch = "",
  targetSha = "",
  headBranch = "",
  hotfixBaseRef = "",
  hotfixBaseSha = "",
  headSha = "",
  parentBaseRef = "",
} = {}) {
  const targetRef = targetBranch ? (targetBranch.startsWith("origin/") ? targetBranch : `origin/${targetBranch}`) : "";
  const normalizedHeadBranch = headBranch.replace(/^origin\//, "");
  const normalizedHotfixBranch = hotfixBaseRef.replace(/^origin\//, "");
  const hotfixIdentifier = normalizedHotfixBranch.replace(/^hotfix\//, "");
  const escapedHotfixIdentifier = hotfixIdentifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hotfixTaskPattern = escapedHotfixIdentifier
    ? new RegExp(`(?:^|[/_-])${escapedHotfixIdentifier}(?:$|[/_-])`)
    : null;
  const isHotfixTaskContext =
    normalizedHeadBranch === normalizedHotfixBranch ||
    Boolean(hotfixTaskPattern?.test(normalizedHeadBranch));
  const eligibleHotfixBaseRef = hotfixBaseRef && isHotfixTaskContext && (!headSha || !hotfixBaseSha || hotfixBaseSha !== headSha)
    ? hotfixBaseRef
    : "";
  return explicitBaseRef || environmentBaseRef || baseSha || targetSha || targetRef || eligibleHotfixBaseRef || parentBaseRef;
}

function findAncestorHotfixBaseRef() {
  const output = execFileSync(
    "git",
    ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/remotes/origin/hotfix/*"],
    { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  for (const ref of output.split(/\r?\n/).filter(Boolean)) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", ref, "HEAD"], {
        cwd: repoRoot,
        stdio: "ignore",
      });
      const sha = execFileSync("git", ["rev-parse", ref], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return { ref, sha };
    } catch {
      // Continue until the closest active hotfix ancestor is found.
    }
  }
  return { ref: "", sha: "" };
}

function findParentBaseRef() {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", "HEAD^"], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return "HEAD^";
  } catch {
    return "";
  }
}

function resolveBaseRef(explicitBaseRef) {
  const targetBranch = process.env.GITHUB_BASE_REF || process.env.CHANGE_TARGET || process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
  const headBranch =
    process.env.GITHUB_HEAD_REF ||
    process.env.CHANGE_BRANCH ||
    process.env.CI_COMMIT_REF_NAME ||
    process.env.BRANCH_NAME ||
    process.env.GIT_BRANCH ||
    execFileSync("git", ["branch", "--show-current"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const hotfixBase = findAncestorHotfixBaseRef();
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  return selectBaseRef({
    explicitBaseRef,
    environmentBaseRef: process.env.UI_TOKEN_AUDIT_BASE_REF,
    baseSha: process.env.GITHUB_BASE_SHA,
    targetBranch,
    targetSha: process.env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA,
    headBranch,
    hotfixBaseRef: hotfixBase.ref,
    hotfixBaseSha: hotfixBase.sha,
    headSha,
    parentBaseRef: findParentBaseRef(),
  });
}

function diffRevisionArgs(baseRef) {
  return baseRef ? [`${baseRef}...HEAD`] : [];
}

export function gitChangedFiles(baseRef = "") {
  try {
    const output = execFileSync("git", ["diff", ...diffRevisionArgs(baseRef), "--name-only", "--", ...scanFiles], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

export function gitAddedLines(baseRef = "") {
  const output = execFileSync("git", ["diff", ...diffRevisionArgs(baseRef), "--unified=0", "--", ...scanFiles], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const addedLines = [];
  let currentPath = "";
  let currentLine = 0;

  for (const diffLine of output.split(/\r?\n/)) {
    if (diffLine.startsWith("+++ b/")) {
      currentPath = diffLine.slice("+++ b/".length);
      continue;
    }

    const hunkMatch = diffLine.match(diffHunkPattern);
    if (hunkMatch) {
      currentLine = Number(hunkMatch[1]);
      continue;
    }

    if (!currentPath || !scanFiles.includes(currentPath)) continue;
    if (diffLine.startsWith("+++") || diffLine.startsWith("---")) continue;

    if (diffLine.startsWith("+")) {
      addedLines.push({ path: currentPath, line: currentLine, text: diffLine.slice(1) });
      currentLine += 1;
      continue;
    }

    if (!diffLine.startsWith("-") && currentLine > 0) currentLine += 1;
  }

  return addedLines;
}

export function inspectChangedOnly(declaredValues, options = {}) {
  const baseRef = resolveBaseRef(options.baseRef);
  const changedFiles = gitChangedFiles(baseRef);
  if (!baseRef && changedFiles.length === 0) {
    if (process.env.CI) {
      throw new Error("changed-only token audit requires a resolvable PR, hotfix, or parent baseline in clean CI");
    }
  }
  const auditedFiles = changedFiles.filter((path) => scanFiles.includes(path));
  const checkedValues = [];
  const jsxInlineStyleChecks = [];
  const violations = [];

  for (const addedLine of gitAddedLines(baseRef)) {
    for (const rawValue of extractLineRawValues(addedLine.text)) {
      const checkedValue = {
        file: addedLine.path,
        line: addedLine.line,
        type: rawValue.type,
        value: rawValue.value,
        declared: declaredValues.has(rawValue.value),
      };
      checkedValues.push(checkedValue);
      if (!checkedValue.declared) {
        violations.push({
          ...checkedValue,
          message: `undeclared raw value: ${rawValue.value}`,
        });
      }
    }

    if (jsxScanFiles.includes(addedLine.path) && jsxInlineStylePattern.test(addedLine.text)) {
      const dynamic = jsxDynamicStylePattern.test(addedLine.text);
      const checkedValue = {
        file: addedLine.path,
        line: addedLine.line,
        text: addedLine.text.trim(),
        dynamic,
        declared: dynamic,
      };
      jsxInlineStyleChecks.push(checkedValue);
      if (!dynamic) {
        violations.push({
          ...checkedValue,
          type: "jsx-inline-style",
          value: "static-style-object",
          message: "new static JSX inline style should be moved to CSS",
        });
      }
    }
  }

  return {
    mode: "ci",
    changedOnly: true,
    comparisonBase: baseRef || "working-tree",
    changedFiles,
    auditedFiles,
    checkedValues,
    jsxInlineStyleChecks,
    violations,
    result: violations.length === 0 ? "pass" : "fail",
  };
}
