#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const espreePath = require.resolve("espree", { paths: [path.resolve("frontend")] });
const espree = await import(pathToFileURL(espreePath).href);

const APP_PATH = "frontend/src/App.jsx";
const PAGE_SPECS = {
  dashboard: { component: "DashboardPage", file: "frontend/src/pages/DashboardPage.jsx", propsVar: "dashboardPageProps" },
  transactions: { component: "TransactionsPage", file: "frontend/src/pages/TransactionsPage.jsx", propsVar: "transactionsPageProps" },
  holdings: { component: "HoldingsPage", file: "frontend/src/pages/HoldingsPage.jsx", propsVar: "holdingsPageProps" },
  settings: { component: "SettingsPage", file: "frontend/src/pages/SettingsPage.jsx", propsVar: "settingsPageProps" },
  collaboration: { component: "CollaborationPage", file: "frontend/src/pages/CollaborationPage.jsx", propsVar: "collaborationPageProps" },
  import: { component: "ImportPage", file: "frontend/src/pages/ImportPage.jsx", propsVar: "importPageProps" },
};
const SOURCE_REF = String(process.env.APP_EXTRACTION_REF || "").trim();
const MAX_APP_LINES = 11_500;
const MIN_PAGE_GROUPS = 3;
const MAX_PAGE_GROUPS = 16;
const MAX_GROUP_FIELDS = 18;

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

function readSource(filePath) {
  if (!SOURCE_REF) {
    return readFileSync(filePath, "utf8");
  }
  return execFileSync("git", ["show", `${SOURCE_REF}:${filePath}`], { encoding: "utf8" });
}

function sourceExists(filePath) {
  if (!SOURCE_REF) {
    return existsSync(filePath);
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${SOURCE_REF}:${filePath}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
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

function propertyName(property) {
  const key = property?.key;
  if (!key) {
    return "";
  }
  if (key.type === "Identifier") {
    return key.name;
  }
  return String(key.value || "");
}

function patternName(property) {
  const key = property?.key;
  if (!key) {
    return "";
  }
  if (key.type === "Identifier") {
    return key.name;
  }
  return String(key.value || "");
}

function pageComponentName(node) {
  if (node?.type !== "JSXElement") {
    return "";
  }
  const name = node.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : "";
}

function spreadPropName(node) {
  if (node?.type !== "JSXElement") {
    return "";
  }
  const spread = node.openingElement.attributes.find((attribute) => attribute.type === "JSXSpreadAttribute");
  return spread?.argument?.type === "Identifier" ? spread.argument.name : "";
}

function extractComponentParamGroups(ast, componentName) {
  let groups = null;
  walk(ast, (node) => {
    if (groups || node.type !== "FunctionDeclaration" || node.id?.name !== componentName) {
      return;
    }
    const param = node.params[0];
    if (param?.type !== "ObjectPattern") {
      groups = [];
      return;
    }
    groups = param.properties.map(patternName).filter(Boolean);
  });
  return groups;
}

function extractPageGroupFields(ast, pageFile) {
  const groups = new Map();
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "ObjectPattern" || node.init?.type !== "Identifier") {
      return;
    }
    const groupName = node.init.name;
    const fields = node.id.properties.map(patternName).filter(Boolean);
    groups.set(groupName, fields);
  });
  if (groups.has("view")) {
    throw new Error(`${pageFile} must not destructure fields from view`);
  }
  return groups;
}

function extractAppPropsObject(ast, propsVar) {
  let props = null;
  walk(ast, (node) => {
    if (props || node.type !== "VariableDeclarator" || node.id?.name !== propsVar || node.init?.type !== "ObjectExpression") {
      return;
    }
    props = new Map();
    for (const groupProperty of node.init.properties) {
      const groupName = propertyName(groupProperty);
      if (!groupName || groupProperty.value?.type !== "ObjectExpression") {
        continue;
      }
      props.set(
        groupName,
        groupProperty.value.properties.map(propertyName).filter(Boolean)
      );
    }
  });
  return props;
}

function sameSet(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return left.length === right.length && left.every((item) => rightSet.has(item)) && right.every((item) => leftSet.has(item));
}

function sortedMissing(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((item) => !actualSet.has(item)).sort();
}

function sortedExtra(expected, actual) {
  const expectedSet = new Set(expected);
  return actual.filter((item) => !expectedSet.has(item)).sort();
}

function addGroupContractFailures(failures, label, groups) {
  if (groups.length < MIN_PAGE_GROUPS || groups.length > MAX_PAGE_GROUPS) {
    failures.push(`${label} must expose ${MIN_PAGE_GROUPS}-${MAX_PAGE_GROUPS} explicit prop groups; found ${groups.length}`);
  }
  if (groups.includes("view")) {
    failures.push(`${label} must not expose a catch-all view prop`);
  }
}

