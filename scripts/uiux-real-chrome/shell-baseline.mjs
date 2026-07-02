import { delay } from "./app-runtime.mjs";
import { openRequestedTab, tryRegisterDashboard } from "./browser-session.mjs";
import { withBrowserEvidence } from "./scenario-runtime.mjs";

async function readShellMetrics(page) {
  return page.evaluate(() => {
    const boxOf = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        bottom: box.bottom,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        width: box.width,
        withinViewport: box.left >= -1 && box.right <= window.innerWidth + 1 && box.top >= -1,
      };
    };
    const bodyStyle = getComputedStyle(document.body);
    return {
      bodyMargin: bodyStyle.margin,
      bodyBackgroundColor: bodyStyle.backgroundColor,
      documentScrollWidth: document.documentElement.scrollWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth - window.innerWidth > 1,
      hasAppShell: Boolean(document.querySelector("main.app-shell")),
      hasAuthShell: Boolean(document.querySelector(".auth-shell")),
      hasTableBody: Boolean(document.querySelector("tbody")),
      topbar: boxOf("header.topbar"),
      nav: boxOf("nav.topbar-tabs, nav.tabs"),
      content: boxOf(".app-content, .auth-shell"),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

function decideVerdict(metrics, dashboard) {
  const backgroundOk = !["rgba(0, 0, 0, 0)", "transparent"].includes(metrics.bodyBackgroundColor);
  const shellOk = dashboard.reached
    ? Boolean(metrics.topbar?.withinViewport && metrics.nav?.withinViewport && metrics.content?.withinViewport)
    : metrics.hasAuthShell;
  return metrics.bodyMargin === "0px" && backgroundOk && !metrics.hasHorizontalOverflow && shellOk ? "pass" : "fail";
}

export async function runShellBaseline(options) {
  return withBrowserEvidence(options, {}, "shell-baseline", async ({ app, page }) => {
    const dashboard = await tryRegisterDashboard(page, app.url);
    const tabNavigation = dashboard.reached ? await openRequestedTab(page, options.tab) : { requested: options.tab, opened: false };
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await delay(250);
    const metrics = await readShellMetrics(page);
    const verdict = decideVerdict(metrics, dashboard);
    return {
      url: page.url(),
      baseUrlSource: app.source,
      dashboardReached: dashboard.reached,
      dashboard,
      tabNavigation,
      bodyMargin: metrics.bodyMargin,
      bodyBackgroundColor: metrics.bodyBackgroundColor,
      hasHorizontalOverflow: metrics.hasHorizontalOverflow,
      topbar: metrics.topbar,
      nav: metrics.nav,
      content: metrics.content,
      metrics,
      verdict,
      failures: verdict === "pass" ? [] : ["global shell baseline failed"],
    };
  });
}
