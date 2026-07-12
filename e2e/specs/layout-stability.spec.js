import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicHolding,
  createTransactionViaApi,
  expectClearOfFixedBottomNav,
  expectNoHorizontalOverflow,
  expectWithinViewport,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

const LAYOUT_PROFILES = [
  { name: "desktop", width: 1366, height: 768, font: "Malgun Gothic" },
  { name: "tablet", width: 768, height: 1024, font: "Noto Sans KR" },
  { name: "mobile-narrow", width: 360, height: 740, font: "Malgun Gothic" },
  { name: "mobile-standard", width: 390, height: 844, font: "Apple SD Gothic Neo" },
  { name: "mobile-wide", width: 412, height: 915, font: "Noto Sans KR" },
];

const MOBILE_NAV_LABEL_PROFILES = [
  { name: "mobile-compact", width: 320, height: 568, font: "Malgun Gothic" },
  { name: "mobile-narrow", width: 360, height: 740, font: "Malgun Gothic" },
  { name: "mobile-standard", width: 390, height: 844, font: "Apple SD Gothic Neo" },
];

const NAV_TABS = ["대시보드", "거래", "자산", "설정", "협업", "데이터 가져오기"];

const AUTH_LAYOUT_PROFILES = [
  { name: "desktop-signup", width: 1366, height: 768, font: "Malgun Gothic", mobile: false },
  { name: "mobile-narrow-signup", width: 360, height: 740, font: "Malgun Gothic", mobile: true },
  { name: "mobile-standard-signup", width: 390, height: 844, font: "Noto Sans KR", mobile: true },
];

async function resetViewportScroll(page) {
  await page.evaluate(async () => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlScrollBehavior = html.style.scrollBehavior;
    const previousBodyScrollBehavior = body.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";

    const roots = [document.scrollingElement, html, body].filter(Boolean);
    const reset = () => {
      document.activeElement?.blur?.();
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      for (const element of roots) {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      }
    };

    // Chrome can restore an anchor after layout settles, so reset on both sides of two frames.
    reset();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    reset();

    html.style.scrollBehavior = previousHtmlScrollBehavior;
    body.style.scrollBehavior = previousBodyScrollBehavior;
  });
}

async function getViewportScrollTop(page) {
  return page.evaluate(() => {
    const positions = [window.scrollY, document.scrollingElement?.scrollTop ?? 0, document.documentElement.scrollTop, document.body.scrollTop];
    return Math.max(...positions);
  });
}

async function scrollViewportToTop(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await resetViewportScroll(page);
    const settled = await expect
      .poll(() => getViewportScrollTop(page), {
        message: "viewport should settle at the top before measuring chrome",
        timeout: 1_500,
      })
      .toBeLessThanOrEqual(1)
      .then(() => true)
      .catch(() => false);

    if (settled) {
      return;
    }
  }

  const scrollTop = await getViewportScrollTop(page);
  expect(scrollTop, "viewport should settle at the top before measuring chrome").toBeLessThanOrEqual(1);
}

async function applyFontProfile(page, fontFamily) {
  await page.addStyleTag({
    content: `
      body, button, input, select, textarea {
        font-family: "${fontFamily}", "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif !important;
      }
    `,
  });
}

async function expectMobileTabBarStable(page) {
  const isMobile = (page.viewportSize()?.width ?? 9999) <= 820;
  if (!isMobile) {
    return;
  }

  await scrollViewportToTop(page);

  const nav = page.locator("nav.topbar-tabs");
  await expect(nav).toBeVisible();
  await expect(nav).toHaveCSS("background-color", "rgb(255, 255, 255)");

  const metrics = await nav.locator("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      const label = button.querySelector(".tab-label");
      return {
        ariaLabel: button.getAttribute("aria-label") || "",
        mobileLabel: label?.getAttribute("data-mobile-label") || "",
        height: box.height,
        width: box.width,
        labelOverflowX: label ? label.scrollWidth - label.clientWidth : 0,
        labelOverflowY: label ? label.scrollHeight - label.clientHeight : 0,
      };
    })
  );

  expect(metrics).toHaveLength(6);
  for (const item of metrics) {
    const labelContext = `${item.ariaLabel}/${item.mobileLabel}`;
    expect(item.width, `${labelContext} tab width`).toBeGreaterThanOrEqual(42);
    expect(item.height, `${labelContext} tab height`).toBeGreaterThanOrEqual(44);
    expect(item.labelOverflowX, `${labelContext} label horizontal overflow`).toBeLessThanOrEqual(2);
    expect(item.labelOverflowY, `${labelContext} label vertical overflow`).toBeLessThanOrEqual(2);
  }

  const navMetrics = await nav.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      position: style.position,
      top: box.top,
      bottom: box.bottom,
      height: box.height,
      viewportHeight: window.innerHeight,
    };
  });

  expect(navMetrics.height).toBeLessThan(navMetrics.viewportHeight * 0.34);
  if (navMetrics.position === "fixed") {
    expect(navMetrics.top, `fixed mobile nav should stay in the lower screen: ${JSON.stringify(navMetrics)}`).toBeGreaterThan(
      navMetrics.viewportHeight * 0.58,
    );
    expect(navMetrics.bottom, `fixed mobile nav should stay inside the viewport: ${JSON.stringify(navMetrics)}`).toBeLessThanOrEqual(
      navMetrics.viewportHeight,
    );
  }
}

