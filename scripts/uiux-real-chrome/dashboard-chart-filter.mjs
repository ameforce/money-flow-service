import { delay } from "./app-runtime.mjs";
import { openRequestedTab, tryRegisterDashboard } from "./browser-session.mjs";
import { seedDashboardFixtures } from "./fixtures.mjs";
import { withBrowserEvidence } from "./scenario-runtime.mjs";

async function readDashboardChartFilterMetrics(page) {
  return page.evaluate(() => {
    const visibleBox = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        visible: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
        withinViewportX: box.left >= -1 && box.right <= window.innerWidth + 1,
        withinViewportY: box.top >= -1 && box.bottom <= window.innerHeight + 1,
        withinViewport: box.left >= -1 && box.right <= window.innerWidth + 1 && box.top >= -1 && box.bottom <= window.innerHeight + 1,
      };
    };
    const elementMetrics = (element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        text: element.textContent?.replace(/\s+/gu, " ").trim() || element.getAttribute("aria-label") || "",
        disabled: Boolean(element.disabled),
        height: box.height,
        width: box.width,
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        visible: style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0,
        focusable: !element.disabled && typeof element.focus === "function",
        touchHeightOk: box.height >= 40,
        touchWidthOk: box.width >= 40,
        withinViewportX: box.left >= -1 && box.right <= window.innerWidth + 1,
        withinViewportY: box.top >= -1 && box.bottom <= window.innerHeight + 1,
        withinViewport: box.left >= -1 && box.right <= window.innerWidth + 1 && box.top >= -1 && box.bottom <= window.innerHeight + 1,
      };
    };
    const filterCard = document.querySelector(".dashboard-filter-card");
    const modeButtons = Array.from(filterCard?.querySelectorAll(".filter-modes-segmented button") || []).map(elementMetrics);
    const monthControls = Array.from(filterCard?.querySelectorAll(".month-stepper button, .month-stepper input") || []).map(elementMetrics);
    const rangeControls = Array.from(filterCard?.querySelectorAll('.range-picker input[type="date"], .range-preset-row button') || []).map(elementMetrics);
    const active = document.activeElement;
    const activeStyle = active ? getComputedStyle(active) : null;
    const outlineWidth = Number.parseFloat(activeStyle?.outlineWidth || "0") || 0;
    const focusRing = active
      ? {
          tagName: active.tagName,
          text: active.textContent?.replace(/\s+/gu, " ").trim() || active.getAttribute("aria-label") || "",
          outlineStyle: activeStyle?.outlineStyle || "",
          outlineWidth,
          boxShadow: activeStyle?.boxShadow || "",
          detectable: (outlineWidth > 0 && activeStyle?.outlineStyle !== "none") || Boolean(activeStyle?.boxShadow && activeStyle.boxShadow !== "none"),
        }
      : null;
    const sliceLabels = Array.from(document.querySelectorAll('[data-testid="portfolio-donut-slice-label"]')).map((node) => {
      const box = node.getBoundingClientRect();
      const chart = node.closest(".chart-wrap")?.getBoundingClientRect();
      const ring = node.closest(".portfolio-donut-slice-labels")?.getBoundingClientRect();
      const children = Array.from(node.children).map((child) => {
        const childBox = child.getBoundingClientRect();
        const childStyle = getComputedStyle(child);
        return {
          topGap: childBox.top - box.top,
          bottomGap: box.bottom - childBox.bottom,
          fontSize: Number.parseFloat(childStyle.fontSize) || 0,
          lineHeight: Number.parseFloat(childStyle.lineHeight) || 0,
        };
      });
      let ringDelta = null;
      if (ring) {
        const centerX = ring.x + ring.width / 2;
        const centerY = ring.y + ring.height / 2;
        const labelX = box.x + box.width / 2;
        const labelY = box.y + box.height / 2;
        const dx = labelX - centerX;
        const dy = labelY - centerY;
        const actualRadius = (Math.sqrt(dx * dx + dy * dy) / (Math.min(ring.width, ring.height) / 2)) * 100;
        const actualAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const expectedAngle = Number(node.dataset.donutAngle || 0);
        const expectedRadius = Number(node.dataset.donutRadius || 0);
        ringDelta = { radius: Math.abs(actualRadius - expectedRadius), angle: Math.abs(((actualAngle - expectedAngle + 540) % 360) - 180) };
      }
      return {
        text: node.textContent?.replace(/\s+/gu, " ").trim() || "",
        topGap: chart ? box.top - chart.top : null,
        bottomGap: chart ? chart.bottom - box.bottom : null,
        withinChart: chart ? box.top >= chart.top + 12 && box.bottom <= chart.bottom - 12 : false,
        clipped: children.some((child) => child.topGap < -1 || child.bottomGap < -1 || (child.fontSize > 0 && child.lineHeight > 0 && child.lineHeight < child.fontSize * 1.08)),
        ringDelta,
      };
    });
    const visibleKpiCards = Array.from(document.querySelectorAll(".dashboard-hero-card .dashboard-kpi-card")).filter((card) => {
      const box = card.getBoundingClientRect();
      const style = getComputedStyle(card);
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    }).length;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentScrollWidth: document.documentElement.scrollWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth - window.innerWidth > 1,
      filter: { card: visibleBox(".dashboard-filter-card"), modeButtons, monthControls, rangeControls, focusRing },
      chart: { donutWrap: visibleBox(".dashboard-donut-wrap"), centerLabel: visibleBox('[data-testid="portfolio-donut-center-label"]'), sliceLabels },
      context: {
        heroCopyVisible: Boolean(visibleBox(".dashboard-hero-copy p")?.visible),
        marketStripVisible: Boolean(visibleBox(".dashboard-market-strip")?.visible),
        statusCardVisible: Boolean(visibleBox(".dashboard-status-card")?.visible),
        membersCardVisible: Boolean(visibleBox(".dashboard-members-card")?.visible),
        visibleKpiCards,
      },
    };
  });
}

