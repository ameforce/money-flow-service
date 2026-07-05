export function ImportPage({ view }) {
  const {
    FLOW_TYPE_OPTIONS,
    IMPORT_MODE_LABELS,
    IMPORT_REPORT_SORT_OPTIONS,
    IMPORT_SOURCE_MODES,
    TOSS_IMAGE_ACCEPT,
    applyLegacyOwnerRemap,
    canEditRecords,
    categories,
    categoryById,
    copyImportReportCsv,
    defaultOwnerRemapOption,
    displayImportFileName,
    doImport,
    doMigrationImport,
    doTossApply,
    doTossPreview,
    downloadImportReportCsv,
    exportMigrationPackage,
    fmt,
    formatTechnicalReportJson,
    hasImportPostApplyTargets,
    importAppliedHoldingRefs,
    importAppliedTransactionRefs,
    importBusy,
    importFile,
    importFileInputRef,
    importIssuePreview,
    importLoadingMode,
    importMismatchPreview,
    importMode,
    importReport,
    importReportRows,
    importReportSearch,
    importReportSeverityFilter,
    importReportSeverityOptions,
    importReportSort,
    importReportTypeFilter,
    importReportTypeOptions,
    importReportVisibleRows,
    importStateLabel,
    isDragOver,
    legacyOwnerCleanupRows,
    legacyOwnerCountText,
    migrationExporting,
    migrationIssuePreview,
    migrationLoadingMode,
    migrationPackageFile,
    migrationPackageInputRef,
    migrationPackageUploadPlaceholder,
    migrationReport,
    migrationStateLabel,
    ownerMemberOptions,
    ownerRemapTargets,
    ownerRemappingKey,
    packageActionsDisabled,
    packageMissingFile,
    setImportFile,
    setImportMode,
    setImportReportSearch,
    setImportReportSeverityFilter,
    setImportReportSort,
    setImportReportTypeFilter,
    setIsDragOver,
    setMigrationPackageFile,
    setOwnerRemapTargets,
    setTossImportFiles,
    showImportedHoldings,
    showImportedTransactions,
    startCategoryDraftFromTossRecommendation,
    startImportedCorrection,
    toCategoryPairLabel,
    tossApplyReport,
    tossDuplicateCount,
    tossExcludedCandidates,
    tossFileInputRef,
    tossFiles,
    tossIncludedCount,
    tossLoadingMode,
    tossPreview,
    tossRows,
    tossUploadPlaceholder,
    updateTossPreviewRow,
    workbookActionsDisabled,
    workbookMissingFile,
    workbookUploadPlaceholder,
  } = view;

  return (
    <section className="grid-1 secondary-surface-grid import-surface-grid">
              <article className="card secondary-surface-card import-console-card">
                <div className="secondary-surface-header import-surface-header">
                  <div className="work-surface-title">
                    <span className="surface-eyebrow">엑셀 파이프라인</span>
                    <h2>데이터 파일 가져오기</h2>
                  </div>
                  <div className="surface-control-strip secondary-control-strip" aria-label="데이터 가져오기 상태">
                    <span className={`surface-chip${importLoadingMode || importReport ? " surface-chip-strong" : ""}`}>
                      {importStateLabel}
                    </span>
                    <span className="surface-chip">{importFile ? "파일 선택됨" : "파일 미선택"}</span>
                    <span className={`surface-chip${canEditRecords ? " surface-chip-strong" : " surface-chip-muted"}`}>
                      {canEditRecords ? "편집 가능" : "읽기 전용"}
                    </span>
                  </div>
                </div>
                {!canEditRecords && (
                  <p className="table-summary">데이터 가져오기는 편집자 이상 권한에서만 가능합니다.</p>
                )}
                {legacyOwnerCleanupRows.length > 0 && (
                  <section className="owner-remap-cleanup" aria-labelledby="owner-remap-cleanup-title">
                    <div className="secondary-table-heading owner-remap-heading">
                      <div className="work-surface-title">
                        <span className="surface-eyebrow">소유자 정리</span>
                        <h3 id="owner-remap-cleanup-title">기존 소유자 정리</h3>
                      </div>
                      <p className="table-summary">
                        기존 값은 현재 가계 구성원과 연결되지 않은 과거/가져오기 소유자명입니다.
                      </p>
                    </div>
                    <div className="owner-remap-list">
                      {legacyOwnerCleanupRows.map((row) => {
                        const targetValue = ownerRemapTargets[row.key] || defaultOwnerRemapOption?.value || "";
                        const remapping = ownerRemappingKey === row.key;
                        const totalCount = row.transactions.length + row.holdings.length;
                        return (
                          <div className="owner-remap-row" key={row.key}>
                            <div className="owner-remap-summary">
                              <strong>{row.ownerName} (기존 값)</strong>
                              <span>{legacyOwnerCountText(row)}</span>
                            </div>
                            <label>
                              매핑 대상
                              <select
                                aria-label={`${row.ownerName} 매핑 대상`}
                                value={targetValue}
                                disabled={!canEditRecords || remapping || ownerMemberOptions.length === 0}
                                onChange={(event) =>
                                  setOwnerRemapTargets((prev) => ({
                                    ...prev,
                                    [row.key]: event.target.value,
                                  }))
                                }
                              >
                                {ownerMemberOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              className="secondary"
                              disabled={!canEditRecords || remapping || !targetValue || totalCount === 0}
                              onClick={() => applyLegacyOwnerRemap(row.key)}
                            >
                              {remapping ? "매핑 중..." : "현재 구성원으로 매핑"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
                <div className="mobile-import-package-export">
                  <button
                    type="button"
                    disabled={migrationExporting || Boolean(migrationLoadingMode) || !canEditRecords}
                    onClick={exportMigrationPackage}
                  >
                    {migrationExporting ? "패키지 추출 중..." : "현재 가계 패키지 추출"}
                  </button>
                </div>
                <div className="import-mode-grid">
                  <section className="import-mode-panel import-excel-panel">
                    <div className="secondary-table-heading import-report-heading">
                      <div className="work-surface-title">
                        <span className="surface-eyebrow">원본 데이터</span>
                        <h3 id="excel-import-heading">데이터 파일 업로드</h3>
                      </div>
                      <p className="table-summary">
                        {importMode === "toss"
                          ? (tossFiles.length > 0 ? `이미지 ${fmt(tossFiles.length)}개 선택됨` : "이미지 대기")
                          : (importFile ? "파일 선택됨" : "파일 대기")}
                      </p>
                    </div>
                    <div className="import-mode-switch" role="tablist" aria-label="가져오기 형식">
                      {IMPORT_SOURCE_MODES.map((mode) => (
                        <button
                          key={mode.value}
                          type="button"
                          className={importMode === mode.value ? "active" : "secondary"}
                          onClick={() => {
                            setImportMode(mode.value);
                            setIsDragOver(false);
                          }}
                          disabled={importBusy}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>

                    {importMode === "workbook" && (
                      <>
                    <div
                      className={`file-drop-area ${isDragOver ? "drag-over" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!importBusy && canEditRecords) setIsDragOver(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (!importBusy && canEditRecords && e.dataTransfer.files?.[0]) {
                          setImportFile(e.dataTransfer.files[0]);
                        }
                      }}
                      onClick={() => {
                        if (!importBusy && canEditRecords) importFileInputRef.current?.click();
                      }}
                    >
                      <input
                        ref={importFileInputRef}
                        type="file"
                        accept=".xlsx"
                        onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                        className="visually-hidden-file-input"
                        aria-label="엑셀 파일 업로드"
                        disabled={importBusy || !canEditRecords}
                      />
                      {importFile ? (
                        <div className="upload-file-name">선택된 파일: {importFile.name}</div>
                      ) : (
                        <div className="upload-placeholder">{workbookUploadPlaceholder}</div>
                      )}
                    </div>
                    {workbookMissingFile && (
                      <p id="excel-import-file-required" className="table-summary import-action-help">
                        엑셀 파일을 선택하면 미리 검증과 적용을 사용할 수 있습니다.
                      </p>
                    )}
                    <div className="inline import-action-row">
                      <button
                        type="button"
                        disabled={workbookActionsDisabled}
                        aria-describedby={workbookMissingFile ? "excel-import-file-required" : undefined}
                        onClick={() => doImport("dry_run")}
                      >
                        {importLoadingMode === "dry_run" ? "미리 검증 중..." : IMPORT_MODE_LABELS.dry_run}
                      </button>
                      <button
                        type="button"
                        disabled={workbookActionsDisabled}
                        aria-describedby={workbookMissingFile ? "excel-import-file-required" : undefined}
                        onClick={() => doImport("apply")}
                      >
                        {importLoadingMode === "apply" ? "적용 중..." : IMPORT_MODE_LABELS.apply}
                      </button>
                    </div>
                    {importLoadingMode && (
                      <div className="import-progress" role="status" aria-live="polite">
                        서버에서 파일을 처리 중입니다. 완료까지 잠시만 기다려 주세요.
                      </div>
                    )}
                    {importReport && (
                      <section className="import-report">
                        <div className="secondary-table-heading import-report-heading">
                          <div className="work-surface-title">
                            <span className="surface-eyebrow">검증 리포트</span>
                            <h3>가져오기 결과</h3>
                          </div>
                          <p className="table-summary">
                            거래 {fmt(importReport.transaction_rows)}행 · 보유 {fmt(importReport.holding_rows)}행
                          </p>
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
                              <span>
                                거래 {fmt(importAppliedTransactionRefs.length)}건 · 자산 {fmt(importAppliedHoldingRefs.length)}건을
                                목록에서 바로 확인하고 수정할 수 있습니다.
                              </span>
                            </div>
                            <div className="import-post-apply-buttons">
                              <button
                                type="button"
                                className="secondary-btn"
                                disabled={importAppliedTransactionRefs.length === 0}
                                onClick={() => showImportedTransactions()}
                              >
                                가져온 거래 보기
                              </button>
                              <button
                                type="button"
                                className="secondary-btn"
                                disabled={importAppliedHoldingRefs.length === 0}
                                onClick={() => showImportedHoldings()}
                              >
                                가져온 자산 보기
                              </button>
                              <button type="button" className="primary" onClick={() => startImportedCorrection()}>
                                수정 시작
                              </button>
                            </div>
                          </section>
                        )}
                        <div className="import-list-grid">
                          <section>
                            <h3>수식 불일치 셀 ({fmt(importReport.monthly_formula_mismatch_count)})</h3>
                            {importMismatchPreview.length === 0 ? (
                              <p className="table-summary">불일치가 없습니다.</p>
                            ) : (
                              <ul className="compact-list">
                                {importMismatchPreview.map((cell) => (
                                  <li key={cell}>{cell}</li>
                                ))}
                              </ul>
                            )}
                            {(importReport.detected_mismatch_cells || []).length > importMismatchPreview.length && (
                              <p className="table-summary">
                                +{(importReport.detected_mismatch_cells || []).length - importMismatchPreview.length}건 더 있음
                              </p>
                            )}
                          </section>
                          <section>
                            <h3>이슈 ({fmt((importReport.issues || []).length)})</h3>
                            {importIssuePreview.length === 0 ? (
                              <p className="table-summary">검출된 이슈가 없습니다.</p>
                            ) : (
                              <ul className="compact-list">
                                {importIssuePreview.map((issue, index) => (
                                  <li key={`${issue.code}-${issue.sheet || "none"}-${issue.row || 0}-${index}`}>
                                    [{issue.severity}] {issue.message}
                                    {issue.sheet ? ` (${issue.sheet}` : ""}
                                    {issue.row ? `:${issue.row}` : ""}
                                    {issue.sheet ? ")" : ""}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {(importReport.issues || []).length > importIssuePreview.length && (
                              <p className="table-summary">+{(importReport.issues || []).length - importIssuePreview.length}건 더 있음</p>
                            )}
                          </section>
                        </div>
                        {importReportRows.length > 0 && (
                          <section className="import-report-workbench" aria-labelledby="import-report-workbench-title">
                            <div className="secondary-table-heading import-report-workbench-heading">
                              <div className="work-surface-title">
                                <span className="surface-eyebrow">정리 도구</span>
                                <h3 id="import-report-workbench-title">문제 정리 표</h3>
                              </div>
                              <p className="table-summary">
                                전체 {fmt(importReportRows.length)}건 · 표시 {fmt(importReportVisibleRows.length)}건
                              </p>
                            </div>
                            <div className="import-report-toolbar">
                              <label>
                                <span>검색</span>
                                <input
                                  type="search"
                                  aria-label="정리 표 검색"
                                  value={importReportSearch}
                                  onChange={(event) => setImportReportSearch(event.target.value)}
                                  placeholder="시트, 행, 유형, 메시지"
                                />
                              </label>
                              <label>
                                <span>심각도</span>
                                <select
                                  aria-label="심각도 필터"
                                  value={importReportSeverityFilter}
                                  onChange={(event) => setImportReportSeverityFilter(event.target.value)}
                                >
                                  <option value="all">전체</option>
                                  {importReportSeverityOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>유형</span>
                                <select
                                  aria-label="유형 필터"
                                  value={importReportTypeFilter}
                                  onChange={(event) => setImportReportTypeFilter(event.target.value)}
                                >
                                  <option value="all">전체</option>
                                  {importReportTypeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>정렬</span>
                                <select
                                  aria-label="정렬"
                                  value={importReportSort}
                                  onChange={(event) => setImportReportSort(event.target.value)}
                                >
                                  {IMPORT_REPORT_SORT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div className="import-report-actions">
                                <button
                                  type="button"
                                  className="secondary-btn"
                                  disabled={importReportVisibleRows.length === 0}
                                  onClick={copyImportReportCsv}
                                >
                                  CSV 복사
                                </button>
                                <button
                                  type="button"
                                  className="secondary-btn"
                                  disabled={importReportVisibleRows.length === 0}
                                  onClick={downloadImportReportCsv}
                                >
                                  CSV 다운로드
                                </button>
                              </div>
                            </div>
                            <div className="import-report-table-scroll">
                              <table className="import-report-table">
                                <thead>
                                  <tr>
                                    <th scope="col">심각도</th>
                                    <th scope="col">유형</th>
                                    <th scope="col">시트</th>
                                    <th scope="col">행/셀</th>
                                    <th scope="col">메시지</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {importReportVisibleRows.length === 0 ? (
                                    <tr>
                                      <td colSpan={5}>필터 조건에 맞는 항목이 없습니다.</td>
                                    </tr>
                                  ) : (
                                    importReportVisibleRows.map((row) => (
                                      <tr key={row.id} id={`import-report-row-${row.id}`}>
                                        <td>
                                          <span className="import-report-severity" data-severity={row.severity}>
                                            {row.severityLabel}
                                          </span>
                                        </td>
                                        <td>{row.typeLabel}</td>
                                        <td>{row.sheet || "-"}</td>
                                        <td>
                                          <a href={`#import-report-row-${row.id}`}>{row.target}</a>
                                        </td>
                                        <td>{row.message}</td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </section>
                        )}
                        <details className="report-technical">
                          <summary>기술 상세 보기</summary>
                          <pre className="report technical-report-json">{formatTechnicalReportJson(importReport)}</pre>
                        </details>
                      </section>
                    )}
                  </>
                )}

                {importMode === "toss" && (
                  <section className="toss-import-panel">
                    <div
                      className={`file-drop-area toss-drop-area ${isDragOver ? "drag-over" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!importBusy && canEditRecords) setIsDragOver(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        if (!importBusy && canEditRecords && e.dataTransfer.files?.length) {
                          setTossImportFiles(e.dataTransfer.files);
                        }
                      }}
                      onClick={() => {
                        if (!importBusy && canEditRecords) tossFileInputRef.current?.click();
                      }}
                    >
                      <input
                        ref={tossFileInputRef}
                        type="file"
                        accept={TOSS_IMAGE_ACCEPT}
                        multiple
                        onChange={(e) => setTossImportFiles(e.target.files)}
                        className="visually-hidden-file-input"
                        aria-label="토스 스크린샷 업로드"
                        disabled={importBusy || !canEditRecords}
                      />
                      {tossFiles.length > 0 ? (
                        <ul className="upload-file-list">
                          {tossFiles.map((file) => (
                            <li key={`${file.name}-${file.size}`}>{file.name}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="upload-placeholder">{tossUploadPlaceholder}</div>
                      )}
                    </div>
                    <div className="inline import-actions">
                      <button type="button" disabled={importBusy || !canEditRecords} onClick={() => doTossPreview()}>
                        {tossLoadingMode === "preview" ? "추출 중..." : "검토 표 만들기"}
                      </button>
                      <button
                        type="button"
                        disabled={importBusy || !canEditRecords || !tossPreview || tossIncludedCount === 0}
                        onClick={() => doTossApply()}
                      >
                        {tossLoadingMode === "apply" ? "적용 중..." : "포함 행 적용"}
                      </button>
                    </div>
                    {tossLoadingMode && (
                      <div className="import-progress">토스 이미지를 처리 중입니다.</div>
                    )}
                    {tossPreview && (
                      <section className="import-report toss-review">
                        <div className="import-summary-grid">
                          <div className="import-summary-item"><strong>이미지</strong><span>{fmt(tossPreview.summary?.image_count)}</span></div>
                          <div className="import-summary-item"><strong>검토 행</strong><span>{fmt(tossRows.length)}</span></div>
                          <div className="import-summary-item"><strong>포함 행</strong><span>{fmt(tossIncludedCount)}</span></div>
                          <div className="import-summary-item"><strong>중복 후보</strong><span>{fmt(tossDuplicateCount)}</span></div>
                          <div className="import-summary-item"><strong>제외된 후보</strong><span>{fmt(tossExcludedCandidates.length)}</span></div>
                        </div>
                        <div className="toss-review-table-wrap">
                          <table className="toss-review-table">
                            <thead>
                              <tr>
                                <th>포함</th>
                                <th>일자</th>
                                <th>시간</th>
                                <th>항목명</th>
                                <th>금액</th>
                                <th>잔액</th>
                                <th>유형</th>
                                <th>카테고리</th>
                                <th>상태</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tossRows.length === 0 && (
                                <tr>
                                  <td colSpan={9} className="empty-state">검토할 행이 없습니다.</td>
                                </tr>
                              )}
                              {tossRows.map((row) => {
                                const recommendation = row.category_recommendation;
                                const selectedCategory = categoryById.get(String(row.category_id || ""));
                                const rowCategories = categories.filter((item) => item.flow_type === row.flow_type);
                                return (
                                  <tr key={row.row_id} className={!row.included ? "toss-row-excluded" : ""}>
                                    <td data-label="포함">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(row.included)}
                                        onChange={(e) => updateTossPreviewRow(row.row_id, { included: e.target.checked })}
                                        disabled={importBusy || !canEditRecords}
                                      />
                                    </td>
                                    <td data-label="일자">
                                      <input
                                        type="date"
                                        value={row.occurred_on || ""}
                                        onChange={(e) => updateTossPreviewRow(row.row_id, { occurred_on: e.target.value })}
                                        disabled={importBusy || !canEditRecords}
                                      />
                                    </td>
                                    <td data-label="시간">
                                      <input
                                        value={row.time || ""}
                                        onChange={(e) => updateTossPreviewRow(row.row_id, { time: e.target.value })}
                                        disabled={importBusy || !canEditRecords}
                                      />
                                    </td>
                                    <td data-label="항목명">
                                      <input
                                        value={row.item_name || ""}
                                        onChange={(e) => updateTossPreviewRow(row.row_id, { item_name: e.target.value })}
                                        disabled={importBusy || !canEditRecords}
                                      />
                                      <input
                                        className="toss-detail-input"
                                        value={row.detail || ""}
                                        onChange={(e) => updateTossPreviewRow(row.row_id, { detail: e.target.value })}
                                        disabled={importBusy || !canEditRecords}
                                        placeholder="상세"
                                      />
                                    </td>
                                    <td data-label="금액">
                                      <input
                                        inputMode="decimal"
                                        value={row.amount ?? ""}
                                        onChange={(e) => updateTossPreviewRow(row.row_id, { amount: e.target.value })}
                                        disabled={importBusy || !canEditRecords}
                                      />
                                    </td>
                                    <td data-label="잔액">
                                      <input
                                        inputMode="decimal"
                                        value={row.balance ?? ""}
                                        onChange={(e) => updateTossPreviewRow(row.row_id, { balance: e.target.value })}
                                        disabled={importBusy || !canEditRecords}
                                      />
                                    </td>
                                    <td data-label="유형">
                                      <select
                                        value={row.flow_type || "expense"}
                                        onChange={(e) => updateTossPreviewRow(row.row_id, { flow_type: e.target.value, category_id: "" })}
                                        disabled={importBusy || !canEditRecords}
                                      >
                                        {FLOW_TYPE_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                      </select>
                                    </td>
                                    <td data-label="카테고리" className="toss-category-cell">
                                      <select
                                        value={row.category_id || ""}
                                        onChange={(e) => updateTossPreviewRow(row.row_id, { category_id: e.target.value })}
                                        disabled={importBusy || !canEditRecords}
                                      >
                                        <option value="">미분류/검토 필요</option>
                                        {rowCategories.map((category) => (
                                          <option key={category.id} value={category.id}>{toCategoryPairLabel(category)}</option>
                                        ))}
                                      </select>
                                      {selectedCategory ? (
                                        <span className="toss-category-hint">선택: {toCategoryPairLabel(selectedCategory)}</span>
                                      ) : recommendation ? (
                                        <div className="toss-category-recommendation">
                                          <span>추천 카테고리: {recommendation.suggested_major} / {recommendation.suggested_minor}</span>
                                          <button
                                            type="button"
                                            className="secondary"
                                            onClick={() => startCategoryDraftFromTossRecommendation(row)}
                                            disabled={importBusy || !canEditRecords}
                                          >
                                            생성 초안
                                          </button>
                                        </div>
                                      ) : (
                                        <span className="toss-category-hint">미분류/검토 필요</span>
                                      )}
                                    </td>
                                    <td data-label="상태">
                                      {row.duplicate_group_id ? (
                                        <span className="status-pill status-pill-pending">중복 후보</span>
                                      ) : row.included ? (
                                        <span className="status-pill status-pill-accepted">적용 예정</span>
                                      ) : (
                                        <span className="status-pill status-pill-revoked">적용 제외</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {tossExcludedCandidates.length > 0 && (
                          <section className="toss-excluded-panel">
                            <h3>제외된 후보 / 인식 불가</h3>
                            <ul className="compact-list">
                              {tossExcludedCandidates.map((candidate, index) => (
                                <li key={`${candidate.source_image_index}-${candidate.item_name}-${index}`}>
                                  <strong>{candidate.item_name || "인식 불가"}</strong>
                                  <span> {candidate.exclusion_reason}</span>
                                  {candidate.raw_text ? <pre>{candidate.raw_text}</pre> : null}
                                </li>
                              ))}
                            </ul>
                          </section>
                        )}
                        {tossApplyReport && (
                          <div className="import-summary-grid">
                            <div className="import-summary-item"><strong>추가된 거래</strong><span>{fmt(tossApplyReport.applied_transactions)}</span></div>
                            <div className="import-summary-item"><strong>건너뛴 행</strong><span>{fmt(tossApplyReport.skipped_transactions)}</span></div>
                          </div>
                        )}
                      </section>
                    )}
                  </section>
                )}
                  </section>
                <section className="import-mode-panel import-package-panel">
                  <div className="secondary-table-heading import-report-heading">
                    <div className="work-surface-title">
                      <span className="surface-eyebrow">환경 이식 패키지</span>
                      <h3 id="package-import-heading">데이터 추출/업로드</h3>
                    </div>
                    <p className="table-summary">{migrationStateLabel}</p>
                  </div>
                  <p className="table-summary">
                    계정 자체는 이식하지 않습니다. 대상 환경에서 로그인한 현재 가계에 거래/보유/카테고리와 가계 설정을 반영합니다.
                  </p>
                  <div className="inline import-action-row import-package-export-row">
                    <button
                      type="button"
                      disabled={migrationExporting || Boolean(migrationLoadingMode) || !canEditRecords}
                      onClick={exportMigrationPackage}
                    >
                      {migrationExporting ? "패키지 추출 중..." : "현재 가계 패키지 추출"}
                    </button>
                  </div>
                  <div
                    className="file-drop-area"
                    onClick={() => {
                      if (!migrationLoadingMode && !migrationExporting && canEditRecords) {
                        migrationPackageInputRef.current?.click();
                      }
                    }}
                  >
                    <input
                      ref={migrationPackageInputRef}
                      type="file"
                      accept=".zip"
                      onChange={(e) => setMigrationPackageFile(e.target.files?.[0] || null)}
                      className="visually-hidden-file-input"
                      aria-label="이식 패키지 업로드"
                      disabled={Boolean(migrationLoadingMode) || migrationExporting || !canEditRecords}
                    />
                    {migrationPackageFile ? (
                      <div className="upload-file-name">선택된 패키지: {migrationPackageFile.name}</div>
                    ) : (
                      <div className="upload-placeholder">{migrationPackageUploadPlaceholder}</div>
                    )}
                  </div>
                  {packageMissingFile && (
                    <p id="package-import-file-required" className="table-summary import-action-help">
                      패키지 파일(.zip)을 선택하면 미리 검증과 적용을 사용할 수 있습니다.
                    </p>
                  )}
                  <div className="inline import-action-row">
                    <button
                      type="button"
                      disabled={packageActionsDisabled}
                      aria-describedby={packageMissingFile ? "package-import-file-required" : undefined}
                      onClick={() => doMigrationImport("dry_run")}
                    >
                      {migrationLoadingMode === "dry_run" ? "미리 검증 중..." : "패키지 미리 검증"}
                    </button>
                    <button
                      type="button"
                      disabled={packageActionsDisabled}
                      aria-describedby={packageMissingFile ? "package-import-file-required" : undefined}
                      onClick={() => doMigrationImport("apply")}
                    >
                      {migrationLoadingMode === "apply" ? "적용 중..." : "패키지 적용"}
                    </button>
                  </div>
                    {migrationLoadingMode && (
                      <div className="import-progress" role="status" aria-live="polite">
                        이식 패키지를 검증/적용하는 중입니다. 완료까지 잠시만 기다려 주세요.
                      </div>
                    )}
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
                        {migrationIssuePreview.length === 0 ? (
                          <p className="table-summary">검출된 이슈가 없습니다.</p>
                        ) : (
                          <ul className="compact-list">
                            {migrationIssuePreview.map((issue, index) => (
                              <li key={`${issue.code}-${issue.sheet || "none"}-${issue.row || 0}-${index}`}>
                                [{issue.severity}] {issue.message}
                              </li>
                            ))}
                          </ul>
                        )}
                        {(migrationReport.issues || []).length > migrationIssuePreview.length && (
                          <p className="table-summary">+{(migrationReport.issues || []).length - migrationIssuePreview.length}건 더 있음</p>
                        )}
                      </section>
                      <details className="report-technical">
                        <summary>기술 상세 보기</summary>
                        <pre className="report technical-report-json">{formatTechnicalReportJson(migrationReport)}</pre>
                      </details>
                    </>
                  )}
                </section>
                </div>
              </article>
            </section>
  );
}
