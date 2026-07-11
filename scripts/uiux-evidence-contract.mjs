const MODAL_ASSERTIONS = ["focus-trap", "background-inert", "escape", "return-focus"];
const FORM_SURFACES = ["auth", "dashboard filters", "settings", "collaboration", "import"];
const FORM_VIEWPORTS = ["915x412", "844x390"];
const MOTION_SURFACES = ["auth", "dashboard", "transactions", "holdings", "import", "settings", "collaboration"];

export const MUI_004_REQUIRED_BROWSERS = ["chromium", "firefox", "webkit"];
export const MUI_004_REQUIRED_VIEWPORTS = [
  "320x568", "568x320", "360x800", "800x360", "390x844", "844x390",
  "412x915", "915x412", "768x1024", "1024x768", "1280x720", "1440x900",
];

export const REQUIRED_ASSERTIONS_BY_FINDING = {
  "MUI-001": ["zoom-enabled"],
  "MUI-002": ["keyboard-upload"],
  "MUI-003": ["horizontal-pan"],
  "MUI-004": ["engine-matrix", "matrix-complete", "orientation-state-preservation", "zero-overflow"],
  "MUI-005": ["font-size-16"],
  "MUI-006": [...MODAL_ASSERTIONS, "nested-confirmation"],
  "MUI-007": ["target-size-44"],
  "MUI-008": ["tab-semantics", "arrow-navigation"],
  "MUI-009": ["assertive-error", "polite-status"],
  "MUI-010": ["reduced-motion"],
  "MUI-011": ["first-task-visible", "chart-readable"],
  "MUI-012": ["token-audit"],
  "MUI-013": ["react-doctor-zero", "react-scan-stable", "state-preservation"],
};

export const REQUIRED_SCENARIOS_BY_FINDING = {
  "MUI-001": [
    { label: "chromium zoom", browser: "chromium", assertions: ["zoom-enabled"] },
    { label: "webkit zoom", browser: "webkit", assertions: ["zoom-enabled"] },
  ],
  "MUI-002": [
    { label: "workbook upload", scenario: "workbook-upload", assertions: ["keyboard-upload", "focus-order"] },
    { label: "toss upload", scenario: "toss-upload", assertions: ["keyboard-upload", "focus-order"] },
    { label: "migration upload", scenario: "migration-upload", assertions: ["keyboard-upload", "focus-order"] },
  ],
  "MUI-003": [
    { label: "320x568 touch access", browser: "chromium", viewport: "320x568", scenario: "touch-access", assertions: ["horizontal-pan", "editable-columns-reachable"] },
    { label: "320x568 keyboard access", browser: "chromium", viewport: "320x568", scenario: "keyboard-access", assertions: ["horizontal-pan", "editable-columns-reachable"] },
    { label: "390x844 touch access", browser: "chromium", viewport: "390x844", scenario: "touch-access", assertions: ["horizontal-pan", "editable-columns-reachable"] },
    { label: "390x844 keyboard access", browser: "chromium", viewport: "390x844", scenario: "keyboard-access", assertions: ["horizontal-pan", "editable-columns-reachable"] },
  ],
  "MUI-004": MUI_004_REQUIRED_BROWSERS.map((browser) => ({
    label: `${browser} orientation state`,
    browser,
    scenario: "orientation-state-preservation",
    assertions: ["matrix-complete", "orientation-state-preservation"],
  })),
  "MUI-005": FORM_VIEWPORTS.flatMap((viewport) => FORM_SURFACES.map((surface) => ({
    label: `${surface} ${viewport} WebKit text`,
    browser: "webkit",
    viewport,
    scenario: `${surface.replaceAll(" ", "-")}-form-text`,
    assertions: ["font-size-16"],
  }))),
  "MUI-006": [
    { label: "transaction sheet", scenario: "transaction-sheet", assertions: MODAL_ASSERTIONS },
    { label: "holding sheet", scenario: "holding-sheet", assertions: MODAL_ASSERTIONS },
    { label: "confirmation dialog", scenario: "confirmation-dialog", assertions: [...MODAL_ASSERTIONS, "nested-confirmation"] },
  ],
  "MUI-007": [
    { label: "transaction targets", scenario: "transaction-targets", assertions: ["target-size-44"] },
    { label: "holding targets", scenario: "holding-targets", assertions: ["target-size-44"] },
    { label: "settings targets", scenario: "settings-targets", assertions: ["target-size-44"] },
    { label: "landscape navigation targets", scenario: "landscape-navigation-targets", assertions: ["target-size-44"] },
  ],
  "MUI-008": [
    { label: "collaboration tabs", scenario: "collaboration-tabs", assertions: ["tab-semantics", "arrow-navigation"] },
    { label: "import tabs", scenario: "import-tabs", assertions: ["tab-semantics", "arrow-navigation"] },
  ],
  "MUI-009": [
    { label: "blocking error", scenario: "blocking-error", assertions: ["assertive-error"] },
    { label: "non-blocking status", scenario: "non-blocking-status", assertions: ["polite-status"] },
  ],
  "MUI-010": MOTION_SURFACES.flatMap((surface) => [
    {
      label: `${surface} computed styles`,
      scenario: `${surface}-computed-styles`,
      assertions: ["reduced-motion", "computed-styles"],
    },
    {
      label: `${surface} interaction states`,
      scenario: `${surface}-interaction-states`,
      assertions: ["reduced-motion", "interaction-states"],
    },
  ]),
  "MUI-011": [
    { label: "800x360 dashboard", viewport: "800x360", scenario: "dashboard-landscape", assertions: ["first-task-visible", "chart-readable"] },
    { label: "844x390 dashboard", viewport: "844x390", scenario: "dashboard-landscape", assertions: ["first-task-visible", "chart-readable"] },
    { label: "915x412 dashboard", viewport: "915x412", scenario: "dashboard-landscape", assertions: ["first-task-visible", "chart-readable"] },
  ],
  "MUI-012": [
    { label: "token audit", scenario: "token-audit", assertions: ["token-audit"] },
  ],
  "MUI-013": [
    { label: "react doctor", scenario: "react-doctor", assertions: ["react-doctor-zero"] },
    { label: "react scan", scenario: "react-scan", assertions: ["react-scan-stable"] },
    { label: "frontend build", scenario: "frontend-build", assertions: ["build-passed"] },
    { label: "state preservation", scenario: "state-preservation", assertions: ["state-preservation"] },
  ],
};
