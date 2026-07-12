import assert from "node:assert/strict";
import test from "node:test";

import { startReactScan } from "./reactScan.js";

test("React Scan opt-in invokes the scanner API", async () => {
  let scanCalls = 0;

  const started = await startReactScan(true, async () => ({
    scan: () => {
      scanCalls += 1;
    },
  }));

  assert.equal(started, true);
  assert.equal(scanCalls, 1);
});

test("React Scan stays dormant without the opt-in and does not load the package", async () => {
  let loadCalls = 0;

  const started = await startReactScan(false, async () => {
    loadCalls += 1;
    return { scan: () => undefined };
  });

  assert.equal(started, false);
  assert.equal(loadCalls, 0);
});

test("React Scan tooling failures do not block app startup", async () => {
  const started = await startReactScan(true, async () => {
    throw new Error("scanner unavailable");
  });

  assert.equal(started, false);
});
