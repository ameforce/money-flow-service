const HOLDING_COLUMN_WIDTH_OPTIONS = [
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
];

export function HoldingDisplayOptions({
  holdingColorMode,
  holdingGroupByColor,
  holdingColumnWidths,
  updateHoldingColorMode,
  updateHoldingGroupByColor,
  updateHoldingColumnWidth,
}) {
  return (
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
          <input type="checkbox" checked={holdingGroupByColor} onChange={(event) => updateHoldingGroupByColor(Boolean(event.target.checked))} />
          색상 그룹 우선 정렬
        </label>
      </div>
      <details className="holding-column-width-editor">
        <summary>열 너비 조정</summary>
        <div className="form-grid settings-form-grid">
          {HOLDING_COLUMN_WIDTH_OPTIONS.map(([columnKey, label]) => (
            <label key={columnKey}>
              {label}
              <input type="range" min="80" max="600" value={Number(holdingColumnWidths[columnKey] || 140)} onChange={(event) => updateHoldingColumnWidth(columnKey, event.target.value)} />
            </label>
          ))}
        </div>
      </details>
    </details>
  );
}
