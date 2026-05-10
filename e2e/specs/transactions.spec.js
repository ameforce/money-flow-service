import { expect, test } from "@playwright/test";

import {
  assertResponsiveShell,
  capture,
  createBasicTransaction,
  createTransactionViaApi,
  expectBackgroundNotPlainWhite,
  expectCompactLedgerRow,
  expectNoHorizontalOverflow,
  expectSingleLineText,
  expectStableButtonPosition,
  expectStickyStack,
  expectTransparentBackground,
  labeledField,
  openTab,
  registerAndVerify,
  unique,
} from "../support/helpers";

function isoDaysAgo(days) {
  return isoDaysFromToday(-days);
}

function isoDaysFromToday(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function yearMonthFromIso(value) {
  const [year, month] = String(value || "").split("-").map((part) => Number(part));
  return { year, month };
}

async function jumpTransactionListToMonth(page, isoDate) {
  const { year, month } = yearMonthFromIso(isoDate);
  const listCard = page.locator(".transaction-list-card").first();
  await listCard.getByLabel("연도").fill(String(year));
  await listCard.getByLabel("월").fill(String(month));
  await listCard.getByLabel("월").press("Enter");
}

async function captureVisibleHistoryAnchor(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr.transaction-row[data-transaction-id]"));
    const topbarBottom = document.querySelector("header.topbar")?.getBoundingClientRect()?.bottom ?? 0;
    const ledgerBottom = document.querySelector(".transactions-mobile-ledger-head")?.getBoundingClientRect()?.bottom ?? 0;
    const threshold = Math.max(topbarBottom, ledgerBottom, 0) + 4;
    const row = rows.find((candidate) => {
      const box = candidate.getBoundingClientRect();
      return box.bottom > threshold && box.top < window.innerHeight;
    });
    if (!row) {
      return null;
    }
    return {
      id: row.getAttribute("data-transaction-id"),
      top: row.getBoundingClientRect().top,
    };
  });
}

