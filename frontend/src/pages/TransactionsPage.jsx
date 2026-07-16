import { TransactionEntrySheet } from "./transactions/TransactionEntrySheet";
import { TransactionListCard } from "./transactions/TransactionListCard";
import { TransactionsSupportCard } from "./transactions/TransactionsSupportCard";

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
    isLedgerCompactViewport = isCompactViewport,
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
    transactionFilterFocusTarget,
    transactionSortSummary,
    transactionLedgerItems,
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
    updateTransactionFilterFocusTarget,
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
    transactionEntrySheetBackdropRef,
    transactionEntrySheetCloseRef,
    transactionEntrySheetRef,
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
    notifyTransactionEditPermissionDenied,
    submitTxInlineEdit,
    txInlineEdit,
    txInlineEditSubmitting,
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
      {isLedgerCompactViewport && !txInlineEdit && (
        <button
          ref={transactionFabRef}
          type="button"
          className="primary transactions-fab transaction-add-fab"
          data-testid="transactions-fab"
          aria-label="거래 추가"
          disabled={!canEditRecords || loading}
          onClick={() => {
            if (!canEditRecords || loading) {
              return;
            }
            openNormalTransactionEntrySheet("form");
          }}
        >
          <span aria-hidden="true">＋</span>
        </button>
      )}
      {showTransactionScrollTop && (
        <button
          type="button"
          className="transactions-scroll-top"
          data-testid="transactions-scroll-top"
          aria-label="거래 목록 맨 위로 이동"
          onClick={scrollTransactionListToTop}
        >
          <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
            <path
              d="M8 3.25 3.75 7.5M8 3.25l4.25 4.25M8 3.25v9.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>맨 위로</span>
        </button>
      )}
      <TransactionListCard
        constants={{ DEFAULT_TRANSACTION_ROW_COLORS, FLOW_TYPE_LABELS, FLOW_TYPE_OPTIONS }}
        permissions={{ canEditHouseholdData, canEditRecords, isCompactViewport, isLedgerCompactViewport, loading }}
        monthFilter={{ handleMoveToCurrentMonth, handleShiftYearMonth, handleYearMonthInputKeyDown, isMonthFilterPending, isNextMonthDisabled, isPrevMonthDisabled, maxMonth, minMonth, updateYearMonthInput, yearMonth }}
        listState={{ expandedTransactionRows, isTransactionFilterActive, recentImportTransactionIds, recentSavedTransactionIds, selectedTransactionSummary, showTransactionFilterPanel, showTransactionScrollTop, sortedTransactions, transactionFilterFocusTarget, transactionSortSummary, transactionLedgerItems, transactionsMobileStickyActive, txListFilter, txSortDirection }}
        listRefs={{ transactionListCardRef, transactionListHeadingRef, transactionStickyToolbarRef }}
        listLookups={{ categoryById, householdSettings, normalizeTransactionRowColors, renderCategoryCell }}
        listActions={{ clearTxListFilter, selectTransactionRows, scrollTransactionListToTop, toggleExpandedTransactionRow, toggleTxSortDirection, updateShowTransactionFilterPanel, updateTransactionFilterFocusTarget, updateTransactionRowsExpanded, updateTransactionRowsSelected, updateTxListFilter }}
        selection={{ areAllFilteredTransactionsSelected, openSelectedTransactionEdit, openSelectedTransactionInsert, removeSelectedTransactions, selectedTransactionIds, toggleAllFilteredTransactionSelection, toggleTransactionSelection, updateSelectedTransactionIds }}
        entrySheet={{ openNormalTransactionEntrySheet, transactionDesktopAddActionRef, transactionFabRef }}
        inlineEdit={{ closeTxInlineEdit, createAndApplyTxInlineCategory, handleGroupedDecimalInput, handleTransactionAmountInput, handleTxInlineEditKeyDown, notifyTransactionEditPermissionDenied, openTransactionInlineEditor, submitTxInlineEdit, txInlineEdit, txInlineEditSubmitting, updateTxInlineEdit }}
        categoryManager={{ renderLegacyOwnerRemapHelper, txInlineCategoryMajor, txInlineCategoryMajorOptions, txInlineCategoryMinorOptions, txInlineCategoryOptions, txInlineCategoryQuickChips }}
        ownerHelpers={{ ownerOptionsWithFallback, ownerSelectValue, ownerSelectionFromValue }}
        formatters={{ fmtDate, fmtKrw, toCategoryMajorLabel, toCategoryMinorLabel, toYearMonthKey }}
      />
      <TransactionsSupportCard
        constants={{ FLOW_TYPE_LABELS }}
        categoryManager={{ renderTransactionCategoryManagerContent, showTxCategoryManager, toggleTransactionCategoryManager, txCategoryManagerRef, updateShowTxCategoryManager }}
        support={{ transactionSupportDetailsRef, transactionSupportOpen, updateTransactionSupportOpen }}
        breakdown={{ txFlowBreakdownExpanded, txFlowSummaryCards, updateTxFlowBreakdownExpanded }}
        formatters={{ fmtKrw, formatSharePercent }}
      />
      <TransactionEntrySheet
        permissions={{ canEditRecords, isCompactViewport }}
        entrySheet={{ closeTransactionEntrySheet, renderTransactionFormFields, showTransactionForm, transactionEntryBanner, transactionEntrySheetBackdropRef, transactionEntrySheetCloseRef, transactionEntrySheetRef, txEntrySheetStep, updateTxEntrySheetStep }}
        categoryManager={{ renderTransactionCategoryManagerContent }}
      />
    </section>
  );
}
