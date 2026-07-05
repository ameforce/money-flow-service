import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const frontendRoot = path.join(repoRoot, "frontend");
const indexPath = path.join(frontendRoot, "index.html");
const manifestPath = path.join(frontendRoot, "public", "manifest.webmanifest");
const serviceWorkerPath = path.join(frontendRoot, "public", "sw.js");
const mainPath = path.join(frontendRoot, "src", "main.jsx");
const pngSignature = "89504e470d0a1a0a";

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(message) {
  throw new Error(message);
}

function expectFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} is missing: ${path.relative(repoRoot, filePath)}`);
  }
}

function expectMatch(value, pattern, message) {
  if (!pattern.test(value)) {
    fail(message);
  }
}

function parseManifest() {
  expectFile(manifestPath, "PWA web manifest");
  const manifest = JSON.parse(readText(manifestPath));
  if (!manifest.name && !manifest.short_name) {
    fail("manifest must define name or short_name");
  }
  for (const key of ["start_url", "scope", "display", "background_color", "theme_color"]) {
    if (!manifest[key]) {
      fail(`manifest must define ${key}`);
    }
  }
  if (!["standalone", "fullscreen", "minimal-ui"].includes(manifest.display)) {
    fail(`manifest display must be installable, got ${manifest.display}`);
  }
  if (manifest.prefer_related_applications === true) {
    fail("manifest must not prefer related native applications");
  }
  return manifest;
}

function expectManifestIcons(manifest) {
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  for (const size of ["192x192", "512x512"]) {
    const icon = icons.find((item) => String(item.sizes || "").split(/\s+/u).includes(size));
    if (!icon) {
      fail(`manifest must include a ${size} icon`);
    }
    if (icon.type !== "image/png") {
      fail(`${size} icon must be image/png for Chromium installability`);
    }
    const iconPath = path.join(frontendRoot, "public", icon.src.replace(/^\//u, ""));
    expectFile(iconPath, `${size} icon`);
    const signature = fs.readFileSync(iconPath).subarray(0, 8).toString("hex");
    if (signature !== pngSignature) {
      fail(`${size} icon must be a PNG file`);
    }
  }
}

const indexHtml = readText(indexPath);
expectMatch(indexHtml, /<link\s+rel=["']manifest["']\s+href=["']\/manifest\.webmanifest["']/u, "index.html must link /manifest.webmanifest");
expectMatch(indexHtml, /<meta\s+name=["']theme-color["']\s+content=["']#[0-9a-fA-F]{6}["']/u, "index.html must define a theme-color meta tag");

const manifest = parseManifest();
expectManifestIcons(manifest);

expectFile(serviceWorkerPath, "service worker");
const serviceWorker = readText(serviceWorkerPath);
expectMatch(serviceWorker, /addEventListener\(["']install["']/u, "service worker must define an install handler");
expectMatch(serviceWorker, /addEventListener\(["']fetch["']/u, "service worker must define a fetch handler");
expectMatch(serviceWorker, /url\.search/u, "service worker must bypass caching query-bearing navigations");
expectMatch(serviceWorker, /cache\.put\(NAVIGATION_CACHE_KEY/u, "service worker must cache navigations under a normalized key");
expectMatch(serviceWorker, /NON_SPA_PATHS/u, "service worker must bypass non-SPA operational endpoints");
const navigationStart = serviceWorker.indexOf("async function networkFirstNavigation");
const staleWhileRevalidateStart = serviceWorker.indexOf("async function staleWhileRevalidate");
const navigationFunction =
  navigationStart >= 0 && staleWhileRevalidateStart > navigationStart
    ? serviceWorker.slice(navigationStart, staleWhileRevalidateStart)
    : "";
if (!navigationFunction) {
  fail("service worker must define networkFirstNavigation before staleWhileRevalidate");
}
if (/cache\.put\(request/u.test(navigationFunction)) {
  fail("service worker must not cache navigation requests by full request URL");
}

const main = readText(mainPath);
expectMatch(main, /serviceWorker\.register\(["']\/sw\.js["']\)/u, "main.jsx must register /sw.js");
expectMatch(main, /import\.meta\.env\.PROD/u, "service worker registration must be production-gated");

console.log("PWA installability metadata verified.");
