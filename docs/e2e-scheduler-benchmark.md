# Local E2E Scheduler Benchmark

Scheduler 채택은 wall time 하나로 결정하지 않는다. 동일 inventory/evidence, flaky 0,
cleanup 100%, 중복 service/setup 제거, queue tail과 effective concurrency 개선을 먼저
검증한다. Wall time은 구조적 최적화의 최종 효과를 확인하는 2차 지표다.

## Measurement contract

- Hardware: Intel i7-13700H, 14 cores / 20 logical processors, 31.6 GB RAM.
- Base: Jenkins-green `origin/develop` `9793ac76bfbf2dca51918c33df2ec4625c11c84c`.
- Benchmark SHA: `890bd7b0ddba03d643bfa7dde04f87e31e88db79`.
- Order: legacy 1 -> dynamic 1 -> legacy 2 -> dynamic 2 -> legacy 3 -> dynamic 3.
- Host가 완전 유휴일 필요는 없지만 모든 run의 host CPU/memory/backend health와
  dynamic runner-owned CPU/I/O/memory/process를 함께 기록했다.
- Legacy: `uv run python scripts/benchmark_e2e_scheduler.py --mode legacy --runs 3 --label <label> -- npm run e2e:matrix -- -- --legacy-runner`.
- Dynamic: `uv run python scripts/benchmark_e2e_scheduler.py --mode dynamic --runs 3 --label <label> -- npm run e2e:matrix`.
- Raw artifact: `output/playwright/e2e-scheduler-benchmark-final-890bd7b.json`
  (schema v3, local ignored evidence).
- System Chrome policy: runner가 소유한 process만 관찰하고 정리한다.

## Same-SHA cross-run result

모든 run은 570 expected = 570 actual, 560 passed / 0 failed / 10 expected skipped,
0 interrupted / 0 missing이었다. 6 projects, 3 browser engines, 6 project viewport
entries와 1,023 expected/actual semantic evidence fingerprint가 모두 일치했다.

이 표는 benchmark SHA의 동일 runner inventory 비교를 보존한다. 이후 독립 리뷰에서
mobile core를 세 test로 나눈 구현이 하나의 600초 budget을 세 개로 확대한다는 점을
확인해 해당 split은 최종 코드에서 원복했다. 최종 채택 inventory는 같은 scenario와
assertion을 단일 core test에 다시 묶은 564 tests / 99 jobs이며, 아래 시간 수치는
구조적 처리량 개선의 보조 증거이지 최종 SHA의 시간 주장으로 사용하지 않는다.

| Mode | Run ID | Wall | Worker-min | Throughput | Effective concurrency | Host CPU / available memory / backend p95 | Result / cleanup |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Legacy 1 | `benchmark-20260715T153450-ba51cbee` | 55.60m | 150.19 | 10.25 scenarios/min | 2.701 | 15.25-100% / 23.79-42.18% / 2.91ms | 560/0/10, complete |
| Dynamic 1 | `20260715T163110-2dbae326` | 14.41m | 98.95 | 39.56 scenarios/min | 6.867 (85.84%) | 32.77-100% / 8.62-50.15% / 3.58-2,008.59ms | 560/0/10, 8/8 complete |
| Legacy 2 | `benchmark-20260715T164608-4b0b05fd` | 53.23m | 142.14 | 10.71 scenarios/min | 2.670 | 9.93-100% / 35.36-50.75% / 1.99ms | 560/0/10, complete |
| Dynamic 2 | `20260715T173959-7e8ab7bc` | 13.64m | 97.15 | 41.79 scenarios/min | 7.122 (89.03%) | 28.57-100% / 9.46-47.81% / 3.10-1,956.49ms | 560/0/10, 8/8 complete |
| Legacy 3 | `benchmark-20260715T175408-2b80f835` | 53.58m | 143.03 | 10.64 scenarios/min | 2.669 | 5.08-100% / 31.46-47.03% / 14.68ms | 560/0/10, complete |
| Dynamic 3 | `20260715T184816-ee86184c` | 14.03m | 99.45 | 40.63 scenarios/min | 7.089 (88.61%) | 27.94-100% / 5.95-44.93% / 3.32-40.83ms | 560/0/10, 8/8 complete |

| Summary | Legacy | Dynamic | Result |
| --- | ---: | ---: | --- |
| Median wall time | 53.58m | 14.03m | secondary target <=25m met |
| Worst wall time | 55.60m | 14.41m | secondary target <=30m met |
| Median speedup | - | 73.82% | secondary target >=50% met |
| Median throughput | 10.64 scenarios/min | 40.63 scenarios/min | 3.82x |
| Median effective concurrency | 2.670 | 7.089 | 2.65x |

## Structural acceptance

세 dynamic run 모두 다음 구조를 반복 확인했다.

- shared production frontend build 1회, Vite process 0개, frontend port 0개;
- 105 jobs, fixed 8 workers, Chromium 7 + Firefox/WebKit 1 lane과 Chromium tail stealing;
- non-auth API setup 485회, auth-under-test UI setup 24회, auth failure 0;
- compatible pending work가 있을 때 250ms 이상 avoidable idle 0건;
- DB reset lock retry 0건, worker/job/evidence collision 0건;
- process spawn role: discovery 1, frontend-build 1, orchestrator 8,
  Playwright CLI 105, browser 11, Vite 0;
