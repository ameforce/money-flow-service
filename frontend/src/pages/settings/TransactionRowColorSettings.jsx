export function TransactionRowColorSettings({ constants, permissions, householdAdmin }) {
  const { DEFAULT_TRANSACTION_ROW_COLORS, FLOW_TYPE_OPTIONS } = constants;
  const { canManageHousehold } = permissions;
  const { householdSettingsForm, saveHouseholdSettings, updateHouseholdSettingsForm } = householdAdmin;

  return (
    <details className="card compact-support-card settings-advanced-card secondary-surface-card">
      <summary role="button">
        <span className="settings-disclosure-main">
          <span>거래 행 색상</span>
          <span className="table-summary">기본 화면에서는 숨기고 필요할 때만 조정합니다.</span>
        </span>
        <span className="settings-disclosure-chip settings-disclosure-chip-collapsed">펼치기</span>
        <span className="settings-disclosure-chip settings-disclosure-chip-expanded">접기</span>
      </summary>
      <form className="settings-color-form" onSubmit={saveHouseholdSettings}>
        {FLOW_TYPE_OPTIONS.map((option) => {
          const colorValue = householdSettingsForm.transaction_row_colors?.[option.value] || DEFAULT_TRANSACTION_ROW_COLORS[option.value];
          return (
            <label key={option.value} className="settings-color-row">
              <span>{option.label}</span>
              <span className="settings-color-preview-bar" style={{ "--settings-color-preview": colorValue }} aria-hidden="true" />
              <input
                type="color"
                value={colorValue}
                onChange={(event) => updateHouseholdSettingsForm((prev) => ({
                  ...prev,
                  transaction_row_colors: { ...prev.transaction_row_colors, [option.value]: event.target.value.toUpperCase() },
                }))}
                disabled={!canManageHousehold}
              />
              <code>{colorValue}</code>
            </label>
          );
        })}
        <div className="inline form-actions settings-actions">
          <button type="submit" disabled={!canManageHousehold}>색상 저장</button>
        </div>
      </form>
    </details>
  );
}
