import { Doughnut, Line } from "react-chartjs-2";
import { ChartBreakdownList, FlowTrendValueTable } from "../components/worksurface/ChartAccessibleSummary";

export function DashboardPage({ view }) {
  const {
    COLLAB_ROLE_LABELS,
    FINANCIAL_SUMMARY_LABELS,
    FLOW_TYPE_LABELS,
    PORTFOLIO_VIEW_OPTIONS,
    SOCKET_STATUS_LABELS,
    applyMonthFilter,
    categoryById,
    dashboardFlowChartDescription,
    dashboardFlowTrendRows,
    dashboardGainLossRatioText,
    dashboardHoldingHighlights,
    dashboardImportStatus,
    dashboardKpiCards,
    dashboardLoading,
    dashboardPortfolioBreakdownItems,
    dashboardPortfolioCenterLabel,
    dashboardPortfolioChartData,
    dashboardPortfolioChartDescription,
    dashboardPortfolioChartSource,
    dashboardPortfolioViewMode,
    dashboardPriceTone,
    dashboardRecentTransactions,
    donutChartOptions,
    extractVisibleInitial,
    filterMode,
    fmt,
    fmtDate,
    fmtDateTime,
    fmtKrw,
    handleMoveToCurrentMonth,
    handleRangeInputChange,
    handleRangePreset,
    handleShiftYearMonth,
    handleSwitchToRangeFilter,
    handleYearMonthInputKeyDown,
    householdMembers,
    importReport,
    isDashboardInitialLoading,
    isMonthFilterPending,
    isNextMonthDisabled,
    isPrevMonthDisabled,
    latestRefreshAt,
    lineChartOptions,
    portfolio,
    priceSummaryRows,
    range,
    refreshStateLabel,
    renderDonutCenterLabel,
    renderDonutSliceLabels,
    setDashboardPortfolioViewMode,
    setTab,
    socketStatus,
    toCategoryPairLabel,
    trendChartData,
    updateYearMonthInput,
    yearMonth,
  } = view;

  return (
    <section className="dashboard-command-center grid-2" aria-busy={dashboardLoading ? "true" : "false"}>
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
                              onChange={(e) => updateYearMonthInput("year", e.target.value)}
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
                              onChange={(e) => updateYearMonthInput("month", e.target.value)}
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
                        <button
                          type="button"
                          className="text-btn"
                          onClick={handleMoveToCurrentMonth}
                        >
                          이번 달
                        </button>
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
                            <input
                              type="date"
                              aria-label="시작일"
                              value={range.start}
                              onChange={(e) => handleRangeInputChange("start", e.target.value)}
                              enterKeyHint="done"
                            />
                            <span className="range-date-value" aria-hidden="true">{range.start}</span>
                          </label>
                          <span className="range-separator">~</span>
                          <label className="range-date-field">
                            <span className="range-date-label">종료일</span>
                            <input
                              type="date"
                              aria-label="종료일"
                              value={range.end}
                              onChange={(e) => handleRangeInputChange("end", e.target.value)}
                              enterKeyHint="done"
                            />
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
                      <select
                        aria-label="포트폴리오 보기 기준"
                        value={dashboardPortfolioViewMode}
                        disabled={dashboardLoading}
                        onChange={(event) => setDashboardPortfolioViewMode(event.target.value)}
                      >
                        {PORTFOLIO_VIEW_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div
                    className={`chart-wrap dashboard-donut-wrap${isDashboardInitialLoading || dashboardPortfolioChartData ? "" : " chart-wrap-empty"}`}
                    aria-label={dashboardPortfolioChartDescription}
                  >
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

              <div className="dashboard-side-grid">
                <article className="card dashboard-side-card dashboard-status-card">
                  <div className="dashboard-card-heading">
                    <div>
                      <span className="dashboard-eyebrow">상태</span>
                      <h2>가져오기 & 상태</h2>
                    </div>
                  </div>
                  <div className="dashboard-status-list">
                    <div>
                      <span>실시간 연결</span>
                      <strong>{SOCKET_STATUS_LABELS[socketStatus] || socketStatus}</strong>
                    </div>
                    <div data-tone={dashboardPriceTone}>
                      <span>시세 정산</span>
                      <strong>{refreshStateLabel}</strong>
                      <small>{latestRefreshAt ? fmtDateTime(latestRefreshAt) : "시세 갱신 기록 없음"}</small>
                    </div>
                    <div>
                      <span>가져오기 상태</span>
                      <strong>{dashboardImportStatus}</strong>
                      {importReport && <small>이슈 {fmt((importReport.issues || []).length)}건 · 수식 불일치 {fmt(importReport.monthly_formula_mismatch_count)}건</small>}
                    </div>
                  </div>
                </article>

                <article className="card dashboard-side-card dashboard-members-card">
                  <div className="dashboard-card-heading">
                    <div>
                      <span className="dashboard-eyebrow">협업</span>
                      <h2>협업 멤버</h2>
                    </div>
                    <span className="dashboard-chip">{fmt(householdMembers.length)}명</span>
                  </div>
                  <div className="dashboard-member-stack">
                    {householdMembers.length === 0 ? (
                      <p className="dashboard-empty-state">등록된 멤버가 없습니다.</p>
                    ) : (
                      householdMembers.slice(0, 5).map((member) => (
                        <div key={member.member_id || member.user_id || member.email} className="dashboard-member-row">
                          <span className="member-avatar" aria-hidden="true">{extractVisibleInitial(member.display_name || member.email || "?")}</span>
                          <div>
                            <strong>{member.display_name || member.email || "이름 없음"}</strong>
                            <small>{COLLAB_ROLE_LABELS[member.role] || member.role || "권한 없음"}</small>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </article>

                <article className="card dashboard-side-card dashboard-recent-card">
                  <div className="dashboard-card-heading">
                    <div>
                      <span className="dashboard-eyebrow">최근</span>
                      <h2>최근 거래</h2>
                    </div>
                  </div>
                  <div className="dashboard-activity-list">
                    {dashboardRecentTransactions.length === 0 ? (
                      <p className="dashboard-empty-state">최근 거래가 없습니다.</p>
                    ) : (
                      dashboardRecentTransactions.map((item) => {
                        const category = categoryById.get(String(item.category_id || ""));
                        return (
                          <div key={item.id} className="dashboard-activity-row" data-flow={item.flow_type}>
                            <div>
                              <strong>{item.memo || FLOW_TYPE_LABELS[item.flow_type] || "거래"}</strong>
                              <small>{fmtDate(item.occurred_on)} · {category ? toCategoryPairLabel(category) : "미분류"}</small>
                            </div>
                            <span>{fmtKrw(item.amount)}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <button type="button" className="text-button dashboard-card-footer-action" onClick={() => setTab("transactions")}>전체 보기</button>
                </article>

                <article className="card dashboard-side-card dashboard-holdings-card">
                  <div className="dashboard-card-heading">
                    <div>
                      <span className="dashboard-eyebrow">자산</span>
                      <h2>보유 자산</h2>
                    </div>
                  </div>
                  <div className="dashboard-activity-list holdings-highlight-list">
                    {dashboardHoldingHighlights.length === 0 ? (
                      <p className="dashboard-empty-state">보유 자산이 없습니다.</p>
                    ) : (
                      dashboardHoldingHighlights.map((item) => (
                        <div key={item.holding_id || item.id || item.name} className="dashboard-activity-row">
                          <div>
                            <strong>{item.name || item.symbol || "자산"}</strong>
                            <small>{item.owner_name || "보유자 미지정"} · {item.category || "기타"}</small>
                          </div>
                          <span>{fmtKrw(item.market_value_krw)}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <button type="button" className="text-button dashboard-card-footer-action" onClick={() => setTab("holdings")}>전체 보기</button>
                </article>
              </div>
            </section>
  );
}
