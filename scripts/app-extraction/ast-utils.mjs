function isNode(value) {
  return value && typeof value.type === "string";
}

export function walk(node, visit, parent = null) {
  if (!isNode(node)) return;
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "range" || key === "parent") continue;
    if (Array.isArray(value)) {
      value.forEach((child) => walk(child, visit, node));
    } else if (isNode(value)) {
      walk(value, visit, node);
    }
  }
}

export function propertyName(property) {
  if (property?.type === "SpreadElement") return `...${expressionName(property.argument) || "spread"}`;
  const key = property?.key;
  if (!key) return "";
  if (key.type === "Identifier") return key.name;
  return String(key.value || "");
}

export function patternName(property) {
  if (property?.type === "RestElement") return `...${expressionName(property.argument) || "rest"}`;
  const key = property?.key;
  if (!key) return "";
  if (key.type === "Identifier") return key.name;
  return String(key.value || "");
}

export function expressionName(expression) {
  if (!expression) return "";
  if (expression.type === "Identifier") return expression.name;
  if (expression.type === "MemberExpression") {
    const objectName = expressionName(expression.object);
    const memberName = expressionName(expression.property);
    return [objectName, memberName].filter(Boolean).join(".");
  }
  return "";
}

export function pageComponentName(node) {
  if (node?.type !== "JSXElement") return "";
  const name = node.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : "";
}

export function jsxAttributeNames(node) {
  if (node?.type !== "JSXElement") return [];
  return node.openingElement.attributes.map((attribute) => {
    if (attribute.type === "JSXSpreadAttribute") return `...${expressionName(attribute.argument) || "spread"}`;
    return attribute.name?.name || "unknown-attribute";
  });
}

export function componentAttributeSets(ast, componentName) {
  const attributeSets = [];
  walk(ast, (node) => {
    if (pageComponentName(node) === componentName) attributeSets.push(jsxAttributeNames(node));
  });
  return attributeSets;
}
