import { delay } from "./app-runtime.mjs";
import { openRequestedTab, tryRegisterDashboard } from "./browser-session.mjs";
import { withBrowserEvidence } from "./scenario-runtime.mjs";

async function readNavAccessibilityMetrics(page) {
  return page.evaluate(() => {
    const expectedLabels = new Set(["대시보드", "거래", "자산", "협업", "데이터 가져오기", "설정"]);
    const buttons = Array.from(document.querySelectorAll("nav.topbar-tabs button"));
    const buttonMetrics = buttons.map((button) => {
      const icon = button.querySelector(".tab-icon");
      const label = button.querySelector(".tab-label");
      const buttonBox = button.getBoundingClientRect();
      const labelBox = label?.getBoundingClientRect() ?? null;
      const labelStyle = label ? getComputedStyle(label) : null;
      const pseudoContent = label ? getComputedStyle(label, "::after").content : "";
      const normalizedPseudoLabel = pseudoContent.replace(/^["']|["']$/gu, "").replace(/\\a\s?/giu, "").replace(/\s/gu, "");
      const normalizedDataLabel = String(label?.getAttribute("data-mobile-label") ?? "").replace(/\s/gu, "");
      const normalizedTextLabel = String(label?.textContent ?? "").replace(/\s/gu, "");
      const accessibleName = String(button.getAttribute("aria-label") ?? "").trim();
      return {
        accessibleName,
        text: button.innerText.trim(),
        visibleLabel: normalizedPseudoLabel || normalizedDataLabel || normalizedTextLabel,
        expectedLabelKnown: expectedLabels.has(accessibleName),
        svgCount: icon?.querySelectorAll("svg").length ?? 0,
        iconText: icon?.textContent?.trim() ?? "",
        ariaHidden: icon?.getAttribute("aria-hidden") ?? "",
        ariaCurrent: button.getAttribute("aria-current") ?? "",
        width: buttonBox.width,
        height: buttonBox.height,
        hitHeightOk: buttonBox.height >= 44,
        labelOverflowX: label ? label.scrollWidth - label.clientWidth : 0,
        labelOverflowY: label ? label.scrollHeight - label.clientHeight : 0,
        visibleLabelOverflow: label
          ? label.scrollWidth - label.clientWidth > 1 ||
            label.scrollHeight - label.clientHeight > 1 ||
            (labelBox !== null && (labelBox.left < buttonBox.left - 1 || labelBox.right > buttonBox.right + 1))
          : true,
        labelWhiteSpace: labelStyle?.whiteSpace ?? "",
        buttonLeft: buttonBox.left,
        buttonRight: buttonBox.right,
      };
    });
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth - window.innerWidth > 1,
      appShell: Boolean(document.querySelector("main.app-shell")),
      navButtonCount: buttons.length,
      buttonMetrics,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

function decideNavAccessibilityVerdict(metrics, dashboard, tabNavigation) {
  const activeButtons = metrics.buttonMetrics.filter((item) => item.ariaCurrent === "page");
  const buttonsOk =
    metrics.navButtonCount === 6 &&
    metrics.buttonMetrics.every(
      (item) =>
        item.accessibleName &&
        item.expectedLabelKnown &&
        item.visibleLabel &&
        item.svgCount === 1 &&
        item.iconText === "" &&
        item.ariaHidden === "true" &&
        item.hitHeightOk &&
        !item.visibleLabelOverflow,
    );
  return dashboard.reached && tabNavigation.opened && metrics.appShell && buttonsOk && activeButtons.length === 1 && !metrics.hasHorizontalOverflow
    ? "pass"
    : "fail";
}

export async function runNavAccessibility(options) {
  return withBrowserEvidence(options, { isolated: true }, "nav-accessibility", async ({ app, page }) => {
    const dashboard = await tryRegisterDashboard(page, app.url);
    const tabNavigation = dashboard.reached ? await openRequestedTab(page, options.tab) : { requested: options.tab, opened: false };
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await delay(250);
    const metrics = await readNavAccessibilityMetrics(page);
    const verdict = decideNavAccessibilityVerdict(metrics, dashboard, tabNavigation);
    return {
      url: page.url(),
      baseUrlSource: app.source,
      backendPort: app.backendPort,
      frontendPort: app.frontendPort,
      dashboardReached: dashboard.reached,
      appShell: metrics.appShell,
      dashboard,
      tabNavigation,
      navButtonCount: metrics.navButtonCount,
      perButton: metrics.buttonMetrics,
      hasHorizontalOverflow: metrics.hasHorizontalOverflow,
      metrics,
      verdict,
      failures: verdict === "pass" ? [] : ["navigation accessibility verdict failed"],
    };
  });
}
