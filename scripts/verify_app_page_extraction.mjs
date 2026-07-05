#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as espree from "../frontend/node_modules/espree/espree.js";

const APP_PATH = path.resolve("frontend", "src", "App.jsx");
const PAGE_SPECS = {
  dashboard: { component: "DashboardPage", file: "frontend/src/pages/DashboardPage.jsx" },
  transactions: { component: "TransactionsPage", file: "frontend/src/pages/TransactionsPage.jsx" },
  holdings: { component: "HoldingsPage", file: "frontend/src/pages/HoldingsPage.jsx" },
  settings: { component: "SettingsPage", file: "frontend/src/pages/SettingsPage.jsx" },
  collaboration: { component: "CollaborationPage", file: "frontend/src/pages/CollaborationPage.jsx" },
  import: { component: "ImportPage", file: "frontend/src/pages/ImportPage.jsx" },
};
const MAX_APP_LINES = 12_000;

function isNode(value) {
  return value && typeof value.type === "string";
}

function walk(node, visit, parent = null) {
  if (!isNode(node)) {
    return;
  }
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "range" || key === "parent") {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((child) => walk(child, visit, node));
    } else if (isNode(value)) {
      walk(value, visit, node);
    }
  }
}

function parseSource(source, filePath) {
  try {
    return espree.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: true },
      loc: true,
    });
  } catch (error) {
    throw new Error(`${filePath} parse failed: ${error.message}`);
  }
}

function pageComponentName(node) {
  if (node?.type !== "JSXElement") {
    return "";
  }
  const name = node.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : "";
}

const failures = [];
const appSource = readFileSync(APP_PATH, "utf8");
const appAst = parseSource(appSource, "frontend/src/App.jsx");
const appLines = appSource.split(/\r?\n/).length;

if (appLines > MAX_APP_LINES) {
  failures.push(`frontend/src/App.jsx has ${appLines} lines; expected <= ${MAX_APP_LINES} after page extraction`);
}
if (!appSource.includes('import { useCompactViewport } from "./hooks/useCompactViewport";')) {
  failures.push("App.jsx must use the shared useCompactViewport hook");
}
if (appSource.includes("setIsCompactViewport")) {
  failures.push("App.jsx must not own viewport synchronization state directly");
}
if (appSource.includes("<Fragment") && !/import\s+\{[^}]*\bFragment\b[^}]*\}\s+from\s+"react";/.test(appSource)) {
  failures.push("App.jsx uses <Fragment> and must import Fragment from react");
}

const routedTabs = new Map();
walk(appAst, (node) => {
  if (node.type !== "LogicalExpression" || node.operator !== "&&") {
    return;
  }
  const left = node.left;
  if (
    left?.type === "BinaryExpression" &&
    left.operator === "===" &&
    left.left.type === "Identifier" &&
    left.left.name === "tab" &&
    left.right.type === "Literal"
  ) {
    routedTabs.set(left.right.value, pageComponentName(node.right));
  }
});

for (const [tab, spec] of Object.entries(PAGE_SPECS)) {
  const component = routedTabs.get(tab);
  if (component !== spec.component) {
    failures.push(`tab "${tab}" must route to ${spec.component}; found ${component || "inline/missing"}`);
  }
  if (!appSource.includes(`import { ${spec.component} } from "./pages/${spec.component}";`)) {
    failures.push(`App.jsx must import ${spec.component} from ./pages/${spec.component}`);
  }
  if (!existsSync(spec.file)) {
    failures.push(`${spec.file} is missing`);
    continue;
  }
  const pageSource = readFileSync(spec.file, "utf8");
  parseSource(pageSource, spec.file);
  if (!pageSource.includes(`export function ${spec.component}({ view })`)) {
    failures.push(`${spec.file} must export ${spec.component} with a narrow view prop contract`);
  }
}

const report = {
  ok: failures.length === 0,
  appLines,
  maxAppLines: MAX_APP_LINES,
  routedTabs: Object.fromEntries(routedTabs.entries()),
  pages: PAGE_SPECS,
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
