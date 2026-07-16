"""Dynamic E2E coordinator over immutable manifests and warm capsules."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Final

from scripts.e2e_scheduler.adaptive_worker_pool import AdaptiveWorkerPool
from scripts.e2e_scheduler.discovery import build_jobs
from scripts.e2e_scheduler.logical_groups import CurrentLogicalGroupResolver
from scripts.e2e_scheduler.model import RunId, RunManifest, WorkerId
from scripts.e2e_scheduler.queue import EligibleJobQueue
from scripts.e2e_scheduler.adaptive import AdaptiveCapacityController, CapacityDecision
from scripts.e2e_scheduler.resources import ResourceSample
from scripts.e2e_scheduler.resource_sampling_monitor import (
    ResourceSamplingMonitor,
    ResourceSamplingSnapshot,
    SynchronizedResourceSampler,
)
from scripts.e2e_scheduler.runner_completion import CompletionContext, complete_run
from scripts.e2e_scheduler.runner_options import RunnerOptions
from scripts.e2e_scheduler.runner_worker import (
    CapsuleWorker,
    ResultLedger,
    SchedulerRuntime,
    TimedJobResult,
    WorkerCrash,
    close_capsules,
    run_worker_pool,
)
from scripts.e2e_scheduler.worker_affinity import (
    adaptive_capacity_worker_order,
    browser_engines_for_affinity,
    plan_adaptive_worker_projects,
    plan_worker_fallback_projects,
    plan_worker_projects,
)

__all__ = ("TimedJobResult", "WorkerCrash", "run_dynamic", "start_capsules")

ADAPTIVE_MAX_WORKERS: Final = 10


def run_dynamic(
    options: RunnerOptions,
    playwright_args: tuple[str, ...],
    *,
    runtime: SchedulerRuntime | None = None,
) -> int:
    if runtime is None:
        from scripts.e2e_scheduler.runner_runtime import LocalSchedulerRuntime

        runtime = LocalSchedulerRuntime(options)
    try:
        return _run_dynamic(options, playwright_args, runtime)
    except Exception as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
        print(f"[e2e-runner] dynamic coordinator failed: {error}", flush=True)
        return 1


def _run_dynamic(
    options: RunnerOptions,
    playwright_args: tuple[str, ...],
    runtime: SchedulerRuntime,
) -> int:
    run_id = runtime.new_run_id()
    build_code = runtime.build_frontend()
    if build_code != 0:
        return build_code
    discovered = runtime.discover(options.discovery_args)
    history = runtime.load_history()
    manifest = RunManifest(
        run_id=run_id,
        tests=discovered,
        jobs=build_jobs(discovered, history, CurrentLogicalGroupResolver()),
        playwright_args=playwright_args,
        benchmark_invocation_id=(
            str(os.environ.get("E2E_BENCHMARK_INVOCATION_ID") or "") or None
        ),
        benchmark_label=options.benchmark_label,
    )
    manifest.save(runtime.manifest_path(run_id))
    warm_worker_ids = tuple(
        WorkerId(f"worker-{index + 1}") for index in range(options.scheduler_workers)
    )
    reserve_worker_ids = (
        tuple(
            WorkerId(f"worker-{index}")
            for index in range(
                options.scheduler_workers + 1,
                ADAPTIVE_MAX_WORKERS + 1,
            )
        )
        if options.adaptive_workers
        else ()
    )
    worker_ids = (*warm_worker_ids, *reserve_worker_ids)
    worker_projects = (
        plan_adaptive_worker_projects(
            warm_worker_ids,
            reserve_worker_ids,
            manifest.jobs,
        )
        if options.adaptive_workers
        else plan_worker_projects(worker_ids, manifest.jobs)
    )
    worker_fallback_projects = plan_worker_fallback_projects(
        warm_worker_ids,
        manifest.jobs,
        worker_projects,
    )
    capsules = tuple(
        runtime.create_capsule(
            run_id,
            worker_id,
            options.job_args,
            browser_engines_for_affinity(
                worker_projects[worker_id],
                worker_fallback_projects[worker_id],
            ),
        )
        for worker_id in worker_ids
    )
    warm_capsules = capsules[: len(warm_worker_ids)]
    reserve_capsules = capsules[len(warm_worker_ids) :]
    sampler = SynchronizedResourceSampler(runtime.create_resource_sampler(capsules))
    resource_monitor = ResourceSamplingMonitor(sampler)
    controller: AdaptiveCapacityController | None = None
    activation: AdaptiveWorkerPool | None = None
    if options.adaptive_workers:
        controller = AdaptiveCapacityController(
            initial=options.scheduler_workers,
            started_capsules=len(capsules),
            sampler=sampler,
        )
        activation = AdaptiveWorkerPool(
            run_id,
            controller,
            warm_worker_ids=warm_worker_ids,
            reserve_capsules=reserve_capsules,
            capacity_order=adaptive_capacity_worker_order(
                warm_worker_ids,
                reserve_worker_ids,
            ),
        )
    queue = EligibleJobQueue(
        manifest.jobs,
        capacity_controller=activation,
        worker_projects=worker_projects,
        worker_fallback_projects=worker_fallback_projects,
    )
    ledger = ResultLedger()
    crash: WorkerCrash | None = None
    final_sample: ResourceSample | None = None
    interruption: KeyboardInterrupt | SystemExit | None = None
    sampling = ResourceSamplingSnapshot((), ())
    monitor_started = False
    monitor_failed = False
    started_workers = 0
    final_sample_error: str | None = None
    try:
        crash = start_capsules(run_id, warm_capsules, runtime)
        if crash is None:
            resource_monitor.start()
            monitor_started = True
            crash = run_worker_pool(
                run_id,
                capsules,
                queue,
                ledger,
                runtime,
                activation,
            )
        if crash is None:
            try:
                final_sample = sampler.sample()
            except Exception as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
                final_sample_error = str(error)
                print(f"[e2e-runner] final resource sample failed: {error}", flush=True)
    except (KeyboardInterrupt, SystemExit) as error:
        interruption = error
    finally:
        if monitor_started:
            try:
                sampling = resource_monitor.stop()
            except RuntimeError as error:
                monitor_failed = True
                sampling = ResourceSamplingSnapshot((), (str(error),))
        if final_sample is not None:
            sampling = ResourceSamplingSnapshot(
                (*sampling.samples, final_sample),
                sampling.errors,
            )
        elif final_sample_error is not None:
            sampling = ResourceSamplingSnapshot(
                sampling.samples,
                (*sampling.errors, final_sample_error),
            )
        started_workers = sum(capsule.is_started for capsule in capsules)
        cleanup = close_capsules(capsules)
        decisions: tuple[CapacityDecision, ...] = (
            controller.decisions if controller is not None else ()
        )

    return complete_run(
        runtime,
        CompletionContext(
            run_id=run_id,
            manifest=manifest,
            history=history,
            results=ledger.finalized(cleanup),
            cleanup=cleanup,
            sampling=sampling,
            final_sample=final_sample,
            started_workers=started_workers,
            crash=crash,
            monitor_failed=monitor_failed,
            interruption=interruption,
            capacity_decisions=decisions,
        ),
    )


def start_capsules(
    run_id: RunId,
    capsules: tuple[CapsuleWorker, ...],
    runtime: SchedulerRuntime,
) -> WorkerCrash | None:
    first_crash: WorkerCrash | None = None
    executor = ThreadPoolExecutor(max_workers=len(capsules))
    try:
        futures = {executor.submit(capsule.start): capsule for capsule in capsules}
        for future in as_completed(futures):
            capsule = futures[future]
            try:
                future.result()
            except Exception as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
                if first_crash is None:
                    first_crash = WorkerCrash(
                        run_id=run_id,
                        worker_id=capsule.worker_id,
                        job_id=None,
                        error_type=type(error).__name__,
                        detail=str(error),
                    )
                    runtime.record_worker_crash(first_crash)
                    _request_capsule_stop(capsules)
    except (KeyboardInterrupt, SystemExit):
        _request_capsule_stop(capsules)
        raise
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
    return first_crash


def _request_capsule_stop(capsules: tuple[CapsuleWorker, ...]) -> None:
    for capsule in capsules:
        try:
            capsule.request_stop()
        except Exception as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
            print(f"[e2e-runner] capsule startup stop failed: {error}", flush=True)
