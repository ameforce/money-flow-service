import { ImportReportPanel } from "./ImportReportPanel";
import { FilePickerDropzone } from "./FilePickerDropzone";
import { TossImportPanel } from "./TossImportPanel";

export function WorkbookImportPanel({ constants, permissions, workbook, reportState, reportActions, toss, helpers, dragDrop }) {
  const { IMPORT_MODE_LABELS, IMPORT_SOURCE_MODES } = constants;
  const { canEditRecords } = permissions;
  const { doImport, importFile, importFileInputRef, importLoadingMode, importMode, workbookActionsDisabled, workbookMissingFile, workbookUploadPlaceholder, updateImportFile, updateImportMode } = workbook;
  const { importBusy, importReport } = reportState;
  const { displayImportFileName, fmt } = helpers;
  const { isDragOver, updateIsDragOver } = dragDrop;

  return (
    <section className="import-mode-panel import-excel-panel">
      <div className="secondary-table-heading import-report-heading">
        <div className="work-surface-title">
          <span className="surface-eyebrow">원본 데이터</span>
          <h3 id="excel-import-heading">데이터 파일 업로드</h3>
        </div>
        <p className="table-summary">{importMode === "toss" ? (toss.tossFiles.length > 0 ? `이미지 ${fmt(toss.tossFiles.length)}개 선택됨` : "이미지 대기") : (importFile ? "파일 선택됨" : "파일 대기")}</p>
      </div>
      <div className="import-mode-switch" role="group" aria-label="가져오기 형식">
        {IMPORT_SOURCE_MODES.map((mode) => (
          <button key={mode.value} type="button" className={importMode === mode.value ? "active" : "secondary"} aria-pressed={importMode === mode.value} onClick={() => { updateImportMode(mode.value); updateIsDragOver(false); }} disabled={importBusy}>
            {mode.label}
          </button>
        ))}
      </div>

      {importMode === "workbook" && (
        <>
          <FilePickerDropzone
            accept=".xlsx"
            buttonLabel="엑셀 파일 선택"
            disabled={importBusy || !canEditRecords}
            inputLabel="엑셀 파일 업로드"
            inputRef={importFileInputRef}
            isDragOver={isDragOver}
            onChange={updateImportFile}
            onDragActiveChange={updateIsDragOver}
            onDrop={(files) => updateImportFile(files[0])}
          >
            {importFile ? <div className="upload-file-name">선택된 파일: {importFile.name}</div> : <div className="upload-placeholder">{workbookUploadPlaceholder}</div>}
          </FilePickerDropzone>
          {workbookMissingFile && <p id="excel-import-file-required" className="table-summary import-action-help">엑셀 파일을 선택하면 미리 검증과 적용을 사용할 수 있습니다.</p>}
          <div className="inline import-action-row">
            <button type="button" disabled={workbookActionsDisabled} aria-describedby={workbookMissingFile ? "excel-import-file-required" : undefined} onClick={() => doImport("dry_run")}>
              {importLoadingMode === "dry_run" ? "미리 검증 중..." : IMPORT_MODE_LABELS.dry_run}
            </button>
            <button type="button" disabled={workbookActionsDisabled} aria-describedby={workbookMissingFile ? "excel-import-file-required" : undefined} onClick={() => doImport("apply")}>
              {importLoadingMode === "apply" ? "적용 중..." : IMPORT_MODE_LABELS.apply}
            </button>
          </div>
          {importLoadingMode && <div className="import-progress" role="status" aria-live="polite">서버에서 파일을 처리 중입니다. 완료까지 잠시만 기다려 주세요.</div>}
          {importReport && (
            <ImportReportPanel
              importReportSortOptions={constants.IMPORT_REPORT_SORT_OPTIONS}
              reportState={reportState}
              reportActions={reportActions}
              helpers={{ displayImportFileName, fmt }}
            />
          )}
        </>
      )}

      {importMode === "toss" && (
        <TossImportPanel constants={constants} permissions={permissions} reportState={{ importBusy }} toss={toss} helpers={helpers} dragDrop={dragDrop} />
      )}
    </section>
  );
}
