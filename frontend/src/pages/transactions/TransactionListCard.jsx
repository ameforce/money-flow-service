import { TransactionListTablePanel } from "./TransactionListTablePanel";
import { TransactionListToolbar } from "./TransactionListToolbar";

export function TransactionListCard({
  constants,
  permissions,
  monthFilter,
  listState,
  listRefs,
  listLookups,
  listActions,
  selection,
  entrySheet,
  inlineEdit,
  categoryManager,
  ownerHelpers,
  formatters,
}) {
  const { isCompactViewport, loading } = permissions;
  const { transactionListCardRef } = listRefs;
  const { openNormalTransactionEntrySheet, transactionFabRef } = entrySheet;
  const { txInlineEdit } = inlineEdit;

  return (
    <>
      <article ref={transactionListCardRef} className="card table-card surface-list-card transaction-list-card">
        <TransactionListToolbar
          constants={constants}
          permissions={permissions}
          monthFilter={monthFilter}
          listState={listState}
          listRefs={listRefs}
          listActions={listActions}
          selection={selection}
          entrySheet={entrySheet}
          inlineEdit={inlineEdit}
          formatters={formatters}
        />
        <TransactionListTablePanel
          constants={constants}
          permissions={permissions}
          listState={listState}
          listLookups={listLookups}
          listActions={listActions}
          selection={selection}
          inlineEdit={inlineEdit}
          categoryManager={categoryManager}
          ownerHelpers={ownerHelpers}
          formatters={formatters}
        />
      </article>
      {isCompactViewport && !txInlineEdit && (
        <button
          ref={transactionFabRef}
          type="button"
          className="transactions-fab transaction-add-fab"
          data-testid="transactions-fab"
          aria-label="거래 추가"
          disabled={loading}
          onClick={() => openNormalTransactionEntrySheet("form")}
        >
          <span aria-hidden="true">＋</span>
        </button>
      )}
    </>
  );
}