async function expectMobileBottomClearance(page) {
  const isMobile = (page.viewportSize()?.width ?? 9999) <= 820;
  if (!isMobile) {
    return;
  }

  const metrics = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const nav = document.querySelector("nav.topbar-tabs")?.getBoundingClientRect();
    const navStyle = document.querySelector("nav.topbar-tabs")
      ? getComputedStyle(document.querySelector("nav.topbar-tabs"))
      : null;
    const lastContent = document.querySelector(".app-content > :last-child")?.getBoundingClientRect();
    return {
      fixedBottomNav: Boolean(
        nav &&
          navStyle?.position === "fixed" &&
          nav.bottom >= window.innerHeight - 32 &&
          nav.top > window.innerHeight * 0.5
      ),
      gap: nav && lastContent ? nav.top - lastContent.bottom : 0,
      navTop: nav?.top ?? 0,
      navBottom: nav?.bottom ?? 0,
      viewportHeight: window.innerHeight,
    };
  });

  if (metrics.fixedBottomNav) {
    expect(metrics.gap).toBeGreaterThanOrEqual(88);
    return;
  }

  expect(metrics.fixedBottomNav).toBe(false);
}

async function expectCopyrightClearOfCards(page) {
  const metrics = await page.evaluate(() => {
    const footer = document.querySelector(".app-shell > .app-copyright");
    if (!footer) {
      return { present: false, position: "", overlaps: [] };
    }

    const footerBox = footer.getBoundingClientRect();
    const overlaps = Array.from(document.querySelectorAll(".app-content > *"))
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const visible = box.width > 0 && box.height > 0;
        const intersects =
          footerBox.left < box.right &&
          footerBox.right > box.left &&
          footerBox.top < box.bottom &&
          footerBox.bottom > box.top;
        return visible && intersects;
      })
      .map((element) => element.className || element.tagName);

    return {
      present: true,
      position: getComputedStyle(footer).position,
      overlaps,
    };
  });

  expect(metrics.present).toBe(true);
  expect(metrics.position).not.toBe("fixed");
  expect(metrics.position).not.toBe("absolute");
  expect(metrics.overlaps).toEqual([]);
}

async function expectPageChromeConsistent(page, tabLabel) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const metrics = await page.evaluate(() => {
    const boxOf = (selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const firstContent = document.querySelector(".app-content > *");
    const firstContentBox = firstContent?.getBoundingClientRect();
    const sideCards = Array.from(document.querySelectorAll(".dashboard-side-grid > .dashboard-side-card")).map((card) => {
      const box = card.getBoundingClientRect();
      return { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width) };
    });
    const importPanels = Array.from(document.querySelectorAll(".import-mode-grid > .import-mode-panel")).map((panel) => {
      const box = panel.getBoundingClientRect();
      return { top: Math.round(box.top), left: Math.round(box.left), width: Math.round(box.width) };
    });
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      topbarTitle: document.querySelector(".topbar h1")?.textContent?.trim() || "",
      visibleText: document.body.textContent || "",
      topbar: boxOf(".topbar"),
      nav: boxOf("nav.topbar-tabs"),
      firstContent: firstContentBox
        ? {
            top: firstContentBox.top,
            bottom: firstContentBox.bottom,
            width: firstContentBox.width,
            height: firstContentBox.height,
          }
        : null,
      sideCards,
      importPanels,
    };
  });

  expect(metrics.topbarTitle).toBe("Money Flow");
  expect(metrics.visibleText).not.toContain("money-flow");
  expect(metrics.topbar).not.toBeNull();
  expect(metrics.nav).not.toBeNull();
  expect(metrics.firstContent).not.toBeNull();
  const navIsBottomFixed =
    metrics.viewportWidth <= 820 &&
    metrics.nav.top > metrics.viewportHeight * 0.5 &&
    metrics.nav.bottom >= metrics.viewportHeight - 32;
  const chromeReferenceBottom = metrics.viewportWidth <= 820 && !navIsBottomFixed ? metrics.nav.bottom : metrics.topbar.bottom;
  expect(metrics.firstContent.top - chromeReferenceBottom).toBeGreaterThanOrEqual(8);
  expect(metrics.firstContent.top - chromeReferenceBottom).toBeLessThanOrEqual(24);

  if (tabLabel === "대시보드" && metrics.viewportWidth >= 1000) {
    expect(metrics.sideCards.length).toBeGreaterThanOrEqual(4);
    const rowCount = new Set(metrics.sideCards.map((card) => card.top)).size;
    expect(rowCount).toBeLessThanOrEqual(2);
  }

  if (tabLabel === "데이터 가져오기" && metrics.viewportWidth >= 1000) {
    expect(metrics.importPanels).toHaveLength(2);
    expect(Math.abs(metrics.importPanels[0].top - metrics.importPanels[1].top)).toBeLessThanOrEqual(2);
    expect(metrics.importPanels[1].left).toBeGreaterThan(metrics.importPanels[0].left + metrics.importPanels[0].width * 0.8);
  }

  if (tabLabel === "설정") {
    await expect(
      page.getByRole("button", {
        name: "거래 행 색상 기본 화면에서는 숨기고 필요할 때만 조정합니다. 펼치기",
      })
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "자산 유형/색상 설정 유형 편집, 색상, 표시 규칙은 접어 둡니다. 펼치기",
      })
    ).toBeVisible();
  }
}

