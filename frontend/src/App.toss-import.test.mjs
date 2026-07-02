import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { patchTossRowWithInference, recomputeTossDuplicateRows } from "./tossImportUtils.js";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("import screen exposes a Toss screenshot preview/apply review flow", () => {
  assert.match(appSource, /imports\/toss-screenshots\/preview/);
  assert.match(appSource, /imports\/toss-screenshots\/apply/);
  assert.match(appSource, /tossPreview/);
  assert.match(appSource, /제외된 후보/);
  assert.match(appSource, /추천 카테고리/);
  assert.match(appSource, /recomputeTossDuplicateRows/);
  assert.match(appSource, /rows: recomputeTossDuplicateRows/);
  assert.match(appSource, /patchTossRowWithInference/);
  assert.match(appSource, /patchTossRowWithInference\(row, patch, categories\)/);
});

test("Toss preview edits recompute duplicate and category state", () => {
  const duplicateRows = recomputeTossDuplicateRows([
    {
      row_id: "a",
      occurred_on: "2026-05-31",
      time: "09:15",
      item_name: "주식회사 카카오",
      amount: "1,900",
      signed_amount: "-1900",
      balance: "4,024,514",
      flow_type: "expense",
      included: true,
    },
    {
      row_id: "b",
      occurred_on: "2026-05-31",
      time: "09:15",
      item_name: "주식회사 카카오",
      amount: "1,900",
      signed_amount: "-1900",
      balance: "4,024,514",
      flow_type: "expense",
      included: true,
    },
  ]);
  assert.equal(duplicateRows[0].duplicate_group_id, "dup-1");
  assert.equal(duplicateRows[1].duplicate_group_id, "dup-1");
  assert.equal(duplicateRows[0].included, false);
  assert.equal(duplicateRows[1].included, false);

  const categories = [
    { id: "cat-membership", flow_type: "expense", major: "구독", minor: "멤버십" },
    { id: "cat-ipo", flow_type: "investment", major: "투자", minor: "공모청약" },
  ];
  const row = {
    row_id: "row-1",
    flow_type: "expense",
    item_name: "네이버플러스 멤버십",
    detail: "",
    category_id: "cat-membership",
    category_recommendation: null,
  };

  const merchantEdit = patchTossRowWithInference(row, { item_name: "씨유(CU) 우만삼익점" }, categories);
  assert.equal(merchantEdit.category_id, "");
  assert.deepEqual(merchantEdit.category_recommendation, {
    suggested_major: "생활",
    suggested_minor: "식비",
    reason: "merchant_keyword",
    create_allowed: false,
  });

  const detailEdit = patchTossRowWithInference(
    merchantEdit,
    { flow_type: "investment", detail: "대신증권 공모청약" },
    categories
  );
  assert.equal(detailEdit.category_id, "cat-ipo");
  assert.equal(detailEdit.category_recommendation, null);
});
