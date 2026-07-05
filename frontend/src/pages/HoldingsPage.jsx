import { Doughnut } from "react-chartjs-2";
import { ChartBreakdownList } from "../components/worksurface/ChartAccessibleSummary";
import { HoldingSurfaceTable } from "../components/worksurface/HoldingSurfaceTable";

export function HoldingsPage({
  constants,
  permissions,
  entryState,
  entryActions,
  entryLookups,
  listState,
  listActions,
  portfolioSummary,
  formatters,
  renderers,
}) {
  const {
    DEFAULT_HOLDING_TYPES,
  } = constants;
  const {
    canEditRecords,
    isCompactViewport,
    loading,
  } = permissions;
  const {
    holdingEntryActionRef,
    holdingForm,
    holdingFormOwnerOptions,
    holdingFormShowAverageCost,
    holdingFormTracked,
    holdingFormType,
    holdingNameInputRef,
    showHoldingForm,
  } = entryState;
  const {
    applyHoldingOwnerOption,
    closeHoldingEntrySheet,
    createHoldingForm,
    handleHoldingEntryDecimalInput,
    nextAverageCostForHoldingTypeChange,
    openHoldingEntrySheet,
    ownerSelectionFromValue,
    resolveHoldingCategoryOnTypeChange,
    shouldExplainHoldingValueReset,
    submitHolding,
    uiGuideMessage,
    updateHoldingDraftTouched,
    updateHoldingForm,
    updateHoldingOwnerTouched,
    notifyMessage,
  } = entryActions;
  const {
    holdingTypeByKey,
    holdingTypeOptions,
    holdingValuationInputMode,
    normalizeHoldingTypeKey,
    ownerSelectValue,
  } = entryLookups;
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
  const {
    moveHoldingCategoryOrder,
    scrollToHoldingSummary,
    updateHoldingColumnWidth,
    updateHoldingColorMode,
    updateHoldingGroupByColor,
    updateHoldingListTab,
    updateHoldingTypeFilter,
    updateSelectedHoldingIds,
  } = listActions;
  const {
    donutChartOptions,
    handleHoldingSummarySummaryClick,
    handleHoldingSummaryToggle,
    holdingPortfolioBreakdownCanFilter,
    holdingPortfolioBreakdownItems,
    holdingPortfolioCenterLabel,
    holdingPortfolioChartData,
    holdingPortfolioChartDescription,
    holdingPortfolioChartSource,
    holdingPortfolioGainTone,
    holdingPortfolioReturnRatio,
    holdingSummaryCardRef,
    holdingSummaryOpen,
    holdingSummarySource,
    holdingSummaryViewMode,
    portfolio,
    updateHoldingSummaryViewMode,
  } = portfolioSummary;
  const {
    fmtKrw,
    fmtSignedPercent,
  } = formatters;
  const {
    renderDonutCenterLabel,
    renderDonutSliceLabels,
    renderHoldingRow,
    renderHoldingSortAria,
    renderHoldingSortHeader,
    renderLegacyOwnerRemapHelper,
    renderOwnerQuickSelect,
  } = renderers;

  return (
    <section className="grid-1">
              {isCompactViewport && showHoldingForm && (
                <div
                  className="holding-entry-sheet-backdrop"
                  data-testid="holding-entry-sheet-backdrop"
                  aria-hidden="true"
                  onClick={closeHoldingEntrySheet}
                />
              )}
              <article
                className={`card surface-entry-card holding-entry-card${isCompactViewport && showHoldingForm ? " holding-entry-sheet" : ""}`}
                data-testid={isCompactViewport && showHoldingForm ? "holding-entry-sheet" : undefined}
                role={isCompactViewport && showHoldingForm ? "dialog" : undefined}
                aria-modal={isCompactViewport && showHoldingForm ? "true" : undefined}
                aria-label={isCompactViewport && showHoldingForm ? "자산 추가 레이어" : undefined}
              >
                <div className="work-surface-header">
                  <div className="work-surface-title">
                    <span className="surface-eyebrow">자산 입력 흐름</span>
                    <h2>자산 입력</h2>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    ref={holdingEntryActionRef}
                    data-testid={isCompactViewport && showHoldingForm ? "holding-entry-sheet-close" : undefined}
                    onClick={(event) => (showHoldingForm ? closeHoldingEntrySheet() : openHoldingEntrySheet(event))}
                  >
                    {showHoldingForm ? "입력 닫기" : "자산 추가"}
                  </button>
                </div>
                <p className="table-summary">필요할 때만 입력창을 엽니다.</p>
                <div className="surface-control-strip" aria-label="자산 입력 상태">
                  <span className="surface-chip surface-chip-strong">{canEditRecords ? "편집 가능" : "읽기 전용"}</span>
                  <span className="surface-chip">유형·보유자·계좌 정리</span>
                  <span className="surface-chip surface-chip-muted">평가금액 자동 정렬</span>
                </div>
                {!canEditRecords && (
                  <p className="table-summary">자산 등록/수정/삭제는 편집자 이상 권한에서만 가능합니다.</p>
                )}
                {showHoldingForm && (
                  <div className="holdings-form-container">
                  <form className="holdings-form-grid" onSubmit={submitHolding} noValidate>
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
                            const previousType =
                              holdingTypeByKey.get(normalizeHoldingTypeKey(holdingForm.type_key || holdingForm.asset_type || "")) ||
                              holdingFormType;
                            if (shouldExplainHoldingValueReset(holdingForm.average_cost, previousType, nextType)) {
                              notifyMessage(
                                uiGuideMessage(
                                  "자산 유형을 변경했습니다.",
                                  "평가금액과 평균단가의 의미가 달라 금액 입력값을 비웠습니다."
                                )
                              );
                            }
                            updateHoldingForm((prev) => ({
                              ...createHoldingForm(nextType.asset_type || "other", nextType.key, nextType.label),
                              name: prev.name,
                              category: resolveHoldingCategoryOnTypeChange(
                                prev.category,
                                previousType,
                                nextType
                              ),
                              owner_user_id: prev.owner_user_id,
                              owner_name: prev.owner_name,
                              account_name: prev.account_name,
                              average_cost: nextAverageCostForHoldingTypeChange(prev.average_cost, previousType, nextType),
                            }));
                          }}
                        >
                          {holdingTypeOptions.map((item) => (
                            <option key={item.key} value={item.key}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        자산명
                        <textarea
                          rows={2}
                          ref={holdingNameInputRef}
                          value={holdingForm.name}
                          onChange={(event) => {
                            updateHoldingDraftTouched(true);
                            updateHoldingForm({ ...holdingForm, name: event.target.value });
                          }}
                          disabled={!canEditRecords}
                          required
                        />
                      </label>
                      <div className="settings-preview">
                        선택 유형: <strong>{holdingFormType?.label || "-"}</strong>
                      </div>
                      <label>
                        카테고리
                        <input
                          value={holdingForm.category}
                          onChange={(event) => {
                            updateHoldingDraftTouched(true);
                            updateHoldingForm({ ...holdingForm, category: event.target.value });
                          }}
                          disabled={!canEditRecords}
                        />
                      </label>
                      <label>
                        보유자
                        <select
                          value={ownerSelectValue(holdingForm.owner_user_id, holdingForm.owner_name)}
                          disabled={!canEditRecords}
                          onChange={(event) => {
                            updateHoldingOwnerTouched(true);
                            updateHoldingDraftTouched(true);
                            updateHoldingForm({
                              ...holdingForm,
                              ...ownerSelectionFromValue(event.target.value, holdingFormOwnerOptions),
                            });
                          }}
                        >
                          <option value="">(선택 안함)</option>
                          {holdingFormOwnerOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {renderOwnerQuickSelect({
                        ownerLabel: "보유자",
                        testId: "holding-owner-quick-select",
                        selectedValue: holdingForm.owner_user_id,
                        disabled: !canEditRecords,
                        onSelect: applyHoldingOwnerOption,
                      })}
                      {renderLegacyOwnerRemapHelper({
                        ownerUserId: holdingForm.owner_user_id,
                        ownerName: holdingForm.owner_name,
                        disabled: !canEditRecords,
                        onApply: (target) => {
                          updateHoldingOwnerTouched(true);
                          updateHoldingDraftTouched(true);
                          updateHoldingForm((prev) => ({
                            ...prev,
                            owner_user_id: target.value,
                            owner_name: target.displayName,
                          }));
                        },
                      })}
                      {holdingFormTracked ? (
                        <>
                          <label>
                            심볼
                            <input
                              value={holdingForm.symbol}
                              onChange={(event) => {
                                updateHoldingDraftTouched(true);
                                updateHoldingForm({ ...holdingForm, symbol: event.target.value });
                              }}
                              disabled={!canEditRecords}
                              required
                            />
                          </label>
                          <label>
                            시장심볼
                            <input
                              value={holdingForm.market_symbol}
                              onChange={(event) => {
                                updateHoldingDraftTouched(true);
                                updateHoldingForm({ ...holdingForm, market_symbol: event.target.value });
                              }}
                              disabled={!canEditRecords}
                            />
                          </label>
                          <label>
                            수량
                            <input
                              type="text"
                              inputMode="decimal"
                              value={holdingForm.quantity}
                              onChange={(event) => handleHoldingEntryDecimalInput(event, "quantity")}
                              disabled={!canEditRecords}
                              required
                            />
                          </label>
                          {holdingFormShowAverageCost && (
                            <label>
                              평균단가
                              <input
                                type="text"
                                inputMode="decimal"
                                value={holdingForm.average_cost}
                                onChange={(event) => handleHoldingEntryDecimalInput(event, "average_cost")}
                                disabled={!canEditRecords}
                                required
                              />
                            </label>
                          )}
                        </>
                      ) : (
                        holdingFormShowAverageCost ? (
                          <label>
                            평가금액
                            <input
                              type="text"
                              inputMode={holdingValuationInputMode(holdingForm.currency)}
                              value={holdingForm.average_cost}
                              onChange={(event) => handleHoldingEntryDecimalInput(event, "average_cost")}
                              disabled={!canEditRecords}
                              required
                            />
                          </label>
                        ) : (
                          <div className="settings-preview">선택한 유형은 평균단가/손익 입력이 필요하지 않습니다.</div>
                        )
                      )}
                      <label>
                        계좌
                        <input
                          value={holdingForm.account_name}
                          onChange={(event) => {
                            updateHoldingDraftTouched(true);
                            updateHoldingForm({ ...holdingForm, account_name: event.target.value });
                          }}
                          disabled={!canEditRecords}
                        />
                      </label>
                      <label>
                        통화
                        <input
                          value={holdingForm.currency}
                          onChange={(event) => {
                            updateHoldingDraftTouched(true);
                            updateHoldingForm({ ...holdingForm, currency: event.target.value.toUpperCase() });
                          }}
                          disabled={!canEditRecords}
                          required
                        />
                      </label>
                    </div>
                    <div className="holdings-form-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={!canEditRecords}
                        onClick={() => {
                          updateHoldingOwnerTouched(false);
                          updateHoldingDraftTouched(false);
                          updateHoldingForm(createHoldingForm(holdingForm.asset_type, holdingForm.type_key, holdingFormType?.label));
                        }}
                      >
                        초기화
                      </button>
                      <button type="submit" className="primary" disabled={!canEditRecords}>자산 등록</button>
                    </div>
                  </form>
                  </div>
                )}
              </article>
              <article className="card table-card surface-list-card holding-list-card">
                <div className="surface-list-heading">
                  <div className="work-surface-title">
                    <span className="surface-eyebrow">자산 원장</span>
                    <h2>자산 목록</h2>
                  </div>
                  {isCompactViewport && (
                    <button
                      type="button"
                      className="holdings-fab holdings-fab-inline surface-heading-action"
                      data-testid="holdings-fab"
                      aria-label="자산 추가"
                      disabled={loading}
                      onClick={openHoldingEntrySheet}
                    >
                      <span aria-hidden="true">＋</span>
                    </button>
                  )}
                  <p className="table-summary surface-count-summary">
                    총 {holdingItems.length}건 중 {filteredHoldingItems.length}건 표시
                  </p>
                </div>
                <div className="surface-control-strip" aria-label="자산 목록 상태">
                  <span className="surface-chip surface-chip-strong">{activeHoldingTabLabel}</span>
                  {holdingTypeFilter !== "all" && <span className="surface-chip surface-chip-strong">유형 {activeHoldingTypeFilterLabel}</span>}
                  <span className="surface-chip">{holdingSortSummary}</span>
                  <span className={`surface-chip${holdingColorMode === "none" ? " surface-chip-muted" : " surface-chip-strong"}`}>
                    {holdingColorModeLabel}
                  </span>
                  <span className="surface-chip">선택 {selectedHoldingSummary.count}건</span>
                </div>
                <button
                  type="button"
                  className="secondary holdings-summary-jump-cue"
                  data-testid="holdings-summary-jump-cue"
                  onClick={scrollToHoldingSummary}
                >
                  자산 포트폴리오 요약 보기
                </button>
                {holdingTypeFilter !== "all" && (
                  <div className="holding-type-filter-status" data-testid="holding-type-filter-status" role="status" aria-live="polite">
                    <span>
                      유형 필터: <strong>{activeHoldingTypeFilterLabel}</strong>
                    </span>
                    <button type="button" className="secondary" onClick={() => updateHoldingTypeFilter("all")}>
                      유형 필터 해제
                    </button>
                  </div>
                )}
                <div className="tabs sub-tabs" role="tablist" aria-label={holdingListTabAriaLabel}>
                  {dynamicHoldingTabs.map((tabItem) => (
                    <button
                      key={tabItem.value}
                      type="button"
                      role="tab"
                      aria-selected={holdingListTab === tabItem.value}
                      className={holdingListTab === tabItem.value ? "active" : ""}
                      onClick={() => updateHoldingListTab(tabItem.value)}
                    >
                      {tabItem.label}
                    </button>
                  ))}
                </div>
                <details className="holding-display-options compact-inline-details">
                  <summary>
                    <span>보기 옵션</span>
                    <span className="holding-display-options-state holding-display-options-state-closed">펼치기</span>
                    <span className="holding-display-options-state holding-display-options-state-open">접기</span>
                  </summary>
                  <div className="table-toolbar">
                    <label>
                      색상 기준
                      <select value={holdingColorMode} onChange={(event) => updateHoldingColorMode(event.target.value)}>
                        <option value="none">없음</option>
                        <option value="owner">보유자</option>
                        <option value="category">카테고리</option>
                        <option value="type">유형</option>
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={holdingGroupByColor}
                        onChange={(event) => updateHoldingGroupByColor(Boolean(event.target.checked))}
                      />
                      색상 그룹 우선 정렬
                    </label>
                  </div>
                  <details className="holding-column-width-editor">
                    <summary>열 너비 조정</summary>
                    <div className="form-grid settings-form-grid">
                      {[
                        ["name", "이름"],
                        ["type", "유형"],
                        ["owner", "보유자"],
                        ["category", "카테고리"],
                        ["quantity", "수량"],
                        ["average_cost", "평균단가"],
                        ["market_value_krw", "평가(KRW)"],
                        ["gain_loss_krw", "손익(KRW)"],
                        ["updated_at", "최종 수정일"],
                        ["actions", "동작"],
                      ].map(([columnKey, label]) => (
                        <label key={columnKey}>
                          {label}
                          <input
                            type="range"
                            min="80"
                            max="600"
                            value={Number(holdingColumnWidths[columnKey] || 140)}
                            onChange={(event) => updateHoldingColumnWidth(columnKey, event.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                </details>
                {selectedHoldingSummary.count > 0 && (
                  <div className="message" role="status">
                    <span>
                      선택 {selectedHoldingSummary.count}건 · 평가 합계 {fmtKrw(selectedHoldingSummary.amount)}
                    </span>
                    <button type="button" className="message-close secondary" onClick={() => updateSelectedHoldingIds(new Set())}>
                      선택 해제
                    </button>
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
              <details
                ref={holdingSummaryCardRef}
                className="card compact-support-card holding-summary-card surface-support-card"
                open={holdingSummaryOpen}
                onToggle={handleHoldingSummaryToggle}
              >
                <summary onClick={handleHoldingSummarySummaryClick}>
                  <span>자산 포트폴리오 차트 {holdingSummaryOpen ? "접기" : "열기"}</span>
                </summary>
                <div className="compact-support-grid">
                  <section className="compact-support-section">
                    <div className="inline compact-support-header asset-portfolio-chart-header">
                      <h3>자산 포트폴리오</h3>
                      <label className="compact-inline-select asset-portfolio-chart-select">
                        보기 기준
                        <select
                          aria-label="자산 요약 보기 기준"
                          value={holdingSummaryViewMode}
                          onChange={(event) => updateHoldingSummaryViewMode(event.target.value)}
                        >
                          <option value="type">자산 유형</option>
                          <option value="category">자산 분류</option>
                          <option value="owner">보유자</option>
                        </select>
                      </label>
                    </div>
                    <div className="asset-portfolio-metrics" aria-label="자산 포트폴리오 핵심 지표">
                      <div>
                        <span>총 평가금액</span>
                        <strong>{fmtKrw(portfolio?.total_market_value_krw)}</strong>
                      </div>
                      <div data-tone={holdingPortfolioGainTone}>
                        <span>평가손익</span>
                        <strong>{fmtKrw(portfolio?.total_gain_loss_krw)}</strong>
                      </div>
                      <div data-tone={holdingPortfolioGainTone}>
                        <span>수익률</span>
                        <strong>{fmtSignedPercent(holdingPortfolioReturnRatio)}</strong>
                      </div>
                    </div>
                    <div className={`chart-wrap compact-chart-wrap${holdingPortfolioChartData ? "" : " chart-wrap-empty"}`}>
                      {holdingPortfolioChartData ? (
                        <>
                          <Doughnut data={holdingPortfolioChartData} options={donutChartOptions} role="img" aria-label={holdingPortfolioChartDescription} />
                          {renderDonutSliceLabels(holdingPortfolioChartSource.items, {
                            testId: "portfolio-donut-slice-label",
                            labelPrefix: holdingPortfolioChartSource.title,
                          })}
                          {renderDonutCenterLabel(holdingPortfolioCenterLabel, {
                            testId: "portfolio-donut-center-label",
                            labelPrefix: "자산 포트폴리오",
                          })}
                        </>
                      ) : (
                        <p>표시할 포트폴리오 데이터가 없습니다.</p>
                      )}
                    </div>
                    <ChartBreakdownList
                      items={holdingPortfolioBreakdownItems}
                      ariaLabel={`${holdingPortfolioChartSource.title} 평가금액`}
                      testId="holding-portfolio-breakdown"
                      activeKey={holdingTypeFilter}
                      onItemAction={
                        holdingPortfolioBreakdownCanFilter
                          ? (item) => updateHoldingTypeFilter((current) => (current === item.key ? "all" : item.key))
                          : undefined
                      }
                    />
                    {holdingTypeFilter !== "all" && (
                      <button type="button" className="secondary portfolio-filter-reset" onClick={() => updateHoldingTypeFilter("all")}>
                        자산 유형 필터 해제
                      </button>
                    )}
                  </section>
                  <section className="compact-support-section">
                    <div className="inline compact-support-header">
                      <h3>{holdingSummarySource.title} 상위 항목</h3>
                      <span className="table-summary">상위 {Math.min(holdingSummarySource.items.length, 5)}개</span>
                    </div>
                    <div className="settings-category-list">
                      {holdingSummarySource.items.length === 0 ? (
                        <p className="table-summary">표시할 카테고리 합계가 없습니다.</p>
                      ) : (
                        holdingSummarySource.items.slice(0, 5).map((item) => (
                          <div key={item.label} className="settings-category-row compact-category-row">
                            <span className="settings-category-major">{item.label}</span>
                            <span className="settings-category-minor">{fmtKrw(item.value)}</span>
                            <span className="settings-category-usage">{holdingSummarySource.title}</span>
                            <span />
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </details>
            </section>
  );
}
