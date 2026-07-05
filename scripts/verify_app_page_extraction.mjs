#!/usr/bin/env node

import {
  APP_PATH,
  APP_SIZE_CEILING,
  PAGE_SPECS,
  SIZE_BUDGET,
  VERIFIER_PATH,
} from "./app-extraction/page-specs.mjs";
import {
  addFieldContractFailures,
  addGroupContractFailures,
  extractAppPropsObject,
  extractComponentParamGroups,
  extractPageGroupFields,
  routePropsContract,
  sameSet,
  sortedExtra,
  sortedMissing,
} from "./app-extraction/contracts.mjs";
import {
  componentAttributeSets,
  pageComponentName,
  walk,
} from "./app-extraction/ast-utils.mjs";
import {
  listSourceFiles,
  parseSource,
  pureLineCount,
  readSource,
  sizeException,
  sourceExists,
} from "./app-extraction/source.mjs";

const SOURCE_REF = String(process.env.APP_EXTRACTION_REF || "").trim();
const failures = [];
const sizeReports = {};

function addSizeBudgetFailures(source, file, appSizeTag = "") {
  const pureLoc = pureLineCount(source);
  const exception = sizeException(source);
  if (file === APP_PATH) {
    if (exception?.sizeTag !== appSizeTag) {
      failures.push(`${file} SIZE_OK tag must be ${appSizeTag}; found ${exception?.sizeTag || "missing"}`);
    }
    if (exception?.maxPureLoc !== APP_SIZE_CEILING) {
      failures.push(`${file} SIZE_OK maxPureLoc must stay ${APP_SIZE_CEILING}; found ${exception?.maxPureLoc || "missing"}`);
    }
    if (Number.isFinite(exception?.maxPureLoc) && pureLoc > exception.maxPureLoc) {
      failures.push(`${file} has ${pureLoc} pure LOC; expected <= declared SIZE_OK ${exception.maxPureLoc}`);
    }
  } else {
    if (exception) {
      failures.push(`${file} must not declare a SIZE_OK extraction marker outside ${APP_PATH}`);
    }
    if (pureLoc > SIZE_BUDGET) {
      failures.push(`${file} has ${pureLoc} pure LOC; expected <= ${SIZE_BUDGET}`);
    }
  }
  sizeReports[file] = { pureLoc, maxPureLoc: file === APP_PATH ? exception?.maxPureLoc || null : SIZE_BUDGET, sizeException: Boolean(exception) };
  return sizeReports[file];
}

