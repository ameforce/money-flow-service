export function HouseholdSwitchCard({ constants, householdAdmin, categoryActions }) {
  const { COLLAB_ROLE_LABELS } = constants;
  const { handleHouseholdSwitchChange, household, householdList, householdRole, householdSwitchDisabled } = householdAdmin;
  const { renderBreakableInlineText } = categoryActions;

  return (
    <article className="card secondary-surface-card settings-switch-card">
      <div className="secondary-surface-header">
        <div className="work-surface-title">
          <span className="surface-eyebrow">작업 컨텍스트</span>
          <h2>작업 가계 전환</h2>
        </div>
        <div className="surface-control-strip secondary-control-strip" aria-label="작업 가계 전환 상태">
          <span className="surface-chip surface-chip-strong">{householdList.length}개 가계</span>
          <span className="surface-chip">현재 {household?.name || "-"}</span>
        </div>
      </div>
      <div className="settings-household-switch">
        <label>
          작업 가계
          <select id="settings-household-select" className="household-select" value={household?.id || ""} onChange={handleHouseholdSwitchChange} disabled={householdSwitchDisabled} aria-describedby="settings-household-select-summary">
            {householdList.length === 0 && <option value="">선택 가능한 가계 없음</option>}
            {householdList.map((entry) => <option key={entry.household.id} value={entry.household.id}>{entry.household.name}</option>)}
          </select>
        </label>
        <p className="table-summary settings-household-current-summary" id="settings-household-select-summary">
          <span className="settings-household-current-label">현재 작업 가계:</span>
          <span className="settings-household-current-name">{renderBreakableInlineText(household?.name || "-")}</span>
          <span className="settings-household-current-role">/ 내 권한: {COLLAB_ROLE_LABELS[householdRole] || householdRole || "-"}</span>
        </p>
      </div>
    </article>
  );
}
