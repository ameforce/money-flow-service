export function DashboardSideCards({ constants, summary, formatters, navigation }) {
  const { COLLAB_ROLE_LABELS, FLOW_TYPE_LABELS, SOCKET_STATUS_LABELS } = constants;
  const {
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
  } = summary;
  const { extractVisibleInitial, fmt, fmtDate, fmtDateTime, fmtKrw, toCategoryPairLabel } = formatters;
  const { navigateToTab } = navigation;

  return (
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
        <button type="button" className="text-button dashboard-card-footer-action" onClick={() => navigateToTab("transactions")}>전체 보기</button>
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
        <button type="button" className="text-button dashboard-card-footer-action" onClick={() => navigateToTab("holdings")}>전체 보기</button>
      </article>
    </div>
  );
}
