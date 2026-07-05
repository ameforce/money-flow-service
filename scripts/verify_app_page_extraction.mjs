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
  dashboard: { component: "DashboardPage", file: "frontend/src/pages/DashboardPage.jsx", propsVar: "dashboardPageProps", maxLines: 460 },
  transactions: { component: "TransactionsPage", file: "frontend/src/pages/TransactionsPage.jsx", propsVar: "transactionsPageProps", maxLines: 720 },
  holdings: { component: "HoldingsPage", file: "frontend/src/pages/HoldingsPage.jsx", propsVar: "holdingsPageProps", maxLines: 660 },
  settings: { component: "SettingsPage", file: "frontend/src/pages/SettingsPage.jsx", propsVar: "settingsPageProps", maxLines: 760 },
  collaboration: { component: "CollaborationPage", file: "frontend/src/pages/CollaborationPage.jsx", propsVar: "collaborationPageProps", maxLines: 480 },
  import: { component: "ImportPage", file: "frontend/src/pages/ImportPage.jsx", propsVar: "importPageProps", maxLines: 900 },
};
const SOURCE_REF = String(process.env.APP_EXTRACTION_REF || "").trim();
const MAX_APP_LINES = 11_500;
const MAX_VERIFIER_LINES = 450;
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
  if (property?.type === "SpreadElement") {
    return `...${expressionName(property.argument) || "spread"}`;
  }
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
  if (property?.type === "RestElement") {
    return `...${expressionName(property.argument) || "rest"}`;
  }
  const key = property?.key;
  if (!key) {
    return "";
  }
  if (key.type === "Identifier") {
    return key.name;
  }
  return String(key.value || "");
}

function expressionName(expression) {
  if (!expression) {
    return "";
  }
  if (expression.type === "Identifier") {
    return expression.name;
  }
  if (expression.type === "MemberExpression") {
    const objectName = expressionName(expression.object);
    const propertyName = expressionName(expression.property);
    return [objectName, propertyName].filter(Boolean).join(".");
  }
  return "";
}

function pageComponentName(node) {
  if (node?.type !== "JSXElement") {
    return "";
  }
  const name = node.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : "";
}

function jsxAttributeNames(node) {
  if (node?.type !== "JSXElement") {
    return [];
  }
  return node.openingElement.attributes.map((attribute) => {
    if (attribute.type === "JSXSpreadAttribute") {
      return `...${expressionName(attribute.argument) || "spread"}`;
    }
    return attribute.name?.name || "unknown-attribute";
  });
}

function componentAttributeSets(ast, componentName) {
  const attributeSets = [];
  walk(ast, (node) => {
    if (pageComponentName(node) === componentName) {
      attributeSets.push(jsxAttributeNames(node));
    }
  });
  return attributeSets;
}

