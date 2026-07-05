import { TransactionSurfaceTable } from "../../components/worksurface/TransactionSurfaceTable";

export function TransactionListTablePanel({
  constants,
  permissions,
  listState,
  listLookups,
  listActions,
  selection,
  inlineEdit,
  categoryManager,
  history,
  ownerHelpers,
  formatters,
}) {
  const { DEFAULT_TRANSACTION_ROW_COLORS, FLOW_TYPE_LABELS, FLOW_TYPE_OPTIONS } = constants;
  const { canEditHouseholdData, canEditRecords, isCompactViewport, loading } = permissions;
  const { expandedTransactionRows, recentImportTransactionIds, recentSavedTransactionIds, showTransactionScrollTop, sortedTransactions, transactionsMobileStickyActive, txListFilter, txSortDirection } = listState;
  const { categoryById, householdSettings, normalizeTransactionRowColors, renderCategoryCell } = listLookups;
  const { clearTxListFilter, selectTransactionRows, scrollTransactionListToTop, toggleExpandedTransactionRow, toggleTxSortDirection, updateTransactionRowsExpanded, updateTransactionRowsSelected, updateTxListFilter } = listActions;
  const { areAllFilteredTransactionsSelected, selectedTransactionIds, toggleAllFilteredTransactionSelection, toggleTransactionSelection } = selection;
  const { closeTxInlineEdit, createAndApplyTxInlineCategory, handleGroupedDecimalInput, handleTransactionAmountInput, handleTxInlineEditKeyDown, openTransactionInlineEditor, submitTxInlineEdit, txInlineEdit, updateTxInlineEdit } = inlineEdit;
  const { renderLegacyOwnerRemapHelper, txInlineCategoryMajor, txInlineCategoryMajorOptions, txInlineCategoryMinorOptions, txInlineCategoryOptions, txInlineCategoryQuickChips } = categoryManager;
  const { transactionHistoryBottomSentinelRef, transactionHistoryError, transactionHistoryInitialized, transactionHistoryLoading, transactionHistoryTopSentinelRef } = history;
  const { ownerOptionsWithFallback, ownerSelectValue, ownerSelectionFromValue } = ownerHelpers;
  const { fmtDate, fmtKrw, toCategoryMajorLabel, toCategoryMinorLabel } = formatters;

  return (
    <>
      {(transactionHistoryLoading.initial || transactionHistoryError) && (
        <p className={`table-summary transaction-history-status${transactionHistoryError ? " is-error" : ""}`} role={transactionHistoryError ? "alert" : "status"}>
          {transactionHistoryError || "오늘 기준 거래 내역을 불러오는 중입니다."}
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
        <button type="button" className="transactions-scroll-top" data-testid="transactions-scroll-top" aria-label="거래 목록 맨 위로 이동" onClick={scrollTransactionListToTop}>
          <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
            <path d="M8 3.25 3.75 7.5M8 3.25l4.25 4.25M8 3.25v9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>맨 위로</span>
        </button>
      )}
    </>
  );
}
