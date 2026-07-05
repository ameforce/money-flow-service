import { MAX_GROUP_FIELDS, MAX_PAGE_GROUPS, MIN_PAGE_GROUPS } from "./page-specs.mjs";
import { expressionName, pageComponentName, patternName, propertyName, walk } from "./ast-utils.mjs";

export function routePropsContract(node) {
  if (node?.type !== "JSXElement") return { spreadName: "", spreadCount: 0, extraAttributes: ["missing-jsx"] };
  const spreads = [];
  const extraAttributes = [];
  for (const attribute of node.openingElement.attributes) {
    if (attribute.type === "JSXSpreadAttribute") {
      spreads.push(attribute.argument?.type === "Identifier" ? attribute.argument.name : "non-identifier-spread");
    } else {
      extraAttributes.push(attribute.name?.name || "unknown-attribute");
    }
  }
  return { spreadName: spreads[0] || "", spreadCount: spreads.length, extraAttributes, component: pageComponentName(node) };
}

export function extractComponentParamGroups(ast, componentName) {
  let groups = null;
  walk(ast, (node) => {
    if (groups || node.type !== "FunctionDeclaration" || node.id?.name !== componentName) return;
    const param = node.params[0];
    groups = param?.type === "ObjectPattern" ? param.properties.map(patternName).filter(Boolean) : [];
  });
  return groups;
}

export function extractPageGroupFields(ast, pageFile) {
  const groups = new Map();
  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "ObjectPattern" || node.init?.type !== "Identifier") return;
    const groupName = node.init.name;
    const fields = node.id.properties.map(patternName).filter(Boolean);
    groups.set(groupName, fields);
  });
  if (groups.has("view")) throw new Error(`${pageFile} must not destructure fields from view`);
  return groups;
}

export function extractAppPropsObject(ast, propsVar) {
  let props = null;
  walk(ast, (node) => {
    if (props || node.type !== "VariableDeclarator" || node.id?.name !== propsVar || node.init?.type !== "ObjectExpression") return;
    props = new Map();
    for (const groupProperty of node.init.properties) {
      const groupName = propertyName(groupProperty);
      if (!groupName || groupProperty.value?.type !== "ObjectExpression") continue;
      props.set(groupName, extractAppGroupFields(groupProperty.value.properties));
    }
  });
  return props;
}

function extractAppGroupFields(properties) {
  const fields = [];
  const rawSetterValues = [];
  const unsupportedFields = [];
  for (const property of properties) {
    const fieldName = propertyName(property);
    if (!fieldName) continue;
    if (fieldName.startsWith("...")) {
      unsupportedFields.push(fieldName);
      continue;
    }
    fields.push(fieldName);
    const valueName = expressionName(property.value);
    if (/^set[A-Z]/.test(valueName)) rawSetterValues.push(`${fieldName}->${valueName}`);
  }
  return { fields, rawSetterValues, unsupportedFields };
}

export function sameSet(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return left.length === right.length && left.every((item) => rightSet.has(item)) && right.every((item) => leftSet.has(item));
}

export function sortedMissing(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((item) => !actualSet.has(item)).sort();
}

export function sortedExtra(expected, actual) {
  const expectedSet = new Set(expected);
  return actual.filter((item) => !expectedSet.has(item)).sort();
}

export function addGroupContractFailures(failures, label, groups) {
  if (groups.length < MIN_PAGE_GROUPS || groups.length > MAX_PAGE_GROUPS) failures.push(`${label} must expose ${MIN_PAGE_GROUPS}-${MAX_PAGE_GROUPS} explicit prop groups; found ${groups.length}`);
  if (groups.includes("view")) failures.push(`${label} must not expose a catch-all view prop`);
  const restGroups = groups.filter((groupName) => groupName.startsWith("..."));
  if (restGroups.length > 0) failures.push(`${label} must not expose rest props: ${restGroups.join(", ")}`);
}

export function addFieldContractFailures(failures, label, groupName, fields) {
  if (fields.length > MAX_GROUP_FIELDS) failures.push(`${label}.${groupName} exposes ${fields.length} fields; expected <= ${MAX_GROUP_FIELDS}`);
  const rawSetters = fields.filter((field) => /^set[A-Z]/.test(field));
  if (rawSetters.length > 0) failures.push(`${label}.${groupName} leaks raw React setters: ${rawSetters.join(", ")}`);
  const restFields = fields.filter((field) => field.startsWith("..."));
  if (restFields.length > 0) failures.push(`${label}.${groupName} must not use rest/spread fields: ${restFields.join(", ")}`);
}
