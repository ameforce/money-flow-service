export function TransactionEntrySheet({ permissions, entrySheet, categoryManager }) {
  const { canEditRecords, isCompactViewport } = permissions;
  const {
    closeTransactionEntrySheet,
    renderTransactionFormFields,
    showTransactionForm,
    transactionEntryBanner,
    transactionEntrySheetBackdropRef,
    transactionEntrySheetRef,
    txEntrySheetStep,
    updateTxEntrySheetStep,
  } = entrySheet;
  const { renderTransactionCategoryManagerContent } = categoryManager;

  if (!showTransactionForm) {
    return null;
  }

  return (
    <div ref={transactionEntrySheetBackdropRef} className={`transaction-entry-sheet-backdrop${isCompactViewport ? " transaction-entry-sheet-backdrop-compact" : " transaction-entry-sheet-backdrop-desktop"}`} role="presentation" onClick={closeTransactionEntrySheet}>
      <section
        ref={transactionEntrySheetRef}
        className={`transaction-entry-sheet${isCompactViewport ? " transaction-entry-sheet-compact" : " transaction-entry-sheet-desktop"}`}
        data-testid="transaction-entry-sheet"
        aria-modal="true"
        role="dialog"
        aria-label={txEntrySheetStep === "category" ? "거래 카테고리 관리 레이어" : "거래 추가 레이어"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="transaction-entry-sheet-header">
          <div>
            <h3>{txEntrySheetStep === "category" ? "카테고리 관리" : "거래 등록"}</h3>
            <p className="table-summary">
              {txEntrySheetStep === "category"
                ? "같은 레이어 안에서 카테고리를 정리합니다."
                : "일자부터 거래자까지 한 화면에서 저장합니다."}
            </p>
          </div>
          <button type="button" className="secondary" data-testid="transaction-entry-sheet-close" onClick={closeTransactionEntrySheet}>닫기</button>
        </div>
        {!canEditRecords && (
          <p className="table-summary transaction-entry-readonly-note">거래 등록/수정/삭제는 편집자 이상 권한에서만 가능합니다.</p>
        )}
        {txEntrySheetStep === "category" ? (
          <>
            <div className="transaction-entry-sheet-actions">
              <button type="button" className="secondary" onClick={() => updateTxEntrySheetStep("form")}>거래 입력으로 돌아가기</button>
            </div>
            {renderTransactionCategoryManagerContent({ sheetMode: true })}
          </>
        ) : (
          <>
            {transactionEntryBanner}
            {renderTransactionFormFields({ sheetMode: true })}
          </>
        )}
      </section>
    </div>
  );
}
