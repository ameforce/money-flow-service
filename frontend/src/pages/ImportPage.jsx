import { MigrationPackagePanel } from "./importing/MigrationPackagePanel";
import { OwnerCleanupPanel } from "./importing/OwnerCleanupPanel";
import { WorkbookImportPanel } from "./importing/WorkbookImportPanel";

export function ImportPage({
  constants,
  permissions,
  workbook,
  reportState,
  reportActions,
  migration,
  ownerCleanup,
  toss,
  helpers,
  dragDrop,
}) {
  const {
    FLOW_TYPE_OPTIONS,
    IMPORT_MODE_LABELS,
    IMPORT_REPORT_SORT_OPTIONS,
    IMPORT_SOURCE_MODES,
    TOSS_IMAGE_ACCEPT,
  } = constants;
  const {
    canEditRecords,
  } = permissions;
  const {
    doImport,
    importFile,
    importFileInputRef,
    importLoadingMode,
    importMode,
    importStateLabel,
    workbookActionsDisabled,
    workbookMissingFile,
    workbookUploadPlaceholder,
    updateImportFile,
    updateImportMode,
  } = workbook;
  const {
    importAppliedHoldingRefs,
    importAppliedTransactionRefs,
    importBusy,
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
  const {
    copyImportReportCsv,
    downloadImportReportCsv,
    formatTechnicalReportJson,
    hasImportPostApplyTargets,
    showImportedHoldings,
    showImportedTransactions,
    startImportedCorrection,
    updateImportReportSearch,
    updateImportReportSeverityFilter,
    updateImportReportSort,
    updateImportReportTypeFilter,
  } = reportActions;
  const {
    doMigrationImport,
    exportMigrationPackage,
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
  } = migration;
  const {
    applyLegacyOwnerRemap,
    defaultOwnerRemapOption,
    legacyOwnerCleanupRows,
    legacyOwnerCountText,
    ownerMemberOptions,
    ownerRemapTargets,
    ownerRemappingKey,
    updateOwnerRemapTargets,
  } = ownerCleanup;
  const {
    doTossApply,
    doTossPreview,
    startCategoryDraftFromTossRecommendation,
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
    updateTossImportFiles,
  } = toss;
  const {
    categories,
    categoryById,
    displayImportFileName,
    fmt,
    toCategoryPairLabel,
  } = helpers;
  const {
    isDragOver,
    updateIsDragOver,
  } = dragDrop;

  return (
    <section className="grid-1 secondary-surface-grid import-surface-grid">
      <article className="card secondary-surface-card import-console-card">
        <div className="secondary-surface-header import-surface-header">
          <div className="work-surface-title">
            <span className="surface-eyebrow">엑셀 파이프라인</span>
            <h2>데이터 파일 가져오기</h2>
          </div>
          <div className="surface-control-strip secondary-control-strip" role="group" aria-label="데이터 가져오기 상태" tabIndex={0}>
            <span className={`surface-chip${importLoadingMode || importReport ? " surface-chip-strong" : ""}`}>{importStateLabel}</span>
            <span className="surface-chip">{importFile ? "파일 선택됨" : "파일 미선택"}</span>
            <span className={`surface-chip${canEditRecords ? " surface-chip-strong" : " surface-chip-muted"}`}>{canEditRecords ? "편집 가능" : "읽기 전용"}</span>
          </div>
        </div>
        {!canEditRecords && <p className="table-summary">데이터 가져오기는 편집자 이상 권한에서만 가능합니다.</p>}
        <OwnerCleanupPanel
          permissions={{ canEditRecords }}
          ownerCleanup={{ applyLegacyOwnerRemap, defaultOwnerRemapOption, legacyOwnerCleanupRows, legacyOwnerCountText, ownerMemberOptions, ownerRemapTargets, ownerRemappingKey, updateOwnerRemapTargets }}
        />
        <div className="mobile-import-package-export">
          <button type="button" disabled={migrationExporting || Boolean(migrationLoadingMode) || !canEditRecords} onClick={exportMigrationPackage}>
            {migrationExporting ? "패키지 추출 중..." : "현재 가계 패키지 추출"}
          </button>
        </div>
        <div className="import-mode-grid">
          <WorkbookImportPanel
            constants={{ FLOW_TYPE_OPTIONS, IMPORT_MODE_LABELS, IMPORT_REPORT_SORT_OPTIONS, IMPORT_SOURCE_MODES, TOSS_IMAGE_ACCEPT }}
            permissions={{ canEditRecords }}
            workbook={{ doImport, importFile, importFileInputRef, importLoadingMode, importMode, workbookActionsDisabled, workbookMissingFile, workbookUploadPlaceholder, updateImportFile, updateImportMode }}
            reportState={{ importAppliedHoldingRefs, importAppliedTransactionRefs, importBusy, importIssuePreview, importMismatchPreview, importReport, importReportRows, importReportSearch, importReportSeverityFilter, importReportSeverityOptions, importReportSort, importReportTypeFilter, importReportTypeOptions, importReportVisibleRows }}
            reportActions={{ copyImportReportCsv, downloadImportReportCsv, formatTechnicalReportJson, hasImportPostApplyTargets, showImportedHoldings, showImportedTransactions, startImportedCorrection, updateImportReportSearch, updateImportReportSeverityFilter, updateImportReportSort, updateImportReportTypeFilter }}
            toss={{ doTossApply, doTossPreview, startCategoryDraftFromTossRecommendation, tossApplyReport, tossDuplicateCount, tossExcludedCandidates, tossFileInputRef, tossFiles, tossIncludedCount, tossLoadingMode, tossPreview, tossRows, tossUploadPlaceholder, updateTossPreviewRow, updateTossImportFiles }}
            helpers={{ categories, categoryById, displayImportFileName, fmt, toCategoryPairLabel }}
            dragDrop={{ isDragOver, updateIsDragOver }}
          />
          <MigrationPackagePanel
            permissions={{ canEditRecords }}
            migration={{ doMigrationImport, displayImportFileName, formatTechnicalReportJson, migrationExporting, migrationIssuePreview, migrationLoadingMode, migrationPackageFile, migrationPackageInputRef, migrationPackageUploadPlaceholder, migrationReport, migrationStateLabel, packageActionsDisabled, packageMissingFile, updateMigrationPackageFile, exportMigrationPackage }}
            helpers={{ fmt }}
          />
        </div>
      </article>
    </section>
  );
}
