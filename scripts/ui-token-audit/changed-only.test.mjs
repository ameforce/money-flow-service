import assert from "node:assert/strict";
import test from "node:test";

import { selectBaseRef } from "./changed-only.mjs";

test("selectBaseRef uses an ancestor hotfix ref when branch CI has no PR target", () => {
  const baseRef = selectBaseRef({
    hotfixBaseRef: "origin/hotfix/v0.1.49",
    parentBaseRef: "HEAD^",
  });

  assert.equal(baseRef, "origin/hotfix/v0.1.49");
});

test("selectBaseRef uses the parent commit for clean ordinary branch CI", () => {
  const baseRef = selectBaseRef({ parentBaseRef: "HEAD^" });

  assert.equal(baseRef, "HEAD^");
});

test("selectBaseRef rejects a hotfix ref that resolves to the current HEAD", () => {
  const baseRef = selectBaseRef({
    headSha: "abc123",
    hotfixBaseRef: "origin/hotfix/v0.1.49",
    hotfixBaseSha: "abc123",
    parentBaseRef: "HEAD^",
  });

  assert.equal(baseRef, "HEAD^");
});

test("selectBaseRef leaves the baseline empty when no parent commit exists", () => {
  const baseRef = selectBaseRef({ parentBaseRef: "" });

  assert.equal(baseRef, "");
});
