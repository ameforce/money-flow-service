import assert from "node:assert/strict";
import test from "node:test";

import { formatCompactKrwAmount } from "./components/worksurface/compactTransactionText.js";

test("compact KRW promotes rounded values across Korean unit boundaries", () => {
  assert.equal(formatCompactKrwAmount(99_999_999, "99,999,999원"), "≈1억원");
  assert.equal(formatCompactKrwAmount(100_000_000, "100,000,000원"), "≈1억원");
  assert.equal(formatCompactKrwAmount(999_999_999_999, "999,999,999,999원"), "≈1조원");
  assert.equal(formatCompactKrwAmount(-99_999_999, "-99,999,999원"), "≈-1억원");
});

test("compact KRW keeps ordinary wide values readable and marked approximate", () => {
  assert.equal(formatCompactKrwAmount(1_234_567_890, "1,234,567,890원"), "≈12.3억원");
  assert.equal(formatCompactKrwAmount(Number.NaN, "-"), "-");
});
