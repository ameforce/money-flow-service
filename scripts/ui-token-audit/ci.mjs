import { inspectChangedOnly } from "./changed-only.mjs";
import { extractDeclaredValues, normalizeValue } from "./scanner.mjs";

export function runCi(args) {
  const declaredValues = extractDeclaredValues();
  if (args.probe) {
    const probe = normalizeValue(args.probe);
    if (!declaredValues.has(probe)) {
      process.stderr.write(`undeclared token: ${args.probe}\n`);
      process.exit(2);
    }
  }

  if (args.changedOnly) {
    const result = inspectChangedOnly(declaredValues, { baseRef: args.baseRef });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.violations.length > 0) {
      process.stderr.write("undeclared raw value found in changed audited UI lines\n");
      process.exit(2);
    }
    return;
  }

  process.stdout.write("token audit ci passed\n");
}