async function sampleControlForTab(page, tabLabel, { holdingName }) {
  if (tabLabel === "대시보드") {
    return page.locator(".dashboard-filter-card").first();
  }
  if (tabLabel === "거래") {
    return page.locator("tr.transaction-row").first();
  }
  if (tabLabel === "자산") {
    return page.locator("tr", { hasText: holdingName }).first();
  }
  if (tabLabel === "설정") {
    return page.getByRole("button", { name: "가계 설정 저장" });
  }
  if (tabLabel === "협업") {
    return page.getByRole("button", { name: "초대 발송" });
  }
  return page.getByRole("button", { name: "패키지 미리 검증", exact: true });
}

async function expectWorksurfaceRowsUseCorrectMode(page, tabLabel) {
  const viewportWidth = page.viewportSize()?.width ?? 9999;
  const isDesktop = viewportWidth > 820;

  if (tabLabel === "거래") {
    const row = page.locator("tr.transaction-row").first();
    await expect(row).toBeVisible();

    const metrics = await row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const displayOf = (selector) => {
        const target = element.querySelector(selector);
        return target ? getComputedStyle(target).display : "missing";
      };
      const dateCell = element.querySelector(".transaction-col-date");
      const dateText = dateCell?.innerText?.trim() || "";
      return {
        rowDisplay: getComputedStyle(element).display,
        rowHeight: box.height,
        mobileDateDisplay: displayOf(".mobile-date-text"),
        flowShortDisplay: displayOf(".transaction-flow-short"),
        ownerCompactDisplay: displayOf(".transaction-owner-compact"),
        toggleDisplay: displayOf(".mobile-toggle-btn"),
        dateText,
        dateOverflow: dateCell ? dateCell.scrollWidth - dateCell.clientWidth : 0,
      };
    });

    if (isDesktop) {
      expect(metrics.rowDisplay).toBe("table-row");
      expect(metrics.mobileDateDisplay).toBe("none");
      expect(metrics.flowShortDisplay).toBe("none");
      expect(metrics.ownerCompactDisplay).not.toBe("none");
      expect(metrics.ownerCompactDisplay).not.toBe("missing");
      expect(["none", "missing"]).toContain(metrics.toggleDisplay);
      expect(metrics.dateText).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(metrics.dateOverflow).toBeLessThanOrEqual(2);
      expect(metrics.rowHeight).toBeLessThanOrEqual(48);
    } else {
      expect(metrics.rowDisplay).toBe("table-row");
      expect(metrics.mobileDateDisplay).not.toBe("none");
      expect(metrics.flowShortDisplay).not.toBe("none");
      expect(metrics.ownerCompactDisplay).not.toBe("none");
      expect(metrics.ownerCompactDisplay).not.toBe("missing");
      expect(metrics.toggleDisplay).toBe("missing");
      expect(metrics.dateText).toMatch(/^\d{2}-\d{2}$/);
      expect(metrics.dateOverflow).toBeLessThanOrEqual(2);
      expect(metrics.rowHeight).toBeLessThanOrEqual(48);
    }
  }

  if (tabLabel === "자산") {
    const row = page.locator("tr.holding-row").first();
    await expect(row).toBeVisible();

    const metrics = await row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const displayOf = (selector) => {
        const target = element.querySelector(selector);
        return target ? getComputedStyle(target).display : "missing";
      };
      const nameLabel = element.querySelector(".holding-name-label");
      const nameLabelStyle = nameLabel ? getComputedStyle(nameLabel) : null;
      return {
        rowDisplay: getComputedStyle(element).display,
        rowHeight: box.height,
        nameCellDisplay: displayOf(".holding-name-cell"),
        nameLabelDisplay: displayOf(".holding-name-label"),
        nameLabelClamp: nameLabelStyle?.getPropertyValue("-webkit-line-clamp") || "",
        mobileMetaDisplay: displayOf(".holding-mobile-meta"),
        ownerChipDisplay: displayOf(".holding-owner-chip"),
        toggleDisplay: displayOf(".mobile-toggle-btn"),
      };
    });

    if (isDesktop) {
      expect(metrics.rowDisplay).toBe("table-row");
      expect(metrics.nameCellDisplay).toBe("table-cell");
      expect(metrics.nameLabelClamp).toBe("2");
      expect(metrics.mobileMetaDisplay).toBe("none");
      expect(["none", "missing"]).toContain(metrics.ownerChipDisplay);
      expect(metrics.toggleDisplay).toBe("none");
      expect(metrics.rowHeight).toBeLessThanOrEqual(72);
    } else {
      expect(metrics.rowDisplay).toBe("grid");
      expect(metrics.mobileMetaDisplay).not.toBe("none");
      expect(metrics.toggleDisplay).not.toBe("none");
    }
  }
}

