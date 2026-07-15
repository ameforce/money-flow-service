import os
from typing import final

import pytest

from scripts.e2e_scheduler.adaptive import AdaptiveCapacityController
from scripts.e2e_scheduler.resources import (
    AdaptivePolicy,
    AdaptivePolicyConfigError,
    CapacityOutOfBoundsError,
    ResourceSample,
    WindowsSystemSampler,
)


@final
class _Sampler:
    def __init__(self, samples: list[ResourceSample | OSError]) -> None:
        self.samples = samples

    def sample(self) -> ResourceSample:
        sample = self.samples.pop(0)
        if isinstance(sample, OSError):
            raise sample
        return sample


def overloaded_sample() -> ResourceSample:
    return ResourceSample(
        cpu_percent=95.0,
        available_memory_percent=19.0,
        backend_p95_ms=501.0,
        recent_worker_crashes=0,
        recent_unexpected_failures=0,
    )


def healthy_sample() -> ResourceSample:
    return ResourceSample(
        cpu_percent=75.0,
        available_memory_percent=25.0,
        backend_p95_ms=350.0,
        recent_worker_crashes=0,
        recent_unexpected_failures=0,
    )


def test_adaptive_policy_moves_one_step_within_four_to_ten() -> None:
    # Given
    policy = AdaptivePolicy(minimum=4, maximum=10, cooldown_seconds=60)

    # When
    reduced = policy.next_capacity(
        8,
        ResourceSample(50.0, 14.9, 100.0, 0, 0),
        elapsed_seconds=61,
    )
    bounded_reduction = policy.next_capacity(
        4,
        ResourceSample(50.0, 50.0, 750.1, 0, 0),
        elapsed_seconds=61,
    )
    increased = policy.next_capacity(
        8,
        healthy_sample(),
        elapsed_seconds=61,
        healthy_streak=3,
    )

    # Then
    assert reduced == 7
    assert bounded_reduction == 4
    assert increased == 9


def test_adaptive_policy_waits_for_cooldown() -> None:
    # Given
    policy = AdaptivePolicy(cooldown_seconds=60)

    # When
    capacity = policy.next_capacity(
        8,
        healthy_sample(),
        elapsed_seconds=59.9,
        healthy_streak=3,
    )

    # Then
    assert capacity == 8


def test_adaptive_policy_keeps_capacity_for_mixed_sample() -> None:
    # Given
    policy = AdaptivePolicy()
    mixed = ResourceSample(
        cpu_percent=80.0,
        available_memory_percent=20.0,
        backend_p95_ms=500.0,
        recent_worker_crashes=0,
        recent_unexpected_failures=0,
    )

    # When
    capacity = policy.next_capacity(8, mixed, elapsed_seconds=61)

    # Then
    assert capacity == 8


def test_failure_signal_prevents_scale_up_and_reduces_capacity() -> None:
    # Given
    policy = AdaptivePolicy()
    failed = ResourceSample(
        cpu_percent=30.0,
        available_memory_percent=80.0,
        backend_p95_ms=100.0,
        recent_worker_crashes=0,
        recent_unexpected_failures=1,
    )

    # When
    capacity = policy.next_capacity(8, failed, elapsed_seconds=61)

    # Then
    assert capacity == 7


@pytest.mark.parametrize(
    ("minimum", "maximum", "cooldown_seconds"),
    (
        (3, 10, 60.0),
        (4, 11, 60.0),
        (8, 7, 60.0),
        (4, 10, -0.1),
    ),
)
def test_adaptive_policy_rejects_invalid_configuration(
    minimum: int,
    maximum: int,
    cooldown_seconds: float,
) -> None:
    # Given / When / Then
    with pytest.raises(AdaptivePolicyConfigError):
        _ = AdaptivePolicy(
            minimum=minimum,
            maximum=maximum,
            cooldown_seconds=cooldown_seconds,
        )


@pytest.mark.parametrize(
    ("minimum", "maximum", "current"),
    ((4, 10, 3), (4, 10, 11), (6, 8, 5), (6, 8, 9)),
)
def test_adaptive_policy_rejects_current_outside_bounds_during_cooldown(
    minimum: int,
    maximum: int,
    current: int,
) -> None:
    # Given
    policy = AdaptivePolicy(
        minimum=minimum,
        maximum=maximum,
        cooldown_seconds=60,
    )

    # When / Then
    with pytest.raises(CapacityOutOfBoundsError) as error:
        _ = policy.next_capacity(
            current,
            healthy_sample(),
            elapsed_seconds=0,
            healthy_streak=3,
        )

    assert error.value.current == current


@pytest.mark.parametrize("maximum", (4, 7, 10))
def test_healthy_sample_respects_configured_maximum(maximum: int) -> None:
    # Given
    policy = AdaptivePolicy(minimum=4, maximum=maximum)

    # When
    capacity = policy.next_capacity(
        maximum,
        healthy_sample(),
        elapsed_seconds=61,
        healthy_streak=3,
    )

    # Then
    assert capacity == maximum


