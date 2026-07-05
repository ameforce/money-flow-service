import { Doughnut, Line } from "react-chartjs-2";
import { ChartBreakdownList, FlowTrendValueTable } from "../../components/worksurface/ChartAccessibleSummary";

export function DashboardCharts({ constants, summary, portfolioView, charts, formatters, renderers }) {
  const { PORTFOLIO_VIEW_OPTIONS } = constants;
  const { dashboardFlowTrendRows, dashboardLoading, isDashboardInitialLoading } = summary;
  const {
    dashboardPortfolioBreakdownItems,
    dashboardPortfolioCenterLabel,
    dashboardPortfolioChartData,
    dashboardPortfolioChartDescription,
    dashboardPortfolioChartSource,
    dashboardPortfolioViewMode,
    updateDashboardPortfolioViewMode,
  } = portfolioView;
  const {
    dashboardFlowChartDescription,
    donutChartOptions,
    lineChartOptions,
    trendChartData,
  } = charts;
  const { fmtKrw } = formatters;
  const { renderDonutCenterLabel, renderDonutSliceLabels } = renderers;

  return (
    <div className="dashboard-main-grid">
      <article className="card chart-card dashboard-flow-card">
        <div className="dashboard-card-heading">
          <div>
            <span className="dashboard-eyebrow">현금 흐름</span>
            <h2>월별 흐름</h2>
          </div>
          <span className="dashboard-chip">현금흐름 추이</span>
        </div>
        <div className={`chart-wrap dashboard-line-chart-wrap${isDashboardInitialLoading || trendChartData ? "" : " chart-wrap-empty"}`}>
          {isDashboardInitialLoading ? (
            <div className="chart-loading" role="status" aria-live="polite">
              <span className="loading-spinner" aria-hidden="true" />
              <p>차트 데이터를 불러오는 중...</p>
            </div>
          ) : trendChartData ? (
            <Line data={trendChartData} options={lineChartOptions} role="img" aria-label={dashboardFlowChartDescription} />
          ) : (
            <p className="dashboard-empty-state">데이터 없음</p>
          )}
        </div>
        <FlowTrendValueTable rows={dashboardFlowTrendRows} formatCurrency={fmtKrw} />
      </article>

      <article className="card chart-card dashboard-portfolio-card">
        <div className="inline chart-card-header dashboard-card-heading">
          <div>
            <span className="dashboard-eyebrow">자산 구성</span>
            <h2>포트폴리오 및 거래내역 차트</h2>
          </div>
          <label className="compact-inline-select dashboard-portfolio-chart-select">
            보기 기준
            <select aria-label="포트폴리오 보기 기준" value={dashboardPortfolioViewMode} disabled={dashboardLoading} onChange={(event) => updateDashboardPortfolioViewMode(event.target.value)}>
              {PORTFOLIO_VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className={`chart-wrap dashboard-donut-wrap${isDashboardInitialLoading || dashboardPortfolioChartData ? "" : " chart-wrap-empty"}`} aria-label={dashboardPortfolioChartDescription}>
          {isDashboardInitialLoading ? (
            <div className="chart-loading" role="status" aria-live="polite">
              <span className="loading-spinner" aria-hidden="true" />
              <p>차트 데이터를 불러오는 중...</p>
            </div>
          ) : dashboardPortfolioChartData ? (
            <>
              <Doughnut data={dashboardPortfolioChartData} options={donutChartOptions} role="img" aria-label={dashboardPortfolioChartDescription} />
              {renderDonutSliceLabels(dashboardPortfolioChartSource.items, {
                testId: "portfolio-donut-slice-label",
                labelPrefix: dashboardPortfolioChartSource.title,
              })}
              {renderDonutCenterLabel(dashboardPortfolioCenterLabel, {
                testId: "portfolio-donut-center-label",
                labelPrefix: dashboardPortfolioChartSource.title,
              })}
            </>
          ) : (
            <p className="dashboard-empty-state">데이터 없음</p>
          )}
        </div>
        <ChartBreakdownList
          items={dashboardPortfolioBreakdownItems}
          ariaLabel={`${dashboardPortfolioChartSource.title} 수치 대체 목록`}
          testId="dashboard-portfolio-breakdown"
          className="dashboard-portfolio-breakdown"
        />
      </article>
    </div>
  );
}
