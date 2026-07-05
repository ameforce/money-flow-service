export function ImportReportPanel({ importReportSortOptions, reportState, reportActions, helpers }) {
  const {
    importAppliedHoldingRefs,
    importAppliedTransactionRefs,
    importIssuePreview,
    importMismatchPreview,
    importReport,
    importReportRows,
    importReportSearch,
    importReportSeverityFilter,
    importReportSeverityOptions,
    importReportSort,
    importReportTypeFilter,
    importReportTypeOptions,
    importReportVisibleRows,
  } = reportState;
  const { copyImportReportCsv, downloadImportReportCsv, formatTechnicalReportJson, hasImportPostApplyTargets, showImportedHoldings, showImportedTransactions, startImportedCorrection, updateImportReportSearch, updateImportReportSeverityFilter, updateImportReportSort, updateImportReportTypeFilter } = reportActions;
  const { displayImportFileName, fmt } = helpers;

  return (
    <section className="import-report">
      <div className="secondary-table-heading import-report-heading">
        <div className="work-surface-title">
          <span className="surface-eyebrow">검증 리포트</span>
          <h3>가져오기 결과</h3>
        </div>
        <p className="table-summary">거래 {fmt(importReport.transaction_rows)}행 · 보유 {fmt(importReport.holding_rows)}행</p>
      </div>
      <div className="import-summary-grid">
        <div className="import-summary-item"><strong>파일</strong><span>{displayImportFileName(importReport.workbook_path)}</span></div>
        <div className="import-summary-item"><strong>시트 수</strong><span>{fmt(importReport.sheets)}</span></div>
        <div className="import-summary-item"><strong>거래 행</strong><span>{fmt(importReport.transaction_rows)}</span></div>
        <div className="import-summary-item"><strong>보유 행</strong><span>{fmt(importReport.holding_rows)}</span></div>
        <div className="import-summary-item"><strong>적용된 거래</strong><span>{fmt(importReport.applied_transactions)}</span></div>
        <div className="import-summary-item"><strong>적용된 보유(추가/수정)</strong><span>{fmt(importReport.applied_holdings_added)} / {fmt(importReport.applied_holdings_updated)}</span></div>
      </div>
      {hasImportPostApplyTargets && (
        <section className="import-post-apply-actions" aria-label="가져오기 적용 후 이동">
          <div className="import-post-apply-copy">
            <strong>적용한 항목 바로가기</strong>
            <span>거래 {fmt(importAppliedTransactionRefs.length)}건 · 자산 {fmt(importAppliedHoldingRefs.length)}건을 목록에서 바로 확인하고 수정할 수 있습니다.</span>
          </div>
          <div className="import-post-apply-buttons">
            <button type="button" className="secondary-btn" disabled={importAppliedTransactionRefs.length === 0} onClick={() => showImportedTransactions()}>가져온 거래 보기</button>
            <button type="button" className="secondary-btn" disabled={importAppliedHoldingRefs.length === 0} onClick={() => showImportedHoldings()}>가져온 자산 보기</button>
            <button type="button" className="primary" onClick={() => startImportedCorrection()}>수정 시작</button>
          </div>
        </section>
      )}
      <ImportIssuePreview importReport={importReport} importMismatchPreview={importMismatchPreview} importIssuePreview={importIssuePreview} fmt={fmt} />
      {importReportRows.length > 0 && (
        <section className="import-report-workbench" aria-labelledby="import-report-workbench-title">
          <div className="secondary-table-heading import-report-workbench-heading">
            <div className="work-surface-title">
              <span className="surface-eyebrow">정리 도구</span>
              <h3 id="import-report-workbench-title">문제 정리 표</h3>
            </div>
            <p className="table-summary">전체 {fmt(importReportRows.length)}건 · 표시 {fmt(importReportVisibleRows.length)}건</p>
          </div>
          <div className="import-report-toolbar">
            <label><span>검색</span><input type="search" aria-label="정리 표 검색" value={importReportSearch} onChange={(event) => updateImportReportSearch(event.target.value)} placeholder="시트, 행, 유형, 메시지" /></label>
            <label><span>심각도</span><select aria-label="심각도 필터" value={importReportSeverityFilter} onChange={(event) => updateImportReportSeverityFilter(event.target.value)}><option value="all">전체</option>{importReportSeverityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>유형</span><select aria-label="유형 필터" value={importReportTypeFilter} onChange={(event) => updateImportReportTypeFilter(event.target.value)}><option value="all">전체</option>{importReportTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>정렬</span><select aria-label="정렬" value={importReportSort} onChange={(event) => updateImportReportSort(event.target.value)}>{importReportSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <div className="import-report-actions">
              <button type="button" className="secondary-btn" disabled={importReportVisibleRows.length === 0} onClick={copyImportReportCsv}>CSV 복사</button>
              <button type="button" className="secondary-btn" disabled={importReportVisibleRows.length === 0} onClick={downloadImportReportCsv}>CSV 다운로드</button>
            </div>
          </div>
          <ImportReportTable rows={importReportVisibleRows} />
        </section>
      )}
      <details className="report-technical">
        <summary>기술 상세 보기</summary>
        <pre className="report technical-report-json">{formatTechnicalReportJson(importReport)}</pre>
      </details>
    </section>
  );
}

function ImportIssuePreview({ importReport, importMismatchPreview, importIssuePreview, fmt }) {
  return (
    <div className="import-list-grid">
      <section>
        <h3>수식 불일치 셀 ({fmt(importReport.monthly_formula_mismatch_count)})</h3>
        {importMismatchPreview.length === 0 ? <p className="table-summary">불일치가 없습니다.</p> : <ul className="compact-list">{importMismatchPreview.map((cell) => <li key={cell}>{cell}</li>)}</ul>}
        {(importReport.detected_mismatch_cells || []).length > importMismatchPreview.length && <p className="table-summary">+{(importReport.detected_mismatch_cells || []).length - importMismatchPreview.length}건 더 있음</p>}
      </section>
      <section>
        <h3>이슈 ({fmt((importReport.issues || []).length)})</h3>
        {importIssuePreview.length === 0 ? <p className="table-summary">검출된 이슈가 없습니다.</p> : (
          <ul className="compact-list">
            {importIssuePreview.map((issue, index) => (
              <li key={`${issue.code}-${issue.sheet || "none"}-${issue.row || 0}-${index}`}>[{issue.severity}] {issue.message}{issue.sheet ? ` (${issue.sheet}` : ""}{issue.row ? `:${issue.row}` : ""}{issue.sheet ? ")" : ""}</li>
            ))}
          </ul>
        )}
        {(importReport.issues || []).length > importIssuePreview.length && <p className="table-summary">+{(importReport.issues || []).length - importIssuePreview.length}건 더 있음</p>}
      </section>
    </div>
  );
}

function ImportReportTable({ rows }) {
  return (
    <div className="import-report-table-scroll">
      <table className="import-report-table">
        <thead><tr><th scope="col">심각도</th><th scope="col">유형</th><th scope="col">시트</th><th scope="col">행/셀</th><th scope="col">메시지</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5}>필터 조건에 맞는 항목이 없습니다.</td></tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} id={`import-report-row-${row.id}`}>
                <td><span className="import-report-severity" data-severity={row.severity}>{row.severityLabel}</span></td>
                <td>{row.typeLabel}</td>
                <td>{row.sheet || "-"}</td>
                <td><a href={`#import-report-row-${row.id}`}>{row.target}</a></td>
                <td>{row.message}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
