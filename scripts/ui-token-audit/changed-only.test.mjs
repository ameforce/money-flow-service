import assert from "node:assert/strict";
import test from "node:test";

import { selectBaseRef } from "./changed-only.mjs";

test("selectBaseRef uses an ancestor hotfix ref when branch CI has no PR target", () => {
  const baseRef = selectBaseRef({ hotfixBaseRef: "origin/hotfix/v0.1.49" });

  assert.equal(baseRef, "origin/hotfix/v0.1.49");
});
