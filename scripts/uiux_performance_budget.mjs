#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const DIST_DIR = path.resolve("frontend", "dist");
const BUDGETS = {
  jsTotalBytes: 740 * 1024,
  jsGzipBytes: 235 * 1024,
  jsLargestBytes: 500 * 1024,
  cssTotalBytes: 185 * 1024,
  cssGzipBytes: 38 * 1024,
  htmlBytes: 12 * 1024,
};

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(absolutePath);
    }
    return [absolutePath];
  });
}

function bytesFor(files, extension) {
  const matchingFiles = files.filter((file) => file.endsWith(extension));
  return {
    files: matchingFiles.map((file) => {
      const content = readFileSync(file);
      return {
        path: path.relative(process.cwd(), file).replaceAll(path.sep, "/"),
        bytes: statSync(file).size,
        gzipBytes: gzipSync(content).length,
      };
    }),
  };
}

function sum(items, key) {
  return items.reduce((total, item) => total + item[key], 0);
}

function formatKiB(bytes) {
  return `${Math.round((bytes / 1024) * 10) / 10} KiB`;
}

if (!existsSync(DIST_DIR)) {
  console.error(JSON.stringify({ ok: false, error: "frontend/dist is missing; run npm run frontend:build first" }, null, 2));
  process.exit(2);
}

const files = walkFiles(DIST_DIR);
const js = bytesFor(files, ".js").files;
const css = bytesFor(files, ".css").files;
const html = bytesFor(files, ".html").files;
const largestJs = js.reduce((largest, item) => (item.bytes > largest.bytes ? item : largest), { bytes: 0, gzipBytes: 0, path: "" });
const metrics = {
  jsTotalBytes: sum(js, "bytes"),
  jsGzipBytes: sum(js, "gzipBytes"),
  jsLargestBytes: largestJs.bytes,
  cssTotalBytes: sum(css, "bytes"),
  cssGzipBytes: sum(css, "gzipBytes"),
  htmlBytes: sum(html, "bytes"),
  chunks: { js, css, html },
};

const failures = Object.entries(BUDGETS)
  .map(([key, budget]) => {
    const actual = metrics[key];
    return actual > budget ? `${key} ${formatKiB(actual)} exceeds ${formatKiB(budget)}` : null;
  })
  .filter(Boolean);

const report = {
  ok: failures.length === 0,
  budgets: BUDGETS,
  metrics,
  failures,
};

console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
