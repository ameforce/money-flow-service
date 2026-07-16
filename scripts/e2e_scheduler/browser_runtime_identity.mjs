import { chromium } from "playwright";

import { resolveBrowserRuntime } from "./browser_runtime.mjs";


const runtime = resolveBrowserRuntime();
const browser = await chromium.launch(runtime.launchOptions);
const browserVersion = String(browser.version()).trim();
await browser.close();
if (!browserVersion) {
  throw new Error("resolved browser returned an empty version");
}
process.stdout.write(`${JSON.stringify({
  version: 1,
  decision: runtime.decision,
  channel: runtime.channel,
  executable_path: runtime.executablePath,
  browser_version: browserVersion,
})}\n`);
