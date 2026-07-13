export function HoldingEntryPanel({ constants, permissions, entryState, entryActions, entryLookups, renderers }) {
  const { DEFAULT_HOLDING_TYPES } = constants;
  const { canEditRecords, isCompactViewport } = permissions;
  const { holdingEntryActionRef, holdingEntrySheetBackdropRef, holdingEntrySheetRef, holdingForm, holdingFormOwnerOptions, holdingFormShowAverageCost, holdingFormTracked, holdingFormType, holdingNameInputRef, showHoldingForm } = entryState;
  const { closeHoldingEntrySheet, openHoldingEntrySheet, submitHolding } = entryActions;

  return (
    <>
      {isCompactViewport && showHoldingForm && (
        <div ref={holdingEntrySheetBackdropRef} className="holding-entry-sheet-backdrop" data-testid="holding-entry-sheet-backdrop" aria-hidden="true" onClick={closeHoldingEntrySheet} />
      )}
      <article ref={holdingEntrySheetRef} className={`card surface-entry-card holding-entry-card${isCompactViewport && showHoldingForm ? " holding-entry-sheet" : ""}`} data-testid={isCompactViewport && showHoldingForm ? "holding-entry-sheet" : undefined} role={isCompactViewport && showHoldingForm ? "dialog" : undefined} aria-modal={isCompactViewport && showHoldingForm ? "true" : undefined} aria-label={isCompactViewport && showHoldingForm ? "자산 추가 레이어" : undefined}>
        <div className="work-surface-header">
          <div className="work-surface-title">
            <span className="surface-eyebrow">자산 입력 흐름</span>
            <h2>자산 입력</h2>
          </div>
          <button type="button" className="secondary" ref={holdingEntryActionRef} data-testid={isCompactViewport && showHoldingForm ? "holding-entry-sheet-close" : undefined} onClick={(event) => (showHoldingForm ? closeHoldingEntrySheet() : openHoldingEntrySheet(event))}>
            {showHoldingForm ? "입력 닫기" : "자산 추가"}
          </button>
        </div>
        <p className="table-summary">필요할 때만 입력창을 엽니다.</p>
        <div className="surface-control-strip" role="group" aria-label="자산 입력 상태">
          <span className="surface-chip surface-chip-strong">{canEditRecords ? "편집 가능" : "읽기 전용"}</span>
          <span className="surface-chip">유형·보유자·계좌 정리</span>
          <span className="surface-chip surface-chip-muted">평가금액 자동 정렬</span>
        </div>
        {!canEditRecords && <p className="table-summary">자산 등록/수정/삭제는 편집자 이상 권한에서만 가능합니다.</p>}
        {showHoldingForm && (
          <div className="holdings-form-container">
            <form className="holdings-form-grid" onSubmit={submitHolding} noValidate>
              <HoldingFormFields
                constants={{ DEFAULT_HOLDING_TYPES }}
                permissions={{ canEditRecords }}
                entryState={{ holdingForm, holdingFormOwnerOptions, holdingFormShowAverageCost, holdingFormTracked, holdingFormType, holdingNameInputRef }}
                entryActions={entryActions}
                entryLookups={entryLookups}
                renderers={renderers}
              />
            </form>
          </div>
        )}
      </article>
    </>
  );
}

