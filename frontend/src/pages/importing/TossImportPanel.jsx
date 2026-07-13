import { FilePickerDropzone } from "./FilePickerDropzone";

export function TossImportPanel({ constants, permissions, reportState, toss, helpers, dragDrop }) {
  const { FLOW_TYPE_OPTIONS, TOSS_IMAGE_ACCEPT } = constants;
  const { canEditRecords } = permissions;
  const { importBusy } = reportState;
  const { doTossApply, doTossPreview, startCategoryDraftFromTossRecommendation, tossApplyReport, tossDuplicateCount, tossExcludedCandidates, tossFileInputRef, tossFiles, tossIncludedCount, tossLoadingMode, tossPreview, tossRows, tossUploadPlaceholder, updateTossPreviewRow, updateTossImportFiles } = toss;
  const { categories, categoryById, fmt, toCategoryPairLabel } = helpers;
  const { isDragOver, updateIsDragOver } = dragDrop;

  return (
    <section className="toss-import-panel">
      <FilePickerDropzone
        accept={TOSS_IMAGE_ACCEPT}
        buttonLabel="토스 이미지 선택"
        className="toss-drop-area"
        disabled={importBusy || !canEditRecords}
        inputLabel="토스 스크린샷 업로드"
        inputRef={tossFileInputRef}
        isDragOver={isDragOver}
        multiple
        onChange={updateTossImportFiles}
        onDragActiveChange={updateIsDragOver}
        onDrop={updateTossImportFiles}
      >
        {tossFiles.length > 0 ? (
          <ul className="upload-file-list">{tossFiles.map((file) => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}</ul>
        ) : (
          <div className="upload-placeholder">
            {tossUploadPlaceholder.map((line) => <span key={line}>{line}</span>)}
          </div>
        )}
      </FilePickerDropzone>
      <div className="inline import-actions">
        <button type="button" disabled={importBusy || !canEditRecords} onClick={() => doTossPreview()}>{tossLoadingMode === "preview" ? "추출 중..." : "검토 표 만들기"}</button>
        <button type="button" disabled={importBusy || !canEditRecords || !tossPreview || tossIncludedCount === 0} onClick={() => doTossApply()}>{tossLoadingMode === "apply" ? "적용 중..." : "포함 행 적용"}</button>
      </div>
      {tossLoadingMode && <div className="import-progress">토스 이미지를 처리 중입니다.</div>}
      {tossPreview && (
        <section className="import-report toss-review">
          <div className="import-summary-grid">
            <div className="import-summary-item"><strong>이미지</strong><span>{fmt(tossPreview.summary?.image_count)}</span></div>
            <div className="import-summary-item"><strong>검토 행</strong><span>{fmt(tossRows.length)}</span></div>
            <div className="import-summary-item"><strong>포함 행</strong><span>{fmt(tossIncludedCount)}</span></div>
            <div className="import-summary-item"><strong>중복 후보</strong><span>{fmt(tossDuplicateCount)}</span></div>
            <div className="import-summary-item"><strong>제외된 후보</strong><span>{fmt(tossExcludedCandidates.length)}</span></div>
          </div>
          <TossReviewTable rows={tossRows} FLOW_TYPE_OPTIONS={FLOW_TYPE_OPTIONS} categories={categories} categoryById={categoryById} importBusy={importBusy} canEditRecords={canEditRecords} startCategoryDraftFromTossRecommendation={startCategoryDraftFromTossRecommendation} toCategoryPairLabel={toCategoryPairLabel} updateTossPreviewRow={updateTossPreviewRow} />
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
  );
}

function TossReviewTable({ rows, FLOW_TYPE_OPTIONS, categories, categoryById, importBusy, canEditRecords, startCategoryDraftFromTossRecommendation, toCategoryPairLabel, updateTossPreviewRow }) {
  const handleScrollRegionKeyDown = (event) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    const region = event.currentTarget;
    const pageDistance = Math.max(120, region.clientWidth * 0.8);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      region.scrollBy({ left: pageDistance, behavior: "auto" });
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      region.scrollBy({ left: -pageDistance, behavior: "auto" });
    } else if (event.key === "Home") {
      event.preventDefault();
      region.scrollTo({ left: 0, behavior: "auto" });
    } else if (event.key === "End") {
      event.preventDefault();
      region.scrollTo({ left: region.scrollWidth, behavior: "auto" });
    }
  };
  const handleScrollRegionFocus = (event) => {
    if (event.target !== event.currentTarget && event.target instanceof HTMLElement) {
      event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  return (
    <>
      <p id="toss-review-scroll-help" className="table-summary toss-review-scroll-help">
        <span>표를 좌우로 밀거나 스크롤 영역에서 좌우 방향키를 사용하세요.</span>
        <span>탭으로 편집 칸을 이동합니다.</span>
      </p>
      <div
        className="toss-review-table-wrap"
        role="region"
        aria-label="토스 거래 검토 표"
        aria-describedby="toss-review-scroll-help"
        tabIndex={0}
        onFocusCapture={handleScrollRegionFocus}
        onKeyDown={handleScrollRegionKeyDown}
      >
        <table className="toss-review-table">
          <thead><tr><th scope="col">포함</th><th scope="col">일자</th><th scope="col">시간</th><th scope="col">항목명</th><th scope="col">금액</th><th scope="col">잔액</th><th scope="col">유형</th><th scope="col">카테고리</th><th scope="col">상태</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="empty-state">검토할 행이 없습니다.</td></tr>}
            {rows.map((row) => (
              <TossReviewRow key={row.row_id} row={row} FLOW_TYPE_OPTIONS={FLOW_TYPE_OPTIONS} categories={categories} categoryById={categoryById} importBusy={importBusy} canEditRecords={canEditRecords} startCategoryDraftFromTossRecommendation={startCategoryDraftFromTossRecommendation} toCategoryPairLabel={toCategoryPairLabel} updateTossPreviewRow={updateTossPreviewRow} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TossReviewRow({ row, FLOW_TYPE_OPTIONS, categories, categoryById, importBusy, canEditRecords, startCategoryDraftFromTossRecommendation, toCategoryPairLabel, updateTossPreviewRow }) {
  const recommendation = row.category_recommendation;
  const selectedCategory = categoryById.get(String(row.category_id || ""));
  const rowCategories = categories.filter((item) => item.flow_type === row.flow_type);
  const disabled = importBusy || !canEditRecords;

  return (
    <tr className={!row.included ? "toss-row-excluded" : ""}>
      <td data-label="포함"><input aria-label="포함 여부" type="checkbox" checked={Boolean(row.included)} onChange={(e) => updateTossPreviewRow(row.row_id, { included: e.target.checked })} disabled={disabled} /></td>
      <td data-label="일자"><input aria-label="일자" type="date" value={row.occurred_on || ""} onChange={(e) => updateTossPreviewRow(row.row_id, { occurred_on: e.target.value })} disabled={disabled} /></td>
      <td data-label="시간"><input aria-label="시간" value={row.time || ""} onChange={(e) => updateTossPreviewRow(row.row_id, { time: e.target.value })} disabled={disabled} /></td>
      <td data-label="항목명">
        <input aria-label="항목명" value={row.item_name || ""} onChange={(e) => updateTossPreviewRow(row.row_id, { item_name: e.target.value })} disabled={disabled} />
        <input aria-label="항목 상세" className="toss-detail-input" value={row.detail || ""} onChange={(e) => updateTossPreviewRow(row.row_id, { detail: e.target.value })} disabled={disabled} placeholder="상세" />
      </td>
      <td data-label="금액"><input aria-label="금액" inputMode="decimal" value={row.amount ?? ""} onChange={(e) => updateTossPreviewRow(row.row_id, { amount: e.target.value })} disabled={disabled} /></td>
      <td data-label="잔액"><input aria-label="잔액" inputMode="decimal" value={row.balance ?? ""} onChange={(e) => updateTossPreviewRow(row.row_id, { balance: e.target.value })} disabled={disabled} /></td>
      <td data-label="유형"><select aria-label="유형" value={row.flow_type || "expense"} onChange={(e) => updateTossPreviewRow(row.row_id, { flow_type: e.target.value, category_id: "" })} disabled={disabled}>{FLOW_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
      <td data-label="카테고리" className="toss-category-cell">
        <select aria-label="카테고리" value={row.category_id || ""} onChange={(e) => updateTossPreviewRow(row.row_id, { category_id: e.target.value })} disabled={disabled}>
          <option value="">미분류/검토 필요</option>
          {rowCategories.map((category) => <option key={category.id} value={category.id}>{toCategoryPairLabel(category)}</option>)}
        </select>
        {selectedCategory ? <span className="toss-category-hint">선택: {toCategoryPairLabel(selectedCategory)}</span> : recommendation ? (
          <div className="toss-category-recommendation">
            <span>추천 카테고리: {recommendation.suggested_major} / {recommendation.suggested_minor}</span>
            <button type="button" className="secondary" onClick={() => startCategoryDraftFromTossRecommendation(row)} disabled={disabled}>생성 초안</button>
          </div>
        ) : <span className="toss-category-hint">미분류/검토 필요</span>}
      </td>
      <td data-label="상태">{row.duplicate_group_id ? <span className="status-pill status-pill-pending">중복 후보</span> : row.included ? <span className="status-pill status-pill-accepted">적용 예정</span> : <span className="status-pill status-pill-revoked">적용 제외</span>}</td>
    </tr>
  );
}
