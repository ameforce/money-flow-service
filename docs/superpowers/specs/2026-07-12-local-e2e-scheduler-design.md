# Local E2E Dynamic Scheduler Design

## Objective

Maximize useful local E2E throughput by actively using available CPU, memory, process, and I/O capacity without changing product behavior, test assertions, retries, timeouts, skips, or coverage. The scheduler must keep the existing command contract, run the same Playwright projects and tests, isolate every execution capsule, fail closed on missing or partial results, and retain an explicit legacy runner fallback. Wall-clock time is a secondary effect metric after parity, cleanup, effective concurrency, avoidable idle, and orchestration work.

The implementation is rebased on Jenkins-green `origin/develop` commit `9793ac76bfbf2dca51918c33df2ec4625c11c84c`. The feature branch is `feat/local-e2e-scheduler`, and its pull request targets `develop`. This work does not merge to `main`, create a tag, or deploy.

## Current State

`npm run e2e:matrix` invokes `scripts/run_e2e_with_orchestrator.py --project-matrix`. The legacy runner uses one orchestrator, one ephemeral SQLite database, and one frontend origin for six Playwright projects. Windows legacy mode defaults to `--workers=3`, `fullyParallel` is false, and the final feature inventory contains 564 project-expanded tests in 99 jobs. A successful legacy run deletes and recreates one shared screenshot directory and writes one `latest-run.json` file.

The current branch contains `e2e/specs/mobile-browser-matrix.spec.js` and runs its 17 tests through dedicated Chromium, Firefox, and WebKit projects. The scheduler treats that spec and the focused mobile successor specs as authoritative develop coverage; it splits the mobile matrix into exact-title logical groups without changing its assertions, timeout, or browser semantics.

## Approaches Considered

### 1. Static Playwright shards

Run eight fixed `--shard=N/8` invocations against isolated services. This is simple and uses only public Playwright APIs, but it cannot steal work, does not use historical durations, and leaves a long tail when a shard receives expensive transaction or viewport-loop tests.

### 2. Coordinator-managed warm capsules (selected)

Discover tests with `playwright test --list`, create explicit test-list jobs, and let long-lived isolated workers pull the longest eligible job from a shared queue. Each worker keeps its backend, static frontend origin, SQLite database, and assigned browser engine warm. Fixed-eight matrix mode uses seven Chromium workers plus one Firefox/WebKit worker so every job still uses an isolated worker context without accumulating every engine in every capsule. Each job runs through the supported local Playwright CLI with `--test-list`, `--project`, `--workers=1`, isolated output directories, and JSON results. This supplies dynamic work stealing without relying on Playwright internals.

### 3. Custom Playwright runner internals

Import Playwright's private runner modules and inject a distributed dispatcher. This could reuse browser workers more directly, but it is version-fragile, hard to fail closed, and would turn an infrastructure optimization into a maintained fork of Playwright behavior.

Approach 2 is selected because it meets the scheduling and isolation requirements while keeping test execution on documented Playwright interfaces.

## Architecture

```text
test discovery
  -> canonical inventory
  -> job manifest
  -> dependency and resource-lock analysis
  -> historical-duration LPT queue
  -> isolated warm worker pool
  -> dynamic eligible-job pull / work stealing
  -> strict result and evidence aggregation
  -> legacy-compatible latest-run.json + exit code
```

The scheduler is a Python package under `scripts/e2e_scheduler/`. `scripts/run_e2e_with_orchestrator.py` remains the stable entrypoint and chooses dynamic or legacy mode. The scheduler modules are intentionally small and separated by responsibility:

- `model.py`: immutable run, job, lock, worker, and result types plus manifest serialization.
- `discovery.py`: Playwright list execution, canonical test identifier parsing, expected-count calculation, and logical grouping.
- `history.py`: duration history loading and atomic update after a complete run.
- `locks.py`: explicit shared-resource lock compatibility.
- `queue.py`: longest-processing-time ordering and eligible-job selection.
- `capsule.py`, `capsule_services.py`, `capsule_job_execution.py`, and `capsule_reset.py`: one worker's same-origin backend, browser pool, job execution, deterministic reset, environment namespace, and cleanup.
- `aggregate.py`: result count/parity validation, partial-result detection, artifact merge, and legacy screenshot manifest generation.
- `resources.py`: fixed and adaptive concurrency decisions.
- `runner.py`: coordinator lifecycle and failure propagation.

## Discovery and Job Manifest

Discovery invokes Playwright with the forwarded filters and matrix environment, `--list`, and a machine-readable reporter. Each canonical test entry contains:

- project name;
- repository-relative spec path;
- source line;
- full title path;
- canonical test ID;
- browser and configured viewport metadata;
- logical group;
- required resource locks;
- historical duration estimate;
- expected scenario and evidence metadata when declared.

The default job unit is `project x spec x logical group`. Small specs use a single `all` group. A job stores the exact Playwright test-list entries rather than a regular-expression grep, preventing accidental over-selection or title collisions.

Every run, worker, job, result, log, and artifact receives a stable unique ID. The coordinator writes the immutable input manifest before starting workers. Discovery duplicates, unknown projects, zero-test manifests, and unsupported forwarded arguments fail before execution.