test("transactions flow: create, inline edit, delete, responsive", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("tx-user")}@example.com`;
  const displayName = unique("tx-name");
  const memo = unique("tx-memo");
  const editedMemo = `${memo}-edited`;

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await assertResponsiveShell(page);
  await capture(page, "transactions-entry");

  const createdRow = await createBasicTransaction(page, { memo, amount: "12000" });
  await expect(createdRow).toContainText(memo);
  await capture(page, "transactions-created");

  const actionCell = createdRow.locator("td").last();
  await actionCell.getByRole("button", { name: "수정" }).click();
  const editorRow = page.locator("tr.transaction-inline-editor-row").first();
  await expect(editorRow).toBeVisible();

  await editorRow.getByLabel("메모").fill(editedMemo);
  await editorRow.getByLabel("금액").fill("54321");
  await editorRow.getByLabel("메모").press("Enter");
  const editedRow = page.locator("tr.transaction-row", { hasText: editedMemo }).first();
  const editedVisibleAfterEnter = await editedRow
    .waitFor({ state: "visible", timeout: 12_000 })
    .then(() => true)
    .catch(() => false);
  if (!editedVisibleAfterEnter) {
    const fallbackEditorRow = page.locator("tr.transaction-inline-editor-row").first();
    const editorStillVisible = await fallbackEditorRow.isVisible().catch(() => false);
    if (editorStillVisible) {
      await fallbackEditorRow.getByRole("button", { name: "저장" }).click();
    }
  }
  await expect(editedRow).toBeVisible();

  await editedRow.locator("td").last().getByRole("button", { name: "삭제" }).click();
  const confirmDialog = page.locator(".confirm-dialog");
  await expect(confirmDialog).toBeVisible();
  await confirmDialog.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByText("거래를 삭제했습니다.")).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: editedMemo })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");
  const transactionEmptyState = page.getByTestId("transactions-empty-state");
  await expect(transactionEmptyState).toBeVisible();
  await expect(transactionEmptyState).toContainText("거래 내역이 없습니다.");
  const transactionEmptyBorder = await transactionEmptyState.evaluate((element) => getComputedStyle(element).borderTopStyle);
  expect(transactionEmptyBorder).toBe("none");
  await assertResponsiveShell(page, 12);
  await expectNoHorizontalOverflow(page, 12);
  await capture(page, "transactions-mobile");
});

test("transactions form keeps grouped number format", async ({ page }) => {
  test.setTimeout(120_000);

  const email = `${unique("tx-format")}@example.com`;
  const displayName = unique("tx-format-name");
  await registerAndVerify(page, { email, displayName });

  await openTab(page, "거래");
  const transactionCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "거래 입력" }),
  });
  const transactionFab = page.getByTestId("transactions-fab");
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  let transactionContainer = transactionCard;
  const txToggleButton = transactionCard.getByRole("button", { name: /거래 추가|입력 닫기/ }).first();
  const txToggleVisible = await txToggleButton.isVisible().catch(() => false);
  if (txToggleVisible) {
    const txToggleText = String((await txToggleButton.textContent()) || "");
    if (txToggleText.includes("거래 추가")) {
      await txToggleButton.click();
    }
  } else if (await transactionFab.isVisible().catch(() => false)) {
    await transactionFab.click();
    await expect(transactionSheet).toBeVisible();
    transactionContainer = transactionSheet;
  }
  const amountInput = labeledField(transactionContainer, "금액", "input");
  const memoInput = labeledField(transactionContainer, "메모", "input");
  await amountInput.fill("123456789");
  await expect(amountInput).toHaveValue("123,456,789");
  await memoInput.fill("빠른 메모 입력");
  await expect(amountInput).toHaveValue("123,456,789");
  await expect(memoInput).toHaveValue("빠른 메모 입력");
});

test("transactions history shows compact date groups with fixed chronological order", async ({ page }) => {
  test.setTimeout(180_000);

  const email = `${unique("tx-history")}@example.com`;
  const displayName = unique("tx-history-name");
  const olderDate = isoDaysAgo(45);
  const middleDate = isoDaysAgo(20);
  const todayDate = isoDaysAgo(0);
  const olderMemo = unique("tx-history-older");
  const middleMemo = unique("tx-history-middle");
  const todayMemo = unique("tx-history-today");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });

  await createBasicTransaction(page, { memo: olderMemo, amount: "10101", occurredOn: olderDate });
  await createBasicTransaction(page, { memo: middleMemo, amount: "20202", occurredOn: middleDate });
  await createBasicTransaction(page, { memo: todayMemo, amount: "30303", occurredOn: todayDate });

  await openTab(page, "거래");
  await expect(page.locator("tr.transaction-row", { hasText: todayMemo })).toBeVisible();
  await expect(page.locator("th .sort-header-static").first()).toHaveAttribute("aria-label", /연속 내역순 고정/);
  await expect(page.locator(".transaction-history-date-row", { hasText: olderDate })).toHaveCount(1);
  await expect(page.locator(".transaction-history-date-row", { hasText: middleDate })).toHaveCount(1);
  await expect(page.locator(".transaction-history-date-row", { hasText: todayDate })).toHaveCount(1);

  const renderedMemos = await page.locator("tr.transaction-row .transaction-memo-text").evaluateAll((nodes) =>
    nodes.map((node) => String(node.textContent || "").trim())
  );
  expect(renderedMemos.indexOf(olderMemo)).toBeLessThan(renderedMemos.indexOf(middleMemo));
  expect(renderedMemos.indexOf(middleMemo)).toBeLessThan(renderedMemos.indexOf(todayMemo));

  const dateHeaderHeights = await page.locator(".transaction-history-date-row").evaluateAll((rows) =>
    rows.map((row) => row.getBoundingClientRect().height)
  );
  expect(
    dateHeaderHeights.every((height) => height <= 32),
    `history date headers should stay thin: ${JSON.stringify(dateHeaderHeights)}`
  ).toBe(true);
  await capture(page, "transactions-history-groups");
});

test("transactions history scrolls older and newer without future rows while keeping compact anchors", async ({ page }) => {
  test.setTimeout(300_000);

  const email = `${unique("tx-history-scroll")}@example.com`;
  const displayName = unique("tx-history-scroll-name");
  const prefix = unique("tx-history-scroll-row");
  const seeded = [];
  const totalSeedRows = 90;
  const oldestDaysAgo = totalSeedRows - 1;
  const createAnchorDate = isoDaysAgo(86);
  const futureDate = isoDaysFromToday(3);
  const futureMemo = `${prefix}-future`;

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });

  await createTransactionViaApi(page, {
    memo: futureMemo,
    amount: "99999",
    occurredOn: futureDate,
    ownerName: displayName,
  });
  for (let index = 0; index < totalSeedRows; index += 1) {
    const daysAgo = oldestDaysAgo - index;
    const memo = `${prefix}-${String(index).padStart(2, "0")}`;
    const occurredOn = isoDaysAgo(daysAgo);
    seeded.push({ memo, occurredOn, daysAgo });
    await createTransactionViaApi(page, {
      memo,
      amount: String(10000 + index),
      occurredOn,
      ownerName: displayName,
    });
  }

  await page.reload();
  await assertResponsiveShell(page);
  await openTab(page, "거래");

  const oldestMemo = seeded[0].memo;
  const initialAnchorMemo = seeded[10].memo;
  const todayMemo = seeded[seeded.length - 1].memo;
  await expect(page.locator("tr.transaction-row", { hasText: todayMemo }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("tr.transaction-row", { hasText: oldestMemo })).toHaveCount(0);
  await expect(page.locator("tr.transaction-row", { hasText: futureMemo })).toHaveCount(0);
  await expect(page.locator(".transaction-history-date-row", { hasText: futureDate })).toHaveCount(0);
  await expect(page.locator("th .sort-header-static").first()).toHaveAttribute("aria-label", /연속 내역순 고정/);
  await expect(page.locator("th button.sort-header")).toHaveCount(0);

  const historyRoutePattern = "**/api/v1/transactions/history**";
  let resolveOlderRoute;
  let heldOlderRoute = null;
  const olderRoutePromise = new Promise((resolve) => {
    resolveOlderRoute = resolve;
  });
  const holdOlderHistoryRoute = async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("direction") === "older" && !heldOlderRoute) {
      heldOlderRoute = route;
      resolveOlderRoute(route);
      return;
    }
    await route.continue();
  };
  await page.route(historyRoutePattern, holdOlderHistoryRoute);

  const anchorRow = page.locator("tr.transaction-row", { hasText: initialAnchorMemo }).first();
  await anchorRow.scrollIntoViewIfNeeded();
  await expect(anchorRow).toBeVisible();

  let olderRoute = await Promise.race([olderRoutePromise, page.waitForTimeout(750).then(() => null)]);
  if (!olderRoute) {
    await page.evaluate(() => window.scrollBy(0, -2400));
    olderRoute = await olderRoutePromise;
  }
  const anchorBefore = await captureVisibleHistoryAnchor(page);
  expect(anchorBefore?.id, "history anchor row should be capturable while older page is loading").toBeTruthy();
  await olderRoute.continue();
  await page.unroute(historyRoutePattern, holdOlderHistoryRoute);
  await expect(page.locator("tr.transaction-row", { hasText: oldestMemo }).first()).toBeVisible({ timeout: 40_000 });
  const anchorAfter = await page.locator(`tr.transaction-row[data-transaction-id="${anchorBefore.id}"]`).boundingBox();
  expect(anchorAfter, "history anchor row should have a bounding box after older load").not.toBeNull();
  expect(Math.abs((anchorAfter?.y ?? 0) - (anchorBefore?.top ?? 0))).toBeLessThanOrEqual(120);
  const rowIds = await page.locator("tr.transaction-row").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-transaction-id")).filter(Boolean)
  );
  expect(new Set(rowIds).size).toBe(rowIds.length);

  const monthAnchorSeed = seeded.find((item) => item.occurredOn === createAnchorDate) || seeded[3];
  await jumpTransactionListToMonth(page, monthAnchorSeed.occurredOn);
  await expect(page.locator("tr.transaction-row", { hasText: monthAnchorSeed.memo }).first()).toBeVisible({ timeout: 30_000 });

  const backdatedMemo = `${prefix}-backdated-create`;
  const backdatedRow = await createBasicTransaction(page, {
    memo: backdatedMemo,
    amount: "90909",
    occurredOn: monthAnchorSeed.occurredOn,
  });
  await expect(backdatedRow).toBeVisible();

  const todayRow = page.locator("tr.transaction-row", { hasText: todayMemo }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (await todayRow.isVisible().catch(() => false)) {
      break;
    }
    await page.evaluate(() => window.scrollBy(0, -200));
    await page.waitForTimeout(100);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1_000);
  }
  await expect(todayRow).toBeVisible({ timeout: 40_000 });
  await expect(page.locator("tr.transaction-row", { hasText: futureMemo })).toHaveCount(0);
  await expect(page.locator(".transaction-history-date-row", { hasText: futureDate })).toHaveCount(0);
  await capture(page, "transactions-history-scroll-continuity");
});

test("transactions list affordance: top filters, compact ledger, ownerless marker", async ({ page }) => {
  test.setTimeout(240_000);

  const email = `${unique("tx-affordance")}@example.com`;
  const displayName = unique("tx-affordance-name");
  const memo = unique("tx-affordance-memo");
  const incomeMemo = unique("tx-income-memo");
  const investmentMemo = unique("tx-investment-memo");
  const ownerlessMemo = unique("tx-ownerless-memo");

  await registerAndVerify(page, { email, displayName });
  await page.setViewportSize({ width: 1366, height: 960 });
  await openTab(page, "거래");
  await expect(page.locator(".transactions-mobile-ledger-head").first()).toBeHidden();
  await expect(page.locator(".tx-header-filters").first()).toBeVisible();

  const transactionCard = page.locator("article.card", {
    has: page.getByRole("heading", { name: "거래 입력" }),
  });
  const txToggleButton = transactionCard.getByRole("button", { name: /거래 추가|입력 닫기/ }).first();
  await expect(txToggleButton).toContainText("거래 추가");
  await expect(transactionCard.locator("form.transactions-form-grid")).toHaveCount(0);

  const createdRow = await createBasicTransaction(page, { memo, amount: "22222" });
  await expect(createdRow).toBeVisible();
  const incomeRow = await createBasicTransaction(page, { memo: incomeMemo, amount: "33333", flowType: "income" });
  await expect(incomeRow).toBeVisible();
  const investmentRow = await createBasicTransaction(page, { memo: investmentMemo, amount: "44444", flowType: "investment" });
  await expect(investmentRow).toBeVisible();

  const ownerlessRow = await createBasicTransaction(page, { memo: ownerlessMemo, amount: "11111", ownerless: true });
  await expect(ownerlessRow).toBeVisible();
  const extraMemos = [];
  const extraFlowTypes = ["expense", "income", "investment"];
  for (let index = 0; index < 9; index += 1) {
    const extraMemo = unique(`tx-sticky-${index}`);
    extraMemos.push(extraMemo);
    const extraRow = await createBasicTransaction(page, {
      memo: extraMemo,
      amount: String(10000 + index * 1111),
      flowType: extraFlowTypes[index % extraFlowTypes.length],
    });
    await expect(extraRow).toBeVisible();
  }

  const headerTexts = await page.getByRole("columnheader").evaluateAll((nodes) =>
    nodes.map((node) => String(node.innerText || node.textContent || "").replace(/\s+/g, " ").trim())
  );
  const findHeaderIndex = (label) => headerTexts.findIndex((text) => text.includes(label));
  expect(findHeaderIndex("일자")).toBeGreaterThanOrEqual(0);
  expect(findHeaderIndex("유형")).toBeGreaterThan(findHeaderIndex("일자"));
  expect(findHeaderIndex("카테고리")).toBeGreaterThan(findHeaderIndex("유형"));
  expect(findHeaderIndex("메모")).toBeGreaterThan(findHeaderIndex("카테고리"));
  expect(findHeaderIndex("금액")).toBeGreaterThan(findHeaderIndex("메모"));

  const staticDateSort = page.locator("th .sort-header-static").first();
  await expect(staticDateSort).toBeVisible();
  await expect(staticDateSort).toHaveAttribute("aria-label", /연속 내역순 고정/);
  await expect(page.locator("th button.sort-header")).toHaveCount(0);

  await createdRow.locator("td").first().locator("input[type='checkbox']").check();
  const selectedSummaryBanner = page.locator(".message", { hasText: "선택 1건" }).first();
  await expect(selectedSummaryBanner).toBeVisible();
  await expect(selectedSummaryBanner).toContainText("합계");

  const supportDetails = page.locator("details.compact-support-card").first();
  const supportCard =
    (await supportDetails.count()) > 0
      ? supportDetails
      : page.locator("article.card", { has: page.getByRole("heading", { name: "거래 지원 카드" }) });
  const hasSupportCard = ((await supportDetails.count()) > 0) || ((await supportCard.count()) > 0);
  if ((await supportDetails.count()) > 0) {
    await supportDetails.locator("summary").click();
    await expect(supportDetails).toHaveAttribute("open", "");
  }

  if (hasSupportCard) {
    await expect(supportCard).toContainText("포트폴리오와 자산 요약은 자산 탭으로 이동했습니다.");
    await expect(supportCard.getByLabel("포트폴리오 보기 기준")).toHaveCount(0);
    await expect(supportCard.getByLabel("자산 요약 보기 기준")).toHaveCount(0);

    const breakdownCard = supportCard.locator(".compact-support-section", {
      has: page.getByRole("heading", { name: "유형별 카테고리 집계" }),
    });
    if ((await breakdownCard.count()) > 0) {
      const breakdownToggle = breakdownCard.locator("button[aria-expanded]").first();
      await expect(breakdownToggle).toHaveAttribute("aria-expanded", "false");
      await breakdownToggle.click();
      await expect(breakdownToggle).toHaveAttribute("aria-expanded", "true");
    }

    const txCategoryManagerCard = supportCard.locator(".compact-support-section", {
      has: page.getByRole("heading", { name: "거래 탭 카테고리 관리" }),
    });
    if ((await txCategoryManagerCard.count()) > 0) {
      await expect(txCategoryManagerCard).toBeVisible();
      const txCategoryToggle = txCategoryManagerCard.getByRole("button", { name: /열기|닫기/ }).first();
      const txCategoryToggleText = String((await txCategoryToggle.textContent()) || "");
      if (txCategoryToggleText.includes("열기")) {
        await txCategoryToggle.click();
      }
      await expect(labeledField(txCategoryManagerCard, "새 대분류", "select")).toBeVisible();
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, "거래");
  await page.waitForLoadState("networkidle");
  const routeBeforeMobileSheet = page.url();
  const activeTabBeforeMobileSheet = await page.locator("nav.tabs button.active").first().innerText();
  const transactionFab = page.getByTestId("transactions-fab");
  const transactionSheet = page.getByTestId("transaction-entry-sheet");
  const transactionSheetClose = page.getByTestId("transaction-entry-sheet-close");
  const transactionCategoryManageEntry = page.getByTestId("transaction-entry-category-manage");
  const transactionCategoryManageStep = page.getByTestId("transaction-category-sheet-step");
  const transactionEntryCard = page.locator(".transaction-entry-card").first();
  const transactionTopActionButton = page.locator(".transaction-entry-card").getByRole("button", { name: /거래 추가|카테고리 관리/ }).first();
  const transactionListCard = page.locator(".transaction-list-card").first();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await expect(transactionEntryCard).toBeHidden();
  await expect(transactionTopActionButton).toBeHidden();
  await expect(transactionFab).toBeVisible();
  const fabInitialBox = await transactionFab.boundingBox();
  const listCardBox = await transactionListCard.boundingBox();
  expect(fabInitialBox, "transaction FAB should have a bounding box").not.toBeNull();
  expect(listCardBox, "transaction list card should have a bounding box").not.toBeNull();
  expect(fabInitialBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(844);
  const mobileHeaderFilters = page.locator(".tx-header-filters").first();
  await expect(page.locator(".tx-filter-details")).toHaveCount(0);
  await expect(mobileHeaderFilters).toBeHidden();
  await expect(page.locator(".transactions-mobile-ledger-head")).toHaveAttribute("data-sticky-active", "false");
  await expect(page.locator(".transactions-mobile-ledger-head")).toBeVisible();
  const mobileLedgerHead = page.locator(".transactions-mobile-ledger-head").first();
  const dateFilterTrigger = mobileLedgerHead.getByRole("button", { name: "일자 필터 열기" });
  const memoFilterTrigger = mobileLedgerHead.getByRole("button", { name: "메모 필터 열기" });
  const amountFilterTrigger = mobileLedgerHead.getByRole("button", { name: "금액 필터 열기" });
  const typeFilterTrigger = mobileLedgerHead.getByRole("button", { name: "유형 필터 열기" });
  await expect(dateFilterTrigger).toBeVisible();
  await expect(memoFilterTrigger).toBeVisible();
  await expect(amountFilterTrigger).toBeVisible();
  await expect(typeFilterTrigger).toBeVisible();
  const mobileTopbarBox = await page.locator("header.topbar").boundingBox();
  const transactionHeadingBox = await page.locator(".transaction-list-card > .surface-list-heading").first().boundingBox();
  await expect(page.locator(".transaction-list-card > .surface-control-strip").first()).toBeHidden();
  const transactionHeaderGroupBox = await page.locator(".transaction-list-card > .table-header-group").first().boundingBox();
  const transactionLedgerBox = await page.locator(".transactions-mobile-ledger-head").boundingBox();
  const transactionTableBox = await page.locator(".transactions-surface-table").boundingBox();
  expect(mobileTopbarBox, "mobile topbar should have a bounding box").not.toBeNull();
  expect(transactionHeadingBox, "transaction heading should have a bounding box").not.toBeNull();
  expect(transactionHeaderGroupBox, "transaction header group should have a bounding box").not.toBeNull();
  expect(transactionLedgerBox, "transaction ledger head should have a bounding box").not.toBeNull();
  expect(transactionTableBox, "transaction table should have a bounding box").not.toBeNull();
  expect(mobileTopbarBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(88);
  expect(transactionHeadingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    (mobileTopbarBox?.y ?? 0) + (mobileTopbarBox?.height ?? 0) + 112,
  );
  expect(transactionHeaderGroupBox?.y ?? Number.NEGATIVE_INFINITY).toBeGreaterThanOrEqual(
    (transactionHeadingBox?.y ?? 0) - 8,
  );
  expect(transactionHeaderGroupBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(transactionLedgerBox?.y ?? 0);
  expect(transactionLedgerBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(transactionTableBox?.y ?? 0);
  const mobileRow = page.locator("tr.transaction-row", { hasText: memo }).first();
  await expect(mobileRow).toBeVisible();
  const mobileRowBox = await mobileRow.boundingBox();
  expect(mobileRowBox, "mobile transaction row should have a bounding box").not.toBeNull();
  expect((transactionLedgerBox?.y ?? Number.POSITIVE_INFINITY)).toBeLessThan((mobileRowBox?.y ?? 0));
  await typeFilterTrigger.click();
  const mobileFilterPanel = page.getByTestId("tx-ledger-filter-panel");
  await expect(mobileFilterPanel).toBeVisible();
  await expect(mobileFilterPanel).toContainText("유형 필터");
  await mobileFilterPanel.getByLabel("유형").selectOption("income");
  await expect(page.locator("tr.transaction-row", { hasText: incomeMemo })).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: investmentMemo })).toHaveCount(0);
  await memoFilterTrigger.click();
  await expect(mobileFilterPanel).toContainText("메모 필터");
  await mobileFilterPanel.getByPlaceholder("메모 검색").fill(incomeMemo);
  await expect(page.locator("tr.transaction-row", { hasText: incomeMemo })).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: memo })).toHaveCount(0);
  await dateFilterTrigger.click();
  await expect(mobileFilterPanel).toContainText("일자 필터");
  await expect(mobileFilterPanel.getByLabel("시작일")).toBeVisible();
  await expect(mobileFilterPanel.getByLabel("종료일")).toBeVisible();
  await mobileFilterPanel.getByRole("button", { name: "필터 초기화" }).click();
  await expect(mobileFilterPanel).toBeHidden();
  await expect(mobileRow).toBeVisible();
  await amountFilterTrigger.click();
  await expect(mobileFilterPanel).toContainText("금액 필터");
  await mobileFilterPanel.getByLabel("최소 금액").fill("44000");
  await mobileFilterPanel.getByLabel("최대 금액").fill("45000");
  await expect(page.locator("tr.transaction-row", { hasText: investmentMemo })).toBeVisible();
  await expect(page.locator("tr.transaction-row", { hasText: incomeMemo })).toHaveCount(0);
  await expect(page.locator("tr.transaction-row", { hasText: memo })).toHaveCount(0);
  await mobileFilterPanel.getByRole("button", { name: "필터 초기화" }).click();
  await expect(mobileFilterPanel).toBeHidden();
  await expect(mobileRow).toBeVisible();
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await expect(mobileRow.getByText(memo, { exact: true })).toBeVisible();
  await expectCompactLedgerRow(mobileRow, 56);
  await expectSingleLineText(mobileRow.locator(".transaction-memo-text").first());
  await expect(mobileRow.locator(".transaction-mobile-category-cue").first()).toBeHidden();
  const collapsedRowMetrics = await page.locator("tr.transaction-row").evaluateAll((rows) =>
    rows.slice(0, 8).map((row) => {
      const box = row.getBoundingClientRect();
      return { height: box.height, expanded: row.getAttribute("data-row-expanded") };
    })
  );
  expect(
    collapsedRowMetrics.every((row) => row.expanded !== "true" && row.height <= 56),
    `mobile ledger rows should stay Excel-like one-line rows: ${JSON.stringify(collapsedRowMetrics)}`
  ).toBe(true);
  await expectBackgroundNotPlainWhite(mobileRow);
  await expectTransparentBackground(mobileRow.locator(".transaction-col-memo").first());
  await expect(mobileRow.locator(".transaction-owner-chip").first()).toHaveText(displayName.slice(0, 1));
  await expect(mobileRow.locator(".transaction-owner-chip").first()).toBeVisible();
  await expect(mobileRow.locator(".transaction-flow-short").first()).toBeVisible();
  const mobileOwnerlessRow = page.locator("tr.transaction-row", { hasText: ownerlessMemo }).first();
  await expect(mobileOwnerlessRow).toBeVisible();
  await expect(mobileOwnerlessRow.locator(".transaction-owner-empty").first()).toHaveText("-");
  await expect(mobileOwnerlessRow.locator(".transaction-owner-chip")).toHaveCount(0);
  await mobileRow.click({ position: { x: 88, y: 22 } });
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);
  await mobileRow.click({ position: { x: 88, y: 22 } });
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  await capture(page, "transactions-mobile-summary");
  await page.evaluate(() => window.scrollTo(0, 380));
  await page.waitForTimeout(250);
  const scrollBeforeSheet = await page.evaluate(() => window.scrollY);
  const fabScrolledBox = await transactionFab.boundingBox();
  expect(fabScrolledBox, "transaction FAB should have a bounding box after scroll").not.toBeNull();
  expect(fabScrolledBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(844);
  const visibleRowActionBoxes = await page.locator(".transaction-row .transaction-col-actions .mobile-toggle-btn").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const box = node.getBoundingClientRect();
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        const topElement = document.elementFromPoint(centerX, centerY);
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          hitVisible: Boolean(topElement && (topElement === node || node.contains(topElement))),
        };
      })
      .filter((box) => box.hitVisible && box.y < window.innerHeight && box.y + box.height > 0)
  );
  const intersects = (left, right) =>
    Boolean(
      left &&
        right &&
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y
    );
  expect(visibleRowActionBoxes.some((box) => intersects(fabScrolledBox, box))).toBe(false);
  await transactionFab.evaluate((element) => element.click());
  await expect(transactionSheet).toBeVisible();
  await expect(page.locator("header.topbar")).toBeVisible();
  await expect(page.locator("nav.tabs")).toBeVisible();
  expect(page.url()).toBe(routeBeforeMobileSheet);
  await expect(page.locator("nav.tabs button.active").first()).toHaveText(activeTabBeforeMobileSheet);
  const transactionSheetBox = await transactionSheet.boundingBox();
  expect(transactionSheetBox, "transaction sheet should have a bounding box").not.toBeNull();
  expect(transactionSheetBox?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(844);
  await expect(labeledField(transactionSheet, "금액", "input")).toBeVisible();
  await transactionCategoryManageEntry.click();
  await expect(transactionCategoryManageStep).toBeVisible();
  await transactionSheetClose.click();
  await expect(transactionSheet).toBeHidden();
  const scrollAfterSheetClose = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollAfterSheetClose - scrollBeforeSheet)).toBeLessThanOrEqual(16);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.scrollBy(0, 620));
  await page.waitForTimeout(400);
  await expect(page.locator(".transactions-mobile-ledger-head")).toHaveAttribute("data-sticky-active", "true");
  await expectStickyStack(
    page.locator(".transaction-list-card > .surface-list-heading").first(),
    page.locator(".transactions-mobile-ledger-head"),
    { maxLedgerY: 128, gapAllowance: 4 }
  );
  const stickyLedgerHead = page.locator(".transactions-mobile-ledger-head");
  const stickyHeadingBox = await page.locator(".transaction-list-card > .surface-list-heading").first().boundingBox();
  const stickyLedgerBox = await stickyLedgerHead.boundingBox();
  const stickyLedgerBottom = (stickyLedgerBox?.y ?? 0) + (stickyLedgerBox?.height ?? 0);
  const stickyVisibleRowBox = await page.locator(".transaction-row").evaluateAll((nodes, ledgerBottom) => {
    const viewportHeight = window.innerHeight;
    return nodes
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
      })
      .find((box) => box.y >= ledgerBottom - 1 && box.y < viewportHeight);
  }, stickyLedgerBottom);
  const fabStickyBox = await transactionFab.boundingBox();
  expect(stickyHeadingBox, "sticky transaction heading should have a bounding box").not.toBeNull();
  expect(stickyLedgerBox, "sticky ledger head should have a bounding box").not.toBeNull();
  await expect(mobileHeaderFilters).toBeHidden();
  expect(stickyVisibleRowBox, "a mobile transaction row should remain visible below sticky stack").toBeTruthy();
  expect(stickyHeadingBox?.y ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(0);
  expect(stickyHeadingBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(18);
  expect((stickyLedgerBox?.y ?? 0) - ((stickyHeadingBox?.y ?? 0) + (stickyHeadingBox?.height ?? 0))).toBeGreaterThanOrEqual(-4);
  expect(stickyVisibleRowBox?.y ?? 0).toBeGreaterThanOrEqual(stickyLedgerBottom - 1);
  expect(intersects(fabStickyBox, stickyLedgerBox)).toBe(false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const mobileToggleButton = mobileRow.locator(".mobile-toggle-btn").first();
  await expectStableButtonPosition(mobileToggleButton, async () => {
    await mobileToggleButton.evaluate((element) => element.click());
  });
  await expect(mobileRow).toHaveClass(/mobile-row-expanded/);
  const expandedActionRow = mobileRow.locator("xpath=following-sibling::tr[1][contains(@class,'transaction-mobile-expanded-actions-row')]");
  await expect(expandedActionRow).toBeVisible();
  await expect(expandedActionRow.getByRole("button", { name: "수정" })).toBeVisible();
  await expect(expandedActionRow.getByRole("button", { name: "삭제" })).toBeVisible();
  await expect(mobileRow.locator(".transaction-col-actions .row-delete-btn")).toBeHidden();
  await mobileRow.locator("td").last().getByRole("button", { name: "거래 세부 접기" }).click();
  await expect(mobileRow).not.toHaveClass(/mobile-row-expanded/);
  const compactFlowSummaryLines = page.getByTestId("tx-flow-summary-line");
  await expect(compactFlowSummaryLines).toHaveCount(3);
  await expect(compactFlowSummaryLines.nth(0)).toContainText(/(수입|지출|투자)/);
  await expect(compactFlowSummaryLines.nth(0)).toContainText("원");
  const incomeSummaryToggle = page.getByTestId("tx-flow-summary-toggle-income");
  if ((await incomeSummaryToggle.getAttribute("aria-expanded")) !== "true") {
    await incomeSummaryToggle.click();
  }
  await expect(incomeSummaryToggle).toHaveAttribute("aria-expanded", "true");
  const incomeSummaryPanel = page.getByTestId("tx-flow-summary-panel-income");
  await expect(incomeSummaryPanel).toBeVisible();
  await expect(incomeSummaryPanel).toContainText("%");
  await expect(incomeSummaryPanel.getByTestId("tx-flow-summary-chart-income")).toBeVisible();
  await assertResponsiveShell(page, 12);
  await expectNoHorizontalOverflow(page, 12);

  await page.setViewportSize({ width: 1366, height: 960 });
  await openTab(page, "거래");
  for (const cleanupMemo of [memo, incomeMemo, investmentMemo, ownerlessMemo, ...extraMemos]) {
    const cleanupRow = page.locator("tr.transaction-row", { hasText: cleanupMemo }).first();
    await cleanupRow.locator("td").last().getByRole("button", { name: "삭제" }).click();
    const confirmDialog = page.locator(".confirm-dialog");
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "삭제" }).click();
    await expect(page.locator("tr.transaction-row", { hasText: cleanupMemo })).toHaveCount(0);
  }
});
