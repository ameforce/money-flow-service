from pathlib import Path

from scripts.e2e_scheduler.model import JobId, JobSpec, WorkerId
from scripts.e2e_scheduler.worker_affinity import (
    adaptive_capacity_worker_order,
    browser_engines_for_affinity,
    browser_engines_for_projects,
    plan_adaptive_worker_projects,
    plan_worker_fallback_projects,
    plan_worker_projects,
)


def _job(job_id: str, project: str) -> JobSpec:
    return JobSpec(
        job_id=JobId(job_id),
        project=project,
        spec_path=Path(f"e2e/specs/{job_id}.spec.js"),
        logical_group=job_id,
        tests=(),
        locks=frozenset(),
        estimated_seconds=1.0,
    )


def test_matrix_affinity_keeps_cross_browser_engines_on_one_worker() -> None:
    workers = tuple(WorkerId(f"worker-{index}") for index in range(1, 9))
    jobs = (
        _job("desktop", "desktop-chromium"),
        _job("matrix-chromium", "matrix-chromium"),
        _job("matrix-firefox", "matrix-firefox"),
        _job("matrix-webkit", "matrix-webkit"),
    )

    affinity = plan_worker_projects(workers, jobs)

    assert affinity[WorkerId("worker-8")] == frozenset(
        {"matrix-firefox", "matrix-webkit"}
    )
    for worker in workers[:-1]:
        assert affinity[worker] == frozenset({"desktop-chromium", "matrix-chromium"})

    fallback = plan_worker_fallback_projects(workers, jobs, affinity)
    assert fallback[WorkerId("worker-7")] == frozenset(
        {"matrix-firefox", "matrix-webkit"}
    )
    assert fallback[WorkerId("worker-8")] == frozenset(
        {"desktop-chromium", "matrix-chromium"}
    )
    assert all(not fallback[worker] for worker in workers[:6])


def test_fixed_eight_tail_assist_starts_cross_browser_engines_lazily_on_worker_seven(
) -> None:
    # Given
    workers = tuple(WorkerId(f"worker-{index}") for index in range(1, 9))
    jobs = (
        _job("desktop", "desktop-chromium"),
        _job("firefox", "matrix-firefox"),
        _job("webkit", "matrix-webkit"),
    )
    affinity = plan_worker_projects(workers, jobs)

    # When
    fallback = plan_worker_fallback_projects(workers, jobs, affinity)
    engines = {
        worker: browser_engines_for_affinity(affinity[worker], fallback[worker])
        for worker in workers
    }

    # Then
    assert engines[WorkerId("worker-7")] == ("chromium", "firefox", "webkit")
    assert engines[WorkerId("worker-8")] == ("firefox", "webkit", "chromium")
    assert all(
        engines[worker] == ("chromium",)
        for worker in workers[:6]
    )


def test_non_matrix_inventory_remains_stealable_by_every_worker() -> None:
    workers = (WorkerId("worker-1"), WorkerId("worker-2"))
    jobs = (_job("desktop", "desktop-chromium"),)

    affinity = plan_worker_projects(workers, jobs)

    assert affinity == {
        WorkerId("worker-1"): frozenset({"desktop-chromium"}),
        WorkerId("worker-2"): frozenset({"desktop-chromium"}),
    }


def test_runtime_starts_only_engines_from_the_discovered_assignment() -> None:
    assert browser_engines_for_projects({"desktop-chromium", "matrix-chromium"}) == (
        "chromium",
    )
    assert browser_engines_for_projects({"matrix-firefox", "matrix-webkit"}) == (
        "firefox",
        "webkit",
    )
    assert browser_engines_for_affinity(
        {"matrix-firefox", "matrix-webkit"},
        {"desktop-chromium"},
    ) == ("firefox", "webkit", "chromium")


def test_single_worker_mixed_matrix_owns_every_required_engine() -> None:
    worker = WorkerId("worker-1")
    jobs = (
        _job("desktop", "desktop-chromium"),
        _job("firefox", "matrix-firefox"),
        _job("webkit", "matrix-webkit"),
    )

    affinity = plan_worker_projects((worker,), jobs)

    assert browser_engines_for_projects(affinity[worker]) == (
        "chromium",
        "firefox",
        "webkit",
    )


def test_single_project_filter_keeps_queue_and_capsules_consistent() -> None:
    workers = (WorkerId("worker-1"), WorkerId("worker-2"))
    jobs = (_job("firefox", "matrix-firefox"),)

    affinity = plan_worker_projects(workers, jobs)

    assert all(
        browser_engines_for_projects(affinity[worker]) == ("firefox",)
        for worker in workers
    )


def test_adaptive_affinity_keeps_worker_eight_warm_for_cross_browser_lane() -> None:
    warm_workers = tuple(WorkerId(f"worker-{index}") for index in range(1, 9))
    reserve_workers = (WorkerId("worker-9"), WorkerId("worker-10"))
    jobs = (
        _job("desktop", "desktop-chromium"),
        _job("firefox", "matrix-firefox"),
        _job("webkit", "matrix-webkit"),
    )

    affinity = plan_adaptive_worker_projects(
        warm_workers,
        reserve_workers,
        jobs,
    )

    assert affinity[WorkerId("worker-8")] == frozenset(
        {"matrix-firefox", "matrix-webkit"}
    )
    assert affinity[WorkerId("worker-9")] == frozenset({"desktop-chromium"})
    assert affinity[WorkerId("worker-10")] == frozenset({"desktop-chromium"})

    fallback = plan_worker_fallback_projects(warm_workers, jobs, affinity)
    assert fallback[WorkerId("worker-7")] == frozenset(
        {"matrix-firefox", "matrix-webkit"}
    )
    assert fallback[WorkerId("worker-8")] == frozenset({"desktop-chromium"})
    assert fallback[WorkerId("worker-9")] == frozenset()
    assert fallback[WorkerId("worker-10")] == frozenset()
    assert browser_engines_for_affinity(
        affinity[WorkerId("worker-7")],
        fallback[WorkerId("worker-7")],
    ) == ("chromium", "firefox", "webkit")
    assert browser_engines_for_affinity(
        affinity[WorkerId("worker-9")],
        fallback[WorkerId("worker-9")],
    ) == ("chromium",)
    assert browser_engines_for_affinity(
        affinity[WorkerId("worker-10")],
        fallback[WorkerId("worker-10")],
    ) == ("chromium",)


def test_adaptive_capacity_order_preserves_cross_browser_before_chromium_slots() -> None:
    warm_workers = tuple(WorkerId(f"worker-{index}") for index in range(1, 9))
    reserve_workers = (WorkerId("worker-9"), WorkerId("worker-10"))

    order = adaptive_capacity_worker_order(warm_workers, reserve_workers)

    assert order[:4] == (
        WorkerId("worker-8"),
        WorkerId("worker-1"),
        WorkerId("worker-2"),
        WorkerId("worker-3"),
    )
    assert order[8:] == reserve_workers
