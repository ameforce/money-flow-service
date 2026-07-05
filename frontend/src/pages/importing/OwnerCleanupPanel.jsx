export function OwnerCleanupPanel({ permissions, ownerCleanup }) {
  const { canEditRecords } = permissions;
  const { applyLegacyOwnerRemap, defaultOwnerRemapOption, legacyOwnerCleanupRows, legacyOwnerCountText, ownerMemberOptions, ownerRemapTargets, ownerRemappingKey, updateOwnerRemapTargets } = ownerCleanup;

  if (legacyOwnerCleanupRows.length === 0) {
    return null;
  }

  return (
    <section className="owner-remap-cleanup" aria-labelledby="owner-remap-cleanup-title">
      <div className="secondary-table-heading owner-remap-heading">
        <div className="work-surface-title">
          <span className="surface-eyebrow">소유자 정리</span>
          <h3 id="owner-remap-cleanup-title">기존 소유자 정리</h3>
        </div>
        <p className="table-summary">기존 값은 현재 가계 구성원과 연결되지 않은 과거/가져오기 소유자명입니다.</p>
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
                  onChange={(event) => updateOwnerRemapTargets((prev) => ({ ...prev, [row.key]: event.target.value }))}
                >
                  {ownerMemberOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <button type="button" className="secondary" disabled={!canEditRecords || remapping || !targetValue || totalCount === 0} onClick={() => applyLegacyOwnerRemap(row.key)}>
                {remapping ? "매핑 중..." : "현재 구성원으로 매핑"}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
