import { CategoryCreateForm } from "./CategoryCreateForm";
import { CategoryFlowGroup } from "./CategoryFlowGroup";
import { CategoryQuickActions } from "./CategoryQuickActions";

export function CategoryManagerCard({ constants, permissions, categoryDrafts, categoryLists, categoryActions, formatters }) {
  const { FLOW_TYPE_LABELS, FLOW_TYPE_OPTIONS } = constants;
  const { canEditHouseholdData } = permissions;
  const { categoryDraft, categoryDraftGuideText, categoryDraftMajorOptions, categoryDraftMajorSelect, categoryDraftMinorOptions, categoryDraftMinorSelect, categoryDraftSummaryText, categoryEditForm, categoryEditId, majorRenameDrafts } = categoryDrafts;
  const { categories, categoryGroups, categoryMajorCount, categoryQuickActionText, categoryQuickOptions, categoryQuickSelectedId, categoryQuickSelectionInUse, categoryUsageById, categoryUsageExpanded, categoryUsageLoadingId } = categoryLists;
  const { createCategoryPair, deleteCategoryPair, deleteSelectedCategoryQuick, editSelectedCategoryQuick, renameCategoryMajorGroup, saveCategoryEdit, toCategoryMajorLabel, toCategoryMinorLabel, toCategoryPairLabel, toggleCategoryUsageDetails, updateCategoryDraft, updateCategoryDraftMajorSelect, updateCategoryDraftMinorSelect, updateCategoryEditForm, updateCategoryEditId, updateCategoryQuickSelectedId, updateMajorRenameDrafts } = categoryActions;
  const { fmtKrw } = formatters;

  return (
    <article className="card settings-span-full secondary-surface-card category-manager-card">
      <div className="secondary-surface-header">
        <div className="work-surface-title">
          <span className="surface-eyebrow">분류 체계</span>
          <h2>카테고리 관리</h2>
        </div>
        <div className="surface-control-strip secondary-control-strip" role="group" aria-label="카테고리 관리 상태" tabIndex={0}>
          <span className="surface-chip surface-chip-strong">{categories.length}개 중분류</span>
          <span className="surface-chip">{categoryMajorCount}개 대분류</span>
          <span className={`surface-chip${canEditHouseholdData ? " surface-chip-strong" : " surface-chip-muted"}`}>{canEditHouseholdData ? "편집 가능" : "읽기 전용"}</span>
        </div>
      </div>
      <CategoryCreateForm
        constants={{ FLOW_TYPE_OPTIONS }}
        permissions={{ canEditHouseholdData }}
        categoryDrafts={{ categoryDraft, categoryDraftGuideText, categoryDraftMajorOptions, categoryDraftMajorSelect, categoryDraftMinorOptions, categoryDraftMinorSelect, categoryDraftSummaryText }}
        categoryActions={{ createCategoryPair, toCategoryMajorLabel, toCategoryMinorLabel, updateCategoryDraft, updateCategoryDraftMajorSelect, updateCategoryDraftMinorSelect, updateCategoryQuickSelectedId }}
      />
      <CategoryQuickActions
        permissions={{ canEditHouseholdData }}
        categoryLists={{ categoryQuickActionText, categoryQuickOptions, categoryQuickSelectedId, categoryQuickSelectionInUse }}
        categoryActions={{ deleteSelectedCategoryQuick, editSelectedCategoryQuick, updateCategoryQuickSelectedId }}
      />
      {!canEditHouseholdData && <p className="table-summary">카테고리 변경은 편집자 이상 권한에서만 가능합니다.</p>}
      <div className="settings-category-flows">
        {categoryGroups.map((flowGroup) => (
          <CategoryFlowGroup
            key={flowGroup.value}
            constants={{ FLOW_TYPE_LABELS }}
            permissions={{ canEditHouseholdData }}
            categoryDrafts={{ categoryEditForm, categoryEditId, majorRenameDrafts }}
            categoryLists={{ categoryUsageById, categoryUsageExpanded, categoryUsageLoadingId }}
            categoryActions={{ deleteCategoryPair, renameCategoryMajorGroup, saveCategoryEdit, toCategoryMajorLabel, toCategoryMinorLabel, toCategoryPairLabel, toggleCategoryUsageDetails, updateCategoryEditForm, updateCategoryEditId, updateMajorRenameDrafts }}
            flowGroup={flowGroup}
            formatters={{ fmtKrw }}
          />
        ))}
      </div>
    </article>
  );
}
