import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

import { IsoDateInput } from "../IsoDateInput";
import { TransactionCategoryQuickPicker } from "./TransactionCategoryQuickPicker";
import { resolveSemanticColor, withAlpha } from "./colorSemantics";
import { formatCompactKrwAmount } from "./compactTransactionText";
import { TRANSACTION_SURFACE_FIELDS, getWorkSurfaceMobilePriority } from "./fieldPriority";
const MOBILE_FILTER_FOCUS_SELECTORS = {
  amount: "[aria-label='최소 금액']",
  date: "[aria-label='시작일']",
  memo: "[aria-label='메모']",
  type: "[aria-label='유형']",
};


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

const ownerGraphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter("ko", { granularity: "grapheme" })
    : null;

function splitVisibleGraphemes(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  if (ownerGraphemeSegmenter) {
    return Array.from(ownerGraphemeSegmenter.segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

function firstVisibleChar(value) {
  return splitVisibleGraphemes(value)[0] || "";
}

function ownerCueAfterCompactInitial(value) {
  const chars = splitVisibleGraphemes(value);
  if (chars.length <= 1) {
    return "";
  }
  return chars.slice(1).join("").trim();
}

function formatCompactMemo(value) {
  const chars = splitVisibleGraphemes(value);
  if (chars.length <= 8) {
    return chars.join("") || "-";
  }
  return `${chars[0]}…${chars.slice(-3).join("")}`;
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
const ROW_LONG_PRESS_SELECTION_MS = 420;
const ROW_SINGLE_CLICK_ACTION_DELAY_MS = 180;
const ROW_SINGLE_CLICK_ACTION_RESTORE_WINDOW_MS = 900;
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
  txSortDirection,
  toggleTxSortDirection,
  selectedTransactionIds,
  recentImportTransactionIds = new Set(),
  recentSavedTransactionIds = new Set(),
  toggleTransactionSelection,
  selectTransactionRows,
  setTransactionRowsSelected,
  setTransactionRowsExpanded,
  txInlineEdit,
  txInlineEditSubmitting = false,
  ownerOptionsWithFallback,
  ownerSelectValue,
  txInlineCategoryMajor,
  txInlineCategoryOptions = [],
  txInlineCategoryQuickChips = [],
  txInlineCategoryMajorOptions,
  txInlineCategoryMinorOptions,
  setTxInlineEdit,
  createTxInlineCategory,
  openTransactionInlineEditor,
  notifyTransactionEditPermissionDenied,
  categoryById,
  renderCategoryCell,
  FLOW_TYPE_LABELS,
  FLOW_TYPE_OPTIONS,
  txListFilter,
  setTxListFilter,
  clearTxListFilter,
  showTransactionFilterPanel,
  requestDesktopFilterPanel,
  householdSettings,
  normalizeTransactionRowColors,
  DEFAULT_TRANSACTION_ROW_COLORS,
  expandedTransactionRows,
  toggleExpandedTransactionRow,
  canEditRecords,
  canEditHouseholdData = false,
  loading,
  isCompactViewport = false,
  closeTxInlineEdit,
  mobileStickyActive,
  handleTxInlineEditKeyDown,
  handleGroupedDecimalInput,
  handleTransactionAmountInput,
  ownerSelectionFromValue,
  renderLegacyOwnerRemapHelper,
  submitTxInlineEdit,
  fmtKrw,
  fmtDate,
  toCategoryMajorLabel,
  toCategoryMinorLabel,
}) {
  const columnSpan = TRANSACTION_SURFACE_FIELDS.length;
  const rowColors = normalizeTransactionRowColors(householdSettings?.transaction_row_colors);
  const ownerColors = householdSettings?.holding_settings?.owner_colors || {};
  const categoryColors = householdSettings?.holding_settings?.category_colors || {};
  const transactionMobilePriority = (fieldKey) => getWorkSurfaceMobilePriority("transactions", fieldKey);
  const allCategoryOptions = Array.from(categoryById?.values?.() || []);
  const mobileLedgerMeasurementKey = sortedTransactions
    .slice(0, 1)
    .map((item) =>
      [
        item?.id,
        item?.flow_type,
        item?.owner_name,
        item?.category_id,
        item?.memo,
        item?.amount,
        item?.updated_at,
      ].join("|")
    )
    .join("");
  const inlineEditorDisabled = !canEditRecords || txInlineEditSubmitting;
  const [mobileFilterKey, setMobileFilterKey] = useState("");
  const mobileLedgerHeadRef = useRef(null);
  const mobileFilterPanelRef = useRef(null);
  const mobileFilterTriggerRef = useRef(null);
  const rowPointerGestureRef = useRef(null);
  const suppressNextRowClickRef = useRef(false);
  const rowClickSuppressTimerRef = useRef(null);
  const rowSingleClickActionRef = useRef(null);
  const rowSingleClickActionTimerRef = useRef(null);
  const rowSingleClickActionExpireTimerRef = useRef(null);
  const rowSweepAutoScrollFrameRef = useRef(0);
  const transactionRowIdsRef = useRef(new Set());

  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const ledgerHead = mobileLedgerHeadRef.current;
    const listCard = ledgerHead?.closest?.(".transaction-list-card");
    if (!ledgerHead || !listCard) {
      return undefined;
    }

    let frameId = 0;
    const measureElementHeight = (element) => {
      const height = Math.ceil(element?.getBoundingClientRect?.().height || 0);
      return Number.isFinite(height) && height > 0 ? height : 0;
    };
    const applyMeasuredMobileLedgerLayout = () => {
      const ledgerHeadHeight = measureElementHeight(ledgerHead);
      const filterPanelHeight = mobileFilterKey ? measureElementHeight(mobileFilterPanelRef.current) : 0;
      const row = listCard.querySelector("tr.transaction-row[data-transaction-id]");
      const measuredColumns = [
        ".transaction-col-date",
        ".transaction-col-type",
        ".transaction-col-owner",
        ".transaction-col-category",
        ".transaction-col-memo",
        ".transaction-col-amount",
      ]
        .map((selector) => row?.querySelector(selector)?.getBoundingClientRect?.().width || 0)
        .filter((width) => Number.isFinite(width) && width > 0);
      listCard.style.setProperty("--surface-ledger-head-height", `${ledgerHeadHeight}px`);
      listCard.style.setProperty("--tx-ledger-filter-panel-height", `${filterPanelHeight}px`);
      if (measuredColumns.length === 6) {
        ledgerHead.style.setProperty(
          "--transaction-mobile-ledger-columns",
          measuredColumns.map((width) => `${width}px`).join(" ")
        );
      } else {
        ledgerHead.style.removeProperty("--transaction-mobile-ledger-columns");
      }
    };
    const scheduleMeasuredMobileLedgerLayout = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        applyMeasuredMobileLedgerLayout();
      });
    };

    applyMeasuredMobileLedgerLayout();

    const resizeObserver =
      typeof window.ResizeObserver === "function" ? new window.ResizeObserver(scheduleMeasuredMobileLedgerLayout) : null;
    resizeObserver?.observe(ledgerHead);
    if (mobileFilterPanelRef.current) {
      resizeObserver?.observe(mobileFilterPanelRef.current);
    }
    window.addEventListener("resize", scheduleMeasuredMobileLedgerLayout);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasuredMobileLedgerLayout);
    };
  }, [mobileFilterKey, mobileLedgerMeasurementKey, mobileStickyActive, sortedTransactions.length]);

  useEffect(() => {
    const stopAutoScroll = () => {
      if (rowSweepAutoScrollFrameRef.current) {
        window.cancelAnimationFrame(rowSweepAutoScrollFrameRef.current);
        rowSweepAutoScrollFrameRef.current = 0;
      }
    };
    const clearPointerGesture = () => {
      stopAutoScroll();
      clearRowGestureLongPressTimer(rowPointerGestureRef.current);
      rowPointerGestureRef.current = null;
    };
    const cancelPointerGesture = () => {
      const gesture = rowPointerGestureRef.current;
      if (gesture?.pointerType === "touch" && gesture.sweepActive && !gesture.touchScrollFirst) {
        clearRowGestureLongPressTimer(gesture);
        return;
      }
      clearPointerGesture();
    };
    window.addEventListener("touchcancel", clearPointerGesture);
    window.addEventListener("pointerup", clearPointerGesture);
    window.addEventListener("pointercancel", cancelPointerGesture);
    return () => {
      window.removeEventListener("touchcancel", clearPointerGesture);
      window.removeEventListener("pointerup", clearPointerGesture);
      window.removeEventListener("pointercancel", cancelPointerGesture);
      clearPointerGesture();
      if (rowClickSuppressTimerRef.current) {
        window.clearTimeout(rowClickSuppressTimerRef.current);
      }
      if (rowSingleClickActionTimerRef.current) {
        window.clearTimeout(rowSingleClickActionTimerRef.current);
      }
      if (rowSingleClickActionExpireTimerRef.current) {
        window.clearTimeout(rowSingleClickActionExpireTimerRef.current);
      }
      rowSingleClickActionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const nextRowIds = new Set(sortedTransactions.map((item) => item?.id).filter(Boolean));
    transactionRowIdsRef.current = nextRowIds;
    const pendingTransactionId = rowSingleClickActionRef.current?.transactionId;
    if (!pendingTransactionId || nextRowIds.has(pendingTransactionId)) {
      return;
    }
    if (rowSingleClickActionTimerRef.current && typeof window !== "undefined") {
      window.clearTimeout(rowSingleClickActionTimerRef.current);
    }
    if (rowSingleClickActionExpireTimerRef.current && typeof window !== "undefined") {
      window.clearTimeout(rowSingleClickActionExpireTimerRef.current);
    }
    rowSingleClickActionTimerRef.current = null;
    rowSingleClickActionExpireTimerRef.current = null;
    rowSingleClickActionRef.current = null;
  }, [sortedTransactions]);

  const findTransactionIdAtPoint = (clientX, clientY, fallbackId = "") => {
    if (typeof document === "undefined") {
      return fallbackId;
    }
    const target = document.elementFromPoint(clientX, clientY);
    return target?.closest?.("tr.transaction-row[data-transaction-id]")?.getAttribute("data-transaction-id") || fallbackId;
  };

  const getTransactionRowSweepBox = (row) => {
    if (!row) {
      return null;
    }
    const boxes = [row, ...Array.from(row.children)]
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0);
    if (boxes.length === 0) {
      return null;
    }
    return {
      top: Math.min(...boxes.map((box) => box.top)),
      bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
  };

  const escapeTransactionIdSelectorValue = (value) => {
    const rawValue = String(value || "");
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(rawValue);
    }
    return rawValue.replace(/["\\]/g, "\\$&");
  };

  const getTransactionRowSweepBoxById = (transactionId) => {
    if (typeof document === "undefined" || !transactionId) {
      return null;
    }
    return getTransactionRowSweepBox(
      document.querySelector(`tr.transaction-row[data-transaction-id="${escapeTransactionIdSelectorValue(transactionId)}"]`)
    );
  };

  const getRowGestureLayoutOffsetY = (gesture) => {
    const startBox = getTransactionRowSweepBoxById(gesture?.startId);
    if (!startBox) {
      return 0;
    }
    return (startBox.top + startBox.bottom) / 2 - gesture.startY;
  };

  const findTransactionIdsInSweepRange = (startY, endY) => {
    if (typeof document === "undefined") {
      return [];
    }
    const top = Math.min(startY, endY);
    const bottom = Math.max(startY, endY);
    return Array.from(document.querySelectorAll("tr.transaction-row[data-transaction-id]"))
      .filter((row) => {
        const box = getTransactionRowSweepBox(row);
        if (!box) {
          return false;
        }
        return box.bottom >= top && box.top <= bottom;
      })
      .map((row) => row.getAttribute("data-transaction-id"))
      .filter(Boolean);
  };

  const stopRowSweepAutoScroll = () => {
    if (rowSweepAutoScrollFrameRef.current && typeof window !== "undefined") {
      window.cancelAnimationFrame(rowSweepAutoScrollFrameRef.current);
      rowSweepAutoScrollFrameRef.current = 0;
    }
  };

  const clearRowGestureLongPressTimer = (gesture) => {
    if (gesture?.longPressTimer && typeof window !== "undefined") {
      window.clearTimeout(gesture.longPressTimer);
    }
    if (gesture) {
      gesture.longPressTimer = 0;
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
    clearRowGestureLongPressTimer(gesture);
    gesture.sweepActive = true;
    clearRowSweepTextSelection();
    applyRowsDuringSweep([gesture.startId, transactionId], gesture.shouldSelect);
    updateRowSweepAutoScroll(gesture);
  };

  const activateLongPressSelection = (gesture) => {
    if (!gesture || gesture.touchScrollFirst || gesture.sweepActive) {
      return;
    }
    gesture.longPressActive = true;
    gesture.sweepActive = true;
    clearRowSweepTextSelection();
    applyRowsDuringSweep([gesture.startId], gesture.shouldSelect);
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
      sweepMoved: false,
      shouldSelect: !selectedTransactionIds.has(transactionId),
      touchScrollFirst: false,
      longPressActive: false,
      longPressTimer: 0,
    };
    if ((event.pointerType || "mouse") === "mouse" && event.cancelable) {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    } else if ((event.pointerType || "") === "touch" && typeof window !== "undefined") {
      const gesture = rowPointerGestureRef.current;
      gesture.longPressTimer = window.setTimeout(() => {
        activateLongPressSelection(gesture);
      }, ROW_LONG_PRESS_SELECTION_MS);
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
    if (distance >= ROW_SWEEP_THRESHOLD_PX) {
      gesture.sweepMoved = true;
    }
    if (!gesture.sweepActive && !gesture.touchScrollFirst && distance >= ROW_SWEEP_THRESHOLD_PX) {
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (gesture.pointerType === "touch" && absY > absX * TOUCH_VERTICAL_SCROLL_RATIO) {
        clearRowGestureLongPressTimer(gesture);
        gesture.touchScrollFirst = true;
        return;
      }
      if (gesture.pointerType === "touch" && !gesture.longPressActive) {
        clearRowGestureLongPressTimer(gesture);
        return;
      }
      activateSweepGesture(gesture, rowIdAtPointer);
    }
    if (!gesture.sweepActive) {
      return;
    }
    if (gesture.pointerType === "touch" && !gesture.sweepMoved) {
      return;
    }
    clearRowSweepTextSelection();
    visitRowDuringSweep(gesture, rowIdAtPointer);
    const layoutOffsetY = getRowGestureLayoutOffsetY(gesture);
    for (const sweptTransactionId of findTransactionIdsInSweepRange(gesture.startY + layoutOffsetY, event.clientY + layoutOffsetY)) {
      visitRowDuringSweep(gesture, sweptTransactionId);
    }
    updateRowSweepAutoScroll(gesture);
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  const updateRowTouchGesture = (event, transactionId) => {
    const gesture = rowPointerGestureRef.current;
    if (!gesture || gesture.pointerType !== "touch") {
      return;
    }
    const touch = event.touches?.[0] || event.changedTouches?.[0];
    if (!touch) {
      return;
    }
    updateRowPointerGesture(
      {
        pointerId: gesture.pointerId,
        clientX: touch.clientX,
        clientY: touch.clientY,
        cancelable: event.cancelable,
        preventDefault: () => event.preventDefault?.(),
      },
      transactionId
    );
  };

  const finishRowPointerGesture = (event) => {
    const gesture = rowPointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }
    if (gesture.sweepActive && gesture.sweepMoved && !gesture.touchScrollFirst) {
      const rowIdAtPointer = findTransactionIdAtPoint(event.clientX, event.clientY, gesture.lastId);
      visitRowDuringSweep(gesture, rowIdAtPointer);
      const layoutOffsetY = getRowGestureLayoutOffsetY(gesture);
      for (const sweptTransactionId of findTransactionIdsInSweepRange(gesture.startY + layoutOffsetY, event.clientY + layoutOffsetY)) {
        visitRowDuringSweep(gesture, sweptTransactionId);
      }
    }
    stopRowSweepAutoScroll();
    clearRowGestureLongPressTimer(gesture);
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

  const clearPendingRowClickAction = ({ preserveFiredRecord = false } = {}) => {
    if (rowSingleClickActionTimerRef.current && typeof window !== "undefined") {
      window.clearTimeout(rowSingleClickActionTimerRef.current);
    }
    rowSingleClickActionTimerRef.current = null;
    if (!preserveFiredRecord) {
      if (rowSingleClickActionExpireTimerRef.current && typeof window !== "undefined") {
        window.clearTimeout(rowSingleClickActionExpireTimerRef.current);
      }
      rowSingleClickActionExpireTimerRef.current = null;
      rowSingleClickActionRef.current = null;
    }
  };

  const runRowClickAction = (transactionId) => {
    if (isCompactViewport) {
      toggleExpandedTransactionRow(transactionId);
      return;
    }
    toggleTransactionSelection(transactionId);
    toggleExpandedTransactionRow(transactionId);
  };

  const expireFiredRowClickAction = (transactionId) => {
    if (typeof window === "undefined") {
      return;
    }
    if (rowSingleClickActionExpireTimerRef.current) {
      window.clearTimeout(rowSingleClickActionExpireTimerRef.current);
    }
    rowSingleClickActionExpireTimerRef.current = window.setTimeout(() => {
      if (rowSingleClickActionRef.current?.transactionId === transactionId) {
        rowSingleClickActionRef.current = null;
      }
      rowSingleClickActionExpireTimerRef.current = null;
    }, ROW_SINGLE_CLICK_ACTION_RESTORE_WINDOW_MS);
  };

  const restoreFiredRowClickAction = (transactionId) => {
    const action = rowSingleClickActionRef.current;
    if (!action || action.transactionId !== transactionId || !action.fired) {
      clearPendingRowClickAction();
      return;
    }
    if (typeof setTransactionRowsSelected === "function") {
      setTransactionRowsSelected([transactionId], action.wasSelected);
    } else if (selectedTransactionIds.has(transactionId) !== action.wasSelected) {
      toggleTransactionSelection(transactionId);
    }
    if (typeof setTransactionRowsExpanded === "function") {
      setTransactionRowsExpanded([transactionId], action.wasExpanded);
    } else if (expandedTransactionRows.has(transactionId) !== action.wasExpanded) {
      toggleExpandedTransactionRow(transactionId);
    }
    clearPendingRowClickAction();
  };

  const hasFiredRowClickAction = (transactionId) => {
    const action = rowSingleClickActionRef.current;
    return Boolean(action && action.transactionId === transactionId && action.fired);
  };

  const scheduleRowClickAction = (transactionId, initialState) => {
    clearPendingRowClickAction();
    rowSingleClickActionRef.current = {
      transactionId,
      wasSelected: Boolean(initialState?.selected),
      wasExpanded: Boolean(initialState?.expanded),
      fired: false,
    };
    if (typeof window === "undefined") {
      runRowClickAction(transactionId);
      rowSingleClickActionRef.current = null;
      return;
    }
    rowSingleClickActionTimerRef.current = window.setTimeout(() => {
      if (!transactionRowIdsRef.current.has(transactionId)) {
        rowSingleClickActionRef.current = null;
        rowSingleClickActionTimerRef.current = null;
        return;
      }
      if (rowSingleClickActionRef.current?.transactionId === transactionId) {
        rowSingleClickActionRef.current = {
          ...rowSingleClickActionRef.current,
          fired: true,
        };
      }
      rowSingleClickActionTimerRef.current = null;
      runRowClickAction(transactionId);
      expireFiredRowClickAction(transactionId);
    }, ROW_SINGLE_CLICK_ACTION_DELAY_MS);
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
  const openMobileFilter = (key, triggerElement = null) => {
    setMobileFilterKey((current) => {
      const nextKey = current === key ? "" : key;
      if (nextKey) {
        mobileFilterTriggerRef.current = triggerElement;
      }
      return nextKey;
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    if (!mobileFilterKey) {
      mobileFilterTriggerRef.current?.focus?.({ preventScroll: true });
      mobileFilterTriggerRef.current = null;
      return undefined;
    }
    const frameId = window.requestAnimationFrame(() => {
      const panel = mobileFilterPanelRef.current;
      const targetSelector = MOBILE_FILTER_FOCUS_SELECTORS[mobileFilterKey];
      const firstControl = (
        targetSelector ? panel?.querySelector(targetSelector) : null
      ) || panel?.querySelector("input, select, button");
      firstControl?.focus?.({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [mobileFilterKey]);
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
  const openDesktopFilterPanel = (focusTarget) => {
    if (isCompactViewport || typeof requestDesktopFilterPanel !== "function") {
      return;
    }
    requestDesktopFilterPanel(focusTarget);
  };
  const desktopFilterActiveByField = {
    amount: isAmountFilterActive,
    flow_type: isTypeFilterActive,
    memo: isMemoFilterActive,
  };

  const renderMobileFilterTrigger = ({ keyName, className, label, active }) => {
    const isOpen = mobileFilterKey === keyName;
    return (
      <button
        type="button"
        className={`${className} ledger-head-filter-trigger${active ? " is-active" : ""}${isOpen ? " is-open" : ""}`}
        aria-label={`${label} 필터 ${isOpen ? "닫기" : "열기"}`}
        aria-expanded={isOpen ? "true" : "false"}
        aria-controls="tx-ledger-filter-panel"
        onClick={(event) => openMobileFilter(keyName, event.currentTarget)}
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
          data-field-key={field.key}
        >
          <button
            type="button"
            className={`sort-header ledger-head-action${txSortDirection ? " active" : ""}`}
            aria-label={`일자 정렬 ${txSortDirection === "asc" ? "내림차순으로 변경" : "오름차순으로 변경"}`}
            onClick={toggleTxSortDirection}
          >
            {field.label}
            <span className="sort-indicator" aria-hidden="true">{txSortDirection === "asc" ? "↑" : "↓"}</span>
          </button>
        </div>
      );
    }
    if (Object.prototype.hasOwnProperty.call(desktopFilterActiveByField, field.key)) {
      const active = Boolean(desktopFilterActiveByField[field.key]);
      return (
        <div
          key={field.key}
          className={`desktop-ledger-head-cell ${field.className}`}
          data-field-key={field.key}
        >
          <button
            type="button"
            className={`ledger-head-action desktop-filter-header${active ? " active" : ""}`}
            aria-label={`${field.label} 필터 열기`}
            aria-expanded={showTransactionFilterPanel ? "true" : "false"}
            aria-controls="transaction-filter-panel"
            onClick={() => openDesktopFilterPanel(field.key)}
          >
            {field.label}
            {active && <span className="ledger-head-filter-indicator" aria-hidden="true" />}
          </button>
        </div>
      );
    }
    return (
      <div
        key={field.key}
        className={`desktop-ledger-head-cell ${field.className}`}
        data-field-key={field.key}
      >
        {field.label}
      </div>
    );
  };

  return (
    <>
      <div
        ref={mobileLedgerHeadRef}
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
          keyName: "type",
          className: "ledger-head-cues",
          label: "유형",
          active: isTypeFilterActive,
        })}
        <span className="ledger-head-owner">거래자</span>
        <span className="ledger-head-category">카테고리</span>
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
      </div>
      {mobileFilterKey && (
        <div
          ref={mobileFilterPanelRef}
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
      <div className="surface-ledger-desktop-head transactions-desktop-ledger-head">
        {TRANSACTION_SURFACE_FIELDS.map(renderDesktopColumnHead)}
      </div>
      <div className="transactions-surface-scroll">
        <table
          className={`transactions-surface-table${mobileStickyActive ? " mobile-sticky-active" : " mobile-sticky-inactive"}`}
          aria-label="거래 작업 표"
        >
          <colgroup>
            <col className="transaction-col-date" style={{ width: "var(--tx-col-date)" }} />
            <col className="transaction-col-type" style={{ width: "var(--tx-col-type)" }} />
            <col className="transaction-col-owner" style={{ width: "var(--tx-col-owner)" }} />
            <col className="transaction-col-category" style={{ width: "var(--tx-col-category)" }} />
            <col className="transaction-col-memo" />
            <col className="transaction-col-amount" style={{ width: "var(--tx-col-amount)" }} />
            <col className="transaction-col-updated" style={{ width: "var(--tx-col-updated)" }} />
          </colgroup>
          <thead>
            <tr>
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
                      {field.label}
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
            </tr>
          </thead>
          <tbody>
          {sortedTransactions.length === 0 && (
            <tr className="surface-empty-row">
              <td colSpan={columnSpan} className="surface-empty-cell">
                <div className="empty-state surface-empty-state" data-testid="transactions-empty-state">
                  거래 내역이 없습니다.
                </div>
              </td>
            </tr>
          )}
          {sortedTransactions.map((item) => {
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
                editForm.mode !== "insert" &&
                originalEditCategory &&
                (String(editForm.flow_type || "") !== String(item.flow_type || "") ||
                  String(editForm.category_id || "") !== String(item.category_id || ""))
            );
            const categoryMajorLabel = category?.major ? toCategoryMajorLabel(category.major) : "";
            const categoryMinorLabel = category?.minor ? toCategoryMinorLabel(category.minor) : "";
            const compactCategoryLabel = categoryMinorLabel || categoryMajorLabel || "미분류";
            const fullCategoryLabel = [categoryMajorLabel, categoryMinorLabel].filter(Boolean).join(" / ") || compactCategoryLabel;
            const flowLabel = FLOW_TYPE_LABELS[item.flow_type] || item.flow_type;
            const flowShortLabel = String(flowLabel || "").slice(0, 2) || "-";
            const installmentLabel =
              item.installment_months == null ? "" : `${item.installment_months}개월 할부`;
            const ownerNameLabel = String(item.owner_name || "").trim();
            const ownerCompactLabel = firstVisibleChar(ownerNameLabel);
            const ownerCueLabel = ownerCueAfterCompactInitial(ownerNameLabel);
            const ownerSummaryLabel = ownerNameLabel || "거래자 미입력";
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
            const amountLabel = fmtKrw(item.amount);
            const isWideAmount = amountLabel.replace(/\s+/g, "").length >= 10;
            const compactAmountLabel = isWideAmount ? formatCompactKrwAmount(item.amount, amountLabel) : amountLabel;
            const compactMemoLabel = formatCompactMemo(item.memo);
            const handleRowClick = (event) => {
              if (isEditing) {
                return;
              }
              if (isInteractiveRowTarget(event.target) || shouldSuppressRowClick()) {
                clearPendingRowClickAction();
                return;
              }
              if (event.detail > 1) {
                clearPendingRowClickAction({ preserveFiredRecord: hasFiredRowClickAction(item.id) });
                return;
              }
              scheduleRowClickAction(item.id, {
                selected: selectedTransactionIds.has(item.id),
                expanded: isExpanded,
              });
            };
            const handleRowDoubleClick = (event) => {
              if (isEditing || loading || isInteractiveRowTarget(event.target) || typeof openTransactionInlineEditor !== "function") {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              clearPendingRowClickAction({ preserveFiredRecord: true });
              restoreFiredRowClickAction(item.id);
              if (!canEditRecords) {
                notifyTransactionEditPermissionDenied?.();
                return;
              }
              openTransactionInlineEditor(item);
            };
            const handleRowKeyDown = (event) => {
              if (isEditing || isInteractiveRowTarget(event.target)) {
                return;
              }
              if (event.key === " " || event.key === "Spacebar") {
                event.preventDefault();
                clearPendingRowClickAction();
                if (!isCompactViewport || event.shiftKey) {
                  toggleTransactionSelection(item.id);
                  return;
                }
                toggleExpandedTransactionRow(item.id);
                return;
              }
              if (event.key !== "Enter" && event.key !== "F2") {
                return;
              }
              if (loading || typeof openTransactionInlineEditor !== "function") {
                return;
              }
              event.preventDefault();
              clearPendingRowClickAction();
              if (!canEditRecords) {
                notifyTransactionEditPermissionDenied?.();
                return;
              }
              openTransactionInlineEditor(item);
            };
            const rowEditShortcutLabel = canEditRecords ? "Enter 또는 F2로 편집" : "편집 권한 없음";
            const rowKeyboardShortcutLabel = isCompactViewport
              ? `${rowEditShortcutLabel}. Space로 세부를 열고 닫고 Shift+Space로 선택합니다.`
              : `${rowEditShortcutLabel}. Space로 선택합니다.`;
            const rowActivationLabel = isCompactViewport
              ? "탭하면 세부를 열고 길게 누르거나 Shift+Space로 선택합니다."
              : "행을 클릭하거나 Space로 선택합니다.";
            const rowKeyShortcuts = [
              ...(canEditRecords ? ["Enter", "F2"] : []),
              ...(isCompactViewport ? ["Space", "Shift+Space"] : ["Space"]),
            ].join(" ");
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
                installment_months: normalizedFlowType === "expense" ? editForm.installment_months : "",
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
            const shouldRenderInlineEditorBeforeRow = Boolean(
              editForm?.mode === "insert" && editForm?.insert_position === "above"
            );
            const inlineEditorRow =
              isEditing && editForm ? (
                <tr
                  className="transaction-inline-editor-row transactions-inline-editor"
                  aria-busy={txInlineEditSubmitting ? "true" : undefined}
                  onKeyDown={handleTxInlineEditKeyDown}
                >
                  <td colSpan={columnSpan} className="transaction-inline-editor-cell">
                    <div className="transaction-inline-editor-grid">
                      <label className="tx-inline-date-field">
                        <span className="tx-inline-field-label">일자</span>
                        <IsoDateInput
                          aria-label="일자"
                          value={editForm.occurred_on}
                          onValueChange={(value) =>
                            setTxInlineEdit((prev) => (prev ? { ...prev, occurred_on: value } : prev))
                          }
                          disabled={inlineEditorDisabled}
                          required
                        />
                      </label>
                      <label className="tx-inline-type-field">
                        <span className="tx-inline-field-label">유형</span>
                        <select
                          aria-label="유형"
                          value={editForm.flow_type}
                          disabled={inlineEditorDisabled}
                          onChange={(e) => updateInlineFlowType(e.target.value)}
                        >
                          {FLOW_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {editForm.flow_type === "expense" && (
                        <div className="tx-inline-installment-field transaction-installment-field">
                          <label>
                            <span className="tx-inline-field-label">결제 방식</span>
                            <select
                              aria-label="결제 방식"
                              value={String(editForm.installment_months ?? "").trim() ? "installment" : "single"}
                              onChange={(event) =>
                                setTxInlineEdit({
                                  ...editForm,
                                  installment_months:
                                    event.target.value === "installment" ? editForm.installment_months || "2" : "",
                                })
                              }
                              disabled={inlineEditorDisabled}
                            >
                              <option value="single">일시불</option>
                              <option value="installment">할부</option>
                            </select>
                          </label>
                          {String(editForm.installment_months ?? "").trim() && (
                            <label>
                              <span className="tx-inline-field-label">할부 개월</span>
                              <input
                                aria-label="할부 개월"
                                type="number"
                                min="2"
                                max="120"
                                inputMode="numeric"
                                value={editForm.installment_months ?? ""}
                                onChange={(event) => setTxInlineEdit({ ...editForm, installment_months: event.target.value })}
                                disabled={inlineEditorDisabled}
                              />
                            </label>
                          )}
                        </div>
                      )}
                      <div className="tx-inline-category-section" aria-label="카테고리 선택">
                        <TransactionCategoryQuickPicker
                          categories={txInlineCategoryOptions}
                          quickOptions={txInlineCategoryQuickChips}
                          selectedCategoryId={editForm.category_id}
                          disabled={inlineEditorDisabled}
                          allowCreate={canEditHouseholdData}
                          createDisabled={inlineEditorDisabled || !canEditHouseholdData || loading}
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
                              disabled={inlineEditorDisabled}
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
                            disabled={inlineEditorDisabled}
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
                            disabled={inlineEditorDisabled || !txInlineCategoryMajor}
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
                          disabled={inlineEditorDisabled}
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
                          disabled={inlineEditorDisabled}
                          required
                        />
                      </label>
                      <label className="tx-inline-owner-field">
                        <span className="tx-inline-field-label">거래자명</span>
                        <select
                          aria-label="거래자"
                          value={ownerSelectValue(editForm.owner_user_id, editForm.owner_name)}
                          disabled={inlineEditorDisabled}
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
                          disabled: inlineEditorDisabled,
                          onApply: (target) =>
                            setTxInlineEdit({
                              ...editForm,
                              owner_user_id: target.value,
                              owner_name: target.displayName,
                            }),
                        })}
                      <div className="inline tx-inline-editor-actions">
                        <button type="button" className="secondary" disabled={inlineEditorDisabled} onClick={() => closeTxInlineEdit()}>
                          취소
                        </button>
                        <button
                          type="button"
                          className="primary"
                          data-testid="tx-inline-save"
                          disabled={inlineEditorDisabled}
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
              ) : null;
            return (
              <Fragment key={rowKey}>
                {shouldRenderInlineEditorBeforeRow && inlineEditorRow}
                <tr
                  className={`transaction-row transaction-row-${item.flow_type} ${isEditing ? "transaction-row-editing" : ""} ${isExpanded ? "mobile-row-expanded" : ""} ${isWideAmount ? "transaction-row-wide-amount" : ""} ${isRecentlyImported ? "transaction-row-imported" : ""} ${isRecentlySaved ? "transaction-row-saved" : ""}`}
                  data-row-expanded={isExpanded ? "true" : "false"}
                  data-row-selected={selectedTransactionIds.has(item.id) ? "true" : "false"}
                  data-import-highlight={isRecentlyImported ? "true" : undefined}
                  data-save-highlight={isRecentlySaved ? "true" : undefined}
                  data-transaction-id={item.id}
                  data-transaction-date={item.occurred_on}
                  aria-selected={selectedTransactionIds.has(item.id) ? "true" : "false"}
                  aria-label={`거래 ${item.occurred_on} ${flowLabel} ${ownerSummaryLabel} ${compactCategoryLabel} ${item.memo || "-"} ${amountLabel}${installmentLabel ? ` ${installmentLabel}` : ""}. ${rowActivationLabel} ${rowKeyboardShortcutLabel}`}
                  aria-keyshortcuts={rowKeyShortcuts || undefined}
                  tabIndex={isEditing ? -1 : 0}
                  onPointerDown={(event) => startRowPointerGesture(event, item.id, isEditing)}
                  onPointerMove={(event) => updateRowPointerGesture(event, item.id)}
                  onPointerEnter={(event) => updateRowPointerGesture(event, item.id)}
                  onTouchMove={(event) => updateRowTouchGesture(event, item.id)}
                  onPointerUp={finishRowPointerGesture}
                  onPointerCancel={finishRowPointerGesture}
                  onClick={handleRowClick}
                  onDoubleClick={handleRowDoubleClick}
                  onKeyDown={handleRowKeyDown}
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
                  <td data-label="일자" aria-label={`일자 ${item.occurred_on}`} className="transaction-col-date" data-field-key="occurred_on" data-mobile-priority={transactionMobilePriority("occurred_on")}>
                    <span className="desktop-date-text">{item.occurred_on}</span>
                    <span className="mobile-date-text">{formatCompactDate(item.occurred_on)}</span>
                  </td>
                  <td data-label="유형" aria-label={`유형 ${flowLabel}`} className="transaction-col-type" data-field-key="flow_type" data-mobile-priority={transactionMobilePriority("flow_type")}>
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
                  </td>
                  <td data-label="거래자명" aria-label={`거래자명 ${ownerSummaryLabel}`} className="transaction-col-owner transaction-mobile-detail-cell" data-field-key="owner_name" data-mobile-priority={transactionMobilePriority("owner_name")}>
                    <span
                      className={ownerCompactLabel ? "transaction-owner-compact" : "transaction-owner-compact transaction-owner-compact-empty"}
                      title={ownerSummaryLabel}
                      aria-label={`거래자 ${ownerSummaryLabel}`}
                    >
                      {ownerCompactLabel || "-"}
                    </span>
                    {ownerCueLabel && (
                      <span className="transaction-owner-cue" title={ownerSummaryLabel}>
                        {ownerCueLabel}
                      </span>
                    )}
                    <span className="transaction-mobile-detail-label">거래자명</span>
                    <div className="transaction-mobile-detail-value">{ownerNameLabel || "-"}</div>
                  </td>
                  <td data-label="카테고리" aria-label={`카테고리 ${fullCategoryLabel}`} className="transaction-col-category transaction-mobile-detail-cell" data-field-key="category" data-mobile-priority={transactionMobilePriority("category")}>
                    <span className="transaction-desktop-category-cue" title={fullCategoryLabel} aria-label={`카테고리 ${fullCategoryLabel}`}>{compactCategoryLabel}</span>
                    <span className="transaction-mobile-category-cue">{compactCategoryLabel}</span>
                    <span className="transaction-mobile-detail-label">카테고리</span>
                    <div className="transaction-mobile-detail-value">{renderCategoryCell(category)}</div>
                  </td>
                  <td data-label="메모" aria-label={`메모 ${item.memo || "-"}${installmentLabel ? `, ${installmentLabel}` : ""}`} className="transaction-col-memo" data-field-key="memo" data-mobile-priority={transactionMobilePriority("memo")}>
                    <span className="transaction-memo-text" title={item.memo || "-"} aria-label={`메모 ${item.memo || "-"}`}>
                      <span className="transaction-memo-text-full">{item.memo || "-"}</span>
                      <span className="transaction-memo-text-compact" aria-hidden="true">{compactMemoLabel}</span>
                    </span>
                    {installmentLabel && <span className="transaction-installment-badge">{installmentLabel}</span>}
                  </td>
                  <td data-label="금액" aria-label={`금액 ${amountLabel}`} className="transaction-col-amount" data-field-key="amount" data-mobile-priority={transactionMobilePriority("amount")}>
                    <span className={`transaction-amount-text${isWideAmount ? " transaction-amount-text-wide" : ""}`} title={amountLabel}>
                      <span className="transaction-amount-text-full">{amountLabel}</span>
                      <span className="transaction-amount-text-compact" aria-hidden="true">{compactAmountLabel}</span>
                    </span>
                  </td>
                  <td data-label="최종 수정일" aria-label={`최종 수정일 ${fmtDate(item.updated_at)}`} className="transaction-col-updated transaction-mobile-detail-cell" data-field-key="updated_at" data-mobile-priority={transactionMobilePriority("updated_at")}>
                    <span className="transaction-mobile-detail-label">최종 수정일</span>
                    <div className="transaction-mobile-detail-value">{fmtDate(item.updated_at)}</div>
                  </td>
                </tr>
                {isExpanded && isCompactViewport && (
                  <tr className="transaction-mobile-expanded-detail-row" data-expanded-detail-for={item.id}>
                    <td colSpan={columnSpan} className="transaction-mobile-expanded-detail-cell">
                      <div className="transaction-expanded-detail-grid">
                        <div className="transaction-expanded-detail-item transaction-expanded-detail-owner transaction-mobile-detail-cell">
                          <span className="transaction-mobile-detail-label">거래자명</span>
                          <div className="transaction-mobile-detail-value">{ownerNameLabel || "-"}</div>
                        </div>
                        <div className="transaction-expanded-detail-item transaction-expanded-detail-category transaction-mobile-detail-cell">
                          <span className="transaction-mobile-detail-label">카테고리</span>
                          <div className="transaction-mobile-detail-value">{renderCategoryCell(category)}</div>
                        </div>
                        <div className="transaction-expanded-detail-item transaction-expanded-detail-memo transaction-mobile-detail-cell">
                          <span className="transaction-mobile-detail-label">메모</span>
                          <div className="transaction-mobile-detail-value" title={item.memo || "-"} aria-label={`메모 ${item.memo || "-"}`}>
                            {item.memo || "-"}
                          </div>
                        </div>
                        <div className="transaction-expanded-detail-item transaction-expanded-detail-amount transaction-mobile-detail-cell">
                          <span className="transaction-mobile-detail-label">금액</span>
                          <div className="transaction-mobile-detail-value">{amountLabel}</div>
                        </div>
                        {item.installment_months != null && (
                          <div className="transaction-expanded-detail-item transaction-expanded-detail-installment transaction-mobile-detail-cell">
                            <span className="transaction-mobile-detail-label">할부</span>
                            <div className="transaction-mobile-detail-value">{item.installment_months}개월 할부</div>
                          </div>
                        )}
                        <div className="transaction-expanded-detail-item transaction-expanded-detail-updated transaction-mobile-detail-cell">
                          <span className="transaction-mobile-detail-label">최종 수정일</span>
                          <div className="transaction-mobile-detail-value">{fmtDate(item.updated_at)}</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {!shouldRenderInlineEditorBeforeRow && inlineEditorRow}
              </Fragment>
            );
          })}
          </tbody>
        </table>
      </div>
    </>
  );
}