function HoldingFormFields({ constants, permissions, entryState, entryActions, entryLookups, renderers }) {
  const { DEFAULT_HOLDING_TYPES } = constants;
  const { canEditRecords } = permissions;
  const { holdingForm, holdingFormOwnerOptions, holdingFormShowAverageCost, holdingFormTracked, holdingFormType, holdingNameInputRef } = entryState;
  const { createHoldingForm, handleHoldingEntryDecimalInput, nextAverageCostForHoldingTypeChange, ownerSelectionFromValue, resolveHoldingCategoryOnTypeChange, shouldExplainHoldingValueReset, uiGuideMessage, updateHoldingDraftTouched, updateHoldingForm, updateHoldingOwnerTouched, notifyMessage } = entryActions;
  const { holdingTypeByKey, holdingTypeOptions, holdingValuationInputMode, normalizeHoldingTypeKey, ownerSelectValue } = entryLookups;
  const { renderLegacyOwnerRemapHelper, renderOwnerQuickSelect } = renderers;

  return (
    <>
      <div className="holdings-form-fields">
        <label>
          유형
          <select
            value={holdingForm.type_key}
            disabled={!canEditRecords}
            onChange={(event) => {
              updateHoldingDraftTouched(true);
              const nextTypeKey = normalizeHoldingTypeKey(event.target.value || "");
              const nextType = holdingTypeByKey.get(nextTypeKey) || holdingTypeOptions[0] || DEFAULT_HOLDING_TYPES[0];
              const previousType = holdingTypeByKey.get(normalizeHoldingTypeKey(holdingForm.type_key || holdingForm.asset_type || "")) || holdingFormType;
              if (shouldExplainHoldingValueReset(holdingForm.average_cost, previousType, nextType)) {
                notifyMessage(uiGuideMessage("자산 유형을 변경했습니다.", "평가금액과 평균단가의 의미가 달라 금액 입력값을 비웠습니다."));
              }
              updateHoldingForm((prev) => ({
                ...createHoldingForm(nextType.asset_type || "other", nextType.key, nextType.label),
                name: prev.name,
                category: resolveHoldingCategoryOnTypeChange(prev.category, previousType, nextType),
                owner_user_id: prev.owner_user_id,
                owner_name: prev.owner_name,
                account_name: prev.account_name,
                average_cost: nextAverageCostForHoldingTypeChange(prev.average_cost, previousType, nextType),
              }));
            }}
          >
            {holdingTypeOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label>자산명<textarea rows={2} ref={holdingNameInputRef} value={holdingForm.name} onChange={(event) => { updateHoldingDraftTouched(true); updateHoldingForm({ ...holdingForm, name: event.target.value }); }} disabled={!canEditRecords} required /></label>
        <div className="settings-preview">선택 유형: <strong>{holdingFormType?.label || "-"}</strong></div>
        <label>카테고리<input value={holdingForm.category} onChange={(event) => { updateHoldingDraftTouched(true); updateHoldingForm({ ...holdingForm, category: event.target.value }); }} disabled={!canEditRecords} /></label>
        <label>
          보유자
          <select value={ownerSelectValue(holdingForm.owner_user_id, holdingForm.owner_name)} disabled={!canEditRecords} onChange={(event) => { updateHoldingOwnerTouched(true); updateHoldingDraftTouched(true); updateHoldingForm({ ...holdingForm, ...ownerSelectionFromValue(event.target.value, holdingFormOwnerOptions) }); }}>
            <option value="">(선택 안함)</option>
            {holdingFormOwnerOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {renderOwnerQuickSelect({ ownerLabel: "보유자", testId: "holding-owner-quick-select", selectedValue: holdingForm.owner_user_id, disabled: !canEditRecords, onSelect: entryActions.applyHoldingOwnerOption })}
        {renderLegacyOwnerRemapHelper({ ownerUserId: holdingForm.owner_user_id, ownerName: holdingForm.owner_name, disabled: !canEditRecords, onApply: (target) => { updateHoldingOwnerTouched(true); updateHoldingDraftTouched(true); updateHoldingForm((prev) => ({ ...prev, owner_user_id: target.value, owner_name: target.displayName })); } })}
        <HoldingValueFields entryState={{ holdingForm, holdingFormShowAverageCost, holdingFormTracked }} entryActions={{ handleHoldingEntryDecimalInput, updateHoldingDraftTouched, updateHoldingForm }} entryLookups={{ holdingValuationInputMode }} permissions={{ canEditRecords }} />
        <label>계좌<input value={holdingForm.account_name} onChange={(event) => { updateHoldingDraftTouched(true); updateHoldingForm({ ...holdingForm, account_name: event.target.value }); }} disabled={!canEditRecords} /></label>
        <label>통화<input value={holdingForm.currency} onChange={(event) => { updateHoldingDraftTouched(true); updateHoldingForm({ ...holdingForm, currency: event.target.value.toUpperCase() }); }} disabled={!canEditRecords} required /></label>
      </div>
      <div className="holdings-form-actions">
        <button type="button" className="secondary" disabled={!canEditRecords} onClick={() => { updateHoldingOwnerTouched(false); updateHoldingDraftTouched(false); updateHoldingForm(createHoldingForm(holdingForm.asset_type, holdingForm.type_key, holdingFormType?.label)); }}>
          초기화
        </button>
        <button type="submit" className="primary" disabled={!canEditRecords}>자산 등록</button>
      </div>
    </>
  );
}

function HoldingValueFields({ entryState, entryActions, entryLookups, permissions }) {
  const { holdingForm, holdingFormShowAverageCost, holdingFormTracked } = entryState;
  const { handleHoldingEntryDecimalInput, updateHoldingDraftTouched, updateHoldingForm } = entryActions;
  const { holdingValuationInputMode } = entryLookups;
  const { canEditRecords } = permissions;

  if (holdingFormTracked) {
    return (
      <>
        <label>심볼<input value={holdingForm.symbol} onChange={(event) => { updateHoldingDraftTouched(true); updateHoldingForm({ ...holdingForm, symbol: event.target.value }); }} disabled={!canEditRecords} required /></label>
        <label>시장심볼<input value={holdingForm.market_symbol} onChange={(event) => { updateHoldingDraftTouched(true); updateHoldingForm({ ...holdingForm, market_symbol: event.target.value }); }} disabled={!canEditRecords} /></label>
        <label>수량<input type="text" inputMode="decimal" value={holdingForm.quantity} onChange={(event) => handleHoldingEntryDecimalInput(event, "quantity")} disabled={!canEditRecords} required /></label>
        {holdingFormShowAverageCost && (
          <label>평균단가<input type="text" inputMode="decimal" value={holdingForm.average_cost} onChange={(event) => handleHoldingEntryDecimalInput(event, "average_cost")} disabled={!canEditRecords} required /></label>
        )}
      </>
    );
  }
  if (!holdingFormShowAverageCost) {
    return <div className="settings-preview">선택한 유형은 평균단가/손익 입력이 필요하지 않습니다.</div>;
  }
  return (
    <label>
      평가금액
      <input type="text" inputMode={holdingValuationInputMode(holdingForm.currency)} value={holdingForm.average_cost} onChange={(event) => handleHoldingEntryDecimalInput(event, "average_cost")} disabled={!canEditRecords} required />
    </label>
  );
}
