#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const BASELINE_PATH = "docs/react-doctor-baseline.json";
const requireClean = process.argv.includes("--require-clean");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["run", "doctor:json", "--prefix", "frontend", "--silent"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
  shell: process.platform === "win32",
});

if (result.error || result.status !== 0) {
  console.error(result.stderr || result.error?.message || "react-doctor execution failed");
  process.exit(result.status || 1);
}

const output = String(result.stdout || "");
const jsonStart = output.indexOf("{");
const jsonEnd = output.lastIndexOf("}");
if (jsonStart < 0 || jsonEnd < jsonStart) {
  console.error("react-doctor did not emit a JSON report");
  process.exit(1);
}

const report = JSON.parse(output.slice(jsonStart, jsonEnd + 1));
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const summary = report.projects?.[0]?.summary || report.summary || {};
const errorCount = Number(summary.errorCount || 0);
const warningCount = Number(summary.warningCount || 0);
const maxErrorCount = requireClean ? 0 : Number(baseline.maxErrorCount);
const maxWarningCount = requireClean ? 0 : Number(baseline.maxWarningCount);
const failures = [];

if (!report.reactDetected) failures.push("React project was not detected");
if (errorCount > maxErrorCount) failures.push(`error count ${errorCount} exceeds ${maxErrorCount}`);
if (warningCount > maxWarningCount) failures.push(`warning count ${warningCount} exceeds ${maxWarningCount}`);

console.log(JSON.stringify({
  ok: failures.length === 0,
  mode: requireClean ? "final-zero" : "baseline-ratchet",
  version: report.version,
  score: summary.score,
  scoreLabel: summary.scoreLabel,
  errorCount,
  warningCount,
  limits: { maxErrorCount, maxWarningCount },
  failures,
}, null, 2));

process.exit(failures.length === 0 ? 0 : 1);
