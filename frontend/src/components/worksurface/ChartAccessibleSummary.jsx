export function FlowTrendValueTable({ rows, formatCurrency, className = "", testId = "dashboard-flow-value-table" }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const formatValue = (value) => (typeof formatCurrency === "function" ? formatCurrency(value) : String(value ?? ""));

  return (
    <div className={`chart-accessible-summary ${className}`.trim()}>
      <div className="chart-data-table-scroll" tabIndex={0} aria-label="월별 현금 흐름 수치 스크롤 영역">
        <table className="chart-data-table" data-testid={testId} aria-label="월별 현금 흐름 수치">
          <thead>
            <tr>
              <th scope="col">월</th>
              <th scope="col">수입</th>
              <th scope="col">지출</th>
              <th scope="col">투자</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month}>
                <th scope="row">{row.month}</th>
                <td>{formatValue(row.income)}</td>
                <td>{formatValue(row.expense)}</td>
                <td>{formatValue(row.investment)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ChartBreakdownList({
  items,
  ariaLabel,
  testId,
  className = "",
  activeKey = "",
  onItemAction,
  itemActionLabelSuffix = "만 보기",
}) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return (
    <ul className={`portfolio-breakdown-list chart-breakdown-list ${className}`.trim()} aria-label={ariaLabel} data-testid={testId}>
      {items.map((item) => {
        const rowContent = (
          <>
            <span className="portfolio-breakdown-name">
              <span className="portfolio-breakdown-dot" style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </span>
            <span className="portfolio-breakdown-value">{item.valueText}</span>
            <strong>{item.shareText}</strong>
          </>
        );

        return (
          <li key={item.key}>
            {onItemAction ? (
              <button
                type="button"
                className={activeKey === item.key ? "active" : ""}
                aria-label={`${item.label}${itemActionLabelSuffix}`}
                onClick={() => onItemAction(item)}
              >
                {rowContent}
              </button>
            ) : (
              <div className="portfolio-breakdown-row">{rowContent}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
