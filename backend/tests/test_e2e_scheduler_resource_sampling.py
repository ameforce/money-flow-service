from __future__ import annotations

from dataclasses import dataclass

import pytest

from scripts.e2e_scheduler.resource_sampling import CapsuleResourceSampler
from scripts.e2e_scheduler.resources import SystemResourceSample


class _SystemSampler:
    def sample(self) -> SystemResourceSample:
        return SystemResourceSample(60.0, 40.0)


@dataclass(slots=True)
class _Capsule:
    is_started: bool
    latency_ms: float
    calls: int = 0

    def backend_health_latency_ms(self) -> float:
        self.calls += 1
        return self.latency_ms


def test_sampler_skips_cold_reserve_then_includes_it_after_activation() -> None:
    warm = _Capsule(True, 100.0)
    reserve = _Capsule(False, 700.0)
    sampler = CapsuleResourceSampler(_SystemSampler(), (warm, reserve))

    before = sampler.sample()
    reserve.is_started = True
    after = sampler.sample()

    assert before.backend_p95_ms == 100.0
    assert after.backend_p95_ms == 700.0
    assert reserve.calls == 1


def test_sampler_fails_closed_without_any_started_backend() -> None:
    sampler = CapsuleResourceSampler(
        _SystemSampler(),
        (_Capsule(False, 100.0),),
    )

    with pytest.raises(OSError, match="no started backend"):
        _ = sampler.sample()
