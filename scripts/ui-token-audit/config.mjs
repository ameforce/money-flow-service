import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const cssScanFiles = ["frontend/src/index.css", "frontend/src/App.css"];
export const jsxScanFiles = ["frontend/src/App.jsx"];
export const scanFiles = [...cssScanFiles, ...jsxScanFiles];
export const colorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
export const radiusPropertyPattern = /\bborder(?:-[a-z]+)?-radius\s*:\s*([^;]+)/i;
export const shadowPropertyPattern = /\bbox-shadow\s*:\s*([^;]+)/i;
export const customPropertyPattern = /^\s*--[\w-]+\s*:/;
export const diffHunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
export const jsxInlineStylePattern = /\bstyle=\{\{/;
export const jsxDynamicStylePattern = /\$\{|--[\w-]+|Math\.|Number\.|[A-Za-z_$][\w$]*\.[A-Za-z_$]|[A-Za-z_$][\w$]*\s*\(/;