function routePropsContract(node) {
  if (node?.type !== "JSXElement") {
    return { spreadName: "", spreadCount: 0, extraAttributes: ["missing-jsx"] };
  }
  const spreads = [];
  const extraAttributes = [];
  for (const attribute of node.openingElement.attributes) {
    if (attribute.type === "JSXSpreadAttribute") {
      spreads.push(attribute.argument?.type === "Identifier" ? attribute.argument.name : "non-identifier-spread");
      continue;
    }
    extraAttributes.push(attribute.name?.name || "unknown-attribute");
  }
  return { spreadName: spreads[0] || "", spreadCount: spreads.length, extraAttributes };
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
      const fields = [];
      const rawSetterValues = [];
      const unsupportedFields = [];
      for (const property of groupProperty.value.properties) {
        const fieldName = propertyName(property);
        if (!fieldName) {
          continue;
        }
        if (fieldName.startsWith("...")) {
          unsupportedFields.push(fieldName);
          continue;
        }
        fields.push(fieldName);
        const valueName = expressionName(property.value);
        if (/^set[A-Z]/.test(valueName)) {
          rawSetterValues.push(`${fieldName}->${valueName}`);
        }
      }
      props.set(groupName, { fields, rawSetterValues, unsupportedFields });
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
  const restGroups = groups.filter((groupName) => groupName.startsWith("..."));
  if (restGroups.length > 0) {
    failures.push(`${label} must not expose rest props: ${restGroups.join(", ")}`);
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
  const restFields = fields.filter((field) => field.startsWith("..."));
  if (restFields.length > 0) {
    failures.push(`${label}.${groupName} must not use rest/spread fields: ${restFields.join(", ")}`);
  }
}

const failures = [];
const appSource = readSource(APP_PATH);
const appAst = parseSource(appSource, APP_PATH);
const appLines = appSource.split(/\r?\n/).length;
const verifierLines = SOURCE_REF ? readFileSync(new URL(import.meta.url), "utf8").split(/\r?\n/).length : readSource("scripts/verify_app_page_extraction.mjs").split(/\r?\n/).length;

if (appLines > MAX_APP_LINES) {
  failures.push(`${APP_PATH} has ${appLines} lines; expected <= ${MAX_APP_LINES} after page extraction`);
}
if (verifierLines > MAX_VERIFIER_LINES) {
  failures.push(`scripts/verify_app_page_extraction.mjs has ${verifierLines} lines; expected <= ${MAX_VERIFIER_LINES}`);
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
if (appSource.includes("<IsoDateInput") && !appSource.includes('import { IsoDateInput } from "./components/IsoDateInput";')) {
  failures.push("App.jsx uses <IsoDateInput> and must import IsoDateInput from ./components/IsoDateInput");
}
if (/PageView\b/.test(appSource) || /\bview=\{/.test(appSource)) {
  failures.push("App.jsx must route page components with explicit grouped props, not PageView/view bags");
}

const routedTabs = new Map();
const routedPropVars = new Map();
const routedContracts = new Map();
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
    const routeContract = routePropsContract(node.right);
    routedTabs.set(left.right.value, pageComponentName(node.right));
    routedPropVars.set(left.right.value, routeContract.spreadName);
    routedContracts.set(left.right.value, routeContract);
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
  const routeContract = routedContracts.get(tab) || { spreadCount: 0, extraAttributes: ["missing-jsx"] };
  if (routeContract.spreadCount !== 1 || routeContract.extraAttributes.length > 0) {
    failures.push(
      `tab "${tab}" must pass exactly one ${spec.propsVar} spread and no extra props; found ${routeContract.spreadCount} spread(s), extras: ${routeContract.extraAttributes.join(", ") || "-"}`
    );
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
  const pageLines = pageSource.split(/\r?\n/).length;
  if (pageLines > spec.maxLines) {
    failures.push(`${spec.file} has ${pageLines} lines; expected <= ${spec.maxLines}`);
  }
  if (/export function \w+\(\{ view \}\)/.test(pageSource) || /\bview\b/.test(pageSource)) {
    failures.push(`${spec.file} must not accept or reference a catch-all view prop`);
  }
  if (spec.component === "TransactionsPage") {
    const tableAttributeSets = componentAttributeSets(pageAst, "TransactionSurfaceTable");
    if (tableAttributeSets.length === 0) {
      failures.push("TransactionsPage must render TransactionSurfaceTable");
    }
    const requiredTableProps = ["setTransactionRowsSelected", "setTransactionRowsExpanded", "setTxInlineEdit", "setTxListFilter"];
    const forbiddenTableProps = ["updateTransactionRowsSelected", "updateTransactionRowsExpanded", "updateTxInlineEdit", "updateTxListFilter"];
    for (const tableAttributes of tableAttributeSets) {
      for (const requiredProp of requiredTableProps) {
        if (!tableAttributes.includes(requiredProp)) {
          failures.push(`TransactionSurfaceTable must receive ${requiredProp} from TransactionsPage`);
        }
      }
      const forbiddenProps = forbiddenTableProps.filter((prop) => tableAttributes.includes(prop));
      if (forbiddenProps.length > 0) {
        failures.push(`TransactionSurfaceTable receives stale update* prop names: ${forbiddenProps.join(", ")}`);
      }
    }
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
    const appGroup = appProps.get(groupName) || { fields: [], rawSetterValues: [], unsupportedFields: [] };
    const appFields = appGroup.fields;
    addFieldContractFailures(failures, `${spec.file}`, groupName, pageFields);
    addFieldContractFailures(failures, `App.jsx ${spec.propsVar}`, groupName, appFields);
    if (appGroup.rawSetterValues.length > 0) {
      failures.push(`App.jsx ${spec.propsVar}.${groupName} passes raw setter identifiers: ${appGroup.rawSetterValues.join(", ")}`);
    }
    if (appGroup.unsupportedFields.length > 0) {
      failures.push(`App.jsx ${spec.propsVar}.${groupName} must not use object spreads: ${appGroup.unsupportedFields.join(", ")}`);
    }
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
      lines: pageLines,
      maxLines: spec.maxLines,
    };
}

const report = {
  ok: failures.length === 0,
  sourceRef: SOURCE_REF || "worktree",
  appLines,
  maxAppLines: MAX_APP_LINES,
  verifierLines,
  maxVerifierLines: MAX_VERIFIER_LINES,
  maxPageGroups: MAX_PAGE_GROUPS,
  maxGroupFields: MAX_GROUP_FIELDS,
  routedTabs: Object.fromEntries(routedTabs.entries()),
  routedPropVars: Object.fromEntries(routedPropVars.entries()),
  pages: pageReports,
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
