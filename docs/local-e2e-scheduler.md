# Local E2E Scheduler

Windows 로컬 `npm run e2e:matrix`의 기본 실행기는 다음 파이프라인을 사용한다.

```text
Playwright discovery
  -> immutable job manifest
  -> dependency/resource-lock analysis
  -> historical-duration LPT queue
  -> isolated warm worker capsules
  -> dynamic work stealing
  -> fail-closed result/evidence aggregation
```

제품 동작과 Playwright assertion, retry, timeout, skip, coverage는 이 scheduler가
약화하지 않는다. 같은 production frontend를 run당 정확히 한 번 build하며, 각 worker
backend가 공유 `frontend/dist`를 production SPA 방식으로 직접 제공한다. Dynamic run은
Vite process와 별도 frontend port를 만들지 않는다. Wall time은 처리량 개선의 최종
효과를 확인하는 보조 지표이며, 구조적 작업 제거와 자원 활용을 채택 판단의 우선
근거로 삼는다.

## 명령 계약

| 목적 | 명령/설정 | 실행 모드 |
| --- | --- | --- |
| Windows 로컬 전체 matrix | `npm run e2e:matrix` | dynamic, fixed 8 기본 |
| 기존 runner fallback | `npm run e2e:matrix -- -- --legacy-runner` | legacy |
| 환경변수 선택 | `E2E_RUNNER_MODE=dynamic` 또는 `legacy` | 명시한 모드 |
| fixed worker 조절 | `--scheduler-workers=<4..10>` | dynamic |
| 작은 직접 진단 | `--scheduler-smoke-workers=<1..3>` | dynamic smoke 전용 |
| adaptive opt-in | `--adaptive-workers` | Windows dynamic 전용 |
| benchmark 표식 | `--benchmark-label=<text>` | manifest에 보존 |
| 인증 setup 선택 | `E2E_AUTH_SETUP_MODE=api\|ui` | dynamic local은 `api`, legacy/CI/shared URL은 `ui` |
| Windows spawn 선택 | `E2E_WINDOWS_SPAWN_MODE=direct\|bootstrap` | dynamic local은 `direct`, bootstrap fallback 유지 |

npm 11에서 runner option을 전달할 때는 `npm run ... -- -- --legacy-runner`처럼
두 번째 단독 `--`가 필요하다. CI의 `ci:e2e*`, 비 Windows, non-matrix 실행은
의도적으로 legacy를 기본값으로 유지한다.

Dynamic mode는 job 단위 실행에서 의미를 그대로 보존할 수 없는 Playwright 옵션
`--headed`, `--fully-parallel`, `--pass-with-no-tests`를 실행 전에 거부하고
`--legacy-runner` fallback을 안내한다. Legacy mode는 세 옵션을 Playwright에 그대로
전달한다.

## A-F 구현 대응

### A. Discovery, profiler, manifest

Playwright JSON discovery를 canonical test ID로 정규화하고, historical duration을
읽어 immutable `manifest.json`을 먼저 쓴다. History v2는 최근 5개 complete-green
sample의 실제 Playwright test duration median과 browser별 job-boundary overhead
median을 사용한다. Failed, flaky, partial, interrupted, cleanup-failed run은 history를
갱신하지 않으며 v1은 읽기 호환 후 첫 complete green에서 v2로 atomic migration한다.
모든 run/job/worker는 고유 ID를 가진다. 현재 feature inventory는 564 tests,
99 jobs이며 manifest의 expected inventory가 최종 actual inventory의 기준이다.

### B. Isolated warm worker capsule와 cleanup

각 capsule은 다음 자원과 정리 책임을 독점한다.

| 자원 | 격리/정리 계약 |
| --- | --- |
| Backend | worker별 port, process tree/Windows Job Object, health latency |
| Frontend | worker backend와 동일 origin, 별도 process/port 없이 공유 `dist` read-only 소비 |
| Database | worker별 SQLite DB, job 간 deterministic DELETE reset |
| Browser | project affinity별 warm server pool, worker별 profile/context namespace, runner 소유 process만 종료 |
| Files | worker/job별 temp, upload, `.runtime`, screenshot, evidence, log 경로 |
| Environment | run/worker/job ID namespace와 전용 environment overlay |

정상 종료, worker crash, `Ctrl+C` 모두 process/port/DB/browser cleanup evidence를
남긴다. 증거가 없거나 active 자원이 남으면 성공으로 간주하지 않는다. 사용자가
실행한 system Chrome처럼 runner가 소유하지 않은 process는 종료하지 않는다.

### C. LPT queue, work stealing, aggregation

job은 예상 시간이 긴 순서(LPT)로 eligible queue에 들어간다. fixed 8 matrix는
7개 Chromium worker와 1개 Firefox/WebKit worker를 사용한다. 각 lane 안에서 idle
worker가 project affinity, 명시적 shared-resource lock, 현재 capacity를 만족하는
다음 job을 가져간다. Firefox/WebKit lane 전체가 terminal이면 해당 worker는 두
browser server를 정리한 뒤 Chromium tail stealing에 합류한다. 이 방식은 초기
과포화를 막으면서 spec을 고정 shard로 묶지 않는다. worker crash,
partial/missing/duplicate result, 예상/실제
test-project-browser-viewport-scenario 차이, evidence 충돌은 모두 fail closed한다.

### D. Logical bottleneck split

기본 job 단위는 `project x spec x logical group`이다. 일반 spec은 spec 전체가 한
logical group이고, `transactions.spec.js`의 71개 test는 다음 7개 업무 그룹에 정확히
한 번씩 배정된다.