- expected/actual test, project, browser, viewport, skip, failure, screenshot/evidence
  parity exact;
- runner-owned active process 0, worker cleanup 8/8, owned port/DB/temp/upload/profile
  residue 0, foreground/visible window transition 0.

LPT history v2는 Playwright의 실제 test duration 최근 5개 complete-green median과
browser별 boundary overhead를 사용한다. Failed/flaky/partial/interrupted/cleanup-failed
run은 갱신하지 않고 atomic write한다. 초기 균등 배분 profile의 median absolute
error 34.2초와 MAPE 117.7%에서, 최종 세 run은 각각 3.58/1.75/2.81초와
5.87/3.60/6.15%로 개선됐다.

| Dynamic run | Runner CPU | Read / write I/O | Peak working set | Peak owned process |
| --- | ---: | ---: | ---: | ---: |
| Dynamic 1 | 7,196.75 CPU-s | 16.45 / 15.14 GB | 16.16 GiB | 194 |
| Dynamic 2 | 7,422.22 CPU-s | 16.82 / 15.67 GB | 16.30 GiB | 198 |
| Dynamic 3 | 7,567.22 CPU-s | 16.89 / 15.77 GB | 12.38 GiB | 166 |

CPU, memory, process와 I/O 증가는 idle worker를 줄이고 유용한 처리량을 높이기 위한
의도된 비용이다. Dynamic 1/2에서는 다른 로컬 workload와 겹친 low-memory 구간에
backend health p95가 일시적으로 750ms를 넘었지만, test crash/flaky/cleanup failure는
발생하지 않았다. Paging은 직접 계측하지 않았으므로 발생하지 않았다고 단정하지
않는다. 별도 adaptive full run `20260715T150655-9a61f0f1`은 같은 570개 inventory를
green으로 완료하면서 memory `<15%` 신호에 capacity를 `8 -> 7 -> 6 -> 5 -> 4`로
낮췄고, running job을 중단하거나 failure를 숨기지 않았으며 10/10 capsule cleanup을
완료했다.

## Verification

- `npm run ci:test`
- `npm run frontend:unit`
- `npm run frontend:lint`
- `npm run frontend:doctor`
- `npm run frontend:build`
- scheduler unit/integration, Ruff, basedpyright
- `uv run python scripts/verify_e2e_screenshots.py` (1,023 verified)
- `uv run python scripts/check_mojibake.py`
- fixed-8 full matrix 3회 연속 green과 adaptive full matrix 1회 green
- 최종 SHA full-run foreground-window monitor 0 transition, cleanup residue 0

제품 assertion, timeout, retry, skip 또는 coverage는 성능을 위해 변경하지 않았다.
같은 SHA의 교차 결과는 구조적 처리량 개선이 wall time 감소로 이어졌음을 보조적으로
확인한다.

## Final adopted inventory validation

독립 리뷰에서 mobile core timeout 의미를 복원하고, complete metrics와
screenshot/UIUX publication을 하나의 transaction으로 묶고, worker `.runtime` cleanup을
추가한 최종 구조는 564 tests / 99 jobs다. 아래 세 run은 모두 554 passed / 0 failed /
10 expected skipped, 6 projects, 3 browser engines, 1,023/1,023 evidence,
avoidable idle 0, auth API 485/UI 24/failure 0, build 1/Vite 0을 기록했다.

| Mode | Run ID | Wall (secondary) | Worker-min | Runner CPU | Read/write | Peak WS/process | Cleanup/foreground |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Fixed 8 | `20260715T215634-21bd4ba0` | 14.75m | 97.84 | 7,602.56s | 15.54/14.70 GB | 16.15 GiB / 200 | 8/8, residue 0, transition 0 |
| Fixed 8 | `20260715T221228-3c4fbdea` | 13.93m | 98.65 | 7,623.05s | 15.62/14.73 GB | 14.97 GiB / 184 | 8/8, residue 0, transition 0 |
| Adaptive | `20260715T230402-ced81a8b` | 14.31m | 92.95 | 7,444.39s | 15.30/14.44 GB | 15.27 GiB / 197 | 10/10, residue 0, transition 0 |

Fixed runs는 host CPU median 100%와 minimum available memory 11.02%/8.70%에서도
flaky나 cleanup failure 없이 자원을 적극 활용했다. Adaptive run은 minimum available
memory 13.00%와 backend latency signal에 따라 `8 -> 7 -> 6 -> 5 -> 4`로 감소했고,
running job interruption이나 재확장은 없었다.

첫 adaptive qualification은 기존 touch helper가 `pointerdown` 뒤 120ms wall-clock sleep을
사용해 CPU saturation에서 release가 long-press 임계값 뒤로 밀리는 race를 드러냈다.
해당 partial run은 history와 global publication을 갱신하지 않았다. Assertion, test
timeout, retry, skip은 유지하고 pointerdown/up을 한 browser task에서 동기적으로
전달한 뒤 기존 cancellation wait를 유지했다. 문제 test `repeat-each=5` 전부와 위
adaptive full run이 green으로 재검증됐다.