function decideDashboardChartFilterVerdict(metrics, dashboard) {
  const failures = [];
  const isUsableControl = (item) => item.visible && item.touchHeightOk && item.withinViewport && (item.disabled || item.focusable);
  const allModeButtonsUsable = metrics.filter.modeButtons.length >= 2 && metrics.filter.modeButtons.every((button) => isUsableControl(button) && button.touchWidthOk);
  const allMonthControlsUsable = metrics.filter.monthControls.length >= 5 && metrics.filter.monthControls.every(isUsableControl);
  const allRangeControlsUsable = metrics.filter.rangeControls.length >= 2 && metrics.filter.rangeControls.every(isUsableControl);
  const contextOk =
    metrics.context.heroCopyVisible &&
    metrics.context.marketStripVisible &&
    metrics.context.statusCardVisible &&
    metrics.context.membersCardVisible &&
    metrics.context.visibleKpiCards >= 6;
  const chartOk =
    Boolean(metrics.chart.donutWrap?.visible) &&
    Boolean(metrics.chart.centerLabel?.visible) &&
    metrics.chart.sliceLabels.length > 0 &&
    metrics.chart.sliceLabels.every((label) => label.withinChart && !label.clipped && (!label.ringDelta || (label.ringDelta.radius <= 3 && label.ringDelta.angle <= 3)));

  if (!dashboard.reached) failures.push("dashboard not reached");
  if (metrics.hasHorizontalOverflow) failures.push("document has horizontal overflow");
  if (!metrics.filter.card?.visible || !metrics.filter.card?.withinViewport) failures.push("dashboard filter card is not visible inside the viewport");
  if (!allModeButtonsUsable) failures.push("filter mode buttons are not visible/focusable/touch-sized inside the viewport");
  if (!allMonthControlsUsable) failures.push("month controls are not visible/focusable/touch-sized inside the viewport");
  if (!allRangeControlsUsable) failures.push("range controls are not visible/focusable/touch-sized inside the viewport after switching to range mode");
  if (!metrics.filter.focusRing?.detectable) failures.push("filter focus ring was not detectable");
  if (!chartOk) failures.push("dashboard donut chart labels are missing, clipped, outside chart, or off ring geometry");
  if (!contextOk) failures.push("dashboard context metrics are incomplete");
  return { verdict: failures.length === 0 ? "pass" : "fail", failures };
}

export async function runDashboardChartFilter(options) {
  return withBrowserEvidence(options, { isolated: true }, "dashboard-chart-filter", async ({ app, page }) => {
    const dashboard = await tryRegisterDashboard(page, app.url);
    let seed = null;
    let monthlyMetrics = null;
    let rangeMetrics = null;
    if (dashboard.reached) {
      seed = await seedDashboardFixtures(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("main.app-shell").waitFor({ state: "visible", timeout: 15_000 });
      await openRequestedTab(page, "dashboard");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole("button", { name: "월별" }).focus();
      await delay(100);
      monthlyMetrics = await readDashboardChartFilterMetrics(page);
      await page.getByRole("button", { name: "기간" }).click();
      await page.getByRole("button", { name: "기간" }).focus();
      await delay(100);
      rangeMetrics = await readDashboardChartFilterMetrics(page);
      await page.getByRole("button", { name: "월별" }).click();
      await page.getByRole("button", { name: "월별" }).focus();
      await page.locator(".dashboard-portfolio-card").scrollIntoViewIfNeeded();
      const select = page.locator(".dashboard-portfolio-chart-select select");
      if ((await select.count()) > 0) await select.selectOption("transaction_flow");
      await delay(300);
    }
    const metrics = await readDashboardChartFilterMetrics(page);
    if (monthlyMetrics?.filter?.monthControls?.length) {
      metrics.filter.card = monthlyMetrics.filter.card;
      metrics.filter.modeButtons = monthlyMetrics.filter.modeButtons;
      metrics.filter.monthControls = monthlyMetrics.filter.monthControls;
      metrics.filter.focusRing = monthlyMetrics.filter.focusRing;
    }
    if (rangeMetrics?.filter?.rangeControls?.length) {
      metrics.filter.rangeControls = rangeMetrics.filter.rangeControls;
      metrics.filter.rangeFocusRing = rangeMetrics.filter.focusRing;
    }
    const { verdict, failures } = decideDashboardChartFilterVerdict(metrics, dashboard);
    return {
      url: page.url(),
      baseUrlSource: app.source,
      backendPort: app.backendPort,
      frontendPort: app.frontendPort,
      dashboardReached: dashboard.reached,
      dashboard,
      seed,
      filter: metrics.filter,
      filterInteractionMetrics: { monthly: monthlyMetrics?.filter ?? null, range: rangeMetrics?.filter ?? null },
      chart: metrics.chart,
      context: metrics.context,
      hasHorizontalOverflow: metrics.hasHorizontalOverflow,
      metrics,
      verdict,
      failures,
    };
  });
}
