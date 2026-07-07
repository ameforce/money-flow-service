import { useEffect, useRef } from "react";

import { IsoDateInput } from "../../components/IsoDateInput";

const TRANSACTION_FILTER_FOCUS_SELECTORS = {
  amount: "[data-transaction-filter-field='amount_min']",
  flow_type: "[data-transaction-filter-field='flow_type']",
  memo: "[data-transaction-filter-field='memo']",
};

function normalizeAmountFilterInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function TransactionListToolbar({
  constants,
  permissions,
  monthFilter,
  listState,
  listRefs,
  listActions,
  selection,
  entrySheet,
  inlineEdit,
  formatters,
}) {
  const { FLOW_TYPE_OPTIONS } = constants;
  const { canEditRecords, isCompactViewport, loading } = permissions;
  const {
    handleMoveToCurrentMonth,
    handleShiftYearMonth,
    handleYearMonthInputKeyDown,
    isMonthFilterPending,
    isNextMonthDisabled,
    isPrevMonthDisabled,
    maxMonth,
    minMonth,
    updateYearMonthInput,
    yearMonth,
  } = monthFilter;
  const {
    isTransactionFilterActive,
    selectedTransactionSummary,
    showTransactionFilterPanel,
    sortedTransactions,
    transactionFilterFocusTarget,
    transactionSortSummary,
    transactionLedgerItems,
    txListFilter,
  } = listState;
  const { transactionListHeadingRef, transactionStickyToolbarRef } = listRefs;
  const { clearTxListFilter, updateShowTransactionFilterPanel, updateTransactionFilterFocusTarget, updateTxListFilter } = listActions;
  const {
    openSelectedTransactionEdit,
    openSelectedTransactionInsert,
    removeSelectedTransactions,
    updateSelectedTransactionIds,
  } = selection;
  const { openNormalTransactionEntrySheet, transactionDesktopAddActionRef, transactionFabRef } = entrySheet;
  const { txInlineEdit } = inlineEdit;
  const { fmtKrw, toYearMonthKey } = formatters;
  const filterPanelRef = useRef(null);

  useEffect(() => {
    if (isCompactViewport || !showTransactionFilterPanel) {
      return undefined;
    }
    const targetSelector = TRANSACTION_FILTER_FOCUS_SELECTORS[transactionFilterFocusTarget];
    const firstControl = (
      targetSelector ? filterPanelRef.current?.querySelector(targetSelector) : null
    ) || filterPanelRef.current?.querySelector("input, select, button");
    firstControl?.focus?.({ preventScroll: true });
    return undefined;
  }, [isCompactViewport, showTransactionFilterPanel, transactionFilterFocusTarget]);

  return (
    <div ref={transactionStickyToolbarRef} className="transaction-sticky-toolbar" data-testid="transaction-sticky-toolbar">
      <div ref={transactionListHeadingRef} className="surface-list-heading">
        <div className="work-surface-title">
          <span className="surface-eyebrow">작업 원장</span>
          <h2>거래 목록</h2>
        </div>
        <p className="table-summary surface-count-summary">
          <span>총 {transactionLedgerItems.length}건 중 {sortedTransactions.length}건 표시</span>
          <span className="surface-count-sort">, {transactionSortSummary}</span>
        </p>
        {!isCompactViewport && !txInlineEdit && (
          <button ref={transactionDesktopAddActionRef} type="button" className="primary surface-heading-action transaction-desktop-add-action" data-testid="transactions-desktop-add-action" disabled={loading} onClick={() => openNormalTransactionEntrySheet("form")}>
            <span aria-hidden="true">＋</span>
            <span>거래 추가</span>
          </button>
        )}
        {isCompactViewport && !txInlineEdit && (
          <button
            ref={transactionFabRef} type="button" className="primary surface-heading-action transactions-fab transactions-fab-inline transaction-add-fab" data-testid="transactions-fab" aria-label="거래 추가" disabled={loading}
            onClick={() => openNormalTransactionEntrySheet("form")}
          >
            <span aria-hidden="true">＋</span>
          </button>
        )}
      </div>
      <div className="surface-control-strip" aria-label="거래 목록 상태">
        <span className="surface-chip surface-chip-strong transaction-sort-status-chip">{transactionSortSummary}</span>
        <span className={`surface-chip${isTransactionFilterActive ? " surface-chip-strong" : " surface-chip-muted"}`}>
          필터 {isTransactionFilterActive ? "적용됨" : "기본"}
        </span>
        <TransactionSelectionSummary
          canEditRecords={canEditRecords}
          loading={loading}
          selectedTransactionSummary={selectedTransactionSummary}
          openSelectedTransactionEdit={openSelectedTransactionEdit}
          openSelectedTransactionInsert={openSelectedTransactionInsert}
          removeSelectedTransactions={removeSelectedTransactions}
          updateSelectedTransactionIds={updateSelectedTransactionIds}
          fmtKrw={fmtKrw}
        />
      </div>
      <MonthFilterBar
        monthFilter={{ handleMoveToCurrentMonth, handleShiftYearMonth, handleYearMonthInputKeyDown, isMonthFilterPending, isNextMonthDisabled, isPrevMonthDisabled, maxMonth, minMonth, updateYearMonthInput, yearMonth }}
        formatters={{ toYearMonthKey }}
      />
      {(!isCompactViewport || isTransactionFilterActive) && (
        <div className="transaction-filter-actions" aria-label="거래 필터 빠른 조작">
          {!isCompactViewport && (
            <button
              type="button"
              className="secondary"
              aria-expanded={showTransactionFilterPanel ? "true" : "false"}
              aria-controls="transaction-filter-panel"
              onClick={() => {
                if (typeof updateTransactionFilterFocusTarget === "function") {
                  updateTransactionFilterFocusTarget("");
                }
                updateShowTransactionFilterPanel((prev) => !prev);
              }}
            >
              {showTransactionFilterPanel ? "필터 닫기" : "필터 열기"}
            </button>
          )}
          {isTransactionFilterActive && (
            <button type="button" className="secondary tx-header-filter-reset" onClick={clearTxListFilter}>필터 초기화</button>
          )}
          {!isCompactViewport && <span className="table-summary">현재 불러온 거래 목록 기준 필터입니다.</span>}
        </div>
      )}
      {showTransactionFilterPanel && (
        <div ref={filterPanelRef} id="transaction-filter-panel" className="tx-header-filters" aria-label="거래 제목행 필터">
          <label className="tx-header-filter tx-header-filter-search">
            <span>메모</span>
            <input data-transaction-filter-field="memo" placeholder="검색" value={txListFilter.keyword} onChange={(e) => updateTxListFilter({ ...txListFilter, keyword: e.target.value })} enterKeyHint="search" />
          </label>
          <label className="tx-header-filter tx-header-filter-type">
            <span>유형</span>
            <select data-transaction-filter-field="flow_type" value={txListFilter.flow_type} onChange={(e) => updateTxListFilter({ ...txListFilter, flow_type: e.target.value })}>
              <option value="all">전체</option>
              {FLOW_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="tx-header-filter">
            <span>시작</span>
            <IsoDateInput value={txListFilter.start} onValueChange={(value) => updateTxListFilter({ ...txListFilter, start: value })} />
          </label>
          <label className="tx-header-filter">
            <span>종료</span>
            <IsoDateInput value={txListFilter.end} onValueChange={(value) => updateTxListFilter({ ...txListFilter, end: value })} />
          </label>
          <label className="tx-header-filter">
            <span>최소 금액</span>
            <input
              inputMode="numeric"
              data-transaction-filter-field="amount_min"
              placeholder="0"
              value={txListFilter.amount_min}
              onChange={(e) => updateTxListFilter({ ...txListFilter, amount_min: normalizeAmountFilterInput(e.target.value) })}
            />
          </label>
          <label className="tx-header-filter">
            <span>최대 금액</span>
            <input
              inputMode="numeric"
              data-transaction-filter-field="amount_max"
              placeholder="100,000"
              value={txListFilter.amount_max}
              onChange={(e) => updateTxListFilter({ ...txListFilter, amount_max: normalizeAmountFilterInput(e.target.value) })}
            />
          </label>
          <button type="button" className="secondary tx-header-filter-reset" onClick={clearTxListFilter}>초기화</button>
        </div>
      )}
    </div>
  );
}

function TransactionSelectionSummary({
  canEditRecords,
  loading,
  selectedTransactionSummary,
  openSelectedTransactionEdit,
  openSelectedTransactionInsert,
  removeSelectedTransactions,
  updateSelectedTransactionIds,
  fmtKrw,
}) {
  return (
    <span className="transaction-selection-summary" data-testid="transaction-selection-summary" data-selection-active={selectedTransactionSummary.count > 0 ? "true" : "false"}>
      <span className="transaction-selection-status" role="status" aria-live="polite" aria-atomic="true">
        <span className={`surface-chip${selectedTransactionSummary.count > 0 ? " surface-chip-strong" : " surface-chip-muted"}`}>선택 {selectedTransactionSummary.count}건</span>
        <span className="surface-chip transaction-selection-amount">선택 합계 {fmtKrw(selectedTransactionSummary.amount)}</span>
      </span>
      {selectedTransactionSummary.count === 1 && (
        <>
          <button type="button" className="secondary transaction-selection-action transaction-selection-edit" data-testid="transaction-selection-edit" disabled={!canEditRecords || loading} onClick={openSelectedTransactionEdit}>수정</button>
          <button type="button" className="secondary transaction-selection-action transaction-selection-insert-above" data-testid="transaction-selection-insert-above" disabled={!canEditRecords || loading} onClick={() => openSelectedTransactionInsert("above")}>위에 삽입</button>
          <button type="button" className="secondary transaction-selection-action transaction-selection-insert-below" data-testid="transaction-selection-insert-below" disabled={!canEditRecords || loading} onClick={() => openSelectedTransactionInsert("below")}>아래에 삽입</button>
        </>
      )}
      <button type="button" className="danger transaction-selection-action transaction-selection-delete" data-testid="transaction-selection-delete" disabled={selectedTransactionSummary.count === 0 || !canEditRecords || loading} onClick={() => { void removeSelectedTransactions(); }}>
        {selectedTransactionSummary.count > 1 ? "선택 삭제" : "삭제"}
      </button>
      <button type="button" className="secondary transaction-selection-action transaction-selection-clear" disabled={selectedTransactionSummary.count === 0} onClick={() => updateSelectedTransactionIds(new Set())}>
        선택 해제
      </button>
    </span>
  );
}

function MonthFilterBar({ monthFilter, formatters }) {
  const { handleMoveToCurrentMonth, handleShiftYearMonth, handleYearMonthInputKeyDown, isMonthFilterPending, isNextMonthDisabled, isPrevMonthDisabled, maxMonth, minMonth, updateYearMonthInput, yearMonth } = monthFilter;
  const { toYearMonthKey } = formatters;

  return (
    <div className="table-header-group">
      <div className="month-stepper-inline">
        <div className="month-stepper">
          <button type="button" className="icon-btn" aria-label="이전 달" disabled={isPrevMonthDisabled} onClick={() => handleShiftYearMonth(-1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <div className="date-inputs">
            <span className="month-value-group"><input type="number" aria-label="연도" value={yearMonth.year} onChange={(event) => updateYearMonthInput("year", event.target.value)} onKeyDown={handleYearMonthInputKeyDown} enterKeyHint="done" /><span aria-hidden="true">년</span></span>
            <span className="month-value-group month-value-group-month"><input type="number" min="1" max="12" aria-label="월" value={yearMonth.month} onChange={(event) => updateYearMonthInput("month", event.target.value)} onKeyDown={handleYearMonthInputKeyDown} enterKeyHint="done" /><span aria-hidden="true">월</span></span>
          </div>
          <button type="button" className="icon-btn" aria-label="다음 달" disabled={isNextMonthDisabled} onClick={() => handleShiftYearMonth(1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
          <button type="button" className="text-btn" onClick={handleMoveToCurrentMonth}>이번 달</button>
        </div>
        <p className="table-summary">조회 가능 월: {toYearMonthKey(minMonth)} ~ {toYearMonthKey(maxMonth)}</p>
        {isMonthFilterPending && (
          <p className="filter-pending-status" data-testid="transaction-month-pending-status" aria-live="polite">변경됨 · Enter로 조회 적용</p>
        )}
      </div>
    </div>
  );
}