async function expectHoldingSectionRowsAligned(page) {
  const viewportWidth = page.viewportSize()?.width ?? 9999;
  if (viewportWidth <= 820) {
    return;
  }

  const sectionCell = page.locator(".holdings-surface-table .section-header-cell").first();
  await expect(sectionCell).toBeVisible();

  const metrics = await sectionCell.evaluate((cell) => {
    const cellBox = cell.getBoundingClientRect();
    const title = cell.querySelector(".holding-section-title");
    const titleBox = title?.getBoundingClientRect();
    const header = document.querySelector(".holdings-surface-table thead")?.getBoundingClientRect();
    const titleMid = titleBox ? titleBox.top + titleBox.height / 2 : 0;
    const cellMid = cellBox.top + cellBox.height / 2;
    return {
      cellHeight: cellBox.height,
      gapFromHeader: header ? cellBox.top - header.bottom : 99,
      titleCenterOffset: Math.abs(titleMid - cellMid),
      titleOverflow: title ? title.scrollWidth - title.clientWidth : 0,
    };
  });

  expect(metrics.cellHeight).toBeGreaterThanOrEqual(34);
  expect(metrics.cellHeight).toBeLessThanOrEqual(48);
  expect(metrics.gapFromHeader).toBeGreaterThanOrEqual(-1);
  expect(metrics.titleCenterOffset).toBeLessThanOrEqual(2.5);
  expect(metrics.titleOverflow).toBeLessThanOrEqual(2);
}

