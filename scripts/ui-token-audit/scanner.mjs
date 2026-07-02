import { readFileSync } from "node:fs";
import {
  colorPattern,
  cssScanFiles,
  customPropertyPattern,
  jsxDynamicStylePattern,
  jsxInlineStylePattern,
  jsxScanFiles,
  radiusPropertyPattern,
  repoRoot,
  shadowPropertyPattern,
} from "./config.mjs";

export function normalizeValue(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export const readText = (path) => readFileSync(`${repoRoot}/${path}`, "utf8");

export function extractDeclaredValues() {
  const values = new Set();
  const designText = readText("DESIGN.md");
  for (const match of designText.matchAll(colorPattern)) values.add(normalizeValue(match[0]));
  for (const match of designText.matchAll(/`([^`]*(?:px|rem)[^`]*)`/g)) {
    values.add(normalizeValue(match[1]));
  }

  for (const path of cssScanFiles) {
    const text = readText(path);
    for (const line of text.split(/\r?\n/)) {
      if (!customPropertyPattern.test(line)) continue;
      for (const value of extractLineRawValues(line)) values.add(value.value);
    }
  }
  return values;
}

export function scanCssFile(path) {
  const lines = readText(path).split(/\r?\n/);
  const tokenCounts = { customProperties: 0, colorTokens: 0, radiusTokens: 0, shadowTokens: 0 };
  const rawValueCounts = { colors: {}, radii: {}, shadows: {} };
  const rawValues = [];

  lines.forEach((line, offset) => {
    const lineNumber = offset + 1;
    const isTokenDefinition = customPropertyPattern.test(line);
    if (isTokenDefinition) {
      tokenCounts.customProperties += 1;
      if (colorPattern.test(line)) tokenCounts.colorTokens += 1;
      colorPattern.lastIndex = 0;
      if (line.includes("radius")) tokenCounts.radiusTokens += 1;
      if (line.includes("shadow")) tokenCounts.shadowTokens += 1;
      return;
    }

    for (const match of line.matchAll(colorPattern)) {
      const value = normalizeValue(match[0]);
      rawValueCounts.colors[value] = (rawValueCounts.colors[value] ?? 0) + 1;
      rawValues.push({ type: "color", value, line: lineNumber });
    }

    const radiusMatch = line.match(radiusPropertyPattern);
    if (radiusMatch && !radiusMatch[1].includes("var(")) {
      const value = normalizeValue(radiusMatch[1]);
      rawValueCounts.radii[value] = (rawValueCounts.radii[value] ?? 0) + 1;
      rawValues.push({ type: "radius", value, line: lineNumber });
    }

    const shadowMatch = line.match(shadowPropertyPattern);
    if (shadowMatch && !/var\(|none|inherit|initial|unset/i.test(shadowMatch[1])) {
      const value = normalizeValue(shadowMatch[1]);
      rawValueCounts.shadows[value] = (rawValueCounts.shadows[value] ?? 0) + 1;
      rawValues.push({ type: "shadow", value, line: lineNumber });
    }
  });

  return { path, tokenCounts, rawValueCounts, rawValues };
}

export function extractLineRawValues(line) {
  const rawValues = [];

  for (const match of line.matchAll(colorPattern)) {
    rawValues.push({ type: "color", value: normalizeValue(match[0]) });
  }

  const radiusMatch = line.match(radiusPropertyPattern);
  if (radiusMatch && !radiusMatch[1].includes("var(")) {
    rawValues.push({ type: "radius", value: normalizeValue(radiusMatch[1]) });
  }

  const shadowMatch = line.match(shadowPropertyPattern);
  if (shadowMatch && !/var\(|none|inherit|initial|unset/i.test(shadowMatch[1])) {
    rawValues.push({ type: "shadow", value: normalizeValue(shadowMatch[1]) });
  }

  return rawValues;
}

export function scanJsxFile(path) {
  const lines = readText(path).split(/\r?\n/);
  const inlineStyleLines = [];
  lines.forEach((line, offset) => {
    if (jsxInlineStylePattern.test(line)) {
      inlineStyleLines.push({
        line: offset + 1,
        text: line.trim(),
        dynamic: jsxDynamicStylePattern.test(line),
      });
    }
  });
  return {
    path,
    inlineStyleCount: inlineStyleLines.length,
    inlineStyleLines,
  };
}

export const scanCssFiles = () => cssScanFiles.map(scanCssFile);
export const scanJsxFiles = () => jsxScanFiles.map(scanJsxFile);
