#!/usr/bin/env node
import { runCi } from "./ui-token-audit/ci.mjs";
import { parseArgs } from "./ui-token-audit/cli.mjs";
import { buildReport, writeReport } from "./ui-token-audit/report.mjs";

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "report") {
    writeReport(buildReport(), args.out);
    return;
  }
  if (args.mode === "ci") {
    runCi(args);
    return;
  }
  throw new Error(`unsupported mode: ${args.mode}`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