function addTransactionTableFailures(pageAst, componentAsts) {
  const tableAttributeSets = [pageAst, ...componentAsts].flatMap((ast) => componentAttributeSets(ast, "TransactionSurfaceTable"));
  if (tableAttributeSets.length === 0) {
    failures.push("TransactionsPage must render TransactionSurfaceTable through the page wrapper or page-owned components");
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

const appSource = readSource(APP_PATH, SOURCE_REF);
const appAst = parseSource(appSource, APP_PATH);
const appLines = appSource.split(/\r?\n/).length;
addSizeBudgetFailures(appSource, APP_PATH, "app-shell");
for (const file of [VERIFIER_PATH, ...listSourceFiles("scripts/app-extraction", SOURCE_REF)]) {
  if (sourceExists(file, SOURCE_REF)) addSizeBudgetFailures(readSource(file, SOURCE_REF), file);
}
if (!appSource.includes('import { useCompactViewport } from "./hooks/useCompactViewport";')) failures.push("App.jsx must use the shared useCompactViewport hook");
if (appSource.includes("setIsCompactViewport")) failures.push("App.jsx must not own viewport synchronization state directly");
if (/PageView\b/.test(appSource) || /\bview=\{/.test(appSource)) failures.push("App.jsx must route page components with explicit grouped props, not PageView/view bags");

const routedTabs = new Map();
const routedPropVars = new Map();
const routedContracts = new Map();
walk(appAst, (node) => {
  const left = node.type === "LogicalExpression" && node.operator === "&&" ? node.left : null;
  if (left?.type === "BinaryExpression" && left.operator === "===" && left.left.type === "Identifier" && left.left.name === "tab" && left.right.type === "Literal") {
    const routeContract = routePropsContract(node.right);
    routedTabs.set(left.right.value, pageComponentName(node.right));
    routedPropVars.set(left.right.value, routeContract.spreadName);
    routedContracts.set(left.right.value, routeContract);
  }
});

const pageReports = {};
for (const [tab, spec] of Object.entries(PAGE_SPECS)) {
  const component = routedTabs.get(tab);
  if (component !== spec.component) failures.push(`tab "${tab}" must route to ${spec.component}; found ${component || "inline/missing"}`);
  const routedPropVar = routedPropVars.get(tab);
  if (routedPropVar !== spec.propsVar) failures.push(`tab "${tab}" must spread ${spec.propsVar}; found ${routedPropVar || "missing/non-spread props"}`);
  const routeContract = routedContracts.get(tab) || { spreadCount: 0, extraAttributes: ["missing-jsx"] };
  if (routeContract.spreadCount !== 1 || routeContract.extraAttributes.length > 0) {
    failures.push(`tab "${tab}" must pass exactly one ${spec.propsVar} spread and no extra props; found ${routeContract.spreadCount} spread(s), extras: ${routeContract.extraAttributes.join(", ") || "-"}`);
  }
  if (!appSource.includes(`import { ${spec.component} } from "./pages/${spec.component}";`)) failures.push(`App.jsx must import ${spec.component} from ./pages/${spec.component}`);
  if (!sourceExists(spec.file, SOURCE_REF)) {
    failures.push(`${spec.file} is missing`);
    continue;
  }

  const pageSource = readSource(spec.file, SOURCE_REF);
  const pageAst = parseSource(pageSource, spec.file);
  const componentFiles = listSourceFiles(spec.componentDir, SOURCE_REF).filter((file) => file !== spec.file);
  const componentAsts = componentFiles.map((file) => parseSource(readSource(file, SOURCE_REF), file));
  addSizeBudgetFailures(pageSource, spec.file);
  for (const file of componentFiles) addSizeBudgetFailures(readSource(file, SOURCE_REF), file);
  if (/export function \w+\(\{ view \}\)/.test(pageSource) || /\bview\b/.test(pageSource)) failures.push(`${spec.file} must not accept or reference a catch-all view prop`);
  if (spec.component === "TransactionsPage") addTransactionTableFailures(pageAst, componentAsts);

  const pageGroups = extractComponentParamGroups(pageAst, spec.component) || [];
  const appProps = extractAppPropsObject(appAst, spec.propsVar);
  if (!appProps) {
    failures.push(`App.jsx must define ${spec.propsVar}`);
    continue;
  }
  const appGroups = Array.from(appProps.keys());
  addGroupContractFailures(failures, spec.file, pageGroups);
  addGroupContractFailures(failures, `App.jsx ${spec.propsVar}`, appGroups);
  if (!sameSet(pageGroups, appGroups)) failures.push(`${spec.component} group contract mismatch; missing in App: ${sortedMissing(pageGroups, appGroups).join(", ") || "-"}; extra in App: ${sortedExtra(pageGroups, appGroups).join(", ") || "-"}`);

  const pageFieldsByGroup = extractPageGroupFields(pageAst, spec.file);
  for (const groupName of pageGroups) {
    const pageFields = pageFieldsByGroup.get(groupName) || [];
    const appGroup = appProps.get(groupName) || { fields: [], rawSetterValues: [], unsupportedFields: [] };
    addFieldContractFailures(failures, `${spec.file}`, groupName, pageFields);
    addFieldContractFailures(failures, `App.jsx ${spec.propsVar}`, groupName, appGroup.fields);
    if (appGroup.rawSetterValues.length > 0) failures.push(`App.jsx ${spec.propsVar}.${groupName} passes raw setter identifiers: ${appGroup.rawSetterValues.join(", ")}`);
    if (appGroup.unsupportedFields.length > 0) failures.push(`App.jsx ${spec.propsVar}.${groupName} must not use object spreads: ${appGroup.unsupportedFields.join(", ")}`);
    if (!sameSet(pageFields, appGroup.fields)) failures.push(`${spec.component}.${groupName} field contract mismatch; missing in App: ${sortedMissing(pageFields, appGroup.fields).join(", ") || "-"}; extra in App: ${sortedExtra(pageFields, appGroup.fields).join(", ") || "-"}`);
  }
  pageReports[tab] = { component: spec.component, file: spec.file, propsVar: spec.propsVar, groups: Object.fromEntries(pageGroups.map((groupName) => [groupName, { fieldCount: (pageFieldsByGroup.get(groupName) || []).length }])), pureLoc: sizeReports[spec.file]?.pureLoc, componentFiles };
}

const report = {
  ok: failures.length === 0,
  sourceRef: SOURCE_REF || "worktree",
  appLines,
  appPureLoc: sizeReports[APP_PATH]?.pureLoc,
  sizeBudget: SIZE_BUDGET,
  routedTabs: Object.fromEntries(routedTabs.entries()),
  routedPropVars: Object.fromEntries(routedPropVars.entries()),
  pages: pageReports,
  sizes: sizeReports,
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