## Logical Groups

`transactions.spec.js` is split in the manifest, not by weakening or duplicating tests:

- `tx-entry-category-context`;
- `tx-entry-crud-validation`;
- `tx-selection-interactions`;
- `tx-ledger-layout-actions`;
- `tx-month-date-filter-loading`.

The grouping table keys on exact test titles and must cover all discovered transaction tests exactly once. New or renamed transaction tests fail manifest validation until assigned, avoiding silent fallback into an oversized catch-all job.

The mobile matrix uses six exact-title logical groups. Profiling identified the cross-browser core test as a WebKit tail, but splitting its mobile profiles, desktop profiles, and dialog surfaces into three Playwright tests would turn one shared 600-second budget into three independent 600-second budgets. The adopted design therefore keeps those scenarios in one core test and one group while preserving modal focus, import accessibility, semantics/status, orientation/zoom, and typography/touch/layout groups. Every discovered mobile matrix title must map exactly once, just like the transaction bottleneck. The final feature inventory is 564 project-expanded tests in 99 jobs, with assertions, finding evidence, authentication modes, and the original timeout semantics preserved.

## Isolation Contract

Each worker owns:

- one reserved backend port;
- one static frontend origin served by that backend;
- one SQLite database and deterministic seed/reset lifecycle;
- one assigned warm browser-engine pool and a per-job fresh browser context/profile;
- one temp/upload directory;
- one screenshot/evidence root;
- one Playwright output directory;
- one environment namespace;
- one log stream;
- all child-process cleanup responsibility.

Workers never share a mutable database, browser context, profile, upload path, screenshot directory, Playwright result directory, or log. The coordinator builds the production frontend once, using a relative API origin so the immutable `frontend/dist` can be shared read-only by workers with different backend ports.

The backend and browser server stay alive between jobs. Between jobs, the capsule performs a deterministic SQL reset against its own database, clears its temp/upload paths, and verifies no previous job context remains. Auth tests always start from the unauthenticated UI and never receive storage state or an API-created session. Dynamic local business-flow tests whose authentication is only a prerequisite call the existing register/verify API through the Playwright browser context request client, then open the frontend once. Legacy, CI, and shared-URL runs retain the UI path. API setup failures fail closed and never fall back to UI.

## Browser Reuse

Each capsule launches its first assigned engine with `launchServer()` before acquiring its worker-unique same-origin backend port. Seven fixed-eight workers own Chromium jobs; the remaining worker dynamically steals Firefox and WebKit jobs and lazily warms only those two engines. After every cross-browser primary job is terminal, that worker closes both old engines and may steal the Chromium tail. Job subprocesses receive `PW_TEST_CONNECT_WS_ENDPOINT` and connect through Playwright's supported `connectOptions` environment path. The browser process remains warm while Playwright creates fresh contexts for every test. If system Chrome is selected by the existing configuration, the shared resolver passes the exact selected executable path and channel to Playwright and records that same executable identity for the benchmark. A browser-server crash or an affinity mismatch fails the active job and the run; it is not silently replaced after partial execution.

## Resource Locks

Normal database, HTTP, WebSocket, viewport, upload, and screenshot work uses worker isolation and requires no global lock. Locks exist only for shared external resources:

- `mail-server` for tests that observe a shared mailbox/server;
- `registration-rate-state` for non-local shared targets;
- `global-version-config` for tests that mutate global version/config state;
- `migration-package` for shared migration package paths;
- an evidence-root lock only when a legacy external evidence path cannot be namespaced.

The local isolated matrix does not serialize ordinary auth or transaction work. Lock acquisition is coordinator-owned: a worker asks for the next longest job whose lock set is currently compatible.

## Scheduling

Historical durations are stored by canonical test ID and project. Version 2 uses the median of the latest five complete-green Playwright test-duration samples plus the median browser-specific job-boundary overhead. Failed, flaky, partial, interrupted, and cleanup-failed runs never update history. Version 1 remains readable and migrates atomically only after the first complete-green run. Job estimates are the sum of constituent test estimates plus measured boundary overhead. Unknown tests receive a conservative default based on the spec median.

The coordinator keeps one priority queue ordered by descending estimated duration. An idle worker requests the next project-affine, lock-compatible job. Completion immediately releases locks and permits another pull within the eligible lane, giving dynamic work stealing without fixed spec shards. Capsule services start in parallel, and jobs invoke the repository-local Playwright CLI directly through Node instead of a Windows `cmd /c npx` wrapper. Workers run Playwright with `--workers=1`; outer capsule concurrency is the only default parallelism, avoiding nested oversubscription.

Local defaults are fixed at 8 workers, with accepted bounds of 4 to 10. CI remains on the legacy low-resource path unless dynamic mode is explicitly enabled. Explicit user worker settings are preserved: legacy mode passes them through, while dynamic mode interprets the scheduler's worker flag separately and rejects ambiguous nested Playwright worker overrides.

