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
      viewportHeight: window.innerHeight,
    };
  });

  expect(navMetrics.position).not.toBe("fixed");
  expect(navMetrics.top).toBeGreaterThanOrEqual(-2);
  expect(navMetrics.bottom).toBeLessThan(navMetrics.viewportHeight * 0.34);
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
  const chromeReferenceBottom = metrics.viewportWidth <= 820 ? metrics.nav.bottom : metrics.topbar.bottom;
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
        ownerChipDisplay: displayOf(".transaction-owner-chip"),
        toggleDisplay: displayOf(".mobile-toggle-btn"),
        dateText,
        dateOverflow: dateCell ? dateCell.scrollWidth - dateCell.clientWidth : 0,
      };
    });

    if (isDesktop) {
      expect(metrics.rowDisplay).toBe("table-row");
      expect(metrics.mobileDateDisplay).toBe("none");
      expect(metrics.flowShortDisplay).toBe("none");
      expect(["none", "missing"]).toContain(metrics.ownerChipDisplay);
      expect(metrics.toggleDisplay).toBe("none");
      expect(metrics.dateText).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(metrics.dateOverflow).toBeLessThanOrEqual(2);
      expect(metrics.rowHeight).toBeLessThanOrEqual(48);
    } else {
      expect(metrics.rowDisplay).toBe("grid");
      expect(metrics.mobileDateDisplay).not.toBe("none");
      expect(metrics.toggleDisplay).not.toBe("none");
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
    expect(checkbox.width).toBeLessThanOrEqual(20);
    expect(checkbox.height).toBeLessThanOrEqual(20);
  }
  expect(metrics.authSwitchButton).not.toBeNull();
  expect(metrics.authSwitchButton.background).toBe("rgba(0, 0, 0, 0)");
  expect(metrics.authSwitchButton.boxShadow).toBe("none");
  expect(["inline-flex", "flex"]).toContain(metrics.authSwitchButton.display);
  expect(metrics.authSwitchButton.height).toBeLessThanOrEqual(22);
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
  const updatedHeader = page.locator(".holdings-surface-table thead .holding-col-updated");
  const actionHeader = page.locator(".holdings-surface-table thead .holding-col-actions");

  await expect(table).toBeVisible();
  await expect(emptyState).toBeVisible();
  await expectNoHorizontalOverflow(page, 12);

  const metrics = await page.evaluate(() => {
    const tableBox = document.querySelector(".holdings-surface-table")?.getBoundingClientRect();
    const emptyBox = document.querySelector("[data-testid='holdings-empty-state']")?.getBoundingClientRect();
    const updatedBox = document.querySelector(".holdings-surface-table thead .holding-col-updated")?.getBoundingClientRect();
    const actionBox = document.querySelector(".holdings-surface-table thead .holding-col-actions")?.getBoundingClientRect();
    const updatedText = document.querySelector(".holdings-surface-table thead .holding-col-updated")?.textContent || "";
    const emptyText = document.querySelector("[data-testid='holdings-empty-state']")?.textContent || "";

    return {
      tableWidth: tableBox?.width || 0,
      emptyWidth: emptyBox?.width || 0,
      emptyHeight: emptyBox?.height || 0,
      updatedWidth: updatedBox?.width || 0,
      updatedHeight: updatedBox?.height || 0,
      actionWidth: actionBox?.width || 0,
      emptyText,
      updatedText,
    };
  });

  expect(metrics.emptyText).toContain("자산 내역이 없습니다.");
  expect(metrics.emptyWidth).toBeGreaterThan(metrics.tableWidth * 0.7);
  expect(metrics.emptyHeight).toBeLessThanOrEqual(130);
  expect(metrics.updatedText).toContain("최종 수정일");
  expect(metrics.updatedWidth).toBeGreaterThanOrEqual(108);
  expect(metrics.updatedHeight).toBeLessThanOrEqual(80);
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

  await page.getByTestId("transactions-fab").click();
  await expect(page.getByTestId("transaction-entry-sheet")).toBeVisible();

  const metrics = await page.locator(".transaction-quick-sticky-actions").evaluate((element) => {
    const button = element.querySelector("button");
    return {
      containerPointerEvents: getComputedStyle(element).pointerEvents,
      buttonPointerEvents: button ? getComputedStyle(button).pointerEvents : "missing",
      bottom: getComputedStyle(element).bottom,
      marginBottom: getComputedStyle(element).marginBottom,
    };
  });

  expect(metrics.containerPointerEvents).toBe("none");
  expect(metrics.buttonPointerEvents).toBe("auto");
  expect(metrics.bottom).toBe("0px");
  expect(metrics.marginBottom).toBe("0px");

  await page.getByTestId("transaction-entry-sheet-close").click();
  await expect(page.getByTestId("transaction-entry-sheet")).toBeHidden();
  await openTab(page, "자산");
  await expect(page.locator(".holding-list-card")).toBeVisible();
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
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  }
});
