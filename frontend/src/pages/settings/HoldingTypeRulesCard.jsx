export function HoldingTypeRulesCard({ constants, permissions, householdAdmin, holdingTypes }) {
  const { ASSET_TYPE_OPTIONS } = constants;
  const { canManageHousehold } = permissions;
  const { householdSettingsForm, saveHouseholdSettings } = householdAdmin;
  const {
    clearHoldingTypeDraft,
    editHoldingType,
    holdingCategoryNames,
    holdingOwnerNames,
    holdingTypeDraft,
    holdingTypeEditKey,
    holdingTypeOptions,
    moveHoldingTypeOrder,
    removeHoldingTypeDefinition,
    saveHoldingTypeDefinition,
    updateHoldingColorInForm,
    updateHoldingTypeDraft,
  } = holdingTypes;

  return (
    <details className="card compact-support-card settings-span-full settings-advanced-card secondary-surface-card settings-asset-rules-card">
      <summary role="button">
        <span className="settings-disclosure-main">
          <span>자산 유형/색상 설정</span>
          <span className="table-summary">유형 편집, 색상, 표시 규칙은 접어 둡니다.</span>
        </span>
        <span className="settings-disclosure-chip settings-disclosure-chip-collapsed">펼치기</span>
        <span className="settings-disclosure-chip settings-disclosure-chip-expanded">접기</span>
      </summary>
      <form className="form-grid settings-form-grid" onSubmit={saveHoldingTypeDefinition} noValidate>
        <label>유형 키<input value={holdingTypeDraft.key} onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, key: event.target.value }))} placeholder="예: deposit" required /></label>
        <label>유형 이름<input value={holdingTypeDraft.label} onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, label: event.target.value }))} placeholder="예: 예적금" required /></label>
        <label>
          기준 asset_type
          <select value={holdingTypeDraft.asset_type} onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, asset_type: event.target.value }))}>
            {ASSET_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="check-row"><input type="checkbox" checked={holdingTypeDraft.tracked} onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, tracked: event.target.checked }))} />시장 추적형 유형</label>
        <label className="check-row"><input type="checkbox" checked={holdingTypeDraft.show_average_cost} onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, show_average_cost: event.target.checked }))} />평균단가/평가금액 입력 표시</label>
        <label className="check-row"><input type="checkbox" checked={holdingTypeDraft.show_gain_loss} onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, show_gain_loss: event.target.checked }))} />손익 표시</label>
        <div className="inline form-actions settings-actions">
          <button type="submit" disabled={!canManageHousehold}>{holdingTypeEditKey ? "유형 수정 저장" : "유형 추가"}</button>
          <button type="button" className="secondary" onClick={clearHoldingTypeDraft}>입력 초기화</button>
        </div>
      </form>
      <div className="settings-category-list">
        {holdingTypeOptions.map((typeItem) => (
          <div key={typeItem.key} className="settings-category-row">
            <span className="settings-category-major">{typeItem.label}</span>
            <span className="settings-category-minor">{typeItem.key}</span>
            <span className="settings-category-usage">{typeItem.asset_type}</span>
            <div className="inline">
              <button type="button" className="secondary settings-type-order-btn" aria-label={`${typeItem.label} 유형 순서 올리기`} onClick={() => moveHoldingTypeOrder(typeItem.key, -1).catch(() => undefined)}>↑</button>
              <button type="button" className="secondary settings-type-order-btn" aria-label={`${typeItem.label} 유형 순서 내리기`} onClick={() => moveHoldingTypeOrder(typeItem.key, 1).catch(() => undefined)}>↓</button>
              <button type="button" className="secondary" onClick={() => editHoldingType(typeItem)}>수정</button>
              <button type="button" className="danger" onClick={() => removeHoldingTypeDefinition(typeItem.key).catch(() => undefined)}>삭제</button>
            </div>
          </div>
        ))}
      </div>
      <form className="settings-color-form" onSubmit={saveHouseholdSettings}>
        {holdingTypeOptions.map((typeItem) => (
          <ColorRow key={`type-color-${typeItem.key}`} label={`유형 색상 · ${typeItem.label}`} value={householdSettingsForm.holding_settings?.type_colors?.[typeItem.key] || "#E2E8F0"} disabled={!canManageHousehold} onChange={(value) => updateHoldingColorInForm("type_colors", typeItem.key, value)} />
        ))}
        {holdingOwnerNames.map((ownerName) => (
          <ColorRow key={`owner-color-${ownerName}`} label={`보유자 색상 · ${ownerName}`} value={householdSettingsForm.holding_settings?.owner_colors?.[ownerName] || "#E2E8F0"} disabled={!canManageHousehold} onChange={(value) => updateHoldingColorInForm("owner_colors", ownerName, value)} />
        ))}
        {holdingCategoryNames.map((categoryName) => (
          <ColorRow key={`category-color-${categoryName}`} label={`카테고리 색상 · ${categoryName}`} value={householdSettingsForm.holding_settings?.category_colors?.[categoryName] || "#E2E8F0"} disabled={!canManageHousehold} onChange={(value) => updateHoldingColorInForm("category_colors", categoryName, value)} />
        ))}
        <div className="inline form-actions settings-actions">
          <button type="submit" disabled={!canManageHousehold}>자산 설정 저장</button>
        </div>
      </form>
      {!canManageHousehold && <p className="table-summary">자산 유형/색상 설정은 공동 소유자 이상 권한에서만 변경할 수 있습니다.</p>}
    </details>
  );
}

function ColorRow({ label, value, disabled, onChange }) {
  return (
    <label className="settings-color-row">
      <span>{label}</span>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      <code>{value}</code>
    </label>
  );
}
