import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { selectBaseRef } from "./changed-only.mjs";

test("selectBaseRef uses an ancestor hotfix ref when branch CI has no PR target", () => {
  const baseRef = selectBaseRef({
    headBranch: "fix/mobile-uiux-rca-v0.1.49",
    hotfixBaseRef: "origin/hotfix/v0.1.49",
    parentBaseRef: "HEAD^",
  });

  assert.equal(baseRef, "origin/hotfix/v0.1.49");
});

test("selectBaseRef uses the parent commit for clean ordinary branch CI", () => {
  const baseRef = selectBaseRef({ parentBaseRef: "HEAD^" });

  assert.equal(baseRef, "HEAD^");
});

test("selectBaseRef ignores a stale hotfix ancestor on main", () => {
  const baseRef = selectBaseRef({
    headBranch: "main",
    hotfixBaseRef: "origin/hotfix/v0.1.49",
    parentBaseRef: "HEAD^",
  });

  assert.equal(baseRef, "HEAD^");
});

test("selectBaseRef ignores a stale hotfix ancestor on an unrelated branch", () => {
  const baseRef = selectBaseRef({
    headBranch: "feature/dashboard-copy",
    hotfixBaseRef: "origin/hotfix/v0.1.49",
    parentBaseRef: "HEAD^",
  });

  assert.equal(baseRef, "HEAD^");
});

test("selectBaseRef rejects a hotfix ref that resolves to the current HEAD", () => {
  const baseRef = selectBaseRef({
    headBranch: "fix/mobile-uiux-rca-v0.1.49",
    headSha: "abc123",
    hotfixBaseRef: "origin/hotfix/v0.1.49",
    hotfixBaseSha: "abc123",
    parentBaseRef: "HEAD^",
  });

  assert.equal(baseRef, "HEAD^");
});

test("selectBaseRef uses an exact hotfix branch when its base is older than HEAD", () => {
  const baseRef = selectBaseRef({
    headBranch: "hotfix/v0.1.49",
    headSha: "def456",
    hotfixBaseRef: "origin/hotfix/v0.1.49",
    hotfixBaseSha: "abc123",
    parentBaseRef: "HEAD^",
  });

  assert.equal(baseRef, "origin/hotfix/v0.1.49");
});

test("selectBaseRef leaves the baseline empty when no parent commit exists", () => {
  const baseRef = selectBaseRef({ parentBaseRef: "" });

  assert.equal(baseRef, "");
});

test("token audit unit script names test files explicitly for Windows cmd portability", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const command = packageJson.scripts?.["uiux:token-audit:unit"] || "";

  assert.doesNotMatch(command, /[*?]/);
  assert.match(command, /scripts\/ui-token-audit\/changed-only\.test\.mjs/);
});
