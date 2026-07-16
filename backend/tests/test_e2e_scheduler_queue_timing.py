from scripts.e2e_scheduler.queue_timing import QueueTiming, QueueWaitReason


def test_eligible_wait_at_threshold_counts_as_avoidable_idle() -> None:
    # Given
    timing = QueueTiming(started_at=10.0)
    timing.record_wait(QueueWaitReason.ELIGIBLE, 0.249)

    # When
    timing.record_wait(QueueWaitReason.ELIGIBLE, 0.250)
    metrics = timing.finish(11.0)

    # Then
    assert metrics.queue_wait_seconds == 1.0
    assert metrics.eligible_idle_seconds == 0.499
    assert metrics.avoidable_idle_count == 1


def test_no_pending_wait_does_not_attribute_blocked_time() -> None:
    # Given
    timing = QueueTiming(started_at=20.0)

    # When
    timing.record_wait(QueueWaitReason.NO_PENDING, 0.5)
    metrics = timing.finish(21.0)

    # Then
    assert metrics.eligible_idle_seconds == 0.0
    assert metrics.affinity_blocked_seconds == 0.0
    assert metrics.lock_blocked_seconds == 0.0
    assert metrics.capacity_blocked_seconds == 0.0
    assert metrics.avoidable_idle_count == 0
