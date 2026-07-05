export function CategoryQuickActions({ permissions, categoryLists, categoryActions }) {
  const { canEditHouseholdData } = permissions;
  const { categoryQuickActionText, categoryQuickOptions, categoryQuickSelectedId, categoryQuickSelectionInUse } = categoryLists;
  const { deleteSelectedCategoryQuick, editSelectedCategoryQuick, updateCategoryQuickSelectedId } = categoryActions;

  return (
    <div className="form-grid settings-form-grid category-create-form category-create-form-spaced">
      <div className="settings-preview category-manager-guide">
        <strong>기존 카테고리 빠른 정리</strong>
        <span>{categoryQuickActionText}</span>
      </div>
      <label>
        기존 카테고리 선택
        <select value={categoryQuickSelectedId} onChange={(event) => updateCategoryQuickSelectedId(event.target.value)} disabled={!canEditHouseholdData}>
          <option value="">(선택 안함)</option>
          {categoryQuickOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <div className="inline form-actions settings-actions">
        <button type="button" className="secondary" disabled={!canEditHouseholdData || !categoryQuickSelectedId} onClick={editSelectedCategoryQuick}>선택 수정</button>
        <button type="button" className="danger" disabled={!canEditHouseholdData || !categoryQuickSelectedId || categoryQuickSelectionInUse} title={categoryQuickSelectionInUse ? "사용 중인 카테고리는 삭제할 수 없습니다." : undefined} onClick={deleteSelectedCategoryQuick}>
          선택 삭제
        </button>
      </div>
    </div>
  );
}
