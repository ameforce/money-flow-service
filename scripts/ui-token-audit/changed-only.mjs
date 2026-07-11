import { execFileSync } from "node:child_process";
import { diffHunkPattern, jsxDynamicStylePattern, jsxInlineStylePattern, jsxScanFiles, repoRoot, scanFiles } from "./config.mjs";
import { extractLineRawValues } from "./scanner.mjs";

function resolveBaseRef(explicitBaseRef) {
  const targetBranch = process.env.GITHUB_BASE_REF || process.env.CHANGE_TARGET || process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
  return explicitBaseRef
    || process.env.UI_TOKEN_AUDIT_BASE_REF
    || process.env.GITHUB_BASE_SHA
    || process.env.CI_MERGE_REQUEST_TARGET_BRANCH_SHA
    || (targetBranch ? `origin/${targetBranch}` : "");
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
  let baseRef = resolveBaseRef(options.baseRef);
  let changedFiles = gitChangedFiles(baseRef);
  if (!baseRef && changedFiles.length === 0) {
    if (process.env.CI) {
      throw new Error("changed-only token audit requires a PR base ref in clean CI (GITHUB_BASE_SHA, GITHUB_BASE_REF, CHANGE_TARGET, or UI_TOKEN_AUDIT_BASE_REF)");
    }
    baseRef = "HEAD^";
    changedFiles = gitChangedFiles(baseRef);
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
