"""Bounded parallel cleanup for isolated worker capsules."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Final, Protocol

from scripts.e2e_scheduler.model import WorkerId


class ClosableCapsule(Protocol):
    worker_id: WorkerId

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class CleanupOutcome:
    worker_id: WorkerId
    succeeded: bool


CAPSULE_CLEANUP_MAX_WORKERS: Final = 10


def close_capsules(
    capsules: tuple[ClosableCapsule, ...],
) -> tuple[CleanupOutcome, ...]:
    if not capsules:
        return ()
    with ThreadPoolExecutor(
        max_workers=min(CAPSULE_CLEANUP_MAX_WORKERS, len(capsules)),
        thread_name_prefix="e2e-cleanup",
    ) as executor:
        futures = tuple(
            executor.submit(_close_capsule, capsule) for capsule in capsules
        )
        return tuple(future.result() for future in futures)


def _close_capsule(capsule: ClosableCapsule) -> CleanupOutcome:
    try:
        capsule.close()
    except Exception as error:  # noqa: BLE001  # noqa: BROAD_EXCEPT_OK
        print(f"[e2e-runner] capsule cleanup failed: {error}", flush=True)
        return CleanupOutcome(capsule.worker_id, False)
    return CleanupOutcome(capsule.worker_id, True)