Diagnostic one- and two-capsule verification uses the explicit `--scheduler-smoke-workers=<1..3>` override. The normal `--scheduler-workers` contract remains `4..10`; smoke worker counts are not supported production concurrency settings. `--benchmark-label=<text>` is retained in the immutable run manifest so direct runner invocations remain attributable.

## Adaptive Concurrency

Fixed eight-worker mode is completed and validated first. Adaptive control is a separable policy layer, disabled by default during correctness qualification. When enabled, it samples:

- CPU utilization;
- available memory;
- backend health latency;
- recent worker/job crash signals;
- recent unexpected test failures.

The controller changes capacity by at most one worker per cooldown window, never below 4 or above 10. It only stops assigning new work to a retiring worker; it never kills an active job. A flaky or crash signal decreases capacity and is recorded in the run report. Adaptive mode cannot change Playwright retries, timeouts, assertions, or skips.

## Results and Evidence

Every job writes a JSON report, Playwright artifacts, screenshots, evidence, stdout, and stderr under `output/playwright/e2e-scheduler/runs/<run-id>/workers/<worker-id>/jobs/<job-id>/`. The coordinator accepts a result exactly once and validates:

- expected versus actual test IDs;
- expected versus actual projects;
- browser/project and configured viewport counts;
- pass, fail, skip, interrupted, and missing counts;
- screenshot/evidence files referenced by results;
- job completion marker and worker exit status.

A worker crash, malformed JSON, duplicate result, missing test, unexpected test, partial job, orphan process, or missing artifact fails the whole run. Failed runs retain their namespaced diagnostics. Only a complete aggregation publishes `output/playwright/e2e-flow/latest-run.json`; screenshots are copied into the legacy consumer directory with collision-proof run/job prefixes.

## Cleanup

Windows dynamic launches create the target suspended with no console window, assign it to a kill-on-close Job Object, and only then resume its primary threads. This removes the Python bootstrap process while preserving the no-escape ownership boundary. `E2E_WINDOWS_SPAWN_MODE=bootstrap` retains the trusted bootstrap fallback. Cleanup attempts cooperative shutdown, explicitly terminates the owned Job when descendants remain, and proves its active-process count reaches zero even when the root target already exited. The coordinator also checks every owned backend/browser port is closed, owned SQLite files are removable, and worker temp/profile directories are gone or quarantined with a recorded error.

Cleanup never kills by executable name and never touches processes or ports not registered in the run manifest. Cleanup failure changes the run result to failed even when tests passed.

## Compatibility

`npm run e2e:matrix` becomes the local dynamic default on Windows. `--legacy-runner` and `E2E_RUNNER_MODE=legacy` preserve the original single-orchestrator behavior. `npm run e2e` and CI commands keep legacy behavior unless explicitly opted in.

The following contracts remain stable:

- arbitrary Playwright file/filter arguments;
- `--project-matrix`, `--html-report`, and `--include-slow` semantics;
- project names `desktop-chromium`, `tablet-chromium`, and `mobile-chromium`;
- system Chrome and bundled Chromium selection;
- vendored Linux Playwright libraries;
- `E2E_BASE_URL`, `E2E_API_BASE_URL`, deterministic test secrets, and test environment;
- nonzero exit on any test or evidence failure;
- legacy screenshot directory and `latest-run.json` consumer contract.

Dynamic mode routes file, project, grep, grep-invert, and only-changed filters to discovery only. Already narrowed jobs receive only compatible execution options. Suite-global or scheduler-owned options such as retries, repeat/shard/list/UI/output/global failure limits, caller test lists, browser selection, and nested workers fail before the frontend build or discovery begins.

## Verification and Benchmark

Correctness gates are layered:

1. scheduler unit tests for parsing, grouping, LPT ordering, locks, adaptive policy, aggregation, and cleanup decisions;
2. integration tests with fake worker processes and real filesystem artifacts;
3. focused Playwright smoke through one and multiple capsules;
4. legacy-versus-dynamic discovery and result parity;
5. backend pytest, frontend unit/lint/build, screenshot verification, mojibake check, and full E2E matrix.

Performance comparison uses the same final feature SHA, same machine, same system Chrome policy, and the same matrix/test inputs. The legacy fallback and dynamic runner each run at least three times. The report records wall time, worker-minutes, median, worst case, CPU/memory samples, result/skip/evidence counts, cleanup status, and run IDs. Acceptance targets are dynamic median at most 25 minutes, worst at most 30 minutes, at least 50% faster than legacy, zero additional flaky failures, and no missing test/project/browser/viewport/evidence. At least two consecutive dynamic runs must be green; three are preferred.

If the target is missed, the coordinator's per-job timing and utilization report identifies the new long tail. Safe follow-up tuning may change logical group sizes, worker count, or adaptive thresholds, but never test behavior or coverage.

## Pull Request Gates

The pull request targets `develop` and documents commands, architecture, benchmark runs, before/after timing, resource use, and result/evidence parity. A separate read-only self-review and an exact `@codex review` request are made against the latest pushed head SHA. Any later push makes that review stale and requires a new request. Merge readiness requires zero unresolved review threads, zero LOW/MEDIUM/HIGH/CRITICAL findings, and green Jenkins evidence for the latest SHA.
