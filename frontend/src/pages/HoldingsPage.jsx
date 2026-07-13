import { HoldingEntryPanel } from "./holdings/HoldingEntryPanel";
import { HoldingListPanel } from "./holdings/HoldingListPanel";
import { HoldingSummaryPanel } from "./holdings/HoldingSummaryPanel";

export function HoldingsPage({
  constants,
  permissions,
  entryState,
  entryActions,
  entryLookups,
  listState,
  listActions,
  portfolioSummary,
  formatters,
  renderers,
}) {
  const {
    DEFAULT_HOLDING_TYPES,
  } = constants;
  const {
    canEditRecords,
    isCompactViewport,
    loading,
  } = permissions;
  const {
    holdingEntryActionRef,
    holdingFabRef,
    holdingEntrySheetBackdropRef,
    holdingEntrySheetRef,
    holdingForm,
    holdingFormOwnerOptions,
    holdingFormShowAverageCost,
    holdingFormTracked,
    holdingFormType,
    holdingNameInputRef,
    showHoldingForm,
  } = entryState;
  const {
    applyHoldingOwnerOption,
    closeHoldingEntrySheet,
    createHoldingForm,
    handleHoldingEntryDecimalInput,
    nextAverageCostForHoldingTypeChange,
    openHoldingEntrySheet,
    ownerSelectionFromValue,
    resolveHoldingCategoryOnTypeChange,
    shouldExplainHoldingValueReset,
    submitHolding,
    uiGuideMessage,
    updateHoldingDraftTouched,
    updateHoldingForm,
    updateHoldingOwnerTouched,
    notifyMessage,
  } = entryActions;
  const {
    holdingTypeByKey,
    holdingTypeOptions,
    holdingValuationInputMode,
    normalizeHoldingTypeKey,
    ownerSelectValue,
  } = entryLookups;
  const {
    activeHoldingTabLabel,
    activeHoldingTypeFilterLabel,
    dynamicHoldingTabs,
    filteredHoldingItems,
    groupedHoldingSections,
    holdingColorMode,
    holdingColorModeLabel,
    holdingColumnWidths,
    holdingGroupByColor,
    holdingItems,
    holdingListTab,
    holdingListTabAriaLabel,
    holdingSortSummary,
    holdingTypeFilter,
    selectedHoldingSummary,
    sortedHoldingItems,
  } = listState;
  const {
    moveHoldingCategoryOrder,
    scrollToHoldingSummary,
    updateHoldingColumnWidth,
    updateHoldingColorMode,
    updateHoldingGroupByColor,
    updateHoldingListTab,
    updateHoldingTypeFilter,
    updateSelectedHoldingIds,
  } = listActions;
  const {
    donutChartOptions,
    handleHoldingSummarySummaryClick,
    handleHoldingSummaryToggle,
    holdingPortfolioBreakdownCanFilter,
    holdingPortfolioBreakdownItems,
    holdingPortfolioCenterLabel,
    holdingPortfolioChartData,
    holdingPortfolioChartDescription,
    holdingPortfolioChartSource,
    holdingPortfolioGainTone,
    holdingPortfolioReturnRatio,
    holdingSummaryCardRef,
    holdingSummaryOpen,
    holdingSummarySource,
    holdingSummaryViewMode,
    portfolio,
    updateHoldingSummaryViewMode,
  } = portfolioSummary;
  const {
    fmtKrw,
    fmtSignedPercent,
  } = formatters;
  const {
    renderDonutCenterLabel,
    renderDonutSliceLabels,
    renderHoldingRow,
    renderHoldingSortAria,
    renderHoldingSortHeader,
    renderLegacyOwnerRemapHelper,
    renderOwnerQuickSelect,
  } = renderers;

  return (
    <section className="grid-1">
      <HoldingEntryPanel
        constants={{ DEFAULT_HOLDING_TYPES }}
        permissions={{ canEditRecords, isCompactViewport }}
        entryState={{ holdingEntryActionRef, holdingEntrySheetBackdropRef, holdingEntrySheetRef, holdingForm, holdingFormOwnerOptions, holdingFormShowAverageCost, holdingFormTracked, holdingFormType, holdingNameInputRef, showHoldingForm }}
        entryActions={{ applyHoldingOwnerOption, closeHoldingEntrySheet, createHoldingForm, handleHoldingEntryDecimalInput, nextAverageCostForHoldingTypeChange, openHoldingEntrySheet, ownerSelectionFromValue, resolveHoldingCategoryOnTypeChange, shouldExplainHoldingValueReset, submitHolding, uiGuideMessage, updateHoldingDraftTouched, updateHoldingForm, updateHoldingOwnerTouched, notifyMessage }}
        entryLookups={{ holdingTypeByKey, holdingTypeOptions, holdingValuationInputMode, normalizeHoldingTypeKey, ownerSelectValue }}
        renderers={{ renderLegacyOwnerRemapHelper, renderOwnerQuickSelect }}
      />
      <HoldingListPanel
        permissions={{ isCompactViewport, loading }}
        entryRefs={{ holdingFabRef }}
        listState={{ activeHoldingTabLabel, activeHoldingTypeFilterLabel, dynamicHoldingTabs, filteredHoldingItems, groupedHoldingSections, holdingColorMode, holdingColorModeLabel, holdingColumnWidths, holdingGroupByColor, holdingItems, holdingListTab, holdingListTabAriaLabel, holdingSortSummary, holdingTypeFilter, selectedHoldingSummary, sortedHoldingItems }}
        listActions={{ moveHoldingCategoryOrder, scrollToHoldingSummary, updateHoldingColumnWidth, updateHoldingColorMode, updateHoldingGroupByColor, updateHoldingListTab, updateHoldingTypeFilter, updateSelectedHoldingIds }}
        entryActions={{ openHoldingEntrySheet }}
        formatters={{ fmtKrw }}
        renderers={{ renderHoldingRow, renderHoldingSortAria, renderHoldingSortHeader }}
      />
      <HoldingSummaryPanel
        listState={{ holdingTypeFilter }}
        listActions={{ updateHoldingTypeFilter }}
        portfolioSummary={{ donutChartOptions, handleHoldingSummarySummaryClick, handleHoldingSummaryToggle, holdingPortfolioBreakdownCanFilter, holdingPortfolioBreakdownItems, holdingPortfolioCenterLabel, holdingPortfolioChartData, holdingPortfolioChartDescription, holdingPortfolioChartSource, holdingPortfolioGainTone, holdingPortfolioReturnRatio, holdingSummaryCardRef, holdingSummaryOpen, holdingSummarySource, holdingSummaryViewMode, portfolio, updateHoldingSummaryViewMode }}
        formatters={{ fmtKrw, fmtSignedPercent }}
        renderers={{ renderDonutCenterLabel, renderDonutSliceLabels }}
      />
    </section>
  );
}
