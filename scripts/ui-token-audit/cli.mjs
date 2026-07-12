export function parseArgs(argv) {
  const parsed = { mode: "report", changedOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--mode=")) parsed.mode = arg.slice("--mode=".length);
    else if (arg === "--mode") parsed.mode = argv[++index];
    else if (arg === "--out") parsed.out = argv[++index];
    else if (arg.startsWith("--out=")) parsed.out = arg.slice("--out=".length);
    else if (arg === "--changed-only") parsed.changedOnly = true;
    else if (arg === "--base-ref") parsed.baseRef = argv[++index];
    else if (arg.startsWith("--base-ref=")) parsed.baseRef = arg.slice("--base-ref=".length);
    else if (arg === "--probe") parsed.probe = argv[++index];
    else if (arg.startsWith("--probe=")) parsed.probe = arg.slice("--probe=".length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}
