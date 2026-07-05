export function TransactionsSupportCard({ constants, categoryManager, support, breakdown, formatters }) {
  const { FLOW_TYPE_LABELS } = constants;
  const { renderTransactionCategoryManagerContent, showTxCategoryManager, toggleTransactionCategoryManager, txCategoryManagerRef, updateShowTxCategoryManager } = categoryManager;
  const { transactionSupportDetailsRef, transactionSupportOpen, updateTransactionSupportOpen } = support;
  const { txFlowBreakdownExpanded, txFlowSummaryCards, updateTxFlowBreakdownExpanded } = breakdown;
  const { fmtKrw, formatSharePercent } = formatters;

  return (
    <details
      ref={transactionSupportDetailsRef}
      className="card compact-support-card transaction-support-card surface-support-card"
      open={transactionSupportOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        updateTransactionSupportOpen(nextOpen);
        if (!nextOpen) updateShowTxCategoryManager(false);
      }}
    >
      <summary>분석·관리 {transactionSupportOpen ? "접기" : "열기"}</summary>
      <p className="table-summary compact-support-summary">집계와 카테고리 관리는 필요할 때만 펼쳐 확인합니다. 포트폴리오와 자산 요약은 자산 탭으로 이동했습니다.</p>
      <div className="compact-support-grid">
        <section className="compact-support-section">
          <div className="inline compact-support-header">
            <h3>유형별 카테고리 집계</h3>
            <span className="table-summary">수입·지출·투자 흐름 요약</span>
          </div>
          <div className="settings-category-flows compact-flow-stack">
            {txFlowSummaryCards.map((flowSummary) => {
              const expanded = Boolean(txFlowBreakdownExpanded[flowSummary.flowType]);
              return (
                <FlowSummaryCard
                  key={flowSummary.flowType}
                  expanded={expanded}
                  flowSummary={flowSummary}
                  FLOW_TYPE_LABELS={FLOW_TYPE_LABELS}
                  fmtKrw={fmtKrw}
                  formatSharePercent={formatSharePercent}
                  updateTxFlowBreakdownExpanded={updateTxFlowBreakdownExpanded}
                />
              );
            })}
          </div>
        </section>
        <section ref={txCategoryManagerRef} className="compact-support-section">
          <div className="inline compact-support-header">
            <h3>거래 탭 카테고리 관리</h3>
            <button type="button" className="secondary" onClick={() => toggleTransactionCategoryManager()}>
              {showTxCategoryManager ? "닫기" : "열기"}
            </button>
          </div>
          {showTxCategoryManager ? renderTransactionCategoryManagerContent() : (
            <p className="table-summary compact-support-summary">필요할 때만 열어 추가·수정·삭제를 진행합니다.</p>
          )}
        </section>
      </div>
    </details>
  );
}

function FlowSummaryCard({ expanded, flowSummary, FLOW_TYPE_LABELS, fmtKrw, formatSharePercent, updateTxFlowBreakdownExpanded }) {
  return (
    <div className="settings-category-flow compact-flow-card">
      <button
        type="button"
        className={`secondary compact-flow-toggle${expanded ? " is-expanded" : ""}`}
        data-testid={`tx-flow-summary-toggle-${flowSummary.flowType}`}
        aria-expanded={expanded}
        aria-label={`${FLOW_TYPE_LABELS[flowSummary.flowType] || flowSummary.flowType} 카테고리 집계 ${expanded ? "접기" : "상세 보기"}`}
        onClick={() => updateTxFlowBreakdownExpanded((prev) => ({ ...prev, [flowSummary.flowType]: !expanded }))}
      >
        <span className="tx-flow-summary-line" data-testid="tx-flow-summary-line">
          <strong>{FLOW_TYPE_LABELS[flowSummary.flowType] || flowSummary.flowType}</strong>
          <span>{fmtKrw(flowSummary.total)}</span>
          <span>전체 {flowSummary.totalShareText}</span>
        </span>
        <span className="compact-flow-toggle-meta">
          대표 {flowSummary.leadingCategoryLabel} {flowSummary.leadingCategoryShareText}
        </span>
      </button>
      {expanded && <FlowSummaryDetail flowSummary={flowSummary} fmtKrw={fmtKrw} formatSharePercent={formatSharePercent} />}
    </div>
  );
}

function FlowSummaryDetail({ flowSummary, fmtKrw, formatSharePercent }) {
  const categoryRows = flowSummary.categories.map((categoryItem) => {
    const amountShare = flowSummary.total > 0 ? (Number(categoryItem.amount || 0) / flowSummary.total) * 100 : 0;
    return { categoryItem, amountShare };
  });

  return (
    <div className="compact-flow-detail-panel" data-testid={`tx-flow-summary-panel-${flowSummary.flowType}`}>
      <div className="compact-flow-detail-metrics">
        <span>합계 {fmtKrw(flowSummary.total)}</span>
        <span>전체 대비 {flowSummary.totalShareText}</span>
        <span>대표 카테고리 {flowSummary.leadingCategoryLabel} {flowSummary.leadingCategoryShareText}</span>
      </div>
      <div className="compact-flow-chart" data-testid={`tx-flow-summary-chart-${flowSummary.flowType}`}>
        {categoryRows.length === 0 ? (
          <p className="table-summary">집계된 카테고리가 없습니다.</p>
        ) : (
          categoryRows.slice(0, 5).map(({ categoryItem, amountShare }) => (
            <div key={`${flowSummary.flowType}:${categoryItem.label}`} className="compact-flow-chart-row">
              <div className="compact-flow-chart-copy">
                <strong>{categoryItem.label}</strong>
                <span>{fmtKrw(categoryItem.amount)} · {formatSharePercent(amountShare)}</span>
              </div>
              <div className="compact-flow-chart-bar-track" aria-hidden="true">
                <span className={`compact-flow-chart-bar compact-flow-chart-bar-${flowSummary.flowType}`} style={{ width: `${Math.max(amountShare, 6)}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
      <div className="settings-category-list">
        {categoryRows.length === 0 ? (
          <p className="table-summary">집계된 카테고리가 없습니다.</p>
        ) : (
          categoryRows.map(({ categoryItem, amountShare }) => (
            <div key={`${flowSummary.flowType}:${categoryItem.label}`} className="settings-category-row">
              <span className="settings-category-major">{categoryItem.label}</span>
              <span className="settings-category-minor">{fmtKrw(categoryItem.amount)}</span>
              <span className="settings-category-usage">{formatSharePercent(amountShare)}</span>
              <span />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
