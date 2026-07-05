export function CategoryCreateForm({ constants, permissions, categoryDrafts, categoryActions }) {
  const { FLOW_TYPE_OPTIONS } = constants;
  const { canEditHouseholdData } = permissions;
  const { categoryDraft, categoryDraftGuideText, categoryDraftMajorOptions, categoryDraftMajorSelect, categoryDraftMinorOptions, categoryDraftMinorSelect, categoryDraftSummaryText } = categoryDrafts;
  const { createCategoryPair, toCategoryMajorLabel, toCategoryMinorLabel, updateCategoryDraft, updateCategoryDraftMajorSelect, updateCategoryDraftMinorSelect, updateCategoryQuickSelectedId } = categoryActions;

  return (
    <form className="form-grid settings-form-grid category-create-form" onSubmit={createCategoryPair} noValidate>
      <div className="settings-preview category-manager-guide">
        <strong>새 카테고리 만들기</strong>
        <span>{categoryDraftGuideText}</span>
        <span>생성 예정: {categoryDraftSummaryText}</span>
      </div>
      <label>
        유형
        <select
          value={categoryDraft.flow_type}
          onChange={(event) => {
            const nextFlowType = event.target.value;
            updateCategoryDraft((prev) => ({ ...prev, flow_type: nextFlowType, major: "", minor: "" }));
            updateCategoryDraftMajorSelect("__custom__");
            updateCategoryDraftMinorSelect("__custom__");
            updateCategoryQuickSelectedId("");
          }}
          disabled={!canEditHouseholdData}
        >
          {FLOW_TYPE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label>
        새 대분류
        <select
          value={categoryDraftMajorSelect}
          onChange={(event) => {
            const nextMajorSelect = event.target.value;
            updateCategoryDraftMajorSelect(nextMajorSelect);
            updateCategoryDraftMinorSelect("__custom__");
            updateCategoryDraft((prev) => ({ ...prev, major: nextMajorSelect === "__custom__" ? "" : nextMajorSelect, minor: "" }));
          }}
          disabled={!canEditHouseholdData}
        >
          <option value="__custom__">직접 입력</option>
          {categoryDraftMajorOptions.map((major) => <option key={major} value={major}>{toCategoryMajorLabel(major)}</option>)}
        </select>
      </label>
      <label>
        첫 중분류
        <select value={categoryDraftMinorSelect} onChange={(event) => { const nextMinorSelect = event.target.value; updateCategoryDraftMinorSelect(nextMinorSelect); updateCategoryDraft((prev) => ({ ...prev, minor: nextMinorSelect === "__custom__" ? "" : nextMinorSelect })); }} disabled={!canEditHouseholdData || (categoryDraftMajorSelect === "__custom__" && !String(categoryDraft.major || "").trim())}>
          <option value="__custom__">직접 입력</option>
          {categoryDraftMinorOptions.map((minor) => <option key={minor} value={minor}>{toCategoryMinorLabel(minor)}</option>)}
        </select>
      </label>
      {categoryDraftMajorSelect === "__custom__" && (
        <label>새 대분류 입력<input value={categoryDraft.major} onChange={(event) => updateCategoryDraft((prev) => ({ ...prev, major: event.target.value }))} placeholder="예: 생활비" required disabled={!canEditHouseholdData} /></label>
      )}
      {categoryDraftMinorSelect === "__custom__" && (
        <label>첫 중분류 입력<input value={categoryDraft.minor} onChange={(event) => updateCategoryDraft((prev) => ({ ...prev, minor: event.target.value }))} placeholder="예: 식비" required disabled={!canEditHouseholdData} /></label>
      )}
      <div className="inline form-actions settings-actions">
        <button type="submit" disabled={!canEditHouseholdData}>카테고리 추가</button>
      </div>
    </form>
  );
}
