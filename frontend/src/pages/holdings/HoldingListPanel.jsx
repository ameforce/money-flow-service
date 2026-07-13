import { HoldingSurfaceTable } from "../../components/worksurface/HoldingSurfaceTable";
import { HoldingDisplayOptions } from "./HoldingDisplayOptions";

export function HoldingListPanel({ permissions, entryRefs, listState, listActions, entryActions, formatters, renderers }) {
  const { isCompactViewport, loading } = permissions;
  const { holdingFabRef } = entryRefs;
  const {
    activeHoldingTabLabel,
    activeHoldingTypeFilterLabel,
    dynamicHoldingTabs,
    filteredHoldingItems,
    groupedHoldingSections,
    holdingColorMode,
    holdingColorModeLabel,
    holdingColumnWidths,
    holdingGroupByColor,
    holdingItems,
    holdingListTab,
    holdingListTabAriaLabel,
    holdingSortSummary,
    holdingTypeFilter,
    selectedHoldingSummary,
    sortedHoldingItems,
  } = listState;
  const { moveHoldingCategoryOrder, scrollToHoldingSummary, updateHoldingColumnWidth, updateHoldingColorMode, updateHoldingGroupByColor, updateHoldingListTab, updateHoldingTypeFilter, updateSelectedHoldingIds } = listActions;
  const { openHoldingEntrySheet } = entryActions;
  const { fmtKrw } = formatters;
  const { renderHoldingRow, renderHoldingSortAria, renderHoldingSortHeader } = renderers;

  return (
    <article className="card table-card surface-list-card holding-list-card">
      <div className="surface-list-heading">
        <div className="work-surface-title">
          <span className="surface-eyebrow">자산 원장</span>
          <h2>자산 목록</h2>
        </div>
        {isCompactViewport && (
          <button ref={holdingFabRef} type="button" className="holdings-fab holdings-fab-inline surface-heading-action" data-testid="holdings-fab" aria-label="자산 추가" disabled={loading} onClick={openHoldingEntrySheet}>
            <span aria-hidden="true">＋</span>
          </button>
        )}
        <p className="table-summary surface-count-summary">총 {holdingItems.length}건 중 {filteredHoldingItems.length}건 표시</p>
      </div>
      <div className="surface-control-strip" role="group" aria-label="자산 목록 상태">
        <span className="surface-chip surface-chip-strong">{activeHoldingTabLabel}</span>
        {holdingTypeFilter !== "all" && <span className="surface-chip surface-chip-strong">유형 {activeHoldingTypeFilterLabel}</span>}
        <span className="surface-chip">{holdingSortSummary}</span>
        <span className={`surface-chip${holdingColorMode === "none" ? " surface-chip-muted" : " surface-chip-strong"}`}>{holdingColorModeLabel}</span>
        <span className="surface-chip">선택 {selectedHoldingSummary.count}건</span>
      </div>
      <button type="button" className="secondary holdings-summary-jump-cue" data-testid="holdings-summary-jump-cue" onClick={scrollToHoldingSummary}>
        자산 포트폴리오 요약 보기
      </button>
      {holdingTypeFilter !== "all" && (
        <div className="holding-type-filter-status" data-testid="holding-type-filter-status" role="status" aria-live="polite">
          <span>유형 필터: <strong>{activeHoldingTypeFilterLabel}</strong></span>
          <button type="button" className="secondary" onClick={() => updateHoldingTypeFilter("all")}>유형 필터 해제</button>
        </div>
      )}
      <div className="tabs sub-tabs" role="tablist" aria-label={holdingListTabAriaLabel}>
        {dynamicHoldingTabs.map((tabItem) => (
          <button key={tabItem.value} type="button" role="tab" aria-selected={holdingListTab === tabItem.value} className={holdingListTab === tabItem.value ? "active" : ""} onClick={() => updateHoldingListTab(tabItem.value)}>
            {tabItem.label}
          </button>
        ))}
      </div>
      <HoldingDisplayOptions
        holdingColorMode={holdingColorMode}
        holdingGroupByColor={holdingGroupByColor}
        holdingColumnWidths={holdingColumnWidths}
        updateHoldingColorMode={updateHoldingColorMode}
        updateHoldingGroupByColor={updateHoldingGroupByColor}
        updateHoldingColumnWidth={updateHoldingColumnWidth}
      />
      {selectedHoldingSummary.count > 0 && (
        <div className="message" role="status">
          <span>선택 {selectedHoldingSummary.count}건 · 평가 합계 {fmtKrw(selectedHoldingSummary.amount)}</span>
          <button type="button" className="message-close secondary" onClick={() => updateSelectedHoldingIds(new Set())}>선택 해제</button>
        </div>
      )}
      <HoldingSurfaceTable
        holdingColumnWidths={holdingColumnWidths}
        sortedHoldingItems={sortedHoldingItems}
        holdingListTab={holdingListTab}
        groupedHoldingSections={groupedHoldingSections}
        renderHoldingSortAria={renderHoldingSortAria}
        renderHoldingSortHeader={renderHoldingSortHeader}
        renderHoldingRow={renderHoldingRow}
        moveHoldingCategoryOrder={moveHoldingCategoryOrder}
        fmtKrw={fmtKrw}
      />
    </article>
  );
}
