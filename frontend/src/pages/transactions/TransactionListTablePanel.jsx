import { TransactionSurfaceTable } from "../../components/worksurface/TransactionSurfaceTable";

export function TransactionListTablePanel({
  constants,
  permissions,
  requestTransactionFilterPanel,
  listState,
  listLookups,
  listActions,
  selection,
  inlineEdit,
  categoryManager,
  ownerHelpers,
  formatters,
}) {
  const { DEFAULT_TRANSACTION_ROW_COLORS, FLOW_TYPE_LABELS, FLOW_TYPE_OPTIONS } = constants;
  const {
    canEditHouseholdData,
    canEditRecords,
    isCompactViewport,
    isLedgerCompactViewport = isCompactViewport,
    loading,
  } = permissions;
  const { expandedTransactionRows, recentImportTransactionIds, recentSavedTransactionIds, showTransactionFilterPanel, showTransactionScrollTop, sortedTransactions, transactionsMobileStickyActive, txListFilter, txSortDirection } = listState;
  const { categoryById, householdSettings, normalizeTransactionRowColors, renderCategoryCell } = listLookups;
  const { clearTxListFilter, selectTransactionRows, scrollTransactionListToTop, toggleExpandedTransactionRow, toggleTxSortDirection, updateTransactionRowsExpanded, updateTransactionRowsSelected, updateTxListFilter } = listActions;
  const { areAllFilteredTransactionsSelected, selectedTransactionIds, toggleAllFilteredTransactionSelection, toggleTransactionSelection } = selection;
  const { closeTxInlineEdit, createAndApplyTxInlineCategory, handleGroupedDecimalInput, handleTransactionAmountInput, handleTxInlineEditKeyDown, openTransactionInlineEditor, submitTxInlineEdit, txInlineEdit, txInlineEditSubmitting, updateTxInlineEdit } = inlineEdit;
  const { renderLegacyOwnerRemapHelper, txInlineCategoryMajor, txInlineCategoryMajorOptions, txInlineCategoryMinorOptions, txInlineCategoryOptions, txInlineCategoryQuickChips } = categoryManager;
  const { ownerOptionsWithFallback, ownerSelectValue, ownerSelectionFromValue } = ownerHelpers;
  const { fmtDate, fmtKrw, toCategoryMajorLabel, toCategoryMinorLabel } = formatters;

  return (
    <>
      <TransactionSurfaceTable
        sortedTransactions={sortedTransactions}
        areAllFilteredTransactionsSelected={areAllFilteredTransactionsSelected}
        toggleAllFilteredTransactionSelection={toggleAllFilteredTransactionSelection}
        txSortDirection={txSortDirection}
        toggleTxSortDirection={toggleTxSortDirection}
        selectedTransactionIds={selectedTransactionIds}
        recentImportTransactionIds={recentImportTransactionIds}
        recentSavedTransactionIds={recentSavedTransactionIds}
        toggleTransactionSelection={toggleTransactionSelection}
        selectTransactionRows={selectTransactionRows}
        setTransactionRowsSelected={updateTransactionRowsSelected}
        setTransactionRowsExpanded={updateTransactionRowsExpanded}
        txInlineEdit={txInlineEdit}
        txInlineEditSubmitting={txInlineEditSubmitting}
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
        showTransactionFilterPanel={showTransactionFilterPanel}
        requestDesktopFilterPanel={requestTransactionFilterPanel}
        householdSettings={householdSettings}
        normalizeTransactionRowColors={normalizeTransactionRowColors}
        DEFAULT_TRANSACTION_ROW_COLORS={DEFAULT_TRANSACTION_ROW_COLORS}
        expandedTransactionRows={expandedTransactionRows}
        toggleExpandedTransactionRow={toggleExpandedTransactionRow}
        canEditRecords={canEditRecords}
        canEditHouseholdData={canEditHouseholdData}
        loading={loading}
        isCompactViewport={isLedgerCompactViewport}
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
