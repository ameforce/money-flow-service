import { HOLDING_SURFACE_FIELDS, getWorkSurfaceMobilePriority } from "./fieldPriority";

export function HoldingSurfaceTable({
  holdingColumnWidths,
  sortedHoldingItems,
  holdingListTab,
  groupedHoldingSections,
  renderHoldingSortAria,
  renderHoldingSortHeader,
  renderHoldingRow,
  moveHoldingCategoryOrder,
  fmtKrw,
}) {
  const columnSpan = HOLDING_SURFACE_FIELDS.length + 2;
  const holdingMobilePriority = (fieldKey) => getWorkSurfaceMobilePriority("holdings", fieldKey);

  return (
    <>
      <div className="surface-ledger-mobile-head holdings-mobile-ledger-head" aria-hidden="true">
        <span className="ledger-head-select" />
        <span className="ledger-head-main">자산</span>
        <span className="ledger-head-cues">분류</span>
        <span className="ledger-head-amount">평가</span>
        <span className="ledger-head-actions">⋯</span>
      </div>
      <div className="holdings-surface-scroll">
        <table
          className="holdings-surface-table"
          aria-label="자산 작업 표"
          style={{
            "--holding-col-name": `${holdingColumnWidths.name || 160}px`,
            "--holding-col-type": `${holdingColumnWidths.type || 70}px`,
            "--holding-col-owner": `${holdingColumnWidths.owner || 96}px`,
            "--holding-col-category": `${holdingColumnWidths.category || 80}px`,
            "--holding-col-quantity": `${holdingColumnWidths.quantity || 58}px`,
            "--holding-col-average": `${holdingColumnWidths.average_cost || 78}px`,
            "--holding-col-market": `${holdingColumnWidths.market_value_krw || 92}px`,
            "--holding-col-gain": `${holdingColumnWidths.gain_loss_krw || 96}px`,
            "--holding-col-updated": `${holdingColumnWidths.updated_at || 108}px`,
            "--holding-col-actions": `${holdingColumnWidths.actions || 124}px`,
          }}
        >
          <thead>
            <tr>
              <th className="holding-col-select" data-mobile-priority="hidden">선택</th>
              {HOLDING_SURFACE_FIELDS.map((field) => (
                <th
                  key={field.key}
                  className={field.className}
                  aria-sort={renderHoldingSortAria(field.key)}
                  data-field-key={field.key}
                  data-mobile-priority={holdingMobilePriority(field.key)}
                >
                  {renderHoldingSortHeader(field.key)}
                </th>
              ))}
              <th className="holding-col-actions" data-mobile-priority="action">동작</th>
            </tr>
          </thead>
          <tbody>
            {sortedHoldingItems.length === 0 && (
              <tr className="surface-empty-row">
                <td colSpan={columnSpan} className="surface-empty-cell">
                  <div className="empty-state surface-empty-state" data-testid="holdings-empty-state">
                    자산 내역이 없습니다.
                  </div>
                </td>
              </tr>
            )}
            {holdingListTab === "all"
              ? groupedHoldingSections.flatMap(([categoryName, sectionItems]) => [
                  <tr key={`section-${categoryName}`} className="holding-section-row">
                    <td className="section-header-cell" colSpan={columnSpan}>
                      <div className="inline holding-section-header">
                        <span className="holding-section-title">
                          {categoryName} · {fmtKrw(sectionItems.reduce((sum, rowItem) => sum + Number(rowItem.market_value_krw || 0), 0))}
                        </span>
                        <span className="inline holding-section-actions">
                          <button
                            type="button"
                            className="secondary holding-section-order-btn"
                            aria-label={`${categoryName} 그룹 위로 이동`}
                            onClick={() => moveHoldingCategoryOrder(categoryName, -1).catch(() => undefined)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="secondary holding-section-order-btn"
                            aria-label={`${categoryName} 그룹 아래로 이동`}
                            onClick={() => moveHoldingCategoryOrder(categoryName, 1).catch(() => undefined)}
                          >
                            ↓
                          </button>
                        </span>
                      </div>
                    </td>
                  </tr>,
                  ...sectionItems.map((item) => renderHoldingRow(item, `all-${categoryName}-${item.holding_id}`)),
                ])
              : sortedHoldingItems.map((item) => renderHoldingRow(item, `tab-${holdingListTab}-${item.holding_id}`))}
          </tbody>
        </table>
      </div>
    </>
  );
}