- `tx-entry-category-owner`
- `tx-entry-form-context`
- `tx-entry-crud-validation`
- `tx-selection-interactions`
- `tx-ledger-actions-clearance`
- `tx-ledger-readability`
- `tx-month-date-filter-loading`

`mobile-browser-matrix.spec.js`의 17개 test는 Chromium/Firefox/WebKit 각 project에서
다음 6개 업무 그룹으로 분할된다. Core test 안의 mobile profile, desktop profile,
dialog surface는 하나의 600초 timeout 예산을 공유한다. 세 test로 나누면 총 timeout
예산이 1,800초로 완화되므로, profiling상 tail 이점이 있어도 채택하지 않는다.

- `mobile-core-profiles`
- `mobile-modal-focus`
- `mobile-import-accessibility`
- `mobile-semantics-status`
- `mobile-orientation-zoom`
- `mobile-typography-touch-layout`

두 병목 spec 모두 title이 미배정되거나 둘 이상의 logical group에 중복되면
discovery 단계에서 실패한다.

### E. Warm reset와 shared build

worker backend/orchestrator와 배정된 browser engine은 warm 상태로 유지하고 job 사이
DB를 deterministic reset한다. capsule service는 병렬로 기동하며 각 job은 공개된 local
Playwright CLI를 Node로 직접 실행한다. Windows dynamic process는 suspended/no-console로
직접 생성해 Job Object에 먼저 편입한 뒤 resume하며, 기존 Python bootstrap은 명시적
fallback으로 유지한다. Dynamic local의 인증 사전조건은 기존
register/verify API를 `page.context().request`로 호출하고 frontend를 한 번만 연다.
`auth.spec.js`, auth layout/live-region, post-deploy auth smoke처럼 인증 자체를 검증하는
범위는 기존 UI 등록 흐름을 유지하며 API 실패를 UI fallback으로 은폐하지 않는다.

현재 shared lock declaration은 0개다. 선언 가능한 lock은 mail server,
registration/global rate state, global version/config, migration package,
불가피한 legacy evidence root뿐이며 일반 DB/WS를 lock으로 직렬화할 수 없다.

### F. Adaptive resource controller와 benchmark

fixed 8이 우선 검증 대상이며 adaptive는 `--adaptive-workers` opt-in이다. worker 1~8만
warm start하고 worker 9~10은 process가 없는 cold reserve로 둔다. reserve capsule은
start 성공 뒤에만 assignment capacity에 포함된다. 정책 범위는 min 4/max 10,
cooldown 60초이고 한 결정에서 capacity를 1만 변경한다.

- 즉시 감소: available memory `<15%`, backend p95 `>750ms`, worker crash 또는
  unexpected failure
- 2회 연속 감소: CPU `>=92%`, memory `<20%`, backend p95 `>500ms`를 모두 만족
- 3회 연속 증가: CPU `<=75%`, memory `>=25%`, backend p95 `<=350ms`를 모두 만족하고
  cooldown 경과
- sampler 오류/stale: 증가 금지, 현재 capacity 유지
- 한 번이라도 failure가 발생한 run: 이후 재확장 금지

실행 중 job을 중단하지 않고 다음 assignment capacity에만 반영한다. 모든 결정은
`capacity-decisions.json`에 기록한다.

## Artifact와 판정

기본 run root는 `output/playwright/e2e-scheduler/runs/<run-id>/`이다.

- `manifest.json`: canonical inventory, jobs, locks, CLI와 benchmark identity
- `workers/<worker-id>/jobs/<job-id>/`: log, Playwright output, screenshot/evidence,
  mobile UI/UX evidence namespace
- `run-metrics.json` v2: queue/assignment/blocking, browser acquire/switch, actual test와
  Playwright boundary, auth mode/count/duration, reset/cleanup/aggregation, process role별
  spawn, runner CPU/I/O/memory/process, host CPU/memory/backend p95, cleanup와 concurrency
- `capacity-decisions.json`: fixed/adaptive capacity 결정 근거
- 최종 published screenshot/evidence manifest와 complete `run-metrics.json`: 같은
  multi-target transaction에서 expected/actual fingerprint가 일치할 때만 함께 갱신

동일 SHA 교차 benchmark의 이전 `570/105` inventory 결과와 최종 채택된 `564/99`
inventory 검증은 구분해 기록한다. 전자는 처리량 개선 증거이고, 후자는 단일 600초
timeout 의미와 최신 cleanup/publication 계약의 합격 증거다. 처리량과 자원 증거는
[`e2e-scheduler-benchmark.md`](e2e-scheduler-benchmark.md)에 기록한다.

최종 채택 구조는 fixed-8 `20260715T215634-21bd4ba0`,
`20260715T221228-3c4fbdea`와 adaptive `20260715T230402-ced81a8b`에서 모두
564/564 tests, 554 passed / 0 failed / 10 expected skipped, 1,023/1,023 evidence,
avoidable idle 0, foreground transition 0, `.runtime` 포함 cleanup residue 0으로
완료됐다. Adaptive run은 pressure signal에 따라 `8 -> 7 -> 6 -> 5 -> 4`로 줄였지만
running job을 중단하거나 failure를 숨기지 않았다.

합격 우선순위는 inventory/evidence 동등성, flaky 0과 Windows cleanup, 처리량·effective
concurrency·queue tail, scenario당 setup/orchestration work, wall time 순이다. Compatible
pending job과 capacity가 있는데 250ms 이상 쉰 assignment는 avoidable idle로 기록하고
0건을 요구한다. 동일 SHA 시간 비교는
[`e2e-scheduler-benchmark.md`](e2e-scheduler-benchmark.md)의 계약을 따르되 실패 run은
profiling 자료로만 사용한다.
