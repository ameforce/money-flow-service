export function HouseholdSettingsCard({ permissions, householdAdmin, categoryLists }) {
  const { canManageHousehold } = permissions;
  const { household, householdRoleLabel, householdSettings, householdSettingsForm, saveHouseholdSettings, updateHouseholdSettingsForm } = householdAdmin;
  const { settingsPermissionLabel } = categoryLists;

  return (
    <article className="card secondary-surface-card settings-household-card">
      <div className="secondary-surface-header">
        <div className="work-surface-title">
          <span className="surface-eyebrow">공유 환경</span>
          <h2>가계 설정</h2>
        </div>
        <div className="surface-control-strip secondary-control-strip" aria-label="가계 설정 상태">
          <span className="surface-chip surface-chip-strong">{settingsPermissionLabel}</span>
          <span className="surface-chip">내 권한 {householdRoleLabel}</span>
        </div>
      </div>
      <form className="form-grid settings-form-grid" onSubmit={saveHouseholdSettings}>
        <label>
          가계 이름
          <input value={householdSettingsForm.name} onChange={(event) => updateHouseholdSettingsForm((prev) => ({ ...prev, name: event.target.value }))} required />
        </label>
        <div className="settings-preview">현재 기준 통화: <strong>{householdSettings?.base_currency || household?.base_currency || "KRW"}</strong></div>
        <div className="inline form-actions settings-actions">
          <button type="submit" disabled={!canManageHousehold}>가계 설정 저장</button>
        </div>
      </form>
      {!canManageHousehold && <p className="table-summary">가계 이름과 공통 색상은 공동 소유자 이상 권한에서만 변경할 수 있습니다.</p>}
    </article>
  );
}
