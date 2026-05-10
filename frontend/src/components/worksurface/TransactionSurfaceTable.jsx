import { Fragment } from "react";

import { extractVisibleInitial, resolveSemanticColor, withAlpha } from "./colorSemantics";
import { TRANSACTION_SURFACE_FIELDS } from "./fieldPriority";

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

export function TransactionSurfaceTable({
  sortedTransactions,
  areAllFilteredTransactionsSelected,
  toggleAllFilteredTransactionSelection,
  txSortDirection,
  toggleTxSortDirection,
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

  return (
    <>
      <div
        className="surface-ledger-mobile-head transactions-mobile-ledger-head"
        data-sticky-active={mobileStickyActive ? "true" : "false"}
        aria-hidden="true"
      >
        <span className="ledger-head-select" />
        <span className="ledger-head-date">일자</span>
        <span className="ledger-head-main">메모</span>
        <span className="ledger-head-amount">금액</span>
        <span className="ledger-head-cues">유형·사용자</span>
        <span className="ledger-head-actions">⋯</span>
      </div>
      <table
        className={`transactions-surface-table${mobileStickyActive ? " mobile-sticky-active" : " mobile-sticky-inactive"}`}
        aria-label="거래 작업 표"
      >
        <thead>
          <tr>
            <th>
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
                  <th key={field.key} className={field.className} aria-sort={txSortDirection === "asc" ? "ascending" : "descending"}>
                    <button
                      type="button"
                      className={`sort-header${txSortDirection ? " active" : ""}`}
                      aria-label={`일자 정렬 ${txSortDirection === "asc" ? "내림차순으로 변경" : "오름차순으로 변경"}`}
                      onClick={toggleTxSortDirection}
                    >
                      {field.label}
                      <span className="sort-indicator" aria-hidden="true">{txSortDirection === "asc" ? "↑" : "↓"}</span>
                    </button>
                  </th>
                );
              }
              return <th key={field.key} className={field.className}>{field.label}</th>;
            })}
            <th>동작</th>
          </tr>
        </thead>
        <tbody>
          {sortedTransactions.length === 0 && (
            <tr>
              <td colSpan={columnSpan} className="empty-state">조건에 맞는 거래가 없습니다.</td>
            </tr>
          )}
          {sortedTransactions.map((item) => {
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
                <tr
                  className={`transaction-row transaction-row-${item.flow_type} ${isEditing ? "transaction-row-editing" : ""} ${isExpanded ? "mobile-row-expanded" : ""}`}
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
                  <td data-label="선택" className="transaction-col-select">
                    <input
                      type="checkbox"
                      aria-label={`${item.occurred_on} 거래 선택`}
                      checked={selectedTransactionIds.has(item.id)}
                      onChange={() => toggleTransactionSelection(item.id)}
                    />
                  </td>
                  <td data-label="일자" className="transaction-col-date">
                    <span className="desktop-date-text">{item.occurred_on}</span>
                    <span className="mobile-date-text">{formatCompactDate(item.occurred_on)}</span>
                  </td>
                  <td data-label="유형" className="transaction-col-type">
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
                  <td data-label="카테고리" className="transaction-col-category">{renderCategoryCell(category)}</td>
                  <td data-label="메모" className="transaction-col-memo">
                    <span className="transaction-mobile-category-cue">{compactCategoryLabel}</span>
                    <span className="transaction-memo-text">{item.memo || "-"}</span>
                  </td>
                  <td data-label="금액" className="transaction-col-amount">
                    <span className="transaction-amount-text">{fmtKrw(item.amount)}</span>
                  </td>
                  <td data-label="거래자명" className="transaction-col-owner">
                    <span className="transaction-owner-cue">{item.owner_name || "-"}</span>
                  </td>
                  <td data-label="최종 수정일" className="transaction-col-updated">{fmtDate(item.updated_at)}</td>
                  <td data-label="동작" className="transaction-col-actions">
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
                        onClick={() => toggleExpandedTransactionRow(item.id)}
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
                  <td data-label="선택">-</td>
                  <td data-label="일자">
                    <label className="tx-inline-date-field">
                      <input
                        aria-label="일자"
                        type="date"
                        placeholder="일자"
                        value={editForm.occurred_on}
                        onChange={(e) => setTxInlineEdit({ ...editForm, occurred_on: e.target.value })}
                        disabled={!canEditRecords}
                        required
                      />
                    </label>
                  </td>
                  <td data-label="유형">
                    <label className="tx-inline-type-field">
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
                  </td>
                  <td data-label="카테고리">
                    <div className="tx-inline-category-section" aria-label="카테고리 선택">
                      <label className="tx-inline-major-field">
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
                  </td>
                  <td data-label="메모">
                    <label className="tx-inline-memo-field">
                      <input
                        aria-label="메모"
                        placeholder="메모"
                        value={editForm.memo}
                        onChange={(e) => setTxInlineEdit({ ...editForm, memo: e.target.value })}
                        disabled={!canEditRecords}
                      />
                    </label>
                  </td>
                  <td data-label="금액">
                    <label className="tx-inline-amount-field">
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
                  </td>
                  <td data-label="거래자명">
                    <label className="tx-inline-owner-field">
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
                  </td>
                  <td data-label="최종 수정일">-</td>
                  <td data-label="동작">
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
                  </td>
                </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