async function expectLandscapeWorkspaceControlVisible(page, locator, label, { minVisibleHeight = 34 } = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(locator).toBeVisible();
  const metrics = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const topbarBox = document.querySelector(".topbar")?.getBoundingClientRect();
    const navBox = document.querySelector("nav.topbar-tabs")?.getBoundingClientRect();
    const visibleTop = Math.max(0, box.top);
    const visibleBottom = Math.min(window.innerHeight, box.bottom);
    return {
      viewportHeight: window.innerHeight,
      topbarBottom: topbarBox?.bottom ?? 0,
      navTop: navBox?.top ?? window.innerHeight,
      navBottom: navBox?.bottom ?? 0,
      sampleTop: box.top,
      sampleBottom: box.bottom,
      sampleHeight: box.height,
      visibleHeight: Math.max(0, visibleBottom - visibleTop),
    };
  });

  if (metrics.navTop > metrics.viewportHeight * 0.5) {
    expect(metrics.sampleBottom, `${label} first work control should clear bottom navigation: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
      metrics.navTop - 6,
    );
  } else {
    expect(metrics.navBottom, `${label} chrome should leave most of 568x320 for work: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(104);
  }
  expect(metrics.sampleTop, `${label} first work control should start inside first viewport: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(286);
  expect(
    metrics.visibleHeight,
    `${label} first work control should be materially visible without scroll: ${JSON.stringify(metrics)}`,
  ).toBeGreaterThanOrEqual(Math.min(minVisibleHeight, metrics.sampleHeight));
}

async function openSignupSurface(page, profile) {
  await page.setViewportSize({ width: profile.width, height: profile.height });
  await page.goto("/");
  await applyFontProfile(page, profile.font);
  await page.getByRole("button", { name: "회원가입" }).click();
  await expect(page.locator("form.auth-card-register")).toBeVisible();
}

async function expectSignupLayoutStable(page, profile) {
  await expectNoHorizontalOverflow(page, 6);

  const card = page.locator("form.auth-card-register");
  await expectWithinViewport(card, { allowance: 6, requireVertical: false });
  await expect(page.getByRole("button", { name: "회원가입하고 시작" })).toBeVisible();

  const metrics = await page.evaluate(() => {
    const boxOf = (selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return null;
      }
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const title = document.querySelector(".auth-card h2");
    const hero = document.querySelector(".auth-hero-panel");
    const heroTitle = document.querySelector(".auth-hero-copy h2");
    const authSwitchText = document.querySelector(".auth-switch span");
    const authSwitchButton = document.querySelector(".auth-switch .text-button");
    const authSwitchTextBox = authSwitchText?.getBoundingClientRect();
    const authSwitchButtonBox = authSwitchButton?.getBoundingClientRect();
    const authSwitchButtonStyle = authSwitchButton ? getComputedStyle(authSwitchButton) : null;
    const labelRowGaps = Array.from(document.querySelectorAll("form.auth-card label:not(.check-row)")).map((label) =>
      Number.parseFloat(getComputedStyle(label).rowGap || "0")
    );
    const checkboxBoxes = Array.from(document.querySelectorAll('.auth-options input[type="checkbox"]')).map((checkbox) => {
      const box = checkbox.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    const checkboxLabelBoxes = Array.from(document.querySelectorAll(".auth-options .check-row")).map((label) => {
      const box = label.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      card: boxOf("form.auth-card-register"),
      submit: boxOf('form.auth-card-register > button[type="submit"]'),
      switcher: boxOf(".auth-switch"),
      titleFontSize: title ? Number.parseFloat(getComputedStyle(title).fontSize) : 0,
      titleLetterSpacing: title ? getComputedStyle(title).letterSpacing : "",
      heroDisplay: hero ? getComputedStyle(hero).display : "missing",
      heroTitleFontSize: heroTitle ? Number.parseFloat(getComputedStyle(heroTitle).fontSize) : 0,
      heroTitleLetterSpacing: heroTitle ? getComputedStyle(heroTitle).letterSpacing : "",
      proofGridCount: document.querySelectorAll(".auth-proof-grid").length,
      visibleText: document.body.textContent || "",
      minLabelRowGap: Math.min(...labelRowGaps),
      checkboxBoxes,
      checkboxLabelBoxes,
      authSwitchButton: authSwitchButtonBox
        ? {
            background: authSwitchButtonStyle.backgroundColor,
            boxShadow: authSwitchButtonStyle.boxShadow,
            display: authSwitchButtonStyle.display,
            height: authSwitchButtonBox.height,
            centerDelta: authSwitchTextBox
              ? Math.abs(
                  authSwitchTextBox.top +
                    authSwitchTextBox.height / 2 -
                    (authSwitchButtonBox.top + authSwitchButtonBox.height / 2)
                )
              : null,
          }
        : null,
    };
  });

  expect(metrics.card).not.toBeNull();
  expect(metrics.proofGridCount).toBe(0);
  expect(metrics.visibleText).not.toContain("협업 초대");
  expect(metrics.visibleText).not.toContain("money-flow");
  expect(metrics.submit).not.toBeNull();
  expect(metrics.switcher).not.toBeNull();
  expect(metrics.titleFontSize).toBeLessThanOrEqual(profile.mobile ? 22 : 24);
  expect(["0px", "normal"]).toContain(metrics.titleLetterSpacing);
  expect(metrics.minLabelRowGap).toBeGreaterThanOrEqual(5);
  expect(metrics.checkboxBoxes).toHaveLength(2);
  for (const checkbox of metrics.checkboxBoxes) {
    expect(checkbox.width).toBeGreaterThanOrEqual(20);
    expect(checkbox.width).toBeLessThanOrEqual(24);
    expect(checkbox.height).toBeGreaterThanOrEqual(20);
    expect(checkbox.height).toBeLessThanOrEqual(24);
  }
  expect(metrics.checkboxLabelBoxes).toHaveLength(2);
  for (const label of metrics.checkboxLabelBoxes) {
    expect(label.height).toBeGreaterThanOrEqual(44);
  }
  expect(metrics.authSwitchButton).not.toBeNull();
  expect(metrics.authSwitchButton.background).toBe("rgba(0, 0, 0, 0)");
  expect(metrics.authSwitchButton.boxShadow).toBe("none");
  expect(["inline-flex", "flex"]).toContain(metrics.authSwitchButton.display);
  expect(metrics.authSwitchButton.height).toBeGreaterThanOrEqual(40);
  expect(metrics.authSwitchButton.height).toBeLessThanOrEqual(48);
  expect(metrics.authSwitchButton.centerDelta).toBeLessThanOrEqual(3);

  if (profile.mobile) {
    expect(metrics.heroDisplay).toBe("none");
    expect(metrics.card.bottom).toBeLessThanOrEqual(metrics.viewport.height - 10);
    expect(metrics.switcher.bottom).toBeLessThanOrEqual(metrics.viewport.height - 16);
  } else {
    expect(metrics.heroDisplay).not.toBe("none");
    expect(metrics.heroTitleFontSize).toBeLessThanOrEqual(32);
    expect(["0px", "normal"]).toContain(metrics.heroTitleLetterSpacing);
  }
}

test("auth signup layout stays compact across desktop and mobile fonts", async ({ page }) => {
  for (const profile of AUTH_LAYOUT_PROFILES) {
    await test.step(profile.name, async () => {
      await openSignupSurface(page, profile);
      await expectSignupLayoutStable(page, profile);
    });
  }
});

test("auth landscape hides hero before headline creates orphan text", async ({ page }) => {
  for (const mode of ["login", "signup"]) {
    await test.step(mode, async () => {
      await page.setViewportSize({ width: 844, height: 390 });
      await page.goto("/");
      await applyFontProfile(page, "Malgun Gothic");
      if (mode === "signup") {
        await page.getByRole("button", { name: "회원가입" }).click();
        await expect(page.locator("form.auth-card-register")).toBeVisible();
      } else {
        await expect(page.locator("form.auth-card-login")).toBeVisible();
      }

      const metrics = await page.evaluate(() => {
        const hero = document.querySelector(".auth-hero-panel");
        const card = document.querySelector("form.auth-card");
        const cardBox = card?.getBoundingClientRect();
        return {
          heroDisplay: hero ? getComputedStyle(hero).display : "missing",
          cardWidth: cardBox?.width ?? 0,
          cardLeft: cardBox?.left ?? 0,
          cardRight: cardBox?.right ?? 0,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      expect(metrics.heroDisplay, `${mode} hero should not render in 844x390 landscape`).toBe("none");
      expect(metrics.cardWidth, `${mode} auth card should keep a measurable width`).toBeGreaterThan(320);
      expect(metrics.cardLeft, `${mode} auth card should remain in viewport`).toBeGreaterThanOrEqual(0);
      expect(metrics.cardRight, `${mode} auth card should remain in viewport`).toBeLessThanOrEqual(844);
      expect(metrics.overflowX, `${mode} auth surface should not overflow horizontally`).toBeLessThanOrEqual(1);
      await expectWithinViewport(page.locator("form.auth-card"), { allowance: 6, requireVertical: false });
      await capture(page, `auth-landscape-${mode}-compact`);
    });
  }
});

test("global shell CSS baseline", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".auth-shell")).toBeVisible();

  const baseline = await page.evaluate(() => {
    const bodyStyle = getComputedStyle(document.body);
    return {
      bodyMargin: bodyStyle.margin,
      bodyBackgroundColor: bodyStyle.backgroundColor,
      hasAuthShell: Boolean(document.querySelector(".auth-shell")),
      hasTableBody: Boolean(document.querySelector("tbody")),
    };
  });

  expect(baseline.bodyMargin).toBe("0px");
  expect(baseline.bodyBackgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(baseline.bodyBackgroundColor).not.toBe("transparent");
  expect(baseline.hasAuthShell).toBe(true);
  expect(baseline.hasTableBody).toBe(false);
  await capture(page, "global-shell-css-baseline");
});

test("mobile import navigation label stays readable at compact widths", async ({ page }) => {
  const email = `${unique("mobile-import-nav")}@example.com`;
  const displayName = unique("mobile-import-nav-user");
  const normalizeVisualLabel = (value) =>
    String(value ?? "")
      .replace(/^["']|["']$/g, "")
      .replace(/\\a\s?/gi, "")
      .replace(/\s/g, "");

  await registerAndVerify(page, { email, displayName });

  for (const profile of MOBILE_NAV_LABEL_PROFILES) {
    await test.step(profile.name, async () => {
      await page.setViewportSize({ width: profile.width, height: profile.height });
      await applyFontProfile(page, profile.font);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectMobileTabBarStable(page);

      const importTab = page.locator('nav.topbar-tabs button[aria-label="데이터 가져오기"]');
      await expect(importTab).toBeVisible();
      const metrics = await importTab.evaluate((button) => {
        const label = button.querySelector(".tab-label");
        const labelBox = label?.getBoundingClientRect();
        const buttonBox = button.getBoundingClientRect();
        const pseudoContent = label ? getComputedStyle(label, "::after").content : "";
        const visualLabel = pseudoContent
          .replace(/^["']|["']$/g, "")
          .replace(/\\a\s?/gi, "")
          .replace(/\s/g, "");
        return {
          ariaLabel: button.getAttribute("aria-label"),
          mobileLabel: label?.getAttribute("data-mobile-label"),
          visualLabel,
          labelOverflowX: label ? label.scrollWidth - label.clientWidth : 0,
          labelLeft: labelBox?.left ?? 0,
          labelRight: labelBox?.right ?? 0,
          buttonLeft: buttonBox.left,
          buttonRight: buttonBox.right,
        };
      });

      expect(metrics.ariaLabel).toBe("데이터 가져오기");
      expect(normalizeVisualLabel(metrics.mobileLabel)).toBe("가져오기");
      expect(normalizeVisualLabel(metrics.visualLabel)).toBe("가져오기");
      expect(metrics.labelOverflowX).toBeLessThanOrEqual(1);
      expect(metrics.labelLeft).toBeGreaterThanOrEqual(metrics.buttonLeft - 0.5);
      expect(metrics.labelRight).toBeLessThanOrEqual(metrics.buttonRight + 0.5);
      await expectNoHorizontalOverflow(page, 12);
    });
  }
});

test("empty holdings table keeps desktop columns readable", async ({ page }) => {
  const email = `${unique("empty-holdings-layout")}@example.com`;
  const displayName = unique("empty-holdings-user");

  await page.setViewportSize({ width: 1366, height: 900 });
  await registerAndVerify(page, { email, displayName });
  await openTab(page, "자산");

  const table = page.locator(".holdings-surface-table");
  const emptyState = page.getByTestId("holdings-empty-state");
  const gainHeader = page.locator(".holdings-surface-table thead .holding-col-gain");
  const updatedHeader = page.locator(".holdings-surface-table thead .holding-col-updated");
  const actionHeader = page.locator(".holdings-surface-table thead .holding-col-actions");

  await expect(table).toBeVisible();
  await expect(emptyState).toBeVisible();
  await expectNoHorizontalOverflow(page, 12);

  const metrics = await page.evaluate(() => {
    const tableBox = document.querySelector(".holdings-surface-table")?.getBoundingClientRect();
    const emptyBox = document.querySelector("[data-testid='holdings-empty-state']")?.getBoundingClientRect();
    const gainHeader = document.querySelector(".holdings-surface-table thead .holding-col-gain");
    const gainBox = gainHeader?.getBoundingClientRect();
    const gainSortButton = gainHeader?.querySelector(".sort-header");
    const updatedBox = document.querySelector(".holdings-surface-table thead .holding-col-updated")?.getBoundingClientRect();
    const actionBox = document.querySelector(".holdings-surface-table thead .holding-col-actions")?.getBoundingClientRect();
    const gainText = gainHeader?.textContent || "";
    const updatedText = document.querySelector(".holdings-surface-table thead .holding-col-updated")?.textContent || "";
    const emptyText = document.querySelector("[data-testid='holdings-empty-state']")?.textContent || "";

    return {
      tableWidth: tableBox?.width || 0,
      emptyWidth: emptyBox?.width || 0,
      emptyHeight: emptyBox?.height || 0,
      gainWidth: gainBox?.width || 0,
      gainClientWidth: gainHeader?.clientWidth || 0,
      gainScrollWidth: gainHeader?.scrollWidth || 0,
      gainButtonClientWidth: gainSortButton?.clientWidth || 0,
      gainButtonScrollWidth: gainSortButton?.scrollWidth || 0,
      updatedWidth: updatedBox?.width || 0,
      updatedHeight: updatedBox?.height || 0,
      actionWidth: actionBox?.width || 0,
      gainText,
      emptyText,
      updatedText,
    };
  });

  expect(metrics.emptyText).toContain("자산 내역이 없습니다.");
  expect(metrics.emptyWidth).toBeGreaterThan(metrics.tableWidth * 0.7);
  expect(metrics.emptyHeight).toBeLessThanOrEqual(130);
  expect(metrics.gainText).toContain("손익(KRW)");
  expect(metrics.gainText).toContain("↕");
  expect(metrics.gainWidth).toBeGreaterThanOrEqual(96);
  expect(metrics.gainScrollWidth).toBeLessThanOrEqual(metrics.gainClientWidth + 1);
  expect(metrics.gainButtonScrollWidth).toBeLessThanOrEqual(metrics.gainButtonClientWidth + 1);
  expect(metrics.updatedText).toContain("최종 수정일");
  expect(metrics.updatedWidth).toBeGreaterThanOrEqual(108);
  expect(metrics.updatedHeight).toBeLessThanOrEqual(80);
  await expectWithinViewport(gainHeader);
  await expectWithinViewport(updatedHeader);
  await expectWithinViewport(actionHeader);
  await capture(page, "layout-empty-holdings-desktop-fixed");
});

test("mobile transaction sheet actions keep navigation reachable", async ({ page }) => {
  const email = `${unique("mobile-action-layer")}@example.com`;
  const displayName = unique("mobile-action-user");

  await page.setViewportSize({ width: 390, height: 844 });
  await registerAndVerify(page, { email, displayName });
  await openTab(page, "거래");

  const fab = page.getByTestId("transactions-fab");
  await expect(fab).toBeVisible();
  const fabMetrics = await fab.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      position: style.position,
      inListHeading: Boolean(element.closest(".surface-list-heading")),
      right: box.right,
      bottom: box.bottom,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(fabMetrics.position, `transaction add action should stay fixed at the bottom-right: ${JSON.stringify(fabMetrics)}`).toBe("fixed");
  expect(fabMetrics.inListHeading, `transaction add action should be outside the sticky heading containing block: ${JSON.stringify(fabMetrics)}`).toBe(false);
  expect(fabMetrics.left, `transaction add action should sit in the right half: ${JSON.stringify(fabMetrics)}`).toBeGreaterThan(
    fabMetrics.viewportWidth * 0.5,
  );
  expect(fabMetrics.right, `transaction add action should stay inside the right edge: ${JSON.stringify(fabMetrics)}`).toBeLessThanOrEqual(
    fabMetrics.viewportWidth - 8,
  );
  expect(fabMetrics.top, `transaction add action should stay in the lower viewport: ${JSON.stringify(fabMetrics)}`).toBeGreaterThan(
    fabMetrics.viewportHeight * 0.72,
  );
  expect(fabMetrics.width).toBeGreaterThanOrEqual(48);
  expect(fabMetrics.height).toBeGreaterThanOrEqual(48);

  await fab.click();
  await expect(page.getByTestId("transaction-entry-sheet")).toBeVisible();
  const overlayMetrics = await page.evaluate(() => {
    const fabElement = document.querySelector('[data-testid="transactions-fab"]');
    const toolbar = document.querySelector('[data-testid="transaction-sticky-toolbar"]');
    const backdrop = document.querySelector(".transaction-entry-sheet-backdrop");
    const sheet = document.querySelector('[data-testid="transaction-entry-sheet"]');
    const fabBox = fabElement?.getBoundingClientRect();
    const centerX = fabBox ? fabBox.left + fabBox.width / 2 : 0;
    const centerY = fabBox ? fabBox.top + fabBox.height / 2 : 0;
    const topElement = fabBox ? document.elementFromPoint(centerX, centerY) : null;
    return {
      fabCenterCoveredByOverlay: Boolean(topElement?.closest(".transaction-entry-sheet-backdrop, [data-testid='transaction-entry-sheet']")),
      backdropZ: backdrop ? Number.parseInt(getComputedStyle(backdrop).zIndex || "0", 10) : 0,
      sheetZ: sheet ? Number.parseInt(getComputedStyle(sheet).zIndex || "0", 10) : 0,
      toolbarZ: toolbar ? Number.parseInt(getComputedStyle(toolbar).zIndex || "0", 10) : 0,
    };
  });
  expect(
    overlayMetrics.fabCenterCoveredByOverlay,
    `transaction sheet overlay should cover the FAB hit center: ${JSON.stringify(overlayMetrics)}`,
  ).toBe(true);
  expect(overlayMetrics.backdropZ, `transaction backdrop should outrank toolbar: ${JSON.stringify(overlayMetrics)}`).toBeGreaterThan(
    overlayMetrics.toolbarZ,
  );
  await capture(page, "layout-mobile-transaction-fab-sheet-layer");

  const metrics = await page.locator(".transaction-quick-actions").evaluate((element) => {
    const button = element.querySelector("button");
    const sheet = element.closest("[data-testid='transaction-entry-sheet']");
    const sheetBox = sheet?.getBoundingClientRect();
    const actionBox = element.getBoundingClientRect();
    return {
      position: getComputedStyle(element).position,
      containerPointerEvents: getComputedStyle(element).pointerEvents,
      buttonPointerEvents: button ? getComputedStyle(button).pointerEvents : "missing",
      sheetScrollHeight: sheet?.scrollHeight || 0,
      sheetClientHeight: sheet?.clientHeight || 0,
      actionBottom: actionBox.bottom,
      sheetBottom: sheetBox?.bottom || 0,
    };
  });

  expect(metrics.position).toBe("static");
  expect(metrics.containerPointerEvents).toBe("auto");
  expect(metrics.buttonPointerEvents).toBe("auto");
  expect(metrics.sheetScrollHeight).toBeLessThanOrEqual(metrics.sheetClientHeight + 2);
  expect(metrics.actionBottom).toBeLessThanOrEqual(metrics.sheetBottom + 1);

  await page.getByTestId("transaction-entry-sheet-close").click();
  await expect(page.getByTestId("transaction-entry-sheet")).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") || "")).toBe("transactions-fab");
  await openTab(page, "자산");
  await expect(page.locator(".holding-list-card")).toBeVisible();
});

test("mobile landscape surfaces show first work controls without immediate scroll", async ({ page }) => {
  const email = `${unique("landscape-workspace")}@example.com`;
  const displayName = unique("landscape-workspace-user");
  const holdingName = "랜드스케이프 첫 화면 검증 자산";

  await page.setViewportSize({ width: 568, height: 320 });
  await registerAndVerify(page, { email, displayName });
  await applyFontProfile(page, "Malgun Gothic");
  await createBasicHolding(page, { name: holdingName, category: "주식" });
  const savedMessageClose = page.locator(".message .message-close").first();
  if (await savedMessageClose.isVisible().catch(() => false)) {
    await savedMessageClose.click();
  }

  const surfaces = [
    {
      tab: "자산",
      locator: () => page.locator("tr.holding-row", { hasText: holdingName }).first(),
      label: "holdings row",
      minVisibleHeight: 38,
    },
    {
      tab: "협업",
      locator: () => page.locator("#collaboration-household-select"),
      label: "collaboration household select",
      minVisibleHeight: 34,
    },
    {
      tab: "설정",
      locator: () => page.getByRole("textbox", { name: "본명" }),
      label: "settings profile name input",
      minVisibleHeight: 34,
    },
  ];

  for (const surface of surfaces) {
    await test.step(surface.tab, async () => {
      await openTab(page, surface.tab);
      await expectNoHorizontalOverflow(page, 12);
      await expectLandscapeWorkspaceControlVisible(page, surface.locator(), surface.label, {
        minVisibleHeight: surface.minVisibleHeight,
      });
      await capture(page, `layout-landscape-workspace-${surface.tab}`);
    });
  }
});

test("layout stability matrix: pages remain clean across desktop, tablet, and mobile fonts", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("layout-matrix")}@example.com`;
  const displayName = unique("layout-user");
  const holdingName = "브라우저 레이아웃 검증용 긴 자산 이름";

  await registerAndVerify(page, { email, displayName });
  await createTransactionViaApi(page, {
    memo: "브라우저 레이아웃 검증용 긴 메모",
    amount: "123456",
  });
  await createBasicHolding(page, { name: holdingName, category: "주식" });

  for (const profile of LAYOUT_PROFILES) {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await applyFontProfile(page, profile.font);

    for (const tabLabel of NAV_TABS) {
      await openTab(page, tabLabel);
      await assertResponsiveShell(page, 12);
      await expectPageChromeConsistent(page, tabLabel);
      await expectNoHorizontalOverflow(page, 12);
      await expectCopyrightClearOfCards(page);
      await expectMobileTabBarStable(page);
      await expectWorksurfaceRowsUseCorrectMode(page, tabLabel);
      if (tabLabel === "자산") {
        await expectHoldingSectionRowsAligned(page);
      }

      const sample = await sampleControlForTab(page, tabLabel, { holdingName });
      await sample.scrollIntoViewIfNeeded();
      await expectClearOfFixedBottomNav(sample);
      await expectMobileBottomClearance(page);
      await scrollViewportToTop(page);
    }
  }

  await capture(page, "layout-stability-matrix");
});
