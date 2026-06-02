import { Fragment, useEffect, useRef, useState } from "react";

import { IsoDateInput } from "../IsoDateInput";
import { TransactionCategoryQuickPicker } from "./TransactionCategoryQuickPicker";
import { extractVisibleInitial, resolveSemanticColor, withAlpha } from "./colorSemantics";
import { TRANSACTION_SURFACE_FIELDS, getWorkSurfaceMobilePriority } from "./fieldPriority";

function formatCompactDate(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "-";
  }
  return trimmed.replace(/^\d{4}-/, "");
}

function firstDefinedValue(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function normalizeCategoryText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/");
}

function normalizeCategoryFlowType(value) {
  return String(value || "expense").trim() || "expense";
}

function findCompatibleCategoryForFlow(categories, sourceCategory, flowType) {
  if (!sourceCategory) {
    return null;
  }
  const targetFlowType = normalizeCategoryFlowType(flowType);
  const sourceMajor = normalizeCategoryText(sourceCategory.major);
  const sourceMinor = normalizeCategoryText(sourceCategory.minor);
  if (!sourceMajor || !sourceMinor) {
    return null;
  }
  return (
    (categories || []).find((candidate) => {
      if (normalizeCategoryFlowType(candidate?.flow_type) !== targetFlowType) {
        return false;
      }
      return (
        normalizeCategoryText(candidate?.major) === sourceMajor &&
        normalizeCategoryText(candidate?.minor) === sourceMinor
      );
    }) || null
  );
}

function isInteractiveRowTarget(target) {
  return Boolean(
    target?.closest?.(
      "button, input, select, textarea, a, label, summary, details, [contenteditable='true'], [role='button'], [data-row-action='true']"
    )
  );
}

const ROW_SWEEP_THRESHOLD_PX = 7;
const TOUCH_VERTICAL_SCROLL_RATIO = 1.18;
const ROW_CLICK_SUPPRESS_MS = 360;
const ROW_SWEEP_AUTO_SCROLL_EDGE_PX = 86;
const ROW_SWEEP_AUTO_SCROLL_MAX_PX = 24;
const ROW_SWEEP_AUTO_SCROLL_MIN_PX = 5;

function clearRowSweepTextSelection() {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") {
    return;
  }
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) {
    selection.removeAllRanges();
  }
}

