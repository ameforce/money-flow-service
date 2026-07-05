import { DashboardCharts } from "./dashboard/DashboardCharts";
import { DashboardHeroCard, DashboardFilterCard } from "./dashboard/DashboardHeroAndFilter";
import { DashboardSideCards } from "./dashboard/DashboardSideCards";

export function DashboardPage({
  constants,
  filters,
  summary,
  portfolioView,
  charts,
  formatters,
  renderers,
  navigation,
}) {
  const {
    COLLAB_ROLE_LABELS,
    FINANCIAL_SUMMARY_LABELS,
    FLOW_TYPE_LABELS,
    PORTFOLIO_VIEW_OPTIONS,
    SOCKET_STATUS_LABELS,
  } = constants;
  const {
    applyMonthFilter,
    filterMode,
    handleMoveToCurrentMonth,
    handleRangeInputChange,
    handleRangePreset,
    handleShiftYearMonth,
    handleSwitchToRangeFilter,
    handleYearMonthInputKeyDown,
    isMonthFilterPending,
    isNextMonthDisabled,
    isPrevMonthDisabled,
    range,
    updateYearMonthInput,
    yearMonth,
  } = filters;
  const {
    categoryById,
    dashboardFlowTrendRows,
    dashboardGainLossRatioText,
    dashboardHoldingHighlights,
    dashboardImportStatus,
    dashboardKpiCards,
    dashboardLoading,
    dashboardPriceTone,
    dashboardRecentTransactions,
    householdMembers,
    importReport,
    isDashboardInitialLoading,
    latestRefreshAt,
    priceSummaryRows,
    refreshStateLabel,
    socketStatus,
  } = summary;
  const {
    dashboardPortfolioBreakdownItems,
    dashboardPortfolioCenterLabel,
    dashboardPortfolioChartData,
    dashboardPortfolioChartDescription,
    dashboardPortfolioChartSource,
    dashboardPortfolioViewMode,
    portfolio,
    updateDashboardPortfolioViewMode,
  } = portfolioView;
  const {
    dashboardFlowChartDescription,
    donutChartOptions,
    lineChartOptions,
    trendChartData,
  } = charts;
  const {
    extractVisibleInitial,
    fmt,
    fmtDate,
    fmtDateTime,
    fmtKrw,
    toCategoryPairLabel,
  } = formatters;
  const {
    renderDonutCenterLabel,
    renderDonutSliceLabels,
  } = renderers;
  const {
    navigateToTab,
  } = navigation;

  return (
    <section className="dashboard-command-center grid-2" aria-busy={dashboardLoading ? "true" : "false"}>
      <DashboardHeroCard
        constants={{ FINANCIAL_SUMMARY_LABELS }}
        filters={{ filterMode, range, yearMonth }}
        summary={{
          dashboardGainLossRatioText,
          dashboardKpiCards,
          dashboardLoading,
          dashboardPriceTone,
          isDashboardInitialLoading,
          priceSummaryRows,
        }}
        portfolioView={{ portfolio }}
        formatters={{ fmtKrw }}
      />
      <DashboardFilterCard
        filters={{
          applyMonthFilter,
          filterMode,
          handleMoveToCurrentMonth,
          handleRangeInputChange,
          handleRangePreset,
          handleShiftYearMonth,
          handleSwitchToRangeFilter,
          handleYearMonthInputKeyDown,
          isMonthFilterPending,
          isNextMonthDisabled,
          isPrevMonthDisabled,
          range,
          updateYearMonthInput,
          yearMonth,
        }}
      />
      <DashboardCharts
        constants={{ PORTFOLIO_VIEW_OPTIONS }}
        summary={{
          dashboardFlowTrendRows,
          dashboardLoading,
          isDashboardInitialLoading,
        }}
        portfolioView={{
          dashboardPortfolioBreakdownItems,
          dashboardPortfolioCenterLabel,
          dashboardPortfolioChartData,
          dashboardPortfolioChartDescription,
          dashboardPortfolioChartSource,
          dashboardPortfolioViewMode,
          updateDashboardPortfolioViewMode,
        }}
        charts={{
          dashboardFlowChartDescription,
          donutChartOptions,
          lineChartOptions,
          trendChartData,
        }}
        formatters={{ fmtKrw }}
        renderers={{ renderDonutCenterLabel, renderDonutSliceLabels }}
      />
      <DashboardSideCards
        constants={{ COLLAB_ROLE_LABELS, FLOW_TYPE_LABELS, SOCKET_STATUS_LABELS }}
        summary={{
          categoryById,
          dashboardHoldingHighlights,
          dashboardImportStatus,
          dashboardPriceTone,
          dashboardRecentTransactions,
          householdMembers,
          importReport,
          latestRefreshAt,
          refreshStateLabel,
          socketStatus,
        }}
        formatters={{ extractVisibleInitial, fmt, fmtDate, fmtDateTime, fmtKrw, toCategoryPairLabel }}
        navigation={{ navigateToTab }}
      />
    </section>
  );
}
