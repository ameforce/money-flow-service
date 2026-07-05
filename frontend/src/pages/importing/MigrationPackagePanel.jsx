export function MigrationPackagePanel({ permissions, migration, helpers }) {
  const { canEditRecords } = permissions;
  const {
    doMigrationImport,
    displayImportFileName,
    formatTechnicalReportJson,
    migrationExporting,
    migrationIssuePreview,
    migrationLoadingMode,
    migrationPackageFile,
    migrationPackageInputRef,
    migrationPackageUploadPlaceholder,
    migrationReport,
    migrationStateLabel,
    packageActionsDisabled,
    packageMissingFile,
    updateMigrationPackageFile,
    exportMigrationPackage,
  } = migration;
  const { fmt } = helpers;

  return (
    <section className="import-mode-panel import-package-panel">
      <div className="secondary-table-heading import-report-heading">
        <div className="work-surface-title">
          <span className="surface-eyebrow">환경 이식 패키지</span>
          <h3 id="package-import-heading">데이터 추출/업로드</h3>
        </div>
        <p className="table-summary">{migrationStateLabel}</p>
      </div>
      <p className="table-summary">계정 자체는 이식하지 않습니다. 대상 환경에서 로그인한 현재 가계에 거래/보유/카테고리와 가계 설정을 반영합니다.</p>
      <div className="inline import-action-row import-package-export-row">
        <button type="button" disabled={migrationExporting || Boolean(migrationLoadingMode) || !canEditRecords} onClick={exportMigrationPackage}>
          {migrationExporting ? "패키지 추출 중..." : "현재 가계 패키지 추출"}
        </button>
      </div>
      <div className="file-drop-area" onClick={() => { if (!migrationLoadingMode && !migrationExporting && canEditRecords) migrationPackageInputRef.current?.click(); }}>
        <input ref={migrationPackageInputRef} type="file" accept=".zip" onChange={(e) => updateMigrationPackageFile(e.target.files?.[0] || null)} className="visually-hidden-file-input" aria-label="이식 패키지 업로드" disabled={Boolean(migrationLoadingMode) || migrationExporting || !canEditRecords} />
        {migrationPackageFile ? <div className="upload-file-name">선택된 패키지: {migrationPackageFile.name}</div> : <div className="upload-placeholder">{migrationPackageUploadPlaceholder}</div>}
      </div>
      {packageMissingFile && <p id="package-import-file-required" className="table-summary import-action-help">패키지 파일(.zip)을 선택하면 미리 검증과 적용을 사용할 수 있습니다.</p>}
      <div className="inline import-action-row">
        <button type="button" disabled={packageActionsDisabled} aria-describedby={packageMissingFile ? "package-import-file-required" : undefined} onClick={() => doMigrationImport("dry_run")}>
          {migrationLoadingMode === "dry_run" ? "미리 검증 중..." : "패키지 미리 검증"}
        </button>
        <button type="button" disabled={packageActionsDisabled} aria-describedby={packageMissingFile ? "package-import-file-required" : undefined} onClick={() => doMigrationImport("apply")}>
          {migrationLoadingMode === "apply" ? "적용 중..." : "패키지 적용"}
        </button>
      </div>
      {migrationLoadingMode && <div className="import-progress" role="status" aria-live="polite">이식 패키지를 검증/적용하는 중입니다. 완료까지 잠시만 기다려 주세요.</div>}
      {migrationReport && (
        <>
          <div className="import-summary-grid">
            <div className="import-summary-item"><strong>패키지</strong><span>{displayImportFileName(migrationReport.package_name)}</span></div>
            <div className="import-summary-item"><strong>원본 환경</strong><span>{migrationReport.source_env || "-"}</span></div>
            <div className="import-summary-item"><strong>원본 가계</strong><span>{migrationReport.source_household_name || "-"}</span></div>
            <div className="import-summary-item"><strong>카테고리 행</strong><span>{fmt(migrationReport.category_rows)}</span></div>
            <div className="import-summary-item"><strong>거래 행</strong><span>{fmt(migrationReport.transaction_rows)}</span></div>
            <div className="import-summary-item"><strong>보유 행</strong><span>{fmt(migrationReport.holding_rows)}</span></div>
            <div className="import-summary-item"><strong>적용 카테고리</strong><span>{fmt(migrationReport.applied_categories)}</span></div>
            <div className="import-summary-item"><strong>적용 거래</strong><span>{fmt(migrationReport.applied_transactions)}</span></div>
            <div className="import-summary-item"><strong>적용 보유</strong><span>{fmt(migrationReport.applied_holdings)}</span></div>
          </div>
          <section>
            <h3>이슈 ({fmt((migrationReport.issues || []).length)})</h3>
            {migrationIssuePreview.length === 0 ? <p className="table-summary">검출된 이슈가 없습니다.</p> : <ul className="compact-list">{migrationIssuePreview.map((issue, index) => <li key={`${issue.code}-${issue.sheet || "none"}-${issue.row || 0}-${index}`}>[{issue.severity}] {issue.message}</li>)}</ul>}
            {(migrationReport.issues || []).length > migrationIssuePreview.length && <p className="table-summary">+{(migrationReport.issues || []).length - migrationIssuePreview.length}건 더 있음</p>}
          </section>
          <details className="report-technical">
            <summary>기술 상세 보기</summary>
            <pre className="report technical-report-json">{formatTechnicalReportJson(migrationReport)}</pre>
          </details>
        </>
      )}
    </section>
  );
}