export function TransactionSurfaceTable({
  sortedTransactions,
  areAllFilteredTransactionsSelected,
  toggleAllFilteredTransactionSelection,
  txSortDirection,
  toggleTxSortDirection,
  historyMode = false,
  historyTopSentinelRef = null,
  historyBottomSentinelRef = null,
  historyLoadingOlder = false,
  historyLoadingNewer = false,
  selectedTransactionIds,
  recentImportTransactionIds = new Set(),
  recentSavedTransactionIds = new Set(),
  toggleTransactionSelection,
  selectTransactionRows,
  setTransactionRowsSelected,
  txInlineEdit,
  ownerOptionsWithFallback,
  ownerSelectValue,
  txInlineCategoryMajor,
  txInlineCategoryOptions = [],
  txInlineCategoryQuickChips = [],
  txInlineCategoryMajorOptions,
  txInlineCategoryMinorOptions,
  setTxInlineEdit,
  createTxInlineCategory,
  categoryById,
  renderCategoryCell,
  FLOW_TYPE_LABELS,
  FLOW_TYPE_OPTIONS,
  txListFilter,
  setTxListFilter,
  clearTxListFilter,
  householdSettings,
  normalizeTransactionRowColors,
  DEFAULT_TRANSACTION_ROW_COLORS,
  expandedTransactionRows,
  toggleExpandedTransactionRow,
  canEditRecords,
  canEditHouseholdData = false,
  loading,
  closeTxInlineEdit,
  removeTx,
  mobileStickyActive,
  handleTxInlineEditKeyDown,
  handleGroupedDecimalInput,
  handleTransactionAmountInput,
  ownerSelectionFromValue,
  renderLegacyOwnerRemapHelper,
  submitTxInlineEdit,
  fmtKrw,
  fmtDate,
  normalizeDecimalInputValue,
  toCategoryMajorLabel,
  toCategoryMinorLabel,
}) {
  const columnSpan = TRANSACTION_SURFACE_FIELDS.length + 2;
  const rowColors = normalizeTransactionRowColors(householdSettings?.transaction_row_colors);
  const ownerColors = householdSettings?.holding_settings?.owner_colors || {};
  const categoryColors = householdSettings?.holding_settings?.category_colors || {};
  const transactionMobilePriority = (fieldKey) => getWorkSurfaceMobilePriority("transactions", fieldKey);
  const allCategoryOptions = Array.from(categoryById?.values?.() || []);
  const [mobileFilterKey, setMobileFilterKey] = useState("");
  const rowPointerGestureRef = useRef(null);
  const suppressNextRowClickRef = useRef(false);
  const rowClickSuppressTimerRef = useRef(null);
  const rowSweepAutoScrollFrameRef = useRef(0);

  useEffect(() => {
    const stopAutoScroll = () => {
      if (rowSweepAutoScrollFrameRef.current) {
        window.cancelAnimationFrame(rowSweepAutoScrollFrameRef.current);
        rowSweepAutoScrollFrameRef.current = 0;
      }
    };
    const clearPointerGesture = () => {
      stopAutoScroll();
      rowPointerGestureRef.current = null;
    };
    window.addEventListener("pointerup", clearPointerGesture);
    window.addEventListener("pointercancel", clearPointerGesture);
    return () => {
      window.removeEventListener("pointerup", clearPointerGesture);
      window.removeEventListener("pointercancel", clearPointerGesture);
      stopAutoScroll();
      if (rowClickSuppressTimerRef.current) {
        window.clearTimeout(rowClickSuppressTimerRef.current);
      }
    };
  }, []);

  const findTransactionIdAtPoint = (clientX, clientY, fallbackId = "") => {
    if (typeof document === "undefined") {
      return fallbackId;
    }
    const target = document.elementFromPoint(clientX, clientY);
    return target?.closest?.("tr.transaction-row[data-transaction-id]")?.getAttribute("data-transaction-id") || fallbackId;
  };

  const stopRowSweepAutoScroll = () => {
    if (rowSweepAutoScrollFrameRef.current && typeof window !== "undefined") {
      window.cancelAnimationFrame(rowSweepAutoScrollFrameRef.current);
      rowSweepAutoScrollFrameRef.current = 0;
    }
  };

  const applyRowsDuringSweep = (transactionIds, selected) => {
    const ids = Array.from(new Set(transactionIds.filter(Boolean)));
    if (ids.length === 0) {
      return;
    }
    if (typeof setTransactionRowsSelected === "function") {
      setTransactionRowsSelected(ids, selected);
      return;
    }
    if (selected && typeof selectTransactionRows === "function") {
      selectTransactionRows(ids);
      return;
    }
    for (const transactionId of ids) {
      const isSelected = selectedTransactionIds.has(transactionId);
      if (selected !== isSelected) {
        toggleTransactionSelection(transactionId);
      }
    }
  };

  const visitRowDuringSweep = (gesture, transactionId) => {
    if (!gesture || !transactionId || gesture.visitedIds.has(transactionId)) {
      return;
    }
    gesture.visitedIds.add(transactionId);
    applyRowsDuringSweep([transactionId], gesture.shouldSelect);
  };

  const updateRowSweepAutoScroll = (gesture) => {
    if (
      typeof window === "undefined" ||
      !gesture?.sweepActive ||
      gesture.touchScrollFirst ||
      gesture.pointerType !== "mouse"
    ) {
      stopRowSweepAutoScroll();
      return;
    }
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    if (viewportHeight <= 0) {
      return;
    }
    const pointerY = gesture.lastY;
    const upperEdge = ROW_SWEEP_AUTO_SCROLL_EDGE_PX;
    const lowerEdge = viewportHeight - ROW_SWEEP_AUTO_SCROLL_EDGE_PX;
    let scrollDelta = 0;
    if (pointerY < upperEdge) {
      const intensity = Math.min(1, Math.max(0, (upperEdge - pointerY) / ROW_SWEEP_AUTO_SCROLL_EDGE_PX));
      scrollDelta = -Math.ceil(ROW_SWEEP_AUTO_SCROLL_MIN_PX + intensity * ROW_SWEEP_AUTO_SCROLL_MAX_PX);
    } else if (pointerY > lowerEdge) {
      const intensity = Math.min(1, Math.max(0, (pointerY - lowerEdge) / ROW_SWEEP_AUTO_SCROLL_EDGE_PX));
      scrollDelta = Math.ceil(ROW_SWEEP_AUTO_SCROLL_MIN_PX + intensity * ROW_SWEEP_AUTO_SCROLL_MAX_PX);
    }
    if (scrollDelta === 0) {
      stopRowSweepAutoScroll();
      return;
    }
    if (rowSweepAutoScrollFrameRef.current) {
      return;
    }
    rowSweepAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      rowSweepAutoScrollFrameRef.current = 0;
      const beforeScrollY = window.scrollY || window.pageYOffset || 0;
      window.scrollBy({ top: scrollDelta, behavior: "auto" });
      const rowIdAtPointer = findTransactionIdAtPoint(gesture.lastX, gesture.lastY, gesture.lastId);
      if (rowIdAtPointer) {
        gesture.lastId = rowIdAtPointer;
        visitRowDuringSweep(gesture, rowIdAtPointer);
      }
      clearRowSweepTextSelection();
      const afterScrollY = window.scrollY || window.pageYOffset || 0;
      if (Math.abs(afterScrollY - beforeScrollY) > 0.5) {
        updateRowSweepAutoScroll(gesture);
      }
    });
  };

  const activateSweepGesture = (gesture, transactionId) => {
    gesture.sweepActive = true;
    clearRowSweepTextSelection();
    applyRowsDuringSweep([gesture.startId, transactionId], gesture.shouldSelect);
    updateRowSweepAutoScroll(gesture);
  };

  const startRowPointerGesture = (event, transactionId, disabled) => {
    if (
      disabled ||
      isInteractiveRowTarget(event.target) ||
      event.button > 0 ||
      event.pointerType === "pen"
    ) {
      rowPointerGestureRef.current = null;
      return;
    }
    rowPointerGestureRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "mouse",
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startId: transactionId,
      lastId: transactionId,
      visitedIds: new Set([transactionId]),
      sweepActive: false,
      shouldSelect: !selectedTransactionIds.has(transactionId),
      touchScrollFirst: false,
    };
    if ((event.pointerType || "mouse") === "mouse" && event.cancelable) {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }
  };

  const updateRowPointerGesture = (event, transactionId) => {
    const gesture = rowPointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    const rowIdAtPointer = findTransactionIdAtPoint(event.clientX, event.clientY, transactionId || gesture.lastId);
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.lastId = rowIdAtPointer;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (!gesture.sweepActive && !gesture.touchScrollFirst && distance >= ROW_SWEEP_THRESHOLD_PX) {
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (gesture.pointerType === "touch" && absY > absX * TOUCH_VERTICAL_SCROLL_RATIO) {
        gesture.touchScrollFirst = true;
        return;
      }
      activateSweepGesture(gesture, rowIdAtPointer);
    }
    if (!gesture.sweepActive) {
      return;
    }
    clearRowSweepTextSelection();
    visitRowDuringSweep(gesture, rowIdAtPointer);
    updateRowSweepAutoScroll(gesture);
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  const finishRowPointerGesture = (event) => {
    const gesture = rowPointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    stopRowSweepAutoScroll();
    if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.sweepActive || gesture.touchScrollFirst) {
      suppressNextRowClickRef.current = true;
      if (rowClickSuppressTimerRef.current) {
        window.clearTimeout(rowClickSuppressTimerRef.current);
      }
      rowClickSuppressTimerRef.current = window.setTimeout(() => {
        suppressNextRowClickRef.current = false;
        rowClickSuppressTimerRef.current = null;
      }, ROW_CLICK_SUPPRESS_MS);
    }
    rowPointerGestureRef.current = null;
  };

  const shouldSuppressRowClick = () => {
    if (suppressNextRowClickRef.current) {
      suppressNextRowClickRef.current = false;
      return true;
    }
    return false;
  };

  const safeTxListFilter = txListFilter || {
    keyword: "",
    flow_type: "all",
    start: "",
    end: "",
    amount_min: "",
    amount_max: "",
  };
  const updateTxListFilter = (patch) => {
    if (typeof setTxListFilter !== "function") {
      return;
    }
    setTxListFilter((prev) => ({ ...(prev || safeTxListFilter), ...patch }));
  };
  const updateAmountFilter = (event, field) => {
    if (typeof handleGroupedDecimalInput === "function" && typeof setTxListFilter === "function") {
      handleGroupedDecimalInput(event, setTxListFilter, field);
      return;
    }
    updateTxListFilter({ [field]: event.target.value });
  };
  const openMobileFilter = (key) => {
    setMobileFilterKey((current) => (current === key ? "" : key));
  };
  const mobileFilterLabelByKey = {
    date: "일자",
    memo: "메모",
    amount: "금액",
    type: "유형",
  };
  const mobileFilterLabel = mobileFilterLabelByKey[mobileFilterKey] || "";
  const isDateFilterActive = Boolean(safeTxListFilter.start || safeTxListFilter.end);
  const isMemoFilterActive = Boolean(String(safeTxListFilter.keyword || "").trim());
  const isAmountFilterActive = Boolean(
    String(safeTxListFilter.amount_min || "").trim() || String(safeTxListFilter.amount_max || "").trim()
  );
  const isTypeFilterActive = safeTxListFilter.flow_type !== "all";

  const renderMobileFilterTrigger = ({ keyName, className, label, active }) => {
    const isOpen = mobileFilterKey === keyName;
    return (
      <button
        type="button"
        className={`${className} ledger-head-filter-trigger${active ? " is-active" : ""}${isOpen ? " is-open" : ""}`}
        aria-label={`${label} 필터 ${isOpen ? "닫기" : "열기"}`}
        aria-expanded={isOpen ? "true" : "false"}
        aria-controls="tx-ledger-filter-panel"
        onClick={() => openMobileFilter(keyName)}
      >
        <span>{label}</span>
        {active && <span className="ledger-head-filter-indicator" aria-hidden="true" />}
      </button>
    );
  };

  const renderDesktopColumnHead = (field) => {
    if (field.key === "occurred_on") {
      return (
        <div
          key={field.key}
          className={`desktop-ledger-head-cell ${field.className}`}
          role="columnheader"
          aria-sort={txSortDirection === "asc" ? "ascending" : "descending"}
          data-field-key={field.key}
        >
          {historyMode ? (
            <span
              className="sort-header active sort-header-static"
              aria-label="일자 정렬 연속 내역순 고정"
            >
              {field.label}
              <span className="sort-indicator" aria-hidden="true">↑</span>
            </span>
          ) : (
            <button
              type="button"
              className={`sort-header${txSortDirection ? " active" : ""}`}
              aria-label={`일자 정렬 ${txSortDirection === "asc" ? "내림차순으로 변경" : "오름차순으로 변경"}`}
              onClick={toggleTxSortDirection}
            >
              {field.label}
              <span className="sort-indicator" aria-hidden="true">{txSortDirection === "asc" ? "↑" : "↓"}</span>
            </button>
          )}
        </div>
      );
    }
    return (
      <div
        key={field.key}
        className={`desktop-ledger-head-cell ${field.className}`}
        role="columnheader"
        data-field-key={field.key}
      >
        {field.label}
      </div>
    );
  };

  return (
    <>
      <div
        className="surface-ledger-mobile-head transactions-mobile-ledger-head"
        data-sticky-active={mobileStickyActive ? "true" : "false"}
        aria-label="거래 제목행 필터"
      >
        <span className="ledger-head-select" />
        {renderMobileFilterTrigger({
          keyName: "date",
          className: "ledger-head-date",
          label: "일자",
          active: isDateFilterActive,
        })}
        {renderMobileFilterTrigger({
          keyName: "memo",
          className: "ledger-head-main",
          label: "메모",
          active: isMemoFilterActive,
        })}
        {renderMobileFilterTrigger({
          keyName: "amount",
          className: "ledger-head-amount",
          label: "금액",
          active: isAmountFilterActive,
        })}
        {renderMobileFilterTrigger({
          keyName: "type",
          className: "ledger-head-cues",
          label: "유형",
          active: isTypeFilterActive,
        })}
        <span className="ledger-head-actions">⋯</span>
      </div>
      {mobileFilterKey && (
        <div
          id="tx-ledger-filter-panel"
          className="tx-ledger-filter-panel"
          data-testid="tx-ledger-filter-panel"
          role="dialog"
          aria-label={`${mobileFilterLabel} 필터`}
        >
          <div className="tx-ledger-filter-title">
            <strong>{mobileFilterLabel} 필터</strong>
            <button type="button" className="secondary" onClick={() => setMobileFilterKey("")}>
              닫기
            </button>
          </div>
          {mobileFilterKey === "memo" && (
            <label className="tx-ledger-filter-field">
              <span>메모</span>
              <input
                aria-label="메모"
                placeholder="메모 검색"
                value={safeTxListFilter.keyword}
                onChange={(event) => updateTxListFilter({ keyword: event.target.value })}
                enterKeyHint="search"
              />
            </label>
          )}
          {mobileFilterKey === "type" && (
            <label className="tx-ledger-filter-field">
              <span>유형</span>
              <select
                aria-label="유형"
                value={safeTxListFilter.flow_type}
                onChange={(event) => updateTxListFilter({ flow_type: event.target.value })}
              >
                <option value="all">전체</option>
                {FLOW_TYPE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mobileFilterKey === "date" && (
            <div className="tx-ledger-filter-date-grid">
              <label className="tx-ledger-filter-field">
                <span>시작일</span>
                <IsoDateInput
                  aria-label="시작일"
                  value={safeTxListFilter.start}
                  onValueChange={(value) => updateTxListFilter({ start: value })}
                />
              </label>
              <label className="tx-ledger-filter-field">
                <span>종료일</span>
                <IsoDateInput
                  aria-label="종료일"
                  value={safeTxListFilter.end}
                  onValueChange={(value) => updateTxListFilter({ end: value })}
                />
              </label>
            </div>
          )}
          {mobileFilterKey === "amount" && (
            <div className="tx-ledger-filter-date-grid tx-ledger-filter-amount-grid">
              <label className="tx-ledger-filter-field">
                <span>최소 금액</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="최소 금액"
                  placeholder="0"
                  value={safeTxListFilter.amount_min}
                  onChange={(event) => updateAmountFilter(event, "amount_min")}
                  enterKeyHint="next"
                />
              </label>
              <label className="tx-ledger-filter-field">
                <span>최대 금액</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="최대 금액"
                  placeholder="100,000"
                  value={safeTxListFilter.amount_max}
                  onChange={(event) => updateAmountFilter(event, "amount_max")}
                  enterKeyHint="done"
                />
              </label>
            </div>
          )}
          <button
            type="button"
            className="secondary tx-ledger-filter-reset"
            onClick={() => {
              clearTxListFilter();
              setMobileFilterKey("");
            }}
          >
            필터 초기화
          </button>
        </div>
      )}
      <div className="surface-ledger-desktop-head transactions-desktop-ledger-head" role="row" aria-label="거래 컬럼 제목">
        <div className="desktop-ledger-head-cell transaction-col-select" role="columnheader">
          <input
            type="checkbox"
            aria-label="표시된 거래 전체 선택"
            checked={areAllFilteredTransactionsSelected}
            onChange={(event) => toggleAllFilteredTransactionSelection(Boolean(event.target.checked))}
          />
        </div>
        {TRANSACTION_SURFACE_FIELDS.map(renderDesktopColumnHead)}
        <div className="desktop-ledger-head-cell transaction-col-actions" role="columnheader">동작</div>
      </div>
      <div className="transactions-surface-scroll">
        <table
          className={`transactions-surface-table${mobileStickyActive ? " mobile-sticky-active" : " mobile-sticky-inactive"}`}
          aria-label="거래 작업 표"
        >
          <thead>
            <tr>
              <th data-mobile-priority="hidden">
                <input
                  type="checkbox"
                  aria-label="거래 표 숨김 전체 선택"
                  checked={areAllFilteredTransactionsSelected}
                  onChange={(event) => toggleAllFilteredTransactionSelection(Boolean(event.target.checked))}
                />
              </th>
              {TRANSACTION_SURFACE_FIELDS.map((field) => {
                if (field.key === "occurred_on") {
                  return (
                    <th
                      key={field.key}
                      className={field.className}
                      aria-sort={txSortDirection === "asc" ? "ascending" : "descending"}
                      data-field-key={field.key}
                      data-mobile-priority={transactionMobilePriority(field.key)}
                    >
                      {historyMode ? (
                        <span
                          className="sort-header active sort-header-static"
                          aria-label="일자 정렬 연속 내역순 고정"
                        >
                          {field.label}
                          <span className="sort-indicator" aria-hidden="true">↑</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`sort-header${txSortDirection ? " active" : ""}`}
                          aria-label={`일자 정렬 ${txSortDirection === "asc" ? "내림차순으로 변경" : "오름차순으로 변경"}`}
                          onClick={toggleTxSortDirection}
                        >
                          {field.label}
                          <span className="sort-indicator" aria-hidden="true">{txSortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      )}
                    </th>
                  );
                }
                return (
                  <th
                    key={field.key}
                    className={field.className}
                    data-field-key={field.key}
                    data-mobile-priority={transactionMobilePriority(field.key)}
                  >
                    {field.label}
                  </th>
                );
              })}
              <th data-mobile-priority="action">동작</th>
            </tr>
          </thead>
          <tbody>
          {historyMode && (
            <tr ref={historyTopSentinelRef} className="transaction-history-sentinel transaction-history-sentinel-top">
              <td colSpan={columnSpan}>{historyLoadingOlder ? "이전 거래 로딩" : ""}</td>
            </tr>
          )}
          {sortedTransactions.length === 0 && (
            <tr className="surface-empty-row">
              <td colSpan={columnSpan} className="surface-empty-cell">
                <div className="empty-state surface-empty-state" data-testid="transactions-empty-state">
                  거래 내역이 없습니다.
                </div>
              </td>
            </tr>
          )}
          {sortedTransactions.map((item, index) => {
            const isEditing = Boolean(item && txInlineEdit?.id === item.id);
            const editForm = isEditing ? txInlineEdit : null;
            const editOwnerOptions = ownerOptionsWithFallback(editForm?.owner_user_id || "", editForm?.owner_name || "");
            const rowKey = item.id;
            const category = categoryById.get(String(item.category_id || ""));
            const originalEditCategory = isEditing ? categoryById.get(String(item.category_id || "")) : null;
            const currentEditCategory = isEditing ? categoryById.get(String(editForm?.category_id || "")) : null;
            const inlineOriginalCategoryChanged = Boolean(
              isEditing &&
                editForm &&
                originalEditCategory &&
                (String(editForm.flow_type || "") !== String(item.flow_type || "") ||
                  String(editForm.category_id || "") !== String(item.category_id || ""))
            );
            const compactCategoryLabel = [
              category?.minor ? toCategoryMinorLabel(category.minor) : "",
              !category?.minor && category?.major ? toCategoryMajorLabel(category.major) : "",
            ].find(Boolean) || "미분류";
            const flowLabel = FLOW_TYPE_LABELS[item.flow_type] || item.flow_type;
            const flowShortLabel = String(flowLabel || "").slice(0, 1) || "-";
            const ownerInitial = extractVisibleInitial(item.owner_name);
            const ownerSummaryLabel = item.owner_name || "거래자 미입력";
            const flowAccent = rowColors[item.flow_type] || DEFAULT_TRANSACTION_ROW_COLORS[item.flow_type];
            const ownerColor = resolveSemanticColor(
              item.owner_name || flowLabel,
              ownerColors[String(item.owner_name || "").trim()],
              { saturation: 72, lightness: 42 }
            );
            const configuredCategoryColor = firstDefinedValue([
              categoryColors[String(category?.minor || "").trim()],
              categoryColors[String(category?.major || "").trim()],
              categoryColors[String(compactCategoryLabel || "").trim()],
            ]);
            const categoryColor = resolveSemanticColor(
              compactCategoryLabel,
              configuredCategoryColor,
              { saturation: 78, lightness: 54 }
            );
            const hasConfiguredCategoryColor = Boolean(String(configuredCategoryColor || "").trim());
            const rowAccent = hasConfiguredCategoryColor ? categoryColor : flowAccent;
            const isExpanded = expandedTransactionRows.has(item.id);
            const isRecentlyImported = recentImportTransactionIds.has(item.id);
            const isRecentlySaved = recentSavedTransactionIds.has(item.id);
            const previousItem = index > 0 ? sortedTransactions[index - 1] : null;
            const shouldRenderDateHeader =
              historyMode && String(previousItem?.occurred_on || "") !== String(item.occurred_on || "");
            const handleRowClick = (event) => {
              if (isEditing || isInteractiveRowTarget(event.target) || shouldSuppressRowClick()) {
                return;
              }
              toggleTransactionSelection(item.id);
              toggleExpandedTransactionRow(item.id);
            };
            const handleEditToggle = () => {
              if (!canEditRecords) {
                return;
              }
              if (isEditing) {
                closeTxInlineEdit();
                return;
              }
              setTxInlineEdit({
                id: item.id,
                version: item.version,
                occurred_on: item.occurred_on,
                flow_type: item.flow_type,
                amount: normalizeDecimalInputValue(item.amount),
                category_id: item.category_id || "",
                category_major: categoryById.get(String(item.category_id || ""))?.major || "",
                memo: item.memo || "",
                owner_user_id: item.owner_user_id || "",
                owner_name: item.owner_name || "",
              });
            };
            const updateInlineFlowType = (nextFlowType) => {
              if (!editForm) {
                return;
              }
              const normalizedFlowType = normalizeCategoryFlowType(nextFlowType);
              const compatibleCategory = findCompatibleCategoryForFlow(
                allCategoryOptions,
                currentEditCategory || originalEditCategory,
                normalizedFlowType
              );
              setTxInlineEdit({
                ...editForm,
                flow_type: normalizedFlowType,
                category_id: compatibleCategory ? String(compatibleCategory.id || "") : "",
                category_major: compatibleCategory ? String(compatibleCategory.major || "") : "",
              });
            };
            const restoreInlineOriginalCategory = () => {
              if (!editForm || !originalEditCategory) {
                return;
              }
              setTxInlineEdit({
                ...editForm,
                flow_type: normalizeCategoryFlowType(item.flow_type),
                category_id: String(item.category_id || ""),
                category_major: String(originalEditCategory.major || ""),
              });
            };
            return (
              <Fragment key={rowKey}>
                {shouldRenderDateHeader && (
                  <tr className="transaction-history-date-row">
                    <td colSpan={columnSpan}>
                      <span>{item.occurred_on}</span>
                    </td>
                  </tr>
                )}
                <tr
                  className={`transaction-row transaction-row-${item.flow_type} ${isEditing ? "transaction-row-editing" : ""} ${isExpanded ? "mobile-row-expanded" : ""} ${isRecentlyImported ? "transaction-row-imported" : ""} ${isRecentlySaved ? "transaction-row-saved" : ""}`}
                  data-row-expanded={isExpanded ? "true" : "false"}
                  data-row-selected={selectedTransactionIds.has(item.id) ? "true" : "false"}
                  data-import-highlight={isRecentlyImported ? "true" : undefined}
                  data-save-highlight={isRecentlySaved ? "true" : undefined}
                  data-transaction-id={item.id}
                  data-transaction-date={item.occurred_on}
                  aria-selected={selectedTransactionIds.has(item.id) ? "true" : "false"}
                  onPointerDown={(event) => startRowPointerGesture(event, item.id, isEditing)}
                  onPointerMove={(event) => updateRowPointerGesture(event, item.id)}
                  onPointerEnter={(event) => updateRowPointerGesture(event, item.id)}
                  onPointerUp={finishRowPointerGesture}
                  onPointerCancel={finishRowPointerGesture}
                  onClick={handleRowClick}
                  style={{
                    "--transaction-row-bg": rowAccent,
                    "--transaction-row-accent": rowAccent,
                    "--transaction-row-wash-strong": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.32 : 0.24),
                    "--transaction-row-wash": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.25 : 0.19),
                    "--transaction-row-wash-soft": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.17 : 0.12),
                    "--transaction-row-border": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.3 : 0.22),
                    "--transaction-owner-color": ownerColor,
                    "--transaction-owner-chip-bg": withAlpha(ownerColor, 0.08),
                    "--transaction-owner-chip-ring": withAlpha(ownerColor, 0.22),
                  }}
                >
                  <td data-label="선택" className="transaction-col-select" data-mobile-priority="hidden">
                    <input
                      type="checkbox"
                      aria-label={`${item.occurred_on} 거래 선택`}
                      checked={selectedTransactionIds.has(item.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleTransactionSelection(item.id)}
                    />
                  </td>
                  <td data-label="일자" className="transaction-col-date" data-field-key="occurred_on" data-mobile-priority={transactionMobilePriority("occurred_on")}>
                    <span className="desktop-date-text">{item.occurred_on}</span>
                    <span className="mobile-date-text">{formatCompactDate(item.occurred_on)}</span>
                  </td>
                  <td data-label="유형" className="transaction-col-type" data-field-key="flow_type" data-mobile-priority={transactionMobilePriority("flow_type")}>
                    <span className={`transaction-flow-badge transaction-flow-full transaction-flow-${item.flow_type}`}>
                      {flowLabel}
                    </span>
                    <span
                      className={`transaction-flow-badge transaction-flow-short transaction-flow-${item.flow_type}`}
                      title={flowLabel}
                      aria-label={flowLabel}
                    >
                      {flowShortLabel}
                    </span>
                    {ownerInitial ? (
                      <span className="transaction-owner-chip" title={item.owner_name || ""} aria-label={item.owner_name || ""}>
                        {ownerInitial}
                      </span>
                    ) : (
                      <span className="transaction-owner-empty" title="거래자 미입력" aria-label="거래자 미입력">-</span>
                    )}
                  </td>
                  <td data-label="카테고리" className="transaction-col-category transaction-mobile-detail-cell" data-field-key="category" data-mobile-priority={transactionMobilePriority("category")}>
                    <span className="transaction-mobile-detail-label">카테고리</span>
                    <div className="transaction-mobile-detail-value">{renderCategoryCell(category)}</div>
                  </td>
                  <td data-label="메모" className="transaction-col-memo" data-field-key="memo" data-mobile-priority={transactionMobilePriority("memo")}>
                    <span className="transaction-mobile-category-cue">{compactCategoryLabel}</span>
                    <span className="transaction-memo-text" title={item.memo || "-"} aria-label={`메모 ${item.memo || "-"}`}>
                      {item.memo || "-"}
                    </span>
                    <span
                      className="transaction-owner-summary"
                      title={ownerSummaryLabel}
                      aria-label={`거래자 ${ownerSummaryLabel}`}
                    >
                      {ownerSummaryLabel}
                    </span>
                  </td>
                  <td data-label="금액" className="transaction-col-amount" data-field-key="amount" data-mobile-priority={transactionMobilePriority("amount")}>
                    <span className="transaction-amount-text">{fmtKrw(item.amount)}</span>
                  </td>
                  <td data-label="거래자명" className="transaction-col-owner transaction-mobile-detail-cell" data-field-key="owner_name" data-mobile-priority={transactionMobilePriority("owner_name")}>
                    <span className="transaction-mobile-detail-label">거래자명</span>
                    <div className="transaction-mobile-detail-value transaction-owner-cue">{item.owner_name || "-"}</div>
                  </td>
                  <td data-label="최종 수정일" className="transaction-col-updated transaction-mobile-detail-cell" data-field-key="updated_at" data-mobile-priority={transactionMobilePriority("updated_at")}>
                    <span className="transaction-mobile-detail-label">최종 수정일</span>
                    <div className="transaction-mobile-detail-value">{fmtDate(item.updated_at)}</div>
                  </td>
                  <td data-label="동작" className="transaction-col-actions" data-mobile-priority="action">
                    <div className="inline">
                      <button
                        type="button"
                        className={`row-edit-btn ${isEditing ? "primary" : "secondary"}`}
                        disabled={!canEditRecords || loading}
                        onClick={handleEditToggle}
                      >
                        {isEditing ? "수정 중" : "수정"}
                      </button>
                      <button
                        type="button"
                        className="secondary mobile-toggle-btn"
                        aria-label={isExpanded ? "거래 세부 접기" : "거래 세부 보기"}
                        aria-expanded={isExpanded ? "true" : "false"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpandedTransactionRow(item.id);
                        }}
                      >
                        <span className="mobile-toggle-icon" aria-hidden="true">
                          <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                            <path d="M5 3.75L10 8L5 12.25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </button>
                      <button type="button" className="danger row-delete-btn" disabled={!canEditRecords || loading} onClick={() => removeTx(item.id)}>삭제</button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr
                    className="transaction-mobile-expanded-actions-row"
                    style={{
                      "--transaction-row-bg": rowAccent,
                      "--transaction-row-accent": rowAccent,
                      "--transaction-row-wash-strong": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.32 : 0.24),
                      "--transaction-row-wash": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.25 : 0.19),
                      "--transaction-row-wash-soft": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.17 : 0.12),
                      "--transaction-row-border": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.3 : 0.22),
                      "--transaction-owner-color": ownerColor,
                      "--transaction-owner-chip-bg": withAlpha(ownerColor, 0.08),
                      "--transaction-owner-chip-ring": withAlpha(ownerColor, 0.22),
                    }}
                  >
                    <td colSpan={columnSpan}>
                      <div className="transaction-mobile-expanded-actions">
                        <button
                          type="button"
                          className={isEditing ? "primary" : "secondary"}
                          disabled={!canEditRecords || loading}
                          onClick={handleEditToggle}
                        >
                          {isEditing ? "수정 중" : "수정"}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={!canEditRecords || loading}
                          onClick={() => removeTx(item.id)}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              {isEditing && editForm && (
                <tr className="transaction-inline-editor-row transactions-inline-editor" onKeyDown={handleTxInlineEditKeyDown}>
                  <td colSpan={columnSpan} className="transaction-inline-editor-cell">
                    <div className="transaction-inline-editor-grid">
                      <label className="tx-inline-date-field">
                        <span className="tx-inline-field-label">일자</span>
                        <IsoDateInput
                          aria-label="일자"
                          value={editForm.occurred_on}
                          onValueChange={(value) => setTxInlineEdit({ ...editForm, occurred_on: value })}
                          disabled={!canEditRecords}
                          required
                        />
                      </label>
                      <label className="tx-inline-type-field">
                        <span className="tx-inline-field-label">유형</span>
                        <select
                          aria-label="유형"
                          value={editForm.flow_type}
                          disabled={!canEditRecords}
                          onChange={(e) => updateInlineFlowType(e.target.value)}
                        >
                          {FLOW_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="tx-inline-category-section" aria-label="카테고리 선택">
                        <TransactionCategoryQuickPicker
                          categories={txInlineCategoryOptions}
                          quickOptions={txInlineCategoryQuickChips}
                          selectedCategoryId={editForm.category_id}
                          disabled={!canEditRecords}
                          allowCreate={canEditHouseholdData}
                          createDisabled={!canEditHouseholdData || loading}
                          onSelect={(categoryId, category) =>
                            setTxInlineEdit({
                              ...editForm,
                              category_id: categoryId,
                              category_major: category ? String(category.major || "") : "",
                            })
                          }
                          onCreate={createTxInlineCategory}
                          title="카테고리 빠른 선택"
                          rootClassName="transaction-category-picker-inline"
                          toCategoryMajorLabel={toCategoryMajorLabel}
                          toCategoryMinorLabel={toCategoryMinorLabel}
                        />
                        {inlineOriginalCategoryChanged && (
                          <div
                            className="tx-category-restore-notice tx-inline-category-restore-notice"
                            data-testid="tx-inline-category-restore-notice"
                            role="status"
                          >
                            <span>
                              <strong>원래 카테고리를 잃을 수 있습니다.</strong>
                              <small>
                                원래 선택: {toCategoryMajorLabel(originalEditCategory.major)} / {toCategoryMinorLabel(originalEditCategory.minor)}
                              </small>
                            </span>
                            <button
                              type="button"
                              className="secondary"
                              data-testid="tx-inline-category-restore-button"
                              onClick={restoreInlineOriginalCategory}
                              disabled={!canEditRecords}
                            >
                              원래 카테고리로 되돌리기
                            </button>
                          </div>
                        )}
                        <label className="tx-inline-major-field">
                          <span className="tx-inline-field-label">카테고리 그룹</span>
                          <select
                            aria-label="카테고리 그룹"
                            value={txInlineCategoryMajor}
                            disabled={!canEditRecords}
                            onChange={(event) =>
                              setTxInlineEdit({
                                ...editForm,
                                category_major: event.target.value,
                                category_id: "",
                              })
                            }
                          >
                            <option value="">(선택 안함)</option>
                            {txInlineCategoryMajorOptions.map((major) => (
                              <option key={major} value={major}>
                                {toCategoryMajorLabel(major)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="tx-inline-minor-field">
                          <span className="tx-inline-field-label">카테고리</span>
                          <select
                            aria-label="카테고리"
                            value={editForm.category_id}
                            disabled={!canEditRecords || !txInlineCategoryMajor}
                            onChange={(e) => setTxInlineEdit({ ...editForm, category_id: e.target.value })}
                          >
                            <option value="">(선택 안함)</option>
                            {txInlineCategoryMinorOptions.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {toCategoryMinorLabel(cat.minor)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="tx-inline-memo-field">
                        <span className="tx-inline-field-label">메모</span>
                        <input
                          aria-label="메모"
                          placeholder="메모"
                          value={editForm.memo}
                          onChange={(e) => setTxInlineEdit({ ...editForm, memo: e.target.value })}
                          disabled={!canEditRecords}
                        />
                      </label>
                      <label className="tx-inline-amount-field">
                        <span className="tx-inline-field-label">금액</span>
                        <input
                          aria-label="금액"
                          placeholder="금액"
                          type="text"
                          inputMode="numeric"
                          value={editForm.amount}
                          onChange={(event) =>
                            (handleTransactionAmountInput || handleGroupedDecimalInput)(event, setTxInlineEdit, "amount")
                          }
                          disabled={!canEditRecords}
                          required
                        />
                      </label>
                      <label className="tx-inline-owner-field">
                        <span className="tx-inline-field-label">거래자명</span>
                        <select
                          aria-label="거래자"
                          value={ownerSelectValue(editForm.owner_user_id, editForm.owner_name)}
                          disabled={!canEditRecords}
                          onChange={(event) =>
                            setTxInlineEdit({
                              ...editForm,
                              ...ownerSelectionFromValue(event.target.value, editOwnerOptions),
                            })
                          }
                        >
                          <option value="">(선택 안함)</option>
                          {editOwnerOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="tx-inline-updated-field" aria-label="최종 수정일">
                        -
                      </span>
                      {typeof renderLegacyOwnerRemapHelper === "function" &&
                        renderLegacyOwnerRemapHelper({
                          ownerUserId: editForm.owner_user_id,
                          ownerName: editForm.owner_name,
                          disabled: !canEditRecords,
                          onApply: (target) =>
                            setTxInlineEdit({
                              ...editForm,
                              owner_user_id: target.value,
                              owner_name: target.displayName,
                            }),
                        })}
                      <div className="inline tx-inline-editor-actions">
                        <button type="button" className="secondary" disabled={!canEditRecords} onClick={() => closeTxInlineEdit()}>
                          취소
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={!canEditRecords}
                          onClick={() => {
                            void submitTxInlineEdit();
                          }}
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
                )}
              </Fragment>
            );
          })}
          {historyMode && (
            <tr ref={historyBottomSentinelRef} className="transaction-history-sentinel transaction-history-sentinel-bottom">
              <td colSpan={columnSpan}>{historyLoadingNewer ? "다음 거래 로딩" : ""}</td>
            </tr>
          )}
          </tbody>
        </table>
      </div>
    </>
  );
}
