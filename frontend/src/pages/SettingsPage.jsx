import { CategoryManagerCard } from "./settings/CategoryManagerCard";
import { HoldingTypeRulesCard } from "./settings/HoldingTypeRulesCard";
import { HouseholdSettingsCard } from "./settings/HouseholdSettingsCard";
import { HouseholdSwitchCard } from "./settings/HouseholdSwitchCard";
import { ProfileSettingsCard } from "./settings/ProfileSettingsCard";
import { TransactionRowColorSettings } from "./settings/TransactionRowColorSettings";

export function SettingsPage({
  constants,
  permissions,
  profile,
  householdAdmin,
  holdingTypes,
  categoryDrafts,
  categoryLists,
  categoryActions,
  formatters,
}) {
  const {
    ASSET_TYPE_OPTIONS,
    COLLAB_ROLE_LABELS,
    DEFAULT_TRANSACTION_ROW_COLORS,
    DISPLAY_NAME_MODE_OPTIONS,
    FLOW_TYPE_LABELS,
    FLOW_TYPE_OPTIONS,
  } = constants;
  const {
    canEditHouseholdData,
    canManageHousehold,
  } = permissions;
  const {
    profileDisplayModeLabel,
    profileForm,
    saveProfileSettings,
    user,
    updateProfileForm,
  } = profile;
  const {
    handleHouseholdSwitchChange,
    household,
    householdList,
    householdRole,
    householdRoleLabel,
    householdSettings,
    householdSettingsForm,
    householdSwitchDisabled,
    saveHouseholdSettings,
    updateHouseholdSettingsForm,
  } = householdAdmin;
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
  const {
    categoryDraft,
    categoryDraftGuideText,
    categoryDraftMajorOptions,
    categoryDraftMajorSelect,
    categoryDraftMinorOptions,
    categoryDraftMinorSelect,
    categoryDraftSummaryText,
    categoryEditForm,
    categoryEditId,
    majorRenameDrafts,
  } = categoryDrafts;
  const {
    categories,
    categoryGroups,
    categoryMajorCount,
    categoryQuickActionText,
    categoryQuickOptions,
    categoryQuickSelectedId,
    categoryQuickSelectionInUse,
    categoryUsageById,
    categoryUsageExpanded,
    categoryUsageLoadingId,
    settingsPermissionLabel,
  } = categoryLists;
  const {
    createCategoryPair,
    deleteCategoryPair,
    deleteSelectedCategoryQuick,
    editSelectedCategoryQuick,
    renameCategoryMajorGroup,
    renderBreakableInlineText,
    saveCategoryEdit,
    toCategoryMajorLabel,
    toCategoryMinorLabel,
    toCategoryPairLabel,
    toggleCategoryUsageDetails,
    updateCategoryDraft,
    updateCategoryDraftMajorSelect,
    updateCategoryDraftMinorSelect,
    updateCategoryEditForm,
    updateCategoryEditId,
    updateCategoryQuickSelectedId,
    updateMajorRenameDrafts,
  } = categoryActions;
  const {
    fmtKrw,
  } = formatters;

  return (
    <section className="grid-2 settings-grid secondary-surface-grid">
      <ProfileSettingsCard
        constants={{ DISPLAY_NAME_MODE_OPTIONS }}
        profile={{ profileDisplayModeLabel, profileForm, saveProfileSettings, user, updateProfileForm }}
      />
      <HouseholdSettingsCard
        permissions={{ canManageHousehold }}
        householdAdmin={{ household, householdRoleLabel, householdSettings, householdSettingsForm, saveHouseholdSettings, updateHouseholdSettingsForm }}
        categoryLists={{ settingsPermissionLabel }}
      />
      <TransactionRowColorSettings
        constants={{ DEFAULT_TRANSACTION_ROW_COLORS, FLOW_TYPE_OPTIONS }}
        permissions={{ canManageHousehold }}
        householdAdmin={{ householdSettingsForm, saveHouseholdSettings, updateHouseholdSettingsForm }}
      />
      <HoldingTypeRulesCard
        constants={{ ASSET_TYPE_OPTIONS }}
        permissions={{ canManageHousehold }}
        householdAdmin={{ householdSettingsForm, saveHouseholdSettings }}
        holdingTypes={{ clearHoldingTypeDraft, editHoldingType, holdingCategoryNames, holdingOwnerNames, holdingTypeDraft, holdingTypeEditKey, holdingTypeOptions, moveHoldingTypeOrder, removeHoldingTypeDefinition, saveHoldingTypeDefinition, updateHoldingColorInForm, updateHoldingTypeDraft }}
      />
      <HouseholdSwitchCard
        constants={{ COLLAB_ROLE_LABELS }}
        householdAdmin={{ handleHouseholdSwitchChange, household, householdList, householdRole, householdSwitchDisabled }}
        categoryActions={{ renderBreakableInlineText }}
      />
      <CategoryManagerCard
        constants={{ FLOW_TYPE_LABELS, FLOW_TYPE_OPTIONS }}
        permissions={{ canEditHouseholdData }}
        categoryDrafts={{ categoryDraft, categoryDraftGuideText, categoryDraftMajorOptions, categoryDraftMajorSelect, categoryDraftMinorOptions, categoryDraftMinorSelect, categoryDraftSummaryText, categoryEditForm, categoryEditId, majorRenameDrafts }}
        categoryLists={{ categories, categoryGroups, categoryMajorCount, categoryQuickActionText, categoryQuickOptions, categoryQuickSelectedId, categoryQuickSelectionInUse, categoryUsageById, categoryUsageExpanded, categoryUsageLoadingId }}
        categoryActions={{ createCategoryPair, deleteCategoryPair, deleteSelectedCategoryQuick, editSelectedCategoryQuick, renameCategoryMajorGroup, saveCategoryEdit, toCategoryMajorLabel, toCategoryMinorLabel, toCategoryPairLabel, toggleCategoryUsageDetails, updateCategoryDraft, updateCategoryDraftMajorSelect, updateCategoryDraftMinorSelect, updateCategoryEditForm, updateCategoryEditId, updateCategoryQuickSelectedId, updateMajorRenameDrafts }}
        formatters={{ fmtKrw }}
      />
    </section>
  );
}
