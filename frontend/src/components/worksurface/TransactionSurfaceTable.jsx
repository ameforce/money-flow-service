import { Fragment, useState } from "react";

import { IsoDateInput } from "../IsoDateInput";
import { extractVisibleInitial, resolveSemanticColor, withAlpha } from "./colorSemantics";
import { TRANSACTION_SURFACE_FIELDS, getWorkSurfaceMobilePriority } from "./fieldPriority";

function formatCompactDate(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "-";
  }
  return trimmed.replace(/^\d{4}-/, "");
}

function firstDefinedValue(values) {
  return values.find((value) => String(value || "").trim()) || "";
}

function isInteractiveRowTarget(target) {
  return Boolean(
    target?.closest?.(
      "button, input, select, textarea, a, label, summary, details, [role='button'], [data-row-action='true']"
    )
  );
}

export function TransactionSurfaceTable({
  sortedTransactions,
  areAllFilteredTransactionsSelected,
  toggleAllFilteredTransactionSelection,
  txSortDirection,
  toggleTxSortDirection,
  historyMode = false,
  historyTopSentinelRef = null,
  historyBottomSentinelRef = null,
  historyLoadingOlder = false,
  historyLoadingNewer = false,
  selectedTransactionIds,
  toggleTransactionSelection,
  txInlineEdit,
  ownerOptionsWithFallback,
  ownerSelectValue,
  txInlineCategoryMajor,
  txInlineCategoryMajorOptions,
  txInlineCategoryMinorOptions,
  setTxInlineEdit,
  categoryById,
  renderCategoryCell,
  FLOW_TYPE_LABELS,
  FLOW_TYPE_OPTIONS,
  txListFilter,
  setTxListFilter,
  clearTxListFilter,
  householdSettings,
  normalizeTransactionRowColors,
  DEFAULT_TRANSACTION_ROW_COLORS,
  expandedTransactionRows,
  toggleExpandedTransactionRow,
  canEditRecords,
  loading,
  closeTxInlineEdit,
  removeTx,
  mobileStickyActive,
  handleTxInlineEditKeyDown,
  handleGroupedDecimalInput,
  ownerSelectionFromValue,
  submitTxInlineEdit,
  fmtKrw,
  fmtDate,
  normalizeDecimalInputValue,
  toCategoryMajorLabel,
  toCategoryMinorLabel,
}) {
  const columnSpan = TRANSACTION_SURFACE_FIELDS.length + 2;
  const rowColors = normalizeTransactionRowColors(householdSettings?.transaction_row_colors);
  const ownerColors = householdSettings?.holding_settings?.owner_colors || {};
  const categoryColors = householdSettings?.holding_settings?.category_colors || {};
  const transactionMobilePriority = (fieldKey) => getWorkSurfaceMobilePriority("transactions", fieldKey);
  const [mobileFilterKey, setMobileFilterKey] = useState("");
  const safeTxListFilter = txListFilter || {
    keyword: "",
    flow_type: "all",
    start: "",
    end: "",
    amount_min: "",
    amount_max: "",
  };
  const updateTxListFilter = (patch) => {
    if (typeof setTxListFilter !== "function") {
      return;
    }
    setTxListFilter((prev) => ({ ...(prev || safeTxListFilter), ...patch }));
  };
  const updateAmountFilter = (event, field) => {
    if (typeof handleGroupedDecimalInput === "function" && typeof setTxListFilter === "function") {
      handleGroupedDecimalInput(event, setTxListFilter, field);
      return;
    }
    updateTxListFilter({ [field]: event.target.value });
  };
  const openMobileFilter = (key) => {
    setMobileFilterKey((current) => (current === key ? "" : key));
  };
  const mobileFilterLabelByKey = {
    date: "일자",
    memo: "메모",
    amount: "금액",
    type: "유형",
  };
  const mobileFilterLabel = mobileFilterLabelByKey[mobileFilterKey] || "";
  const isDateFilterActive = Boolean(safeTxListFilter.start || safeTxListFilter.end);
  const isMemoFilterActive = Boolean(String(safeTxListFilter.keyword || "").trim());
  const isAmountFilterActive = Boolean(
    String(safeTxListFilter.amount_min || "").trim() || String(safeTxListFilter.amount_max || "").trim()
  );
  const isTypeFilterActive = safeTxListFilter.flow_type !== "all";

  const renderMobileFilterTrigger = ({ keyName, className, label, active }) => {
    const isOpen = mobileFilterKey === keyName;
    return (
      <button
        type="button"
        className={`${className} ledger-head-filter-trigger${active ? " is-active" : ""}${isOpen ? " is-open" : ""}`}
        aria-label={`${label} 필터 ${isOpen ? "닫기" : "열기"}`}
        aria-expanded={isOpen ? "true" : "false"}
        aria-controls="tx-ledger-filter-panel"
        onClick={() => openMobileFilter(keyName)}
      >
        <span>{label}</span>
        {active && <span className="ledger-head-filter-indicator" aria-hidden="true" />}
      </button>
    );
  };

  return (
    <>
      <div
        className="surface-ledger-mobile-head transactions-mobile-ledger-head"
        data-sticky-active={mobileStickyActive ? "true" : "false"}
        aria-label="거래 제목행 필터"
      >
        <span className="ledger-head-select" />
        {renderMobileFilterTrigger({
          keyName: "date",
          className: "ledger-head-date",
          label: "일자",
          active: isDateFilterActive,
        })}
        {renderMobileFilterTrigger({
          keyName: "memo",
          className: "ledger-head-main",
          label: "메모",
          active: isMemoFilterActive,
        })}
        {renderMobileFilterTrigger({
          keyName: "amount",
          className: "ledger-head-amount",
          label: "금액",
          active: isAmountFilterActive,
        })}
        {renderMobileFilterTrigger({
          keyName: "type",
          className: "ledger-head-cues",
          label: "유형",
          active: isTypeFilterActive,
        })}
        <span className="ledger-head-actions">⋯</span>
      </div>
      {mobileFilterKey && (
        <div
          id="tx-ledger-filter-panel"
          className="tx-ledger-filter-panel"
          data-testid="tx-ledger-filter-panel"
          role="dialog"
          aria-label={`${mobileFilterLabel} 필터`}
        >
          <div className="tx-ledger-filter-title">
            <strong>{mobileFilterLabel} 필터</strong>
            <button type="button" className="secondary" onClick={() => setMobileFilterKey("")}>
              닫기
            </button>
          </div>
          {mobileFilterKey === "memo" && (
            <label className="tx-ledger-filter-field">
              <span>메모</span>
              <input
                aria-label="메모"
                placeholder="메모 검색"
                value={safeTxListFilter.keyword}
                onChange={(event) => updateTxListFilter({ keyword: event.target.value })}
                enterKeyHint="search"
              />
            </label>
          )}
          {mobileFilterKey === "type" && (
            <label className="tx-ledger-filter-field">
              <span>유형</span>
              <select
                aria-label="유형"
                value={safeTxListFilter.flow_type}
                onChange={(event) => updateTxListFilter({ flow_type: event.target.value })}
              >
                <option value="all">전체</option>
                {FLOW_TYPE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mobileFilterKey === "date" && (
            <div className="tx-ledger-filter-date-grid">
              <label className="tx-ledger-filter-field">
                <span>시작일</span>
                <IsoDateInput
                  aria-label="시작일"
                  value={safeTxListFilter.start}
                  onValueChange={(value) => updateTxListFilter({ start: value })}
                />
              </label>
              <label className="tx-ledger-filter-field">
                <span>종료일</span>
                <IsoDateInput
                  aria-label="종료일"
                  value={safeTxListFilter.end}
                  onValueChange={(value) => updateTxListFilter({ end: value })}
                />
              </label>
            </div>
          )}
          {mobileFilterKey === "amount" && (
            <div className="tx-ledger-filter-date-grid tx-ledger-filter-amount-grid">
              <label className="tx-ledger-filter-field">
                <span>최소 금액</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="최소 금액"
                  placeholder="0"
                  value={safeTxListFilter.amount_min}
                  onChange={(event) => updateAmountFilter(event, "amount_min")}
                  enterKeyHint="next"
                />
              </label>
              <label className="tx-ledger-filter-field">
                <span>최대 금액</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="최대 금액"
                  placeholder="100,000"
                  value={safeTxListFilter.amount_max}
                  onChange={(event) => updateAmountFilter(event, "amount_max")}
                  enterKeyHint="done"
                />
              </label>
            </div>
          )}
          <button
            type="button"
            className="secondary tx-ledger-filter-reset"
            onClick={() => {
              clearTxListFilter();
              setMobileFilterKey("");
            }}
          >
            필터 초기화
          </button>
        </div>
      )}
      <div className="transactions-surface-scroll">
        <table
          className={`transactions-surface-table${mobileStickyActive ? " mobile-sticky-active" : " mobile-sticky-inactive"}`}
          aria-label="거래 작업 표"
        >
          <thead>
            <tr>
              <th data-mobile-priority="hidden">
                <input
                  type="checkbox"
                  aria-label="표시된 거래 전체 선택"
                  checked={areAllFilteredTransactionsSelected}
                  onChange={(event) => toggleAllFilteredTransactionSelection(Boolean(event.target.checked))}
                />
              </th>
              {TRANSACTION_SURFACE_FIELDS.map((field) => {
                if (field.key === "occurred_on") {
                  return (
                    <th
                      key={field.key}
                      className={field.className}
                      aria-sort={txSortDirection === "asc" ? "ascending" : "descending"}
                      data-field-key={field.key}
                      data-mobile-priority={transactionMobilePriority(field.key)}
                    >
                      {historyMode ? (
                        <span
                          className="sort-header active sort-header-static"
                          aria-label="일자 정렬 연속 내역순 고정"
                        >
                          {field.label}
                          <span className="sort-indicator" aria-hidden="true">↑</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`sort-header${txSortDirection ? " active" : ""}`}
                          aria-label={`일자 정렬 ${txSortDirection === "asc" ? "내림차순으로 변경" : "오름차순으로 변경"}`}
                          onClick={toggleTxSortDirection}
                        >
                          {field.label}
                          <span className="sort-indicator" aria-hidden="true">{txSortDirection === "asc" ? "↑" : "↓"}</span>
                        </button>
                      )}
                    </th>
                  );
                }
                return (
                  <th
                    key={field.key}
                    className={field.className}
                    data-field-key={field.key}
                    data-mobile-priority={transactionMobilePriority(field.key)}
                  >
                    {field.label}
                  </th>
                );
              })}
              <th data-mobile-priority="action">동작</th>
            </tr>
          </thead>
          <tbody>
          {historyMode && (
            <tr ref={historyTopSentinelRef} className="transaction-history-sentinel transaction-history-sentinel-top">
              <td colSpan={columnSpan}>{historyLoadingOlder ? "이전 거래 로딩" : ""}</td>
            </tr>
          )}
          {sortedTransactions.length === 0 && (
            <tr className="surface-empty-row">
              <td colSpan={columnSpan} className="surface-empty-cell">
                <div className="empty-state surface-empty-state" data-testid="transactions-empty-state">
                  거래 내역이 없습니다.
                </div>
              </td>
            </tr>
          )}
          {sortedTransactions.map((item, index) => {
            const isEditing = Boolean(item && txInlineEdit?.id === item.id);
            const editForm = isEditing ? txInlineEdit : null;
            const editOwnerOptions = ownerOptionsWithFallback(editForm?.owner_user_id || "", editForm?.owner_name || "");
            const rowKey = item.id;
            const category = categoryById.get(String(item.category_id || ""));
            const compactCategoryLabel = [
              category?.minor ? toCategoryMinorLabel(category.minor) : "",
              !category?.minor && category?.major ? toCategoryMajorLabel(category.major) : "",
            ].find(Boolean) || "미분류";
            const flowLabel = FLOW_TYPE_LABELS[item.flow_type] || item.flow_type;
            const flowShortLabel = String(flowLabel || "").slice(0, 1) || "-";
            const ownerInitial = extractVisibleInitial(item.owner_name);
            const flowAccent = rowColors[item.flow_type] || DEFAULT_TRANSACTION_ROW_COLORS[item.flow_type];
            const ownerColor = resolveSemanticColor(
              item.owner_name || flowLabel,
              ownerColors[String(item.owner_name || "").trim()],
              { saturation: 72, lightness: 42 }
            );
            const configuredCategoryColor = firstDefinedValue([
              categoryColors[String(category?.minor || "").trim()],
              categoryColors[String(category?.major || "").trim()],
              categoryColors[String(compactCategoryLabel || "").trim()],
            ]);
            const categoryColor = resolveSemanticColor(
              compactCategoryLabel,
              configuredCategoryColor,
              { saturation: 78, lightness: 54 }
            );
            const hasConfiguredCategoryColor = Boolean(String(configuredCategoryColor || "").trim());
            const rowAccent = hasConfiguredCategoryColor ? categoryColor : flowAccent;
            const isExpanded = expandedTransactionRows.has(item.id);
            const previousItem = index > 0 ? sortedTransactions[index - 1] : null;
            const shouldRenderDateHeader =
              historyMode && String(previousItem?.occurred_on || "") !== String(item.occurred_on || "");
            const handleRowToggle = (event) => {
              if (isEditing || isInteractiveRowTarget(event.target)) {
                return;
              }
              toggleExpandedTransactionRow(item.id);
            };
            const handleEditToggle = () => {
              if (!canEditRecords) {
                return;
              }
              if (isEditing) {
                closeTxInlineEdit();
                return;
              }
              setTxInlineEdit({
                id: item.id,
                version: item.version,
                occurred_on: item.occurred_on,
                flow_type: item.flow_type,
                amount: normalizeDecimalInputValue(item.amount),
                category_id: item.category_id || "",
                category_major: categoryById.get(String(item.category_id || ""))?.major || "",
                memo: item.memo || "",
                owner_user_id: item.owner_user_id || "",
                owner_name: item.owner_name || "",
              });
            };
            return (
              <Fragment key={rowKey}>
                {shouldRenderDateHeader && (
                  <tr className="transaction-history-date-row">
                    <td colSpan={columnSpan}>
                      <span>{item.occurred_on}</span>
                    </td>
                  </tr>
                )}
                <tr
                  className={`transaction-row transaction-row-${item.flow_type} ${isEditing ? "transaction-row-editing" : ""} ${isExpanded ? "mobile-row-expanded" : ""}`}
                  data-row-expanded={isExpanded ? "true" : "false"}
                  data-transaction-id={item.id}
                  data-transaction-date={item.occurred_on}
                  onClick={handleRowToggle}
                  style={{
                    "--transaction-row-bg": rowAccent,
                    "--transaction-row-accent": rowAccent,
                    "--transaction-row-wash-strong": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.32 : 0.24),
                    "--transaction-row-wash": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.25 : 0.19),
                    "--transaction-row-wash-soft": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.17 : 0.12),
                    "--transaction-row-border": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.3 : 0.22),
                    "--transaction-owner-color": ownerColor,
                    "--transaction-owner-chip-bg": withAlpha(ownerColor, 0.08),
                    "--transaction-owner-chip-ring": withAlpha(ownerColor, 0.22),
                  }}
                >
                  <td data-label="선택" className="transaction-col-select" data-mobile-priority="hidden">
                    <input
                      type="checkbox"
                      aria-label={`${item.occurred_on} 거래 선택`}
                      checked={selectedTransactionIds.has(item.id)}
                      onChange={() => toggleTransactionSelection(item.id)}
                    />
                  </td>
                  <td data-label="일자" className="transaction-col-date" data-field-key="occurred_on" data-mobile-priority={transactionMobilePriority("occurred_on")}>
                    <span className="desktop-date-text">{item.occurred_on}</span>
                    <span className="mobile-date-text">{formatCompactDate(item.occurred_on)}</span>
                  </td>
                  <td data-label="유형" className="transaction-col-type" data-field-key="flow_type" data-mobile-priority={transactionMobilePriority("flow_type")}>
                    <span className={`transaction-flow-badge transaction-flow-full transaction-flow-${item.flow_type}`}>
                      {flowLabel}
                    </span>
                    <span
                      className={`transaction-flow-badge transaction-flow-short transaction-flow-${item.flow_type}`}
                      title={flowLabel}
                      aria-label={flowLabel}
                    >
                      {flowShortLabel}
                    </span>
                    {ownerInitial ? (
                      <span className="transaction-owner-chip" title={item.owner_name || ""} aria-label={item.owner_name || ""}>
                        {ownerInitial}
                      </span>
                    ) : (
                      <span className="transaction-owner-empty" title="거래자 미입력" aria-label="거래자 미입력">-</span>
                    )}
                  </td>
                  <td data-label="카테고리" className="transaction-col-category transaction-mobile-detail-cell" data-field-key="category" data-mobile-priority={transactionMobilePriority("category")}>
                    <span className="transaction-mobile-detail-label">카테고리</span>
                    <div className="transaction-mobile-detail-value">{renderCategoryCell(category)}</div>
                  </td>
                  <td data-label="메모" className="transaction-col-memo" data-field-key="memo" data-mobile-priority={transactionMobilePriority("memo")}>
                    <span className="transaction-mobile-category-cue">{compactCategoryLabel}</span>
                    <span className="transaction-memo-text">{item.memo || "-"}</span>
                  </td>
                  <td data-label="금액" className="transaction-col-amount" data-field-key="amount" data-mobile-priority={transactionMobilePriority("amount")}>
                    <span className="transaction-amount-text">{fmtKrw(item.amount)}</span>
                  </td>
                  <td data-label="거래자명" className="transaction-col-owner transaction-mobile-detail-cell" data-field-key="owner_name" data-mobile-priority={transactionMobilePriority("owner_name")}>
                    <span className="transaction-mobile-detail-label">거래자명</span>
                    <div className="transaction-mobile-detail-value transaction-owner-cue">{item.owner_name || "-"}</div>
                  </td>
                  <td data-label="최종 수정일" className="transaction-col-updated transaction-mobile-detail-cell" data-field-key="updated_at" data-mobile-priority={transactionMobilePriority("updated_at")}>
                    <span className="transaction-mobile-detail-label">최종 수정일</span>
                    <div className="transaction-mobile-detail-value">{fmtDate(item.updated_at)}</div>
                  </td>
                  <td data-label="동작" className="transaction-col-actions" data-mobile-priority="action">
                    <div className="inline">
                      <button
                        type="button"
                        className={`row-edit-btn ${isEditing ? "primary" : "secondary"}`}
                        disabled={!canEditRecords || loading}
                        onClick={handleEditToggle}
                      >
                        {isEditing ? "수정 중" : "수정"}
                      </button>
                      <button
                        type="button"
                        className="secondary mobile-toggle-btn"
                        aria-label={isExpanded ? "거래 세부 접기" : "거래 세부 보기"}
                        aria-expanded={isExpanded ? "true" : "false"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpandedTransactionRow(item.id);
                        }}
                      >
                        <span className="mobile-toggle-icon" aria-hidden="true">
                          <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                            <path d="M5 3.75L10 8L5 12.25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </button>
                      <button type="button" className="danger row-delete-btn" disabled={!canEditRecords || loading} onClick={() => removeTx(item.id)}>삭제</button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr
                    className="transaction-mobile-expanded-actions-row"
                    style={{
                      "--transaction-row-bg": rowAccent,
                      "--transaction-row-accent": rowAccent,
                      "--transaction-row-wash-strong": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.32 : 0.24),
                      "--transaction-row-wash": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.25 : 0.19),
                      "--transaction-row-wash-soft": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.17 : 0.12),
                      "--transaction-row-border": withAlpha(rowAccent, hasConfiguredCategoryColor ? 0.3 : 0.22),
                      "--transaction-owner-color": ownerColor,
                      "--transaction-owner-chip-bg": withAlpha(ownerColor, 0.08),
                      "--transaction-owner-chip-ring": withAlpha(ownerColor, 0.22),
                    }}
                  >
                    <td colSpan={columnSpan}>
                      <div className="transaction-mobile-expanded-actions">
                        <button
                          type="button"
                          className={isEditing ? "primary" : "secondary"}
                          disabled={!canEditRecords || loading}
                          onClick={handleEditToggle}
                        >
                          {isEditing ? "수정 중" : "수정"}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={!canEditRecords || loading}
                          onClick={() => removeTx(item.id)}
                        >
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              {isEditing && editForm && (
                <tr className="transaction-inline-editor-row transactions-inline-editor" onKeyDown={handleTxInlineEditKeyDown}>
                  <td colSpan={columnSpan} className="transaction-inline-editor-cell">
                    <div className="transaction-inline-editor-grid">
                      <label className="tx-inline-date-field">
                        <span className="tx-inline-field-label">일자</span>
                        <IsoDateInput
                          aria-label="일자"
                          value={editForm.occurred_on}
                          onValueChange={(value) => setTxInlineEdit({ ...editForm, occurred_on: value })}
                          disabled={!canEditRecords}
                          required
                        />
                      </label>
                      <label className="tx-inline-type-field">
                        <span className="tx-inline-field-label">유형</span>
                        <select
                          aria-label="유형"
                          value={editForm.flow_type}
                          disabled={!canEditRecords}
                          onChange={(e) => {
                            setTxInlineEdit({
                              ...editForm,
                              flow_type: e.target.value,
                              category_id: "",
                              category_major: "",
                            });
                          }}
                        >
                          {FLOW_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="tx-inline-category-section" aria-label="카테고리 선택">
                        <label className="tx-inline-major-field">
                          <span className="tx-inline-field-label">카테고리 그룹</span>
                          <select
                            aria-label="카테고리 그룹"
                            value={txInlineCategoryMajor}
                            disabled={!canEditRecords}
                            onChange={(event) =>
                              setTxInlineEdit({
                                ...editForm,
                                category_major: event.target.value,
                                category_id: "",
                              })
                            }
                          >
                            <option value="">(선택 안함)</option>
                            {txInlineCategoryMajorOptions.map((major) => (
                              <option key={major} value={major}>
                                {toCategoryMajorLabel(major)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="tx-inline-minor-field">
                          <span className="tx-inline-field-label">카테고리</span>
                          <select
                            aria-label="카테고리"
                            value={editForm.category_id}
                            disabled={!canEditRecords || !txInlineCategoryMajor}
                            onChange={(e) => setTxInlineEdit({ ...editForm, category_id: e.target.value })}
                          >
                            <option value="">(선택 안함)</option>
                            {txInlineCategoryMinorOptions.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {toCategoryMinorLabel(cat.minor)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="tx-inline-memo-field">
                        <span className="tx-inline-field-label">메모</span>
                        <input
                          aria-label="메모"
                          placeholder="메모"
                          value={editForm.memo}
                          onChange={(e) => setTxInlineEdit({ ...editForm, memo: e.target.value })}
                          disabled={!canEditRecords}
                        />
                      </label>
                      <label className="tx-inline-amount-field">
                        <span className="tx-inline-field-label">금액</span>
                        <input
                          aria-label="금액"
                          placeholder="금액"
                          type="text"
                          inputMode="decimal"
                          value={editForm.amount}
                          onChange={(event) => handleGroupedDecimalInput(event, setTxInlineEdit, "amount")}
                          disabled={!canEditRecords}
                          required
                        />
                      </label>
                      <label className="tx-inline-owner-field">
                        <span className="tx-inline-field-label">거래자명</span>
                        <select
                          aria-label="거래자"
                          value={ownerSelectValue(editForm.owner_user_id, editForm.owner_name)}
                          disabled={!canEditRecords}
                          onChange={(event) =>
                            setTxInlineEdit({
                              ...editForm,
                              ...ownerSelectionFromValue(event.target.value, editOwnerOptions),
                            })
                          }
                        >
                          <option value="">(선택 안함)</option>
                          {editOwnerOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="tx-inline-updated-field" aria-label="최종 수정일">
                        -
                      </span>
                      <div className="inline tx-inline-editor-actions">
                        <button type="button" className="secondary" disabled={!canEditRecords} onClick={() => closeTxInlineEdit()}>
                          취소
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={!canEditRecords}
                          onClick={() => {
                            void submitTxInlineEdit();
                          }}
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
                )}
              </Fragment>
            );
          })}
          {historyMode && (
            <tr ref={historyBottomSentinelRef} className="transaction-history-sentinel transaction-history-sentinel-bottom">
              <td colSpan={columnSpan}>{historyLoadingNewer ? "다음 거래 로딩" : ""}</td>
            </tr>
          )}
          </tbody>
        </table>
      </div>
    </>
  );
}
