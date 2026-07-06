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
        inlineEdit={{ closeTxInlineEdit, createAndApplyTxInlineCategory, handleGroupedDecimalInput, handleTransactionAmountInput, handleTxInlineEditKeyDown, openTransactionInlineEditor, submitTxInlineEdit, txInlineEdit, updateTxInlineEdit }}
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
        entrySheet={{ closeTransactionEntrySheet, renderTransactionFormFields, showTransactionForm, transactionEntryBanner, txEntrySheetStep, updateTxEntrySheetStep }}
        categoryManager={{ renderTransactionCategoryManagerContent }}
      />
    </section>
  );
}
