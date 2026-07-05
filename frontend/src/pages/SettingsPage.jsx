import { Fragment } from "react";

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
              <article className="card secondary-surface-card settings-profile-card">
                <div className="secondary-surface-header">
                  <div className="work-surface-title">
                    <span className="surface-eyebrow">개인 설정</span>
                    <h2>내 프로필</h2>
                  </div>
                  <div className="surface-control-strip secondary-control-strip" aria-label="프로필 설정 상태">
                    <span className="surface-chip surface-chip-strong">{user?.display_name || "표시명 대기"}</span>
                    <span className="surface-chip">{profileDisplayModeLabel}</span>
                  </div>
                </div>
                <form className="form-grid settings-form-grid" onSubmit={saveProfileSettings}>
                  <label>
                    본명
                    <input
                      value={profileForm.real_name}
                      onChange={(event) => updateProfileForm((prev) => ({ ...prev, real_name: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    닉네임
                    <input
                      value={profileForm.nickname}
                      onChange={(event) => updateProfileForm((prev) => ({ ...prev, nickname: event.target.value }))}
                      placeholder="선택 입력"
                    />
                  </label>
                  <label>
                    표시명 방식
                    <select
                      value={profileForm.display_name_mode}
                      onChange={(event) => updateProfileForm((prev) => ({ ...prev, display_name_mode: event.target.value }))}
                    >
                      {DISPLAY_NAME_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="settings-preview">
                    현재 표시명: <strong>{user?.display_name || "-"}</strong>
                  </div>
                  <div className="inline form-actions settings-actions">
                    <button type="submit">프로필 저장</button>
                  </div>
                </form>
              </article>

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
                    <input
                      value={householdSettingsForm.name}
                      onChange={(event) => updateHouseholdSettingsForm((prev) => ({ ...prev, name: event.target.value }))}
                      required
                    />
                  </label>
                  <div className="settings-preview">
                    현재 기준 통화: <strong>{householdSettings?.base_currency || household?.base_currency || "KRW"}</strong>
                  </div>
                  <div className="inline form-actions settings-actions">
                    <button type="submit" disabled={!canManageHousehold}>
                      가계 설정 저장
                    </button>
                  </div>
                </form>
                {!canManageHousehold && (
                  <p className="table-summary">가계 이름과 공통 색상은 공동 소유자 이상 권한에서만 변경할 수 있습니다.</p>
                )}
              </article>

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
                        <span
                          className="settings-color-preview-bar"
                          style={{ "--settings-color-preview": colorValue }}
                          aria-hidden="true"
                        />
                        <input
                          type="color"
                          value={colorValue}
                          onChange={(event) =>
                            updateHouseholdSettingsForm((prev) => ({
                              ...prev,
                              transaction_row_colors: {
                                ...prev.transaction_row_colors,
                                [option.value]: event.target.value.toUpperCase(),
                              },
                            }))
                          }
                          disabled={!canManageHousehold}
                        />
                        <code>{colorValue}</code>
                      </label>
                    );
                  })}
                  <div className="inline form-actions settings-actions">
                    <button type="submit" disabled={!canManageHousehold}>
                      색상 저장
                    </button>
                  </div>
                </form>
              </details>

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
                  <label>
                    유형 키
                    <input
                      value={holdingTypeDraft.key}
                      onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, key: event.target.value }))}
                      placeholder="예: deposit"
                      required
                    />
                  </label>
                  <label>
                    유형 이름
                    <input
                      value={holdingTypeDraft.label}
                      onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, label: event.target.value }))}
                      placeholder="예: 예적금"
                      required
                    />
                  </label>
                  <label>
                    기준 asset_type
                    <select
                      value={holdingTypeDraft.asset_type}
                      onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, asset_type: event.target.value }))}
                    >
                      {ASSET_TYPE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={holdingTypeDraft.tracked}
                      onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, tracked: event.target.checked }))}
                    />
                    시장 추적형 유형
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={holdingTypeDraft.show_average_cost}
                      onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, show_average_cost: event.target.checked }))}
                    />
                    평균단가/평가금액 입력 표시
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={holdingTypeDraft.show_gain_loss}
                      onChange={(event) => updateHoldingTypeDraft((prev) => ({ ...prev, show_gain_loss: event.target.checked }))}
                    />
                    손익 표시
                  </label>
                  <div className="inline form-actions settings-actions">
                    <button type="submit" disabled={!canManageHousehold}>
                      {holdingTypeEditKey ? "유형 수정 저장" : "유형 추가"}
                    </button>
                    <button type="button" className="secondary" onClick={clearHoldingTypeDraft}>
                      입력 초기화
                    </button>
                  </div>
                </form>
                <div className="settings-category-list">
                  {holdingTypeOptions.map((typeItem) => (
                    <div key={typeItem.key} className="settings-category-row">
                      <span className="settings-category-major">{typeItem.label}</span>
                      <span className="settings-category-minor">{typeItem.key}</span>
                      <span className="settings-category-usage">{typeItem.asset_type}</span>
                      <div className="inline">
                        <button
                          type="button"
                          className="secondary settings-type-order-btn"
                          aria-label={`${typeItem.label} 유형 순서 올리기`}
                          onClick={() => moveHoldingTypeOrder(typeItem.key, -1).catch(() => undefined)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="secondary settings-type-order-btn"
                          aria-label={`${typeItem.label} 유형 순서 내리기`}
                          onClick={() => moveHoldingTypeOrder(typeItem.key, 1).catch(() => undefined)}
                        >
                          ↓
                        </button>
                        <button type="button" className="secondary" onClick={() => editHoldingType(typeItem)}>수정</button>
                        <button type="button" className="danger" onClick={() => removeHoldingTypeDefinition(typeItem.key).catch(() => undefined)}>삭제</button>
                      </div>
                    </div>
                  ))}
                </div>
                <form className="settings-color-form" onSubmit={saveHouseholdSettings}>
                  {holdingTypeOptions.map((typeItem) => {
                    const colorValue = householdSettingsForm.holding_settings?.type_colors?.[typeItem.key] || "#E2E8F0";
                    return (
                      <label key={`type-color-${typeItem.key}`} className="settings-color-row">
                        <span>유형 색상 · {typeItem.label}</span>
                        <input
                          type="color"
                          value={colorValue}
                          onChange={(event) => updateHoldingColorInForm("type_colors", typeItem.key, event.target.value)}
                          disabled={!canManageHousehold}
                        />
                        <code>{colorValue}</code>
                      </label>
                    );
                  })}
                  {holdingOwnerNames.map((ownerName) => {
                    const colorValue = householdSettingsForm.holding_settings?.owner_colors?.[ownerName] || "#E2E8F0";
                    return (
                      <label key={`owner-color-${ownerName}`} className="settings-color-row">
                        <span>보유자 색상 · {ownerName}</span>
                        <input
                          type="color"
                          value={colorValue}
                          onChange={(event) => updateHoldingColorInForm("owner_colors", ownerName, event.target.value)}
                          disabled={!canManageHousehold}
                        />
                        <code>{colorValue}</code>
                      </label>
                    );
                  })}
                  {holdingCategoryNames.map((categoryName) => {
                    const colorValue = householdSettingsForm.holding_settings?.category_colors?.[categoryName] || "#E2E8F0";
                    return (
                      <label key={`category-color-${categoryName}`} className="settings-color-row">
                        <span>카테고리 색상 · {categoryName}</span>
                        <input
                          type="color"
                          value={colorValue}
                          onChange={(event) => updateHoldingColorInForm("category_colors", categoryName, event.target.value)}
                          disabled={!canManageHousehold}
                        />
                        <code>{colorValue}</code>
                      </label>
                    );
                  })}
                  <div className="inline form-actions settings-actions">
                    <button type="submit" disabled={!canManageHousehold}>
                      자산 설정 저장
                    </button>
                  </div>
                </form>
                {!canManageHousehold && <p className="table-summary">자산 유형/색상 설정은 공동 소유자 이상 권한에서만 변경할 수 있습니다.</p>}
              </details>

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
                    <select
                      id="settings-household-select"
                      className="household-select"
                      value={household?.id || ""}
                      onChange={handleHouseholdSwitchChange}
                      disabled={householdSwitchDisabled}
                      aria-describedby="settings-household-select-summary"
                    >
                      {householdList.length === 0 && <option value="">선택 가능한 가계 없음</option>}
                      {householdList.map((entry) => (
                        <option key={entry.household.id} value={entry.household.id}>
                          {entry.household.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="table-summary settings-household-current-summary" id="settings-household-select-summary">
                    <span className="settings-household-current-label">현재 작업 가계:</span>
                    <span className="settings-household-current-name">{renderBreakableInlineText(household?.name || "-")}</span>
                    <span className="settings-household-current-role">
                      / 내 권한: {COLLAB_ROLE_LABELS[householdRole] || householdRole || "-"}
                    </span>
                  </p>
                </div>
              </article>

              <article className="card settings-span-full secondary-surface-card category-manager-card">
                <div className="secondary-surface-header">
                  <div className="work-surface-title">
                    <span className="surface-eyebrow">분류 체계</span>
                    <h2>카테고리 관리</h2>
                  </div>
                  <div className="surface-control-strip secondary-control-strip" aria-label="카테고리 관리 상태">
                    <span className="surface-chip surface-chip-strong">{categories.length}개 중분류</span>
                    <span className="surface-chip">{categoryMajorCount}개 대분류</span>
                    <span className={`surface-chip${canEditHouseholdData ? " surface-chip-strong" : " surface-chip-muted"}`}>
                      {canEditHouseholdData ? "편집 가능" : "읽기 전용"}
                    </span>
                  </div>
                </div>
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
                      {FLOW_TYPE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
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
                        if (nextMajorSelect === "__custom__") {
                          updateCategoryDraft((prev) => ({ ...prev, major: "", minor: "" }));
                        } else {
                          updateCategoryDraft((prev) => ({ ...prev, major: nextMajorSelect, minor: "" }));
                        }
                      }}
                      disabled={!canEditHouseholdData}
                    >
                      <option value="__custom__">직접 입력</option>
                      {categoryDraftMajorOptions.map((major) => (
                        <option key={major} value={major}>
                          {toCategoryMajorLabel(major)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    첫 중분류
                    <select
                      value={categoryDraftMinorSelect}
                      onChange={(event) => {
                        const nextMinorSelect = event.target.value;
                        updateCategoryDraftMinorSelect(nextMinorSelect);
                        if (nextMinorSelect === "__custom__") {
                          updateCategoryDraft((prev) => ({ ...prev, minor: "" }));
                        } else {
                          updateCategoryDraft((prev) => ({ ...prev, minor: nextMinorSelect }));
                        }
                      }}
                      disabled={!canEditHouseholdData || (categoryDraftMajorSelect === "__custom__" && !String(categoryDraft.major || "").trim())}
                    >
                      <option value="__custom__">직접 입력</option>
                      {categoryDraftMinorOptions.map((minor) => (
                        <option key={minor} value={minor}>
                          {toCategoryMinorLabel(minor)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {categoryDraftMajorSelect === "__custom__" && (
                    <label>
                      새 대분류 입력
                      <input
                        value={categoryDraft.major}
                        onChange={(event) => updateCategoryDraft((prev) => ({ ...prev, major: event.target.value }))}
                        placeholder="예: 생활비"
                        required
                        disabled={!canEditHouseholdData}
                      />
                    </label>
                  )}
                  {categoryDraftMinorSelect === "__custom__" && (
                    <label>
                      첫 중분류 입력
                      <input
                        value={categoryDraft.minor}
                        onChange={(event) => updateCategoryDraft((prev) => ({ ...prev, minor: event.target.value }))}
                        placeholder="예: 식비"
                        required
                        disabled={!canEditHouseholdData}
                      />
                    </label>
                  )}
                  <div className="inline form-actions settings-actions">
                    <button type="submit" disabled={!canEditHouseholdData}>카테고리 추가</button>
                  </div>
                </form>
                <div className="form-grid settings-form-grid category-create-form category-create-form-spaced">
                  <div className="settings-preview category-manager-guide">
                    <strong>기존 카테고리 빠른 정리</strong>
                    <span>{categoryQuickActionText}</span>
                  </div>
                  <label>
                    기존 카테고리 선택
                    <select
                      value={categoryQuickSelectedId}
                      onChange={(event) => updateCategoryQuickSelectedId(event.target.value)}
                      disabled={!canEditHouseholdData}
                    >
                      <option value="">(선택 안함)</option>
                      {categoryQuickOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="inline form-actions settings-actions">
                    <button type="button" className="secondary" disabled={!canEditHouseholdData || !categoryQuickSelectedId} onClick={editSelectedCategoryQuick}>
                      선택 수정
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={!canEditHouseholdData || !categoryQuickSelectedId || categoryQuickSelectionInUse}
                      title={categoryQuickSelectionInUse ? "사용 중인 카테고리는 삭제할 수 없습니다." : undefined}
                      onClick={deleteSelectedCategoryQuick}
                    >
                      선택 삭제
                    </button>
                  </div>
                </div>
                {!canEditHouseholdData && (
                  <p className="table-summary">카테고리 변경은 편집자 이상 권한에서만 가능합니다.</p>
                )}

                <div className="settings-category-flows">
                  {categoryGroups.map((flowGroup) => (
                    <section key={flowGroup.value} className="settings-category-flow">
                      <header className="settings-category-flow-header">
                        <h3>{FLOW_TYPE_LABELS[flowGroup.value] || flowGroup.value}</h3>
                        <span className="table-summary">{flowGroup.groups.reduce((count, [, items]) => count + items.length, 0)}개</span>
                      </header>
                      {flowGroup.groups.length === 0 ? (
                        <p className="table-summary">등록된 카테고리가 없습니다.</p>
                      ) : (
                        flowGroup.groups.map(([major, items]) => (
                          <div key={`${flowGroup.value}:${major}`} className="settings-category-group">
                            <div className="settings-category-group-header">
                              <strong>{toCategoryMajorLabel(major)}</strong>
                              <div className="inline">
                                <input
                                  value={majorRenameDrafts[`${flowGroup.value}:${major}`] || ""}
                                  onChange={(event) =>
                                    updateMajorRenameDrafts((prev) => ({
                                      ...prev,
                                      [`${flowGroup.value}:${major}`]: event.target.value,
                                    }))
                                  }
                                  placeholder="새 대분류명"
                                  aria-label={`${FLOW_TYPE_LABELS[flowGroup.value] || flowGroup.value} ${toCategoryMajorLabel(major)} 대분류 변경 새 이름`}
                                  disabled={!canEditHouseholdData}
                                />
                                <button type="button" className="secondary" disabled={!canEditHouseholdData} onClick={() => renameCategoryMajorGroup(flowGroup.value, major)}>
                                  대분류 변경
                                </button>
                              </div>
                            </div>
                            <div className="settings-category-list">
                              {items.map((category) => {
                                const isEditing = categoryEditId === category.id;
                                const usageExpanded = Boolean(categoryUsageExpanded[category.id]);
                                const usageRows = categoryUsageById[category.id] || [];
                                const usageLoading = categoryUsageLoadingId === category.id;
                                return isEditing ? (
                                  <form
                                    key={category.id}
                                    className="settings-category-row category-row-editing"
                                    onSubmit={(event) => saveCategoryEdit(event, category.id)}
                                  >
                                    <span className="settings-category-major">{toCategoryMajorLabel(category.major)}</span>
                                    <input
                                      value={categoryEditForm.minor}
                                      onChange={(event) => updateCategoryEditForm((prev) => ({ ...prev, major: category.major, minor: event.target.value }))}
                                      required
                                      disabled={!canEditHouseholdData}
                                    />
                                    <span className="settings-category-usage">사용 {category.usage_count}건</span>
                                    <div className="inline">
                                      <button type="submit" disabled={!canEditHouseholdData}>저장</button>
                                      <button type="button" className="secondary" onClick={() => { updateCategoryEditId(""); updateCategoryEditForm({ major: "", minor: "" }); }}>
                                        취소
                                      </button>
                                    </div>
                                  </form>
                                ) : (
                                  <Fragment key={category.id}>
                                    <div className="settings-category-row">
                                      <span className="settings-category-major">{toCategoryMajorLabel(category.major)}</span>
                                      <span className="settings-category-minor">{toCategoryMinorLabel(category.minor)}</span>
                                      <span className="settings-category-usage">사용 {category.usage_count}건</span>
                                      <div className="inline">
                                        <button
                                          type="button"
                                          className="secondary"
                                          aria-expanded={usageExpanded}
                                          aria-label={`${toCategoryPairLabel(category)} 사용 내역 ${usageExpanded ? "접기" : "월별로 보기"}`}
                                          onClick={() => toggleCategoryUsageDetails(category).catch(() => undefined)}
                                        >
                                          <span>{usageExpanded ? "내역 접기" : "월별 내역"}</span>
                                          <span className="sort-indicator" aria-hidden="true">{usageExpanded ? "˅" : ">"}</span>
                                        </button>
                                        <button
                                          type="button"
                                          className="secondary"
                                          disabled={!canEditHouseholdData}
                                          onClick={() => {
                                            updateCategoryEditId(category.id);
                                            updateCategoryEditForm({ major: category.major, minor: category.minor });
                                          }}
                                        >
                                          중분류 수정
                                        </button>
                                        <button
                                          type="button"
                                          className="danger"
                                          disabled={!canEditHouseholdData || Number(category.usage_count || 0) > 0}
                                          onClick={() => deleteCategoryPair(category).catch(() => undefined)}
                                        >
                                          삭제
                                        </button>
                                      </div>
                                    </div>
                                    {usageExpanded && (
                                      <div className="settings-category-usage-detail">
                                        {usageLoading ? (
                                          <p className="table-summary">사용 내역을 불러오는 중입니다...</p>
                                        ) : usageRows.length === 0 ? (
                                          <p className="table-summary">사용 내역이 없습니다.</p>
                                        ) : (
                                          usageRows.map((monthRow) => (
                                            <details key={`${category.id}:${monthRow.month}`} className="category-usage-month">
                                              <summary>
                                                {monthRow.month} · {monthRow.count}건 · 합계 {fmtKrw(monthRow.total_amount)}
                                              </summary>
                                              <ul className="compact-list">
                                                {monthRow.items.map((usageItem) => (
                                                  <li key={usageItem.transaction_id}>
                                                    {usageItem.occurred_on} / {usageItem.owner_name || "-"} / {fmtKrw(usageItem.amount)} / {usageItem.memo || "-"}
                                                  </li>
                                                ))}
                                              </ul>
                                            </details>
                                          ))
                                        )}
                                      </div>
                                    )}
                                  </Fragment>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </section>
                  ))}
                </div>
              </article>
            </section>
  );
}
