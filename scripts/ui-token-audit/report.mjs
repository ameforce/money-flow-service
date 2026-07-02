import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { customPropertyPattern, repoRoot, scanFiles } from "./config.mjs";
import { scanCssFiles, scanJsxFiles } from "./scanner.mjs";

export function buildReport() {
  const files = scanCssFiles();
  const jsxFiles = scanJsxFiles();
  const totals = files.reduce(
    (acc, file) => {
      for (const [key, count] of Object.entries(file.tokenCounts)) acc.tokenCounts[key] += count;
      for (const category of Object.keys(acc.rawValueCounts)) {
        for (const [value, count] of Object.entries(file.rawValueCounts[category])) {
          acc.rawValueCounts[category][value] = (acc.rawValueCounts[category][value] ?? 0) + count;
        }
      }
      return acc;
    },
    {
      tokenCounts: { customProperties: 0, colorTokens: 0, radiusTokens: 0, shadowTokens: 0 },
      rawValueCounts: { colors: {}, radii: {}, shadows: {} },
    },
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    files,
    tokenCounts: totals.tokenCounts,
    rawValueCounts: totals.rawValueCounts,
    allowlist: {
      tokenDefinitionPattern: String(customPropertyPattern),
      declaredSources: ["DESIGN.md", "CSS custom property definition lines in audited files"],
      rawDebtMode: "report-only baseline; changed-only CI fails undeclared added raw values",
      productUiFiles: scanFiles,
      jsxInlineStyleMode: "changed-only CI fails newly added static JSX style objects; dynamic computed geometry/color styles must be justified separately",
    },
    jsxFiles,
  };
}

export function writeReport(report, outPath) {
  if (!outPath) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  mkdirSync(dirname(`${repoRoot}/${outPath}`), { recursive: true });
  writeFileSync(`${repoRoot}/${outPath}`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
