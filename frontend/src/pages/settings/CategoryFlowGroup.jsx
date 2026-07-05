import { Fragment } from "react";

export function CategoryFlowGroup({ constants, permissions, categoryDrafts, categoryLists, categoryActions, flowGroup, formatters }) {
  const { FLOW_TYPE_LABELS } = constants;
  const { canEditHouseholdData } = permissions;
  const { categoryEditForm, categoryEditId, majorRenameDrafts } = categoryDrafts;
  const { categoryUsageById, categoryUsageExpanded, categoryUsageLoadingId } = categoryLists;
  const { deleteCategoryPair, renameCategoryMajorGroup, saveCategoryEdit, toCategoryMajorLabel, toCategoryMinorLabel, toCategoryPairLabel, toggleCategoryUsageDetails, updateCategoryEditForm, updateCategoryEditId, updateMajorRenameDrafts } = categoryActions;
  const { fmtKrw } = formatters;

  return (
    <section className="settings-category-flow">
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
                  onChange={(event) => updateMajorRenameDrafts((prev) => ({ ...prev, [`${flowGroup.value}:${major}`]: event.target.value }))}
                  placeholder="새 대분류명"
                  aria-label={`${FLOW_TYPE_LABELS[flowGroup.value] || flowGroup.value} ${toCategoryMajorLabel(major)} 대분류 변경 새 이름`}
                  disabled={!canEditHouseholdData}
                />
                <button type="button" className="secondary" disabled={!canEditHouseholdData} onClick={() => renameCategoryMajorGroup(flowGroup.value, major)}>대분류 변경</button>
              </div>
            </div>
            <div className="settings-category-list">
              {items.map((category) => {
                const isEditing = categoryEditId === category.id;
                const usageExpanded = Boolean(categoryUsageExpanded[category.id]);
                const usageRows = categoryUsageById[category.id] || [];
                const usageLoading = categoryUsageLoadingId === category.id;
                return isEditing ? (
                  <form key={category.id} className="settings-category-row category-row-editing" onSubmit={(event) => saveCategoryEdit(event, category.id)}>
                    <span className="settings-category-major">{toCategoryMajorLabel(category.major)}</span>
                    <input value={categoryEditForm.minor} onChange={(event) => updateCategoryEditForm((prev) => ({ ...prev, major: category.major, minor: event.target.value }))} required disabled={!canEditHouseholdData} />
                    <span className="settings-category-usage">사용 {category.usage_count}건</span>
                    <div className="inline">
                      <button type="submit" disabled={!canEditHouseholdData}>저장</button>
                      <button type="button" className="secondary" onClick={() => { updateCategoryEditId(""); updateCategoryEditForm({ major: "", minor: "" }); }}>취소</button>
                    </div>
                  </form>
                ) : (
                  <Fragment key={category.id}>
                    <CategoryRow
                      category={category}
                      canEditHouseholdData={canEditHouseholdData}
                      deleteCategoryPair={deleteCategoryPair}
                      toggleCategoryUsageDetails={toggleCategoryUsageDetails}
                      toCategoryMajorLabel={toCategoryMajorLabel}
                      toCategoryMinorLabel={toCategoryMinorLabel}
                      toCategoryPairLabel={toCategoryPairLabel}
                      updateCategoryEditForm={updateCategoryEditForm}
                      updateCategoryEditId={updateCategoryEditId}
                      usageExpanded={usageExpanded}
                    />
                    {usageExpanded && <CategoryUsageDetail category={category} usageLoading={usageLoading} usageRows={usageRows} fmtKrw={fmtKrw} />}
                  </Fragment>
                );
              })}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function CategoryRow({ category, canEditHouseholdData, deleteCategoryPair, toggleCategoryUsageDetails, toCategoryMajorLabel, toCategoryMinorLabel, toCategoryPairLabel, updateCategoryEditForm, updateCategoryEditId, usageExpanded }) {
  return (
    <div className="settings-category-row">
      <span className="settings-category-major">{toCategoryMajorLabel(category.major)}</span>
      <span className="settings-category-minor">{toCategoryMinorLabel(category.minor)}</span>
      <span className="settings-category-usage">사용 {category.usage_count}건</span>
      <div className="inline">
        <button type="button" className="secondary" aria-expanded={usageExpanded} aria-label={`${toCategoryPairLabel(category)} 사용 내역 ${usageExpanded ? "접기" : "월별로 보기"}`} onClick={() => toggleCategoryUsageDetails(category).catch(() => undefined)}>
          <span>{usageExpanded ? "내역 접기" : "월별 내역"}</span>
          <span className="sort-indicator" aria-hidden="true">{usageExpanded ? "˅" : ">"}</span>
        </button>
        <button type="button" className="secondary" disabled={!canEditHouseholdData} onClick={() => { updateCategoryEditId(category.id); updateCategoryEditForm({ major: category.major, minor: category.minor }); }}>중분류 수정</button>
        <button type="button" className="danger" disabled={!canEditHouseholdData || Number(category.usage_count || 0) > 0} onClick={() => deleteCategoryPair(category).catch(() => undefined)}>삭제</button>
      </div>
    </div>
  );
}

function CategoryUsageDetail({ category, usageLoading, usageRows, fmtKrw }) {
  return (
    <div className="settings-category-usage-detail">
      {usageLoading ? (
        <p className="table-summary">사용 내역을 불러오는 중입니다...</p>
      ) : usageRows.length === 0 ? (
        <p className="table-summary">사용 내역이 없습니다.</p>
      ) : (
        usageRows.map((monthRow) => (
          <details key={`${category.id}:${monthRow.month}`} className="category-usage-month">
            <summary>{monthRow.month} · {monthRow.count}건 · 합계 {fmtKrw(monthRow.total_amount)}</summary>
            <ul className="compact-list">
              {monthRow.items.map((usageItem) => (
                <li key={usageItem.transaction_id}>{usageItem.occurred_on} / {usageItem.owner_name || "-"} / {fmtKrw(usageItem.amount)} / {usageItem.memo || "-"}</li>
              ))}
            </ul>
          </details>
        ))
      )}
    </div>
  );
}
