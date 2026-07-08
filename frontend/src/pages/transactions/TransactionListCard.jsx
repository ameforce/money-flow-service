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
  const { isCompactViewport, isLedgerCompactViewport = isCompactViewport } = permissions;
  const { transactionListCardRef } = listRefs;
  const {
    updateShowTransactionFilterPanel,
    updateTransactionFilterFocusTarget,
  } = listActions;
  const requestTransactionFilterPanel = (focusTarget) => {
    if (isLedgerCompactViewport) {
      return;
    }
    updateTransactionFilterFocusTarget?.(focusTarget);
    updateShowTransactionFilterPanel?.(true);
  };

  return (
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
        requestTransactionFilterPanel={requestTransactionFilterPanel}
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
  );
}
