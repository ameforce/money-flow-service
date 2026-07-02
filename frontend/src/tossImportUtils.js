function stripGrouping(value) {
  return String(value ?? "").replace(/,/g, "").trim();
}

function decimalPayload(value) {
  const normalized = stripGrouping(value);
  return normalized || null;
}

function signedAmountPayload(row, amountText) {
  const fallback = decimalPayload(row?.signed_amount);
  const magnitude = String(amountText || fallback || "").replace(/^[+-]/, "");
  if (!magnitude) {
    return fallback;
  }
  return row?.flow_type === "income" ? magnitude : `-${magnitude}`;
}

export function normalizeFileArray(fileList) {
  return Array.from(fileList || []).filter(Boolean);
}

export function tossDuplicateKey(row) {
  const occurredOn = String(row?.occurred_on || "").trim();
  const time = String(row?.time || "").trim();
  const itemName = String(row?.item_name || "").trim().toLowerCase().replace(/\s+/g, " ");
  const amount = decimalPayload(row?.amount);
  const signedAmount = signedAmountPayload(row, amount);
  const balance = decimalPayload(row?.balance) || "";
  if (!occurredOn || !time || !itemName || !signedAmount) {
    return "";
  }
  return [occurredOn, time, itemName, signedAmount, balance].join("|");
}

export function recomputeTossDuplicateRows(rows) {
  const grouped = new Map();
  rows.forEach((row, index) => {
    const key = tossDuplicateKey(row);
    if (!key) {
      return;
    }
    grouped.set(key, [...(grouped.get(key) || []), index]);
  });

  const duplicateGroups = new Map();
  let duplicateIndex = 0;
  grouped.forEach((indexes, key) => {
    if (indexes.length <= 1) {
      return;
    }
    duplicateIndex += 1;
    duplicateGroups.set(key, `dup-${duplicateIndex}`);
  });

  return rows.map((row) => {
    const key = tossDuplicateKey(row);
    const duplicateGroupId = key ? duplicateGroups.get(key) : "";
    if (duplicateGroupId) {
      return {
        ...row,
        duplicate_group_id: duplicateGroupId,
        exclusion_reason: "duplicate_candidate",
        included: row.duplicate_group_id ? row.included : false,
      };
    }
    return {
      ...row,
      duplicate_group_id: null,
      exclusion_reason: row.exclusion_reason === "duplicate_candidate" ? null : row.exclusion_reason,
    };
  });
}

export function normalizeTossCategoryText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function recommendTossCategory(flowType, itemName, detail) {
  const text = `${itemName || ""} ${detail || ""}`;
  const create_allowed = false;
  if (flowType === "income") {
    return { suggested_major: "수입", suggested_minor: "기타수입", reason: "income_fallback", create_allowed };
  }
  if (["유튜브", "네이버플러스", "멤버십"].some((keyword) => text.includes(keyword))) {
    return { suggested_major: "구독", suggested_minor: "멤버십", reason: "subscription_keyword", create_allowed };
  }
  if (["CU", "편의점", "카페", "커피"].some((keyword) => text.includes(keyword))) {
    return { suggested_major: "생활", suggested_minor: "식비", reason: "merchant_keyword", create_allowed };
  }
  if (flowType === "investment") {
    return { suggested_major: "투자", suggested_minor: "기타투자", reason: "investment_fallback", create_allowed };
  }
  if (flowType === "transfer") {
    return { suggested_major: "이체", suggested_minor: "기타이체", reason: "transfer_fallback", create_allowed };
  }
  return { suggested_major: "지출", suggested_minor: "기타지출", reason: "expense_fallback", create_allowed };
}

export function inferTossCategory(row, categories) {
  const flowType = row?.flow_type || "expense";
  const text = normalizeTossCategoryText(`${row?.item_name || ""} ${row?.detail || ""}`);
  const matched = (categories || []).find((category) => {
    if (category.flow_type !== flowType) {
      return false;
    }
    const major = normalizeTossCategoryText(category.major);
    const minor = normalizeTossCategoryText(category.minor);
    return (minor && text.includes(minor)) || (major && text.includes(major));
  });
  if (matched) {
    return { category_id: String(matched.id || ""), category_recommendation: null };
  }
  return { category_id: "", category_recommendation: recommendTossCategory(flowType, row?.item_name, row?.detail) };
}

export function patchTossRowWithInference(row, patch, categories) {
  const nextRow = { ...row, ...patch };
  if (!("item_name" in patch || "detail" in patch || "flow_type" in patch)) {
    return nextRow;
  }
  return { ...nextRow, ...inferTossCategory(nextRow, categories) };
}