@pytest.mark.parametrize(
    "sample",
    (
        ResourceSample(50.0, 14.9, 100.0, 0, 0),
        ResourceSample(50.0, 50.0, 750.1, 0, 0),
        ResourceSample(50.0, 50.0, 100.0, 1, 0),
    ),
    ids=(
        "memory-overload",
        "backend-p95-overload",
        "worker-crash-overload",
    ),
)
def test_overload_thresholds_reduce_capacity(sample: ResourceSample) -> None:
    # Given
    policy = AdaptivePolicy()

    # When
    capacity = policy.next_capacity(8, sample, elapsed_seconds=61)

    # Then
    assert capacity == 7


@pytest.mark.parametrize(
    "sample",
    (
        ResourceSample(75.0, 50.0, 100.0, 0, 0),
        ResourceSample(50.0, 25.0, 100.0, 0, 0),
        ResourceSample(50.0, 50.0, 350.0, 0, 0),
    ),
    ids=(
        "cpu-inclusive-healthy",
        "memory-inclusive-healthy",
        "p95-inclusive-healthy",
    ),
)
def test_healthy_thresholds_increase_capacity(sample: ResourceSample) -> None:
    # Given
    policy = AdaptivePolicy()

    # When
    capacity = policy.next_capacity(
        8,
        sample,
        elapsed_seconds=61,
        healthy_streak=3,
    )

    # Then
    assert capacity == 9


def test_high_cpu_alone_is_normal_utilization_not_overload() -> None:
    policy = AdaptivePolicy()

    capacity = policy.next_capacity(
        8,
        ResourceSample(99.0, 40.0, 200.0, 0, 0),
        elapsed_seconds=61,
        pressure_streak=10,
    )

    assert capacity == 8


def test_combined_cpu_memory_backend_pressure_requires_two_samples() -> None:
    policy = AdaptivePolicy()

    first = policy.next_capacity(
        8,
        overloaded_sample(),
        elapsed_seconds=61,
        pressure_streak=1,
    )
    second = policy.next_capacity(
        8,
        overloaded_sample(),
        elapsed_seconds=61,
        pressure_streak=2,
    )

    assert first == 8
    assert second == 7


def test_healthy_capacity_requires_three_samples_and_expansion_permission() -> None:
    policy = AdaptivePolicy()

    assert policy.next_capacity(
        8, healthy_sample(), elapsed_seconds=61, healthy_streak=2
    ) == 8
    assert policy.next_capacity(
        8,
        healthy_sample(),
        elapsed_seconds=61,
        healthy_streak=3,
        expansion_allowed=False,
    ) == 8


@pytest.mark.skipif(os.name != "nt", reason="Windows system API adapter")
def test_windows_system_sampler_reports_bounded_percentages() -> None:
    # Given
    sampler = WindowsSystemSampler(interval_seconds=0.01)

    # When
    sample = sampler.sample()

    # Then
    assert 0.0 <= sample.cpu_percent <= 100.0
    assert 0.0 <= sample.available_memory_percent <= 100.0


def test_windows_sampler_reports_typed_unsupported_error_off_windows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(os, "name", "posix")

    with pytest.raises(OSError, match="WindowsSystemSampler"):
        _ = WindowsSystemSampler(interval_seconds=0).sample()


def test_adaptive_controller_reduces_only_future_assignment_capacity() -> None:
    controller = AdaptiveCapacityController(
        initial=8,
        started_capsules=8,
        sampler=_Sampler([overloaded_sample(), overloaded_sample()]),
        policy=AdaptivePolicy(cooldown_seconds=0),
        sample_interval_seconds=0,
    )

    first = controller.assignment_capacity()
    capacity = controller.assignment_capacity()

    assert first == 8
    assert capacity == 7
    assert controller.decisions[-1].reason == "overloaded"


def test_sampler_failure_never_increases_capacity_and_is_evidenced() -> None:
    controller = AdaptiveCapacityController(
        initial=8,
        started_capsules=10,
        sampler=_Sampler([OSError("counter unavailable")]),
        policy=AdaptivePolicy(cooldown_seconds=0),
        sample_interval_seconds=0,
    )

    capacity = controller.assignment_capacity()

    assert capacity == 8
    assert controller.decisions[-1].reason == "sampler-error"
    assert "counter unavailable" in controller.decisions[-1].detail


def test_failure_blocks_reexpansion_for_the_rest_of_the_run() -> None:
    failed = ResourceSample(30.0, 80.0, 100.0, 0, 1)
    controller = AdaptiveCapacityController(
        initial=8,
        started_capsules=10,
        sampler=_Sampler([failed, healthy_sample(), healthy_sample(), healthy_sample()]),
        policy=AdaptivePolicy(cooldown_seconds=0),
        sample_interval_seconds=0,
    )

    capacities = tuple(controller.assignment_capacity() for _ in range(4))

    assert capacities == (7, 7, 7, 7)
    assert controller.decisions[-1].reason != "healthy"
