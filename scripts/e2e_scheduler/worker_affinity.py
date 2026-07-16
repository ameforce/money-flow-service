"""Deterministic browser-project affinity for bounded warm worker pools."""

from __future__ import annotations

from collections.abc import Collection, Mapping

from scripts.e2e_scheduler.model import JobSpec, WorkerId
from scripts.e2e_scheduler.project_profiles import BrowserEngine, project_profile


_BROWSER_ENGINE_ORDER: tuple[BrowserEngine, ...] = (
    "chromium",
    "firefox",
    "webkit",
)


def plan_worker_projects(
    worker_ids: tuple[WorkerId, ...],
    jobs: tuple[JobSpec, ...],
) -> Mapping[WorkerId, frozenset[str]]:
    """Keep non-Chromium engines on one warm worker without fixed spec shards."""
    if not worker_ids:
        return {}
    projects = frozenset(job.project for job in jobs)
    chromium_projects = frozenset(
        project
        for project in projects
        if project_profile(project).browser == "chromium"
    )
    cross_browser_projects = projects - chromium_projects
    if not cross_browser_projects or not chromium_projects:
        return {worker_id: projects for worker_id in worker_ids}
    if len(worker_ids) < 2:
        only_worker = next(iter(worker_ids))
        return {only_worker: projects}
    cross_browser_worker = worker_ids[-1]
    return {
        worker_id: (
            cross_browser_projects
            if worker_id == cross_browser_worker
            else chromium_projects
        )
        for worker_id in worker_ids
    }


def plan_adaptive_worker_projects(
    warm_worker_ids: tuple[WorkerId, ...],
    reserve_worker_ids: tuple[WorkerId, ...],
    jobs: tuple[JobSpec, ...],
) -> Mapping[WorkerId, frozenset[str]]:
    """Keep the cross-browser lane warm and reserve only Chromium capacity."""
    warm_projects = plan_worker_projects(warm_worker_ids, jobs)
    projects = frozenset(job.project for job in jobs)
    chromium_projects = frozenset(
        project
        for project in projects
        if project_profile(project).browser == "chromium"
    )
    reserve_projects = chromium_projects or projects
    return {
        **warm_projects,
        **{
            worker_id: reserve_projects
            for worker_id in reserve_worker_ids
        },
    }


def adaptive_capacity_worker_order(
    warm_worker_ids: tuple[WorkerId, ...],
    reserve_worker_ids: tuple[WorkerId, ...],
) -> tuple[WorkerId, ...]:
    """Preserve the warm cross-browser lane through capacity reductions."""
    if not warm_worker_ids:
        return reserve_worker_ids
    return (
        warm_worker_ids[-1],
        *warm_worker_ids[:-1],
        *reserve_worker_ids,
    )


def plan_worker_fallback_projects(
    worker_ids: tuple[WorkerId, ...],
    jobs: tuple[JobSpec, ...],
    primary_projects: Mapping[WorkerId, frozenset[str]],
) -> Mapping[WorkerId, frozenset[str]]:
    """Open one bidirectional tail assistant after its primary lane completes."""
    chromium_projects = frozenset(
        job.project
        for job in jobs
        if project_profile(job.project).browser == "chromium"
    )
    cross_browser_projects = frozenset(job.project for job in jobs) - chromium_projects
    chromium_workers = tuple(
        worker_id
        for worker_id in worker_ids
        if primary_projects.get(worker_id, frozenset()).intersection(
            chromium_projects
        )
        and primary_projects.get(worker_id, frozenset()).isdisjoint(
            cross_browser_projects
        )
    )
    tail_assistant = chromium_workers[-1] if chromium_workers else None
    return {
        worker_id: (
            chromium_projects
            if chromium_projects
            and projects.intersection(cross_browser_projects)
            and projects.isdisjoint(chromium_projects)
            else (
                cross_browser_projects
                if worker_id == tail_assistant and cross_browser_projects
                else frozenset()
            )
        )
        for worker_id, projects in primary_projects.items()
    }


def browser_engines_for_projects(
    projects: Collection[str],
) -> tuple[BrowserEngine, ...]:
    """Derive capsule engines from the same discovered project assignment."""
    engines = frozenset(project_profile(project).browser for project in projects)
    ordered: list[BrowserEngine] = []
    for engine in _BROWSER_ENGINE_ORDER:
        if engine in engines:
            ordered.append(engine)
    return tuple(ordered) or ("chromium",)


def browser_engines_for_affinity(
    primary_projects: Collection[str],
    fallback_projects: Collection[str],
) -> tuple[BrowserEngine, ...]:
    """Start primary engines first and keep fallback Chromium lazy."""
    return tuple(
        dict.fromkeys(
            (
                *browser_engines_for_projects(primary_projects),
                *browser_engines_for_projects(fallback_projects),
            )
        )
    )
