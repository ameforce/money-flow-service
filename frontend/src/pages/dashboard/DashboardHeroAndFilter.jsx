export function DashboardHeroCard({ constants, filters, summary, portfolioView, formatters }) {
  const { FINANCIAL_SUMMARY_LABELS } = constants;
  const { filterMode, range, yearMonth } = filters;
  const {
    dashboardGainLossRatioText,
    dashboardKpiCards,
    dashboardLoading,
    dashboardPriceTone,
    isDashboardInitialLoading,
    priceSummaryRows,
  } = summary;
  const { portfolio } = portfolioView;
  const { fmtKrw } = formatters;

  return (
    <>
      {isDashboardInitialLoading && (
        <div className="dashboard-loading-banner" role="status" aria-live="polite">
          대시보드 데이터를 불러오는 중입니다.
        </div>
      )}
      <article className="card summary-card dashboard-hero-card">
        <div className="dashboard-hero-copy">
          <span className="dashboard-eyebrow">요약</span>
          <h2>요약</h2>
          <p>
            {filterMode === "month"
              ? `${yearMonth.year}년 ${yearMonth.month}월 기준으로 현금흐름과 자산 상태를 한눈에 확인합니다.`
              : `${range.start || "시작일"}부터 ${range.end || "종료일"}까지의 흐름을 요약합니다.`}
          </p>
        </div>
        <div className="dashboard-hero-metric" data-tone={Number(portfolio?.total_gain_loss_krw || 0) >= 0 ? "positive" : "negative"}>
          <span>총자산(KRW)</span>
          <strong>{fmtKrw(portfolio?.total_market_value_krw)}</strong>
          <small>평가손익 {fmtKrw(portfolio?.total_gain_loss_krw)} <b>{dashboardGainLossRatioText}</b></small>
        </div>
        <div className="dashboard-kpi-grid" aria-busy={dashboardLoading ? "true" : "false"}>
          {isDashboardInitialLoading
            ? FINANCIAL_SUMMARY_LABELS.map((label) => (
                <div key={label} className="dashboard-kpi-card summary-placeholder">
                  <span>{label}</span>
                  <strong>불러오는 중...</strong>
                </div>
              ))
            : dashboardKpiCards.map((item) => (
                <div key={item.label} className="dashboard-kpi-card" data-tone={item.tone}>
                  <span>{item.label}</span>
                  <strong className={item.meta ? "dashboard-kpi-value-line" : undefined}>
                    <span className="dashboard-kpi-value-main">{item.value}</span>
                    {item.meta && <em className="dashboard-kpi-value-meta">{item.meta}</em>}
                  </strong>
                  <small>{item.helper}</small>
                </div>
              ))}
        </div>
        <div className="dashboard-market-strip">
          {priceSummaryRows.map((item) => (
            <div key={item.label} data-tone={item.label === "시세 갱신 상태" ? dashboardPriceTone : undefined}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </article>
    </>
  );
}

export function DashboardFilterCard({ filters }) {
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

  return (
    <article className="card filter-card dashboard-filter-card">
      <div className="dashboard-filter-heading">
        <span className="dashboard-eyebrow">기간 필터</span>
        <strong>{filterMode === "month" ? "월별 리포트" : "기간 리포트"}</strong>
      </div>
      <div className="filter-container">
        <div className="filter-modes-segmented">
          <button className={filterMode === "month" ? "active" : ""} onClick={() => applyMonthFilter(yearMonth)}>월별</button>
          <button className={filterMode === "range" ? "active" : ""} onClick={handleSwitchToRangeFilter}>기간</button>
        </div>
        <div className="filter-inputs-wrapper">
          {filterMode === "month" ? (
            <>
              <div className="month-stepper">
                <button type="button" className="icon-btn" aria-label="이전 달" disabled={isPrevMonthDisabled} onClick={() => handleShiftYearMonth(-1)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <div className="date-inputs">
                  <span className="month-value-group">
                    <input type="number" aria-label="연도" value={yearMonth.year} onChange={(e) => updateYearMonthInput("year", e.target.value)} onKeyDown={handleYearMonthInputKeyDown} enterKeyHint="done" />
                    <span aria-hidden="true">년</span>
                  </span>
                  <span className="month-value-group month-value-group-month">
                    <input type="number" min="1" max="12" aria-label="월" value={yearMonth.month} onChange={(e) => updateYearMonthInput("month", e.target.value)} onKeyDown={handleYearMonthInputKeyDown} enterKeyHint="done" />
                    <span aria-hidden="true">월</span>
                  </span>
                </div>
                <button type="button" className="icon-btn" aria-label="다음 달" disabled={isNextMonthDisabled} onClick={() => handleShiftYearMonth(1)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
                <button type="button" className="text-btn" onClick={handleMoveToCurrentMonth}>이번 달</button>
              </div>
              {isMonthFilterPending && (
                <p className="filter-pending-status" data-testid="transaction-month-pending-status" aria-live="polite">
                  변경됨 · Enter로 조회 적용
                </p>
              )}
            </>
          ) : (
            <div className="range-filter-stack">
              <div className="range-picker">
                <label className="range-date-field">
                  <span className="range-date-label">시작일</span>
                  <input type="date" aria-label="시작일" value={range.start} onChange={(e) => handleRangeInputChange("start", e.target.value)} enterKeyHint="done" />
                  <span className="range-date-value" aria-hidden="true">{range.start}</span>
                </label>
                <span className="range-separator">~</span>
                <label className="range-date-field">
                  <span className="range-date-label">종료일</span>
                  <input type="date" aria-label="종료일" value={range.end} onChange={(e) => handleRangeInputChange("end", e.target.value)} enterKeyHint="done" />
                  <span className="range-date-value" aria-hidden="true">{range.end}</span>
                </label>
              </div>
              <div className="range-preset-row" aria-label="기간 빠른 선택">
                <button type="button" onClick={() => handleRangePreset("current_month")}>이번 달</button>
                <button type="button" onClick={() => handleRangePreset("recent_30")}>최근 30일</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
