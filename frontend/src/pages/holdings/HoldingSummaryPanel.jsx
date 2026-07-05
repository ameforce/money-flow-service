import { Doughnut } from "react-chartjs-2";
import { ChartBreakdownList } from "../../components/worksurface/ChartAccessibleSummary";

export function HoldingSummaryPanel({ listState, listActions, portfolioSummary, formatters, renderers }) {
  const { holdingTypeFilter } = listState;
  const { updateHoldingTypeFilter } = listActions;
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
  const { fmtKrw, fmtSignedPercent } = formatters;
  const { renderDonutCenterLabel, renderDonutSliceLabels } = renderers;

  return (
    <details ref={holdingSummaryCardRef} className="card compact-support-card holding-summary-card surface-support-card" open={holdingSummaryOpen} onToggle={handleHoldingSummaryToggle}>
      <summary onClick={handleHoldingSummarySummaryClick}>
        <span>자산 포트폴리오 차트 {holdingSummaryOpen ? "접기" : "열기"}</span>
      </summary>
      <div className="compact-support-grid">
        <section className="compact-support-section">
          <div className="inline compact-support-header asset-portfolio-chart-header">
            <h3>자산 포트폴리오</h3>
            <label className="compact-inline-select asset-portfolio-chart-select">
              보기 기준
              <select aria-label="자산 요약 보기 기준" value={holdingSummaryViewMode} onChange={(event) => updateHoldingSummaryViewMode(event.target.value)}>
                <option value="type">자산 유형</option>
                <option value="category">자산 분류</option>
                <option value="owner">보유자</option>
              </select>
            </label>
          </div>
          <div className="asset-portfolio-metrics" aria-label="자산 포트폴리오 핵심 지표">
            <div><span>총 평가금액</span><strong>{fmtKrw(portfolio?.total_market_value_krw)}</strong></div>
            <div data-tone={holdingPortfolioGainTone}><span>평가손익</span><strong>{fmtKrw(portfolio?.total_gain_loss_krw)}</strong></div>
            <div data-tone={holdingPortfolioGainTone}><span>수익률</span><strong>{fmtSignedPercent(holdingPortfolioReturnRatio)}</strong></div>
          </div>
          <div className={`chart-wrap compact-chart-wrap${holdingPortfolioChartData ? "" : " chart-wrap-empty"}`}>
            {holdingPortfolioChartData ? (
              <>
                <Doughnut data={holdingPortfolioChartData} options={donutChartOptions} role="img" aria-label={holdingPortfolioChartDescription} />
                {renderDonutSliceLabels(holdingPortfolioChartSource.items, { testId: "portfolio-donut-slice-label", labelPrefix: holdingPortfolioChartSource.title })}
                {renderDonutCenterLabel(holdingPortfolioCenterLabel, { testId: "portfolio-donut-center-label", labelPrefix: "자산 포트폴리오" })}
              </>
            ) : (
              <p>표시할 포트폴리오 데이터가 없습니다.</p>
            )}
          </div>
          <ChartBreakdownList
            items={holdingPortfolioBreakdownItems}
            ariaLabel={`${holdingPortfolioChartSource.title} 평가금액`}
            testId="holding-portfolio-breakdown"
            activeKey={holdingTypeFilter}
            onItemAction={holdingPortfolioBreakdownCanFilter ? (item) => updateHoldingTypeFilter((current) => (current === item.key ? "all" : item.key)) : undefined}
          />
          {holdingTypeFilter !== "all" && (
            <button type="button" className="secondary portfolio-filter-reset" onClick={() => updateHoldingTypeFilter("all")}>자산 유형 필터 해제</button>
          )}
        </section>
        <section className="compact-support-section">
          <div className="inline compact-support-header">
            <h3>{holdingSummarySource.title} 상위 항목</h3>
            <span className="table-summary">상위 {Math.min(holdingSummarySource.items.length, 5)}개</span>
          </div>
          <div className="settings-category-list">
            {holdingSummarySource.items.length === 0 ? (
              <p className="table-summary">표시할 카테고리 합계가 없습니다.</p>
            ) : (
              holdingSummarySource.items.slice(0, 5).map((item) => (
                <div key={item.label} className="settings-category-row compact-category-row">
                  <span className="settings-category-major">{item.label}</span>
                  <span className="settings-category-minor">{fmtKrw(item.value)}</span>
                  <span className="settings-category-usage">{holdingSummarySource.title}</span>
                  <span />
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </details>
  );
}
