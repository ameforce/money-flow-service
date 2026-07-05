import { IsoDateInput } from "../components/IsoDateInput";
import { TransactionSurfaceTable } from "../components/worksurface/TransactionSurfaceTable";

export function TransactionsPage({
  constants,
  permissions,
  monthFilter,
  listState,
  listRefs,
  listLookups,
  listActions,
  selection,
  entrySheet,
  inlineEdit,
  categoryManager,
  history,
  support,
  breakdown,
  ownerHelpers,
  formatters,
}) {
  const {
    DEFAULT_TRANSACTION_ROW_COLORS,
    FLOW_TYPE_LABELS,
    FLOW_TYPE_OPTIONS,
  } = constants;
  const {
    canEditHouseholdData,
    canEditRecords,
    isCompactViewport,
    loading,
  } = permissions;
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
    expandedTransactionRows,
    isTransactionFilterActive,
    recentImportTransactionIds,
    recentSavedTransactionIds,
    selectedTransactionSummary,
    showTransactionFilterPanel,
    showTransactionScrollTop,
    sortedTransactions,
    transactionSortSummary,
    transactionsMobileStickyActive,
    txListFilter,
    txSortDirection,
  } = listState;
  const {
    transactionListCardRef,
    transactionListHeadingRef,
    transactionStickyToolbarRef,
  } = listRefs;
  const {
    categoryById,
    householdSettings,
    normalizeTransactionRowColors,
    renderCategoryCell,
  } = listLookups;
  const {
    clearTxListFilter,
    selectTransactionRows,
    scrollTransactionListToTop,
    toggleExpandedTransactionRow,
    toggleTxSortDirection,
    updateShowTransactionFilterPanel,
    updateTransactionRowsExpanded,
    updateTransactionRowsSelected,
    updateTxListFilter,
  } = listActions;
  const {
    areAllFilteredTransactionsSelected,
    openSelectedTransactionEdit,
    openSelectedTransactionInsert,
    removeSelectedTransactions,
    selectedTransactionIds,
    toggleAllFilteredTransactionSelection,
    toggleTransactionSelection,
    updateSelectedTransactionIds,
  } = selection;
  const {
    closeTransactionEntrySheet,
    openNormalTransactionEntrySheet,
    renderTransactionFormFields,
    showTransactionForm,
    transactionDesktopAddActionRef,
    transactionEntryBanner,
    transactionFabRef,
    txEntrySheetStep,
    updateTxEntrySheetStep,
  } = entrySheet;
  const {
    closeTxInlineEdit,
    createAndApplyTxInlineCategory,
    handleGroupedDecimalInput,
    handleTransactionAmountInput,
    handleTxInlineEditKeyDown,
    openTransactionInlineEditor,
    submitTxInlineEdit,
    txInlineEdit,
    updateTxInlineEdit,
  } = inlineEdit;
  const {
    renderLegacyOwnerRemapHelper,
    renderTransactionCategoryManagerContent,
    showTxCategoryManager,
    toggleTransactionCategoryManager,
    txCategoryManagerRef,
    txInlineCategoryMajor,
    txInlineCategoryMajorOptions,
    txInlineCategoryMinorOptions,
    txInlineCategoryOptions,
    txInlineCategoryQuickChips,
    updateShowTxCategoryManager,
  } = categoryManager;
  const {
    transactionHistoryAnchorDate,
    transactionHistoryBottomSentinelRef,
    transactionHistoryError,
    transactionHistoryInitialized,
    transactionHistoryLoading,
    transactionHistoryToday,
    transactionHistoryTopSentinelRef,
    transactionLedgerItems,
  } = history;
  const {
    transactionSupportDetailsRef,
    transactionSupportOpen,
    updateTransactionSupportOpen,
  } = support;
  const {
    txFlowBreakdownExpanded,
    txFlowSummaryCards,
    updateTxFlowBreakdownExpanded,
  } = breakdown;
  const {
    ownerOptionsWithFallback,
    ownerSelectValue,
    ownerSelectionFromValue,
  } = ownerHelpers;
  const {
    fmtDate,
    fmtKrw,
    formatSharePercent,
    toCategoryMajorLabel,
    toCategoryMinorLabel,
    toYearMonthKey,
  } = formatters;

  return (
    <section className="grid-1 transaction-page-section">
              <article ref={transactionListCardRef} className="card table-card surface-list-card transaction-list-card">
                <div
                  ref={transactionStickyToolbarRef}
                  className="transaction-sticky-toolbar"
                  data-testid="transaction-sticky-toolbar"
                >
                  <div ref={transactionListHeadingRef} className="surface-list-heading">
                    <div className="work-surface-title">
                      <span className="surface-eyebrow">작업 원장</span>
                      <h2>거래 목록</h2>
                    </div>
                    <p className="table-summary surface-count-summary">
                      {transactionHistoryInitialized ? "불러온" : "총"} {transactionLedgerItems.length}건 중 {sortedTransactions.length}건 표시
                    </p>
                    {!isCompactViewport && !txInlineEdit && (
                      <button
                        ref={transactionDesktopAddActionRef}
                        type="button"
                        className="primary surface-heading-action transaction-desktop-add-action"
                        data-testid="transactions-desktop-add-action"
                        disabled={loading}
                        onClick={() => openNormalTransactionEntrySheet("form")}
                      >
                        <span aria-hidden="true">＋</span>
                        <span>거래 추가</span>
                      </button>
                    )}
                  </div>
                  <div className="surface-control-strip" aria-label="거래 목록 상태">
                    <span className="surface-chip surface-chip-strong">{transactionSortSummary}</span>
                    {transactionHistoryInitialized && (
                      <span className="surface-chip surface-chip-muted">
                        기준 {transactionHistoryAnchorDate || transactionHistoryToday}
                      </span>
                    )}
                    <span className={`surface-chip${isTransactionFilterActive ? " surface-chip-strong" : " surface-chip-muted"}`}>
                      필터 {isTransactionFilterActive ? "적용됨" : "기본"}
                    </span>
                    <span
                      className="transaction-selection-summary"
                      data-testid="transaction-selection-summary"
                      data-selection-active={selectedTransactionSummary.count > 0 ? "true" : "false"}
                    >
                      <span className="transaction-selection-status" role="status" aria-live="polite" aria-atomic="true">
                        <span
                          className={`surface-chip${
                            selectedTransactionSummary.count > 0 ? " surface-chip-strong" : " surface-chip-muted"
                          }`}
                        >
                          선택 {selectedTransactionSummary.count}건
                        </span>
                        <span className="surface-chip transaction-selection-amount">
                          선택 합계 {fmtKrw(selectedTransactionSummary.amount)}
                        </span>
                      </span>
                      {selectedTransactionSummary.count === 1 && (
                        <>
                          <button
                            type="button"
                            className="secondary transaction-selection-action transaction-selection-edit"
                            data-testid="transaction-selection-edit"
                            disabled={!canEditRecords || loading}
                            onClick={openSelectedTransactionEdit}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="secondary transaction-selection-action transaction-selection-insert-above"
                            data-testid="transaction-selection-insert-above"
                            disabled={!canEditRecords || loading}
                            onClick={() => openSelectedTransactionInsert("above")}
                          >
                            위에 삽입
                          </button>
                          <button
                            type="button"
                            className="secondary transaction-selection-action transaction-selection-insert-below"
                            data-testid="transaction-selection-insert-below"
                            disabled={!canEditRecords || loading}
                            onClick={() => openSelectedTransactionInsert("below")}
                          >
                            아래에 삽입
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        className="danger transaction-selection-action transaction-selection-delete"
                        data-testid="transaction-selection-delete"
                        disabled={selectedTransactionSummary.count === 0 || !canEditRecords || loading}
                        onClick={() => {
                          void removeSelectedTransactions();
                        }}
                      >
                        {selectedTransactionSummary.count > 1 ? "선택 삭제" : "삭제"}
                      </button>
                      <button
                        type="button"
                        className="secondary transaction-selection-action transaction-selection-clear"
                        disabled={selectedTransactionSummary.count === 0}
                        onClick={() => updateSelectedTransactionIds(new Set())}
                      >
                        선택 해제
                      </button>
                    </span>
                  </div>
                  <div className="table-header-group">
                    <div className="month-stepper-inline">
                      <div className="month-stepper">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="이전 달"
                          disabled={isPrevMonthDisabled}
                          onClick={() => handleShiftYearMonth(-1)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                        </button>
                        <div className="date-inputs">
                          <span className="month-value-group">
                            <input
                              type="number"
                              aria-label="연도"
                              value={yearMonth.year}
                              onChange={(event) => updateYearMonthInput("year", event.target.value)}
                              onKeyDown={handleYearMonthInputKeyDown}
                              enterKeyHint="done"
                            />
                            <span aria-hidden="true">년</span>
                          </span>
                          <span className="month-value-group month-value-group-month">
                            <input
                              type="number"
                              min="1"
                              max="12"
                              aria-label="월"
                              value={yearMonth.month}
                              onChange={(event) => updateYearMonthInput("month", event.target.value)}
                              onKeyDown={handleYearMonthInputKeyDown}
                              enterKeyHint="done"
                            />
                            <span aria-hidden="true">월</span>
                          </span>
                        </div>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="다음 달"
                          disabled={isNextMonthDisabled}
                          onClick={() => handleShiftYearMonth(1)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </button>
                        <button type="button" className="text-btn" onClick={handleMoveToCurrentMonth}>
                          이번 달
                        </button>
                      </div>
                      <p className="table-summary">
                        조회 가능 월: {toYearMonthKey(minMonth)} ~ {toYearMonthKey(maxMonth)}
                      </p>
                      {isMonthFilterPending && (
                        <p className="filter-pending-status" data-testid="transaction-month-pending-status" aria-live="polite">
                          변경됨 · Enter로 조회 적용
                        </p>
                      )}
                    </div>
                  </div>
                  {(!isCompactViewport || isTransactionFilterActive) && (
                    <div className="transaction-filter-actions" aria-label="거래 필터 빠른 조작">
                      {!isCompactViewport && (
                        <button
                          type="button"
                          className="secondary"
                          aria-expanded={showTransactionFilterPanel ? "true" : "false"}
                          aria-controls="transaction-filter-panel"
                          onClick={() => updateShowTransactionFilterPanel((prev) => !prev)}
                        >
                          {showTransactionFilterPanel ? "필터 닫기" : "필터 열기"}
                        </button>
                      )}
                      {isTransactionFilterActive && (
                        <button type="button" className="secondary tx-header-filter-reset" onClick={clearTxListFilter}>
                          필터 초기화
                        </button>
                      )}
                      {!isCompactViewport && <span className="table-summary">현재 불러온 거래 목록 기준 필터입니다.</span>}
                    </div>
                  )}
                  {showTransactionFilterPanel && (
                    <div id="transaction-filter-panel" className="tx-header-filters" aria-label="거래 제목행 필터">
                      <label className="tx-header-filter tx-header-filter-search">
                        <span>메모</span>
                        <input
                          placeholder="검색"
                          value={txListFilter.keyword}
                          onChange={(e) => updateTxListFilter({ ...txListFilter, keyword: e.target.value })}
                          enterKeyHint="search"
                        />
                      </label>
                      <label className="tx-header-filter tx-header-filter-type">
                        <span>유형</span>
                        <select
                          value={txListFilter.flow_type}
                          onChange={(e) => updateTxListFilter({ ...txListFilter, flow_type: e.target.value })}
                        >
                          <option value="all">전체</option>
                          {FLOW_TYPE_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="tx-header-filter">
                        <span>시작</span>
                        <IsoDateInput
                          value={txListFilter.start}
                          onValueChange={(value) => updateTxListFilter({ ...txListFilter, start: value })}
                        />
                      </label>
                      <label className="tx-header-filter">
                        <span>종료</span>
                        <IsoDateInput
                          value={txListFilter.end}
                          onValueChange={(value) => updateTxListFilter({ ...txListFilter, end: value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary tx-header-filter-reset"
                        onClick={clearTxListFilter}
                      >
                        초기화
                      </button>
                    </div>
                  )}
                </div>
                {(transactionHistoryLoading.initial || transactionHistoryError) && (
                  <p
                    className={`table-summary transaction-history-status${transactionHistoryError ? " is-error" : ""}`}
                    role={transactionHistoryError ? "alert" : "status"}
                  >
                    {transactionHistoryError ||
                      "오늘 기준 거래 내역을 불러오는 중입니다."}
                  </p>
                )}
                <TransactionSurfaceTable
                  sortedTransactions={sortedTransactions}
                  areAllFilteredTransactionsSelected={areAllFilteredTransactionsSelected}
                  toggleAllFilteredTransactionSelection={toggleAllFilteredTransactionSelection}
                  txSortDirection={transactionHistoryInitialized ? "asc" : txSortDirection}
                  toggleTxSortDirection={toggleTxSortDirection}
                  historyMode={transactionHistoryInitialized}
                  historyTopSentinelRef={transactionHistoryTopSentinelRef}
                  historyBottomSentinelRef={transactionHistoryBottomSentinelRef}
                  historyLoadingOlder={transactionHistoryLoading.older}
                  historyLoadingNewer={transactionHistoryLoading.newer}
                  selectedTransactionIds={selectedTransactionIds}
                  recentImportTransactionIds={recentImportTransactionIds}
                  recentSavedTransactionIds={recentSavedTransactionIds}
                  toggleTransactionSelection={toggleTransactionSelection}
                  selectTransactionRows={selectTransactionRows}
                  setTransactionRowsSelected={updateTransactionRowsSelected}
                  setTransactionRowsExpanded={updateTransactionRowsExpanded}
                  txInlineEdit={txInlineEdit}
                  ownerOptionsWithFallback={ownerOptionsWithFallback}
                  ownerSelectValue={ownerSelectValue}
                  txInlineCategoryMajor={txInlineCategoryMajor}
                  txInlineCategoryOptions={txInlineCategoryOptions}
                  txInlineCategoryQuickChips={txInlineCategoryQuickChips}
                  txInlineCategoryMajorOptions={txInlineCategoryMajorOptions}
                  txInlineCategoryMinorOptions={txInlineCategoryMinorOptions}
                  setTxInlineEdit={updateTxInlineEdit}
                  createTxInlineCategory={createAndApplyTxInlineCategory}
                  openTransactionInlineEditor={openTransactionInlineEditor}
                  categoryById={categoryById}
                  renderCategoryCell={renderCategoryCell}
                  FLOW_TYPE_LABELS={FLOW_TYPE_LABELS}
                  FLOW_TYPE_OPTIONS={FLOW_TYPE_OPTIONS}
                  txListFilter={txListFilter}
                  setTxListFilter={updateTxListFilter}
                  clearTxListFilter={clearTxListFilter}
                  householdSettings={householdSettings}
                  normalizeTransactionRowColors={normalizeTransactionRowColors}
                  DEFAULT_TRANSACTION_ROW_COLORS={DEFAULT_TRANSACTION_ROW_COLORS}
                  expandedTransactionRows={expandedTransactionRows}
                  toggleExpandedTransactionRow={toggleExpandedTransactionRow}
                  canEditRecords={canEditRecords}
                  canEditHouseholdData={canEditHouseholdData}
                  loading={loading}
                  isCompactViewport={isCompactViewport}
                  closeTxInlineEdit={closeTxInlineEdit}
                  mobileStickyActive={transactionsMobileStickyActive}
                  handleTxInlineEditKeyDown={handleTxInlineEditKeyDown}
                  handleGroupedDecimalInput={handleGroupedDecimalInput}
                  handleTransactionAmountInput={handleTransactionAmountInput}
                  ownerSelectionFromValue={ownerSelectionFromValue}
                  renderLegacyOwnerRemapHelper={renderLegacyOwnerRemapHelper}
                  submitTxInlineEdit={submitTxInlineEdit}
                  fmtKrw={fmtKrw}
                  fmtDate={fmtDate}
                  toCategoryMajorLabel={toCategoryMajorLabel}
                  toCategoryMinorLabel={toCategoryMinorLabel}
                />
                {showTransactionScrollTop && (
                  <button
                    type="button"
                    className="transactions-scroll-top"
                    data-testid="transactions-scroll-top"
                    aria-label="거래 목록 맨 위로 이동"
                    onClick={scrollTransactionListToTop}
                  >
                    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                      <path d="M8 3.25 3.75 7.5M8 3.25l4.25 4.25M8 3.25v9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>맨 위로</span>
                  </button>
                )}
              </article>
              {isCompactViewport && !txInlineEdit && (
                <button
                  ref={transactionFabRef}
                  type="button"
                  className="transactions-fab transaction-add-fab"
                  data-testid="transactions-fab"
                  aria-label="거래 추가"
                  disabled={loading}
                  onClick={() => openNormalTransactionEntrySheet("form")}
                >
                  <span aria-hidden="true">＋</span>
                </button>
              )}
              <details
                ref={transactionSupportDetailsRef}
                className="card compact-support-card transaction-support-card surface-support-card"
                open={transactionSupportOpen}
                onToggle={(event) => {
                  const nextOpen = event.currentTarget.open;
                  updateTransactionSupportOpen(nextOpen);
                  if (!nextOpen) {
                    updateShowTxCategoryManager(false);
                  }
                }}
              >
                <summary>
                  분석·관리 {transactionSupportOpen ? "접기" : "열기"}
                </summary>
                <p className="table-summary compact-support-summary">집계와 카테고리 관리는 필요할 때만 펼쳐 확인합니다. 포트폴리오와 자산 요약은 자산 탭으로 이동했습니다.</p>
                <div className="compact-support-grid">
                  <section className="compact-support-section">
                    <div className="inline compact-support-header">
                      <h3>유형별 카테고리 집계</h3>
                      <span className="table-summary">수입·지출·투자 흐름 요약</span>
                    </div>
                    <div className="settings-category-flows compact-flow-stack">
                      {txFlowSummaryCards.map((flowSummary) => {
                        const expanded = Boolean(txFlowBreakdownExpanded[flowSummary.flowType]);
                        return (
                          <div key={flowSummary.flowType} className="settings-category-flow compact-flow-card">
                            <button
                              type="button"
                              className={`secondary compact-flow-toggle${expanded ? " is-expanded" : ""}`}
                              data-testid={`tx-flow-summary-toggle-${flowSummary.flowType}`}
                              aria-expanded={expanded}
                              aria-label={`${FLOW_TYPE_LABELS[flowSummary.flowType] || flowSummary.flowType} 카테고리 집계 ${expanded ? "접기" : "상세 보기"}`}
                              onClick={() =>
                                updateTxFlowBreakdownExpanded((prev) => ({
                                  ...prev,
                                  [flowSummary.flowType]: !expanded,
                                }))
                              }
                            >
                              <span className="tx-flow-summary-line" data-testid="tx-flow-summary-line">
                                <strong>{FLOW_TYPE_LABELS[flowSummary.flowType] || flowSummary.flowType}</strong>
                                <span>{fmtKrw(flowSummary.total)}</span>
                                <span>전체 {flowSummary.totalShareText}</span>
                              </span>
                              <span className="compact-flow-toggle-meta">
                                대표 {flowSummary.leadingCategoryLabel} {flowSummary.leadingCategoryShareText}
                              </span>
                            </button>
                            {expanded && (
                              <div
                                className="compact-flow-detail-panel"
                                data-testid={`tx-flow-summary-panel-${flowSummary.flowType}`}
                              >
                                <div className="compact-flow-detail-metrics">
                                  <span>합계 {fmtKrw(flowSummary.total)}</span>
                                  <span>전체 대비 {flowSummary.totalShareText}</span>
                                  <span>대표 카테고리 {flowSummary.leadingCategoryLabel} {flowSummary.leadingCategoryShareText}</span>
                                </div>
                                <div
                                  className="compact-flow-chart"
                                  data-testid={`tx-flow-summary-chart-${flowSummary.flowType}`}
                                >
                                  {flowSummary.categories.length === 0 ? (
                                    <p className="table-summary">집계된 카테고리가 없습니다.</p>
                                  ) : (
                                    flowSummary.categories.slice(0, 5).map((categoryItem) => {
                                      const amountShare = flowSummary.total > 0
                                        ? (Number(categoryItem.amount || 0) / flowSummary.total) * 100
                                        : 0;
                                      return (
                                        <div key={`${flowSummary.flowType}:${categoryItem.label}`} className="compact-flow-chart-row">
                                          <div className="compact-flow-chart-copy">
                                            <strong>{categoryItem.label}</strong>
                                            <span>{fmtKrw(categoryItem.amount)} · {formatSharePercent(amountShare)}</span>
                                          </div>
                                          <div className="compact-flow-chart-bar-track" aria-hidden="true">
                                            <span
                                              className={`compact-flow-chart-bar compact-flow-chart-bar-${flowSummary.flowType}`}
                                              style={{ width: `${Math.max(amountShare, 6)}%` }}
                                            />
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                                <div className="settings-category-list">
                                  {flowSummary.categories.length === 0 ? (
                                    <p className="table-summary">집계된 카테고리가 없습니다.</p>
                                  ) : (
                                    flowSummary.categories.map((categoryItem) => {
                                      const amountShare = flowSummary.total > 0
                                        ? (Number(categoryItem.amount || 0) / flowSummary.total) * 100
                                        : 0;
                                      return (
                                        <div key={`${flowSummary.flowType}:${categoryItem.label}`} className="settings-category-row">
                                          <span className="settings-category-major">{categoryItem.label}</span>
                                          <span className="settings-category-minor">{fmtKrw(categoryItem.amount)}</span>
                                          <span className="settings-category-usage">{formatSharePercent(amountShare)}</span>
                                          <span />
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                  <section ref={txCategoryManagerRef} className="compact-support-section">
                    <div className="inline compact-support-header">
                      <h3>거래 탭 카테고리 관리</h3>
                      <button type="button" className="secondary" onClick={() => toggleTransactionCategoryManager()}>
                        {showTxCategoryManager ? "닫기" : "열기"}
                      </button>
                    </div>
                    {showTxCategoryManager ? (
                      renderTransactionCategoryManagerContent()
                    ) : (
                      <p className="table-summary compact-support-summary">필요할 때만 열어 추가·수정·삭제를 진행합니다.</p>
                    )}
                  </section>
                </div>
              </details>
              {showTransactionForm && (
                <div
                  className={`transaction-entry-sheet-backdrop${isCompactViewport ? " transaction-entry-sheet-backdrop-compact" : " transaction-entry-sheet-backdrop-desktop"}`}
                  role="presentation"
                  onClick={closeTransactionEntrySheet}
                >
                  <section
                    className={`transaction-entry-sheet${isCompactViewport ? " transaction-entry-sheet-compact" : " transaction-entry-sheet-desktop"}`}
                    data-testid="transaction-entry-sheet"
                    aria-modal="true"
                    role="dialog"
                    aria-label={txEntrySheetStep === "category" ? "거래 카테고리 관리 레이어" : "거래 추가 레이어"}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="transaction-entry-sheet-header">
                      <div>
                        <h3>{txEntrySheetStep === "category" ? "카테고리 관리" : "거래 등록"}</h3>
                        <p className="table-summary">
                          {txEntrySheetStep === "category"
                            ? "같은 레이어 안에서 카테고리를 정리합니다."
                            : "금액, 카테고리, 메모 순서로 바로 저장합니다."}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        data-testid="transaction-entry-sheet-close"
                        onClick={closeTransactionEntrySheet}
                      >
                        닫기
                      </button>
                    </div>
                    {!canEditRecords && (
                      <p className="table-summary transaction-entry-readonly-note">
                        거래 등록/수정/삭제는 편집자 이상 권한에서만 가능합니다.
                      </p>
                    )}
                    {txEntrySheetStep === "category" ? (
                      <>
                        <div className="transaction-entry-sheet-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => updateTxEntrySheetStep("form")}
                          >
                            거래 입력으로 돌아가기
                          </button>
                        </div>
                        {renderTransactionCategoryManagerContent({ sheetMode: true })}
                      </>
                    ) : (
                      <>
                        {transactionEntryBanner}
                        {renderTransactionFormFields({ sheetMode: true })}
                      </>
                    )}
                  </section>
                </div>
              )}
            </section>
  );
}
