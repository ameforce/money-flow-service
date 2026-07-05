export const APP_PATH = "frontend/src/App.jsx";
export const VERIFIER_PATH = "scripts/verify_app_page_extraction.mjs";
export const APP_SIZE_CEILING = 10852;
export const SIZE_BUDGET = 250;
export const MIN_PAGE_GROUPS = 3;
export const MAX_PAGE_GROUPS = 16;
export const MAX_GROUP_FIELDS = 18;

export const PAGE_SPECS = {
  dashboard: {
    component: "DashboardPage",
    file: "frontend/src/pages/DashboardPage.jsx",
    componentDir: "frontend/src/pages/dashboard",
    propsVar: "dashboardPageProps",
  },
  transactions: {
    component: "TransactionsPage",
    file: "frontend/src/pages/TransactionsPage.jsx",
    componentDir: "frontend/src/pages/transactions",
    propsVar: "transactionsPageProps",
  },
  holdings: {
    component: "HoldingsPage",
    file: "frontend/src/pages/HoldingsPage.jsx",
    componentDir: "frontend/src/pages/holdings",
    propsVar: "holdingsPageProps",
  },
  settings: {
    component: "SettingsPage",
    file: "frontend/src/pages/SettingsPage.jsx",
    componentDir: "frontend/src/pages/settings",
    propsVar: "settingsPageProps",
  },
  collaboration: {
    component: "CollaborationPage",
    file: "frontend/src/pages/CollaborationPage.jsx",
    componentDir: "frontend/src/pages/collaboration",
    propsVar: "collaborationPageProps",
  },
  import: {
    component: "ImportPage",
    file: "frontend/src/pages/ImportPage.jsx",
    componentDir: "frontend/src/pages/importing",
    propsVar: "importPageProps",
  },
};
