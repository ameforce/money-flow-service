#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASELINE_PATH = "docs/react-doctor-baseline.json";
const REACT_FRAMEWORK_TOKENS = new Set([
  "expo",
  "gatsby",
  "next",
  "nextjs",
  "preact",
  "react",
  "reactjs",
  "reactnative",
  "remix",
]);

function hasVersion(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasReactEvidence(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  if (candidate.reactDetected === true) return true;
  if (
    hasVersion(candidate.reactVersion) ||
    hasVersion(candidate.preactVersion) ||
    hasVersion(candidate.expoVersion) ||
    candidate.hasReactNativeWorkspace === true
  ) {
    return true;
  }

  if (typeof candidate.framework !== "string") return false;
  const framework = candidate.framework.toLowerCase().replaceAll(/[^a-z]/g, "");
  return REACT_FRAMEWORK_TOKENS.has(framework);
}

export function detectReactProject(report) {
  if (!report || typeof report !== "object") return false;
  if (typeof report.reactDetected === "boolean") return report.reactDetected;
  if (!Array.isArray(report.projects)) return false;

  return report.projects.some((entry) =>
    [entry, entry?.project, entry?.coverage, entry?.project?.coverage].some(hasReactEvidence)
  );
}

function parseDiagnosticCount(value, label) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`react-doctor ${label} must be a non-negative integer`);
  }
  return value;
}

export function extractReactDoctorLimits(baseline, requireClean) {
  if (requireClean) return { maxErrorCount: 0, maxWarningCount: 0 };
  return {
    maxErrorCount: parseDiagnosticCount(
      baseline?.maxErrorCount,
      "baseline.maxErrorCount"
    ),
    maxWarningCount: parseDiagnosticCount(
      baseline?.maxWarningCount,
      "baseline.maxWarningCount"
    ),
  };
}

function readCountPair(candidate, label) {
  if (!candidate || typeof candidate !== "object") return null;

  const hasErrorCount = Object.hasOwn(candidate, "errorCount");
  const hasWarningCount = Object.hasOwn(candidate, "warningCount");
  if (!hasErrorCount && !hasWarningCount) return null;
  if (!hasErrorCount || !hasWarningCount) {
    throw new TypeError(`react-doctor ${label} must contain both errorCount and warningCount`);
  }

  return {
    errorCount: parseDiagnosticCount(candidate.errorCount, `${label}.errorCount`),
    warningCount: parseDiagnosticCount(candidate.warningCount, `${label}.warningCount`),
  };
}

function readContainerMetrics(container, label) {
  return readCountPair(container?.summary, `${label}.summary`) ?? readCountPair(container, label);
}

function addAggregate(aggregates, metrics, label) {
  if (metrics) aggregates.push({ ...metrics, label });
}

export function extractReactDoctorMetrics(report) {
  if (!report || typeof report !== "object") {
    throw new TypeError("react-doctor report must be an object");
  }

  const aggregates = [];
  addAggregate(aggregates, readContainerMetrics(report, "report"), "report");
  addAggregate(aggregates, readContainerMetrics(report.project, "project"), "project");

  if (Array.isArray(report.projects) && report.projects.length > 0) {
    const projectMetrics = report.projects.map((project, index) =>
      readContainerMetrics(project, `projects[${index}]`)
    );
    if (projectMetrics.every(Boolean)) {
      addAggregate(
        aggregates,
        projectMetrics.reduce(
          (total, metrics) => ({
            errorCount: total.errorCount + metrics.errorCount,
            warningCount: total.warningCount + metrics.warningCount,
          }),
          { errorCount: 0, warningCount: 0 }
        ),
        "projects"
      );
    }
  }

  if (aggregates.length === 0) {
    throw new TypeError(
      "react-doctor report does not contain valid errorCount and warningCount metrics"
    );
  }

  const [selected, ...remaining] = aggregates;
  const inconsistent = remaining.find(
    (candidate) =>
      candidate.errorCount !== selected.errorCount ||
      candidate.warningCount !== selected.warningCount
  );
  if (inconsistent) {
    throw new TypeError(
      `react-doctor diagnostic counts disagree between ${selected.label} and ${inconsistent.label}`
    );
  }

  const scoreSource =
    [
      report.summary,
      report,
      report.project?.summary,
      report.project,
      report.projects?.[0]?.summary,
      report.projects?.[0],
    ].find(
      (candidate) =>
        candidate &&
        (Object.hasOwn(candidate, "score") || Object.hasOwn(candidate, "scoreLabel"))
    ) ?? {};

  return {
    errorCount: selected.errorCount,
    warningCount: selected.warningCount,
    score: scoreSource.score,
    scoreLabel: scoreSource.scoreLabel,
  };
}

function run() {
  const requireClean = process.argv.includes("--require-clean");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npmCommand,
    ["run", "doctor:json", "--prefix", "frontend", "--silent"],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === "win32",
    }
  );

  if (result.error || result.status !== 0) {
    console.error(result.stderr || result.error?.message || "react-doctor execution failed");
    return result.status || 1;
  }

  const output = String(result.stdout || "");
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart) {
    console.error("react-doctor did not emit a JSON report");
    return 1;
  }

  const report = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const metrics = extractReactDoctorMetrics(report);
  const { maxErrorCount, maxWarningCount } = extractReactDoctorLimits(baseline, requireClean);
  const failures = [];

  if (!detectReactProject(report)) failures.push("React project was not detected");
  if (metrics.errorCount > maxErrorCount) {
    failures.push(`error count ${metrics.errorCount} exceeds ${maxErrorCount}`);
  }
  if (metrics.warningCount > maxWarningCount) {
    failures.push(`warning count ${metrics.warningCount} exceeds ${maxWarningCount}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        mode: requireClean ? "final-zero" : "baseline-ratchet",
        version: report.version,
        score: metrics.score,
        scoreLabel: metrics.scoreLabel,
        errorCount: metrics.errorCount,
        warningCount: metrics.warningCount,
        limits: { maxErrorCount, maxWarningCount },
        failures,
      },
      null,
      2
    )
  );

  return failures.length === 0 ? 0 : 1;
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMainModule) process.exit(run());
