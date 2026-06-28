export const HELP_TEXT = `Usage: node scripts/uiux_real_chrome_qa.mjs [options]

Real Chrome UI/UX QA harness.

Options:
  --help                 Print this help and exit.
  --tab <name>           App tab to open, for example dashboard, transactions, or import.
  --viewport <WxH>       Viewport size such as 390x844.
  --evidence <path>      JSON evidence output path.
  --scenario <name>      Scenario name to execute.

Implemented scenarios:
  shell-baseline         Verify global app shell CSS baseline in real Chrome/Chromium.
  nav-accessibility      Verify top-level nav labels, SVG icons, and current state.
  dashboard-chart-filter Verify mobile dashboard chart, filter, and context ergonomics.
  work-surface-ledger    Verify mobile transaction/holding ledger controls and expanded rows.
  import-report-state    Verify mobile import empty/report/technical-details states.
  performance-baseline   Measure dashboard, tab, chart, ledger, and import interactions.
`;

export const SCENARIOS = new Set([
  "shell-baseline",
  "nav-accessibility",
  "dashboard-chart-filter",
  "work-surface-ledger",
  "import-report-state",
  "performance-baseline",
]);

const KNOWN_OPTIONS = new Set(["--help", "--tab", "--viewport", "--evidence", "--scenario"]);
const VALUE_OPTIONS = new Set(["--tab", "--viewport", "--evidence", "--scenario"]);

export function parseArgs(argv) {
  const parsed = { help: false, tab: null, viewport: null, evidence: null, scenario: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!KNOWN_OPTIONS.has(arg)) {
      return { ok: false, error: `Unknown option: ${arg}` };
    }
    if (arg === "--help") {
      parsed.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (VALUE_OPTIONS.has(arg)) {
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: `Missing value for ${arg}` };
      }
      parsed[arg.slice(2)] = value;
      index += 1;
    }
  }
  return { ok: true, value: parsed };
}

export function missingRequiredOptions(parsed) {
  return ["tab", "viewport", "evidence", "scenario"].filter((key) => parsed[key] === null);
}

export function parseViewport(value) {
  const match = String(value || "").match(/^(\d+)x(\d+)$/u);
  if (!match) {
    throw new Error(`Invalid viewport: ${value}`);
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}
