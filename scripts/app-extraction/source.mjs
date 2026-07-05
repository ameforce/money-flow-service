import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const espreePath = require.resolve("espree", { paths: [path.resolve("frontend")] });
const espree = await import(pathToFileURL(espreePath).href);
const SIZE_OK_PATTERN = new RegExp("SIZE_OK\\s+issue-248\\s+([a-z0-9-]+);\\s+maxPureLoc=(\\d+);");

export function readSource(filePath, sourceRef = "") {
  if (!sourceRef) return readFileSync(filePath, "utf8");
  return execFileSync("git", ["show", `${sourceRef}:${filePath}`], { encoding: "utf8" });
}

export function sourceExists(filePath, sourceRef = "") {
  if (!sourceRef) return existsSync(filePath);
  try {
    execFileSync("git", ["cat-file", "-e", `${sourceRef}:${filePath}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function listSourceFiles(dirPath, sourceRef = "") {
  if (!sourceRef) {
    if (!existsSync(dirPath)) return [];
    return readdirSync(dirPath)
      .map((name) => `${dirPath}/${name}`)
      .filter((file) => statSync(file).isFile() && (file.endsWith(".mjs") || file.endsWith(".jsx")))
      .sort();
  }
  try {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", sourceRef, dirPath], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter((file) => file && (file.endsWith(".mjs") || file.endsWith(".jsx")))
      .sort();
  } catch {
    return [];
  }
}

export function parseSource(source, filePath) {
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

export function pureLineCount(source) {
  return source.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !/^(\/\/|#|\/\*|\*|\*\/)/.test(trimmed);
  }).length;
}

export function sizeException(source) {
  const head = source.split(/\r?\n/).slice(0, 5).join("\n");
  const match = head.match(SIZE_OK_PATTERN);
  return match ? { sizeTag: match[1], maxPureLoc: Number(match[2]) } : null;
}
