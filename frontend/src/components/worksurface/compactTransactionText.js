const KRW_COMPACT_UNITS = [
  { divisor: 1_000_000_000_000, label: "조" },
  { divisor: 100_000_000, label: "억" },
  { divisor: 10_000, label: "만" },
];

function compactPrecision(value) {
  if (value >= 100) {
    return 0;
  }
  return value >= 10 ? 1 : 2;
}

function trimDecimalZeros(value) {
  return value.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}

export function formatCompactKrwAmount(value, fallbackLabel) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return fallbackLabel;
  }
  const absoluteAmount = Math.abs(amount);
  let unitIndex = KRW_COMPACT_UNITS.findIndex(({ divisor }) => absoluteAmount >= divisor);
  if (unitIndex < 0) {
    return fallbackLabel;
  }

  while (unitIndex >= 0) {
    const unit = KRW_COMPACT_UNITS[unitIndex];
    const scaled = absoluteAmount / unit.divisor;
    const rounded = scaled.toFixed(compactPrecision(scaled));
    if (Number(rounded) >= 10_000 && unitIndex > 0) {
      unitIndex -= 1;
      continue;
    }
    return `≈${amount < 0 ? "-" : ""}${trimDecimalZeros(rounded)}${unit.label}원`;
  }

  return fallbackLabel;
}