function addFieldContractFailures(failures, label, groupName, fields) {
  if (fields.length > MAX_GROUP_FIELDS) {
    failures.push(`${label}.${groupName} exposes ${fields.length} fields; expected <= ${MAX_GROUP_FIELDS}`);
  }
  const rawSetters = fields.filter((field) => /^set[A-Z]/.test(field));
  if (rawSetters.length > 0) {
    failures.push(`${label}.${groupName} leaks raw React setters: ${rawSetters.join(", ")}`);
  }
}

const failures = [];
const appSource = readSource(APP_PATH);
const appAst = parseSource(appSource, APP_PATH);
const appLines = appSource.split(/\r?\n/).length;

if (appLines > MAX_APP_LINES) {
  failures.push(`${APP_PATH} has ${appLines} lines; expected <= ${MAX_APP_LINES} after page extraction`);
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
if (/PageView\b/.test(appSource) || /\bview=\{/.test(appSource)) {
  failures.push("App.jsx must route page components with explicit grouped props, not PageView/view bags");
}

const routedTabs = new Map();
const routedPropVars = new Map();
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
    routedPropVars.set(left.right.value, spreadPropName(node.right));
  }
});

const pageReports = {};
for (const [tab, spec] of Object.entries(PAGE_SPECS)) {
  const component = routedTabs.get(tab);
  if (component !== spec.component) {
    failures.push(`tab "${tab}" must route to ${spec.component}; found ${component || "inline/missing"}`);
  }
  const routedPropVar = routedPropVars.get(tab);
  if (routedPropVar !== spec.propsVar) {
    failures.push(`tab "${tab}" must spread ${spec.propsVar}; found ${routedPropVar || "missing/non-spread props"}`);
  }
  if (!appSource.includes(`import { ${spec.component} } from "./pages/${spec.component}";`)) {
    failures.push(`App.jsx must import ${spec.component} from ./pages/${spec.component}`);
  }
  if (!sourceExists(spec.file)) {
    failures.push(`${spec.file} is missing`);
    continue;
  }

  const pageSource = readSource(spec.file);
  const pageAst = parseSource(pageSource, spec.file);
  if (/export function \w+\(\{ view \}\)/.test(pageSource) || /\bview\b/.test(pageSource)) {
    failures.push(`${spec.file} must not accept or reference a catch-all view prop`);
  }

  const pageGroups = extractComponentParamGroups(pageAst, spec.component) || [];
  const appProps = extractAppPropsObject(appAst, spec.propsVar);
  if (!appProps) {
    failures.push(`App.jsx must define ${spec.propsVar}`);
    continue;
  }
  const appGroups = Array.from(appProps.keys());
  addGroupContractFailures(failures, spec.file, pageGroups);
  addGroupContractFailures(failures, `App.jsx ${spec.propsVar}`, appGroups);
  if (!sameSet(pageGroups, appGroups)) {
    failures.push(
      `${spec.component} group contract mismatch; missing in App: ${sortedMissing(pageGroups, appGroups).join(", ") || "-"}; extra in App: ${sortedExtra(pageGroups, appGroups).join(", ") || "-"}`
    );
  }

  const pageFieldsByGroup = extractPageGroupFields(pageAst, spec.file);
  for (const groupName of pageGroups) {
    const pageFields = pageFieldsByGroup.get(groupName) || [];
    const appFields = appProps.get(groupName) || [];
    addFieldContractFailures(failures, `${spec.file}`, groupName, pageFields);
    addFieldContractFailures(failures, `App.jsx ${spec.propsVar}`, groupName, appFields);
    if (!sameSet(pageFields, appFields)) {
      failures.push(
        `${spec.component}.${groupName} field contract mismatch; missing in App: ${sortedMissing(pageFields, appFields).join(", ") || "-"}; extra in App: ${sortedExtra(pageFields, appFields).join(", ") || "-"}`
      );
    }
  }
  pageReports[tab] = {
    component: spec.component,
    file: spec.file,
    propsVar: spec.propsVar,
    groups: Object.fromEntries(
      pageGroups.map((groupName) => [groupName, { fieldCount: (pageFieldsByGroup.get(groupName) || []).length }])
    ),
  };
}

const report = {
  ok: failures.length === 0,
  sourceRef: SOURCE_REF || "worktree",
  appLines,
  maxAppLines: MAX_APP_LINES,
  maxPageGroups: MAX_PAGE_GROUPS,
  maxGroupFields: MAX_GROUP_FIELDS,
  routedTabs: Object.fromEntries(routedTabs.entries()),
  routedPropVars: Object.fromEntries(routedPropVars.entries()),
  pages: pageReports,
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
