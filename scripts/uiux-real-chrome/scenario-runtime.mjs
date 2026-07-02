import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { cleanupDatabase, resolveBaseUrl, terminateStartedProcess } from "./app-runtime.mjs";
import { launchBrowser } from "./browser-session.mjs";
import { parseViewport } from "./cli.mjs";

export function prepareEvidence(options) {
  const viewport = parseViewport(options.viewport);
  const evidencePath = resolve(options.evidence);
  mkdirSync(dirname(evidencePath), { recursive: true });
  return { evidencePath, viewport };
}

export async function withBrowserEvidence(options, appOptions, scenario, run) {
  const { evidencePath, viewport } = prepareEvidence(options);
  const app = await resolveBaseUrl(appOptions);
  let browserInfo = null;
  let context = null;
  const cleanup = { browserClosed: false, contextClosed: false, appProcess: null };
  try {
    browserInfo = await launchBrowser();
    context = await browserInfo.browser.newContext({ viewport });
    const page = await context.newPage();
    const result = await run({ app, browserInfo, cleanup, context, page, viewport });
    await context.close();
    cleanup.contextClosed = true;
    await browserInfo.browser.close();
    cleanup.browserClosed = true;
    cleanup.appProcess = terminateStartedProcess(app.started);
    cleanup.database = cleanupDatabase(app.dbPath);
    const evidence = { scenario, tab: options.tab, viewport, chromeChannel: browserInfo.chromeChannel, fallbackReason: browserInfo.fallbackReason, ...result, cleanup };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    return evidence.verdict === "pass" ? 0 : 1;
  } catch (error) {
    if (context && !cleanup.contextClosed) {
      await context.close().catch(() => {});
      cleanup.contextClosed = true;
    }
    if (browserInfo?.browser && !cleanup.browserClosed) {
      await browserInfo.browser.close().catch(() => {});
      cleanup.browserClosed = true;
    }
    cleanup.appProcess = terminateStartedProcess(app?.started);
    cleanup.database = cleanupDatabase(app?.dbPath);
    const message = error instanceof Error ? error.message : String(error);
    const evidence = { scenario, tab: options.tab, viewport, chromeChannel: browserInfo?.chromeChannel ?? null, fallbackReason: browserInfo?.fallbackReason ?? null, url: app?.url ?? null, dashboardReached: false, error: message, verdict: "fail", failures: [message], cleanup };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    return 1;
  }
}
