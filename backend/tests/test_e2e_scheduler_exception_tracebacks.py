from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pytest

from scripts.e2e_scheduler.browser_runtime import BrowserRuntimeResolutionError
from scripts.e2e_scheduler.processes import OwnedProcessCleanupError


@contextmanager
def _traceback_boundary() -> Iterator[None]:
    yield


@pytest.mark.parametrize(
    "error",
    [
        BrowserRuntimeResolutionError("browser launch failed"),
        OwnedProcessCleanupError(
            pid=7001,
            open_ports=(8123,),
            process_running=True,
        ),
    ],
)
def test_scheduler_errors_preserve_original_exception_across_context_boundary(
    error: BaseException,
) -> None:
    with pytest.raises(type(error)) as captured:
        with _traceback_boundary():
            raise error

    assert captured.value is error
