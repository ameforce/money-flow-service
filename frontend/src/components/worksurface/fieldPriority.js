export const WORK_SURFACE_FIELDS = {
  transactions: {
    desktop: [
      { key: 'occurred_on', label: '일자', priority: 'primary', className: 'transaction-col-date' },
      { key: 'flow_type', label: '유형', priority: 'cue', className: 'transaction-col-type' },
      { key: 'category', label: '카테고리', priority: 'primary', className: 'transaction-col-category' },
      { key: 'memo', label: '메모', priority: 'primary', className: 'transaction-col-memo' },
      { key: 'amount', label: '금액', priority: 'primary', className: 'transaction-col-amount' },
      { key: 'owner_name', label: '거래자명', priority: 'cue', className: 'transaction-col-owner' },
      { key: 'updated_at', label: '최종 수정일', priority: 'secondary', className: 'transaction-col-updated' },
    ],
    mobileCompact: ['occurred_on', 'flow_type', 'amount', 'memo'],
    cues: ['category', 'owner_name', 'updated_at'],
  },
  holdings: {
    desktop: [
      { key: 'name', label: '이름', priority: 'primary', className: 'holding-col-name' },
      { key: 'type_key', label: '유형', priority: 'cue', className: 'holding-col-type' },
      { key: 'owner_name', label: '보유자', priority: 'cue', className: 'holding-col-owner' },
      { key: 'category', label: '카테고리', priority: 'secondary', className: 'holding-col-category' },
      { key: 'quantity', label: '수량', priority: 'secondary', className: 'holding-col-quantity' },
      { key: 'average_cost', label: '평균단가', priority: 'secondary', className: 'holding-col-average' },
      { key: 'market_value_krw', label: '평가(KRW)', priority: 'primary', className: 'holding-col-market' },
      { key: 'gain_loss_krw', label: '손익(KRW)', priority: 'secondary', className: 'holding-col-gain' },
      { key: 'updated_at', label: '최종 수정일', priority: 'secondary', className: 'holding-col-updated' },
    ],
    mobileCompact: ['name', 'market_value_krw', 'owner_name', 'type_category_summary'],
    secondary: ['quantity', 'average_cost', 'gain_loss_krw', 'updated_at'],
  },
};

export const TRANSACTION_SURFACE_FIELDS = WORK_SURFACE_FIELDS.transactions.desktop;
export const HOLDING_SURFACE_FIELDS = WORK_SURFACE_FIELDS.holdings.desktop;

function createMobilePriorityLookup(surfaceKey) {
  const surface = WORK_SURFACE_FIELDS[surfaceKey] || {};
  const entries = new Map();
  for (const key of surface.mobileCompact || []) {
    entries.set(key, "compact");
  }
  for (const key of surface.cues || []) {
    entries.set(key, entries.get(key) || "cue");
  }
  for (const key of surface.secondary || []) {
    entries.set(key, entries.get(key) || "secondary");
  }
  return entries;
}

export const TRANSACTION_MOBILE_PRIORITY = createMobilePriorityLookup("transactions");
export const HOLDING_MOBILE_PRIORITY = createMobilePriorityLookup("holdings");

const HOLDING_MOBILE_FIELD_ALIASES = {
  type_key: "type_category_summary",
  category: "type_category_summary",
};

export function getWorkSurfaceMobilePriority(surfaceKey, fieldKey) {
  const normalizedSurfaceKey = String(surfaceKey || "").trim();
  const normalizedFieldKey = String(fieldKey || "").trim();
  const priorityMap =
    normalizedSurfaceKey === "transactions"
      ? TRANSACTION_MOBILE_PRIORITY
      : normalizedSurfaceKey === "holdings"
        ? HOLDING_MOBILE_PRIORITY
        : null;
  if (!priorityMap || !normalizedFieldKey) {
    return "hidden";
  }
  const lookupKey =
    normalizedSurfaceKey === "holdings"
      ? HOLDING_MOBILE_FIELD_ALIASES[normalizedFieldKey] || normalizedFieldKey
      : normalizedFieldKey;
  return priorityMap.get(lookupKey) || "hidden";
}
