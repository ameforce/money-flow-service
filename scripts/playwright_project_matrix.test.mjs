import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

function listProjectTests() {
  const result = spawnSync(
    process.execPath,
    [resolve("node_modules/@playwright/test/cli.js"), "test", "--list"],
    {
      cwd: resolve("."),
      encoding: "utf8",
      env: { ...process.env, E2E_PROJECT_MATRIX: "1" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function listedProjectNames(output) {
  return new Set(
    [...output.matchAll(/^\s+\[([^\]]+)\]\s+›/gmu)].map((match) => match[1]),
  );
}

function projectListsSpec(output, projectName, specName) {
  const pattern = new RegExp(
    `^\\s+\\[${escapeRegex(projectName)}\\]\\s+›\\s+${escapeRegex(specName)}:`,
    "mu",
  );
  return pattern.test(output);
}

test("project matrix preserves standard regression projects and adds dedicated browser projects", () => {
  const output = listProjectTests();
  const projectNames = listedProjectNames(output);

  assert.deepEqual(projectNames, new Set([
    "desktop-chromium",
    "tablet-chromium",
    "mobile-chromium",
    "matrix-chromium",
    "matrix-firefox",
    "matrix-webkit",
  ]));

  for (const projectName of ["desktop-chromium", "tablet-chromium", "mobile-chromium"]) {
    assert.equal(
      projectListsSpec(output, projectName, "dashboard.spec.js"),
      true,
      `${projectName} must keep the standard regression suite`,
    );
    assert.equal(projectListsSpec(output, projectName, "mobile-browser-matrix.spec.js"), false);
  }

  for (const projectName of ["matrix-chromium", "matrix-firefox", "matrix-webkit"]) {
    assert.equal(projectListsSpec(output, projectName, "mobile-browser-matrix.spec.js"), true);
    assert.equal(projectListsSpec(output, projectName, "dashboard.spec.js"), false);
  }
});
