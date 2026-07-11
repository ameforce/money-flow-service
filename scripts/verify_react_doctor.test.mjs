import assert from "node:assert/strict";
import test from "node:test";

import {
  detectReactProject,
  extractReactDoctorLimits,
  extractReactDoctorMetrics,
} from "./verify_react_doctor.mjs";

test("detectReactProject derives React evidence from current project metadata", () => {
  // Given: the current JSON contract without the optional aggregate flag.
  const report = {
    projects: [
      {
        project: {
          framework: "vite",
          reactVersion: "^19.2.0",
          preactVersion: null,
        },
      },
    ],
  };

  // When / Then: explicit project runtime metadata proves this is a React scan.
  assert.equal(detectReactProject(report), true);
});

test("detectReactProject accepts a direct React framework project entry", () => {
  // Given: a compatible report shape that exposes framework and coverage directly.
  const report = {
    projects: [{ framework: "React", coverage: { scannedFileCount: 12 } }],
  };

  // When / Then: the missing top-level flag does not reject valid project evidence.
  assert.equal(detectReactProject(report), true);
});

test("detectReactProject fails closed without project-level React evidence", () => {
  // Given: projects exist, but none proves a React-compatible runtime.
  const report = {
    projects: [{ framework: "vite", coverage: { scannedFileCount: 12 } }],
  };

  // When / Then: generic tool coverage cannot masquerade as React detection.
  assert.equal(detectReactProject(report), false);
  assert.equal(detectReactProject({ projects: [] }), false);
  assert.equal(detectReactProject({}), false);
});

test("extractReactDoctorLimits rejects malformed regular-gate baselines", () => {
  // Given: values that Number() would turn into a non-blocking comparison.
  const malformedBaselines = [
    { maxErrorCount: 0 },
    { maxErrorCount: 0, maxWarningCount: Number.NaN },
    { maxErrorCount: 0, maxWarningCount: Number.POSITIVE_INFINITY },
    { maxErrorCount: 0, maxWarningCount: -1 },
    { maxErrorCount: 0, maxWarningCount: 1.5 },
  ];

  // When / Then: every malformed limit fails closed at the parsing boundary.
  for (const baseline of malformedBaselines) {
    assert.throws(
      () => extractReactDoctorLimits(baseline, false),
      /must be a non-negative integer/
    );
  }
});

test("extractReactDoctorMetrics reads the current top-level summary counts", () => {
  // Given: react-doctor's current aggregate summary shape.
  const report = {
    summary: {
      errorCount: 2,
      warningCount: 7,
      score: 84,
      scoreLabel: "Good",
    },
  };

  // When: the verifier extracts the blocking metrics.
  const metrics = extractReactDoctorMetrics(report);

  // Then: the non-zero diagnostics remain visible to the final gate.
  assert.deepEqual(metrics, {
    errorCount: 2,
    warningCount: 7,
    score: 84,
    scoreLabel: "Good",
  });
});

test("extractReactDoctorMetrics reads counts stored directly on a project entry", () => {
  // Given: a react-doctor report shape with direct project-level counts.
  const report = {
    projects: [
      {
        errorCount: 3,
        warningCount: 11,
        score: 62,
        scoreLabel: "Needs work",
      },
    ],
  };

  // When: the verifier extracts the blocking metrics.
  const metrics = extractReactDoctorMetrics(report);

  // Then: the project diagnostics cannot be treated as zero.
  assert.deepEqual(metrics, {
    errorCount: 3,
    warningCount: 11,
    score: 62,
    scoreLabel: "Needs work",
  });
});

test("extractReactDoctorMetrics reads counts stored directly on the report", () => {
  // Given: a react-doctor report with top-level direct counts.
  const report = {
    errorCount: 4,
    warningCount: 9,
    score: 71,
    scoreLabel: "Needs work",
  };

  // When: the verifier extracts the blocking metrics.
  const metrics = extractReactDoctorMetrics(report);

  // Then: the top-level diagnostics cannot be treated as zero.
  assert.deepEqual(metrics, {
    errorCount: 4,
    warningCount: 9,
    score: 71,
    scoreLabel: "Needs work",
  });
});

test("extractReactDoctorMetrics reads counts stored on a singular project", () => {
  // Given: a react-doctor report with a singular project object.
  const report = {
    project: {
      errorCount: 1,
      warningCount: 6,
      score: 88,
      scoreLabel: "Good",
    },
  };

  // When: the verifier extracts the blocking metrics.
  const metrics = extractReactDoctorMetrics(report);

  // Then: the singular project's diagnostics remain blocking.
  assert.deepEqual(metrics, {
    errorCount: 1,
    warningCount: 6,
    score: 88,
    scoreLabel: "Good",
  });
});

test("extractReactDoctorMetrics aggregates direct counts across multiple projects", () => {
  // Given: a multi-project report without a top-level aggregate.
  const report = {
    projects: [
      { errorCount: 1, warningCount: 4 },
      { errorCount: 2, warningCount: 5 },
    ],
  };

  // When: the verifier extracts the blocking metrics.
  const metrics = extractReactDoctorMetrics(report);

  // Then: every project's diagnostics contribute to the gate.
  assert.equal(metrics.errorCount, 3);
  assert.equal(metrics.warningCount, 9);
});

test("extractReactDoctorMetrics fails closed when no diagnostic counts exist", () => {
  // Given: a malformed report that contains no supported count shape.
  const report = { projects: [{ score: 100 }] };

  // When / Then: parsing fails instead of silently substituting zero.
  assert.throws(
    () => extractReactDoctorMetrics(report),
    /does not contain valid errorCount and warningCount metrics/
  );
});
