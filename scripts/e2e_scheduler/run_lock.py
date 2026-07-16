"""Repository-scoped cross-process ownership for one local E2E run."""

from __future__ import annotations

from datetime import UTC, datetime
import errno
import os
from pathlib import Path
from types import TracebackType
from typing import ClassVar, final, override
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError


_BUSY_ERRNOS = frozenset({errno.EACCES, errno.EAGAIN, errno.EDEADLK})


class RunLockOwner(BaseModel):
    """Diagnostic identity written only after kernel lock acquisition."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    pid: int = Field(gt=0)
    mode: str = Field(min_length=1)
    invocation_id: str = Field(min_length=1)
    acquired_at_utc: datetime
    repository_root: str = Field(min_length=1)


class LocalE2ERunLockError(RuntimeError):
    """Base error translated to a fail-closed CLI result."""


@final
class LocalE2ERunBusyError(LocalE2ERunLockError):
    """Mutable so Python can attach traceback state while propagating."""

    __slots__ = ("lock_path", "observed_owner", "requested")

    def __init__(
        self,
        lock_path: Path,
        requested: RunLockOwner,
        observed_owner: RunLockOwner | None,
    ) -> None:
        self.lock_path = lock_path
        self.requested = requested
        self.observed_owner = observed_owner
        super().__init__()

    @override
    def __str__(self) -> str:
        owner = self.observed_owner
        observed = (
            "owner metadata unavailable"
            if owner is None
            else (
                f"pid={owner.pid}, mode={owner.mode}, "
                f"invocation={owner.invocation_id}, "
                f"acquired={owner.acquired_at_utc.isoformat()}"
            )
        )
        return (
            f"local E2E run already active ({observed}); "
            f"requested mode={self.requested.mode}, lock={self.lock_path}"
        )


@final
class LocalE2ERunLockIOError(LocalE2ERunLockError):
    """Mutable so Python can attach traceback state while propagating."""

    __slots__ = ("detail", "lock_path", "operation")

    def __init__(self, operation: str, lock_path: Path, detail: str) -> None:
        self.operation = operation
        self.lock_path = lock_path
        self.detail = detail
        super().__init__()

    @override
    def __str__(self) -> str:
        return f"local E2E run lock {self.operation} failed at {self.lock_path}: {self.detail}"


@final
class LocalE2ERunLease:
    """Hold a kernel lock until the surrounding CLI invocation exits."""

    __slots__ = ("_fd", "_lock_path", "_owner", "_owner_path")

    def __init__(self, repository_root: Path, mode: str) -> None:
        resolved_root = repository_root.resolve()
        self._lock_path = local_e2e_run_lock_path(resolved_root)
        self._owner_path = local_e2e_run_owner_path(resolved_root)
        self._owner = RunLockOwner(
            pid=os.getpid(),
            mode=mode,
            invocation_id=uuid4().hex,
            acquired_at_utc=datetime.now(UTC),
            repository_root=str(resolved_root),
        )
        self._fd: int | None = None

    def __enter__(self) -> RunLockOwner:
        if self._fd is not None:
            raise LocalE2ERunLockIOError(
                "re-entry",
                self._lock_path,
                "lease is already active",
            )
        fd = _open_lock_file(self._lock_path)
        try:
            _acquire_kernel_lock(fd)
        except OSError as error:
            observed_owner = _read_owner(self._owner_path)
            _close_after_failed_enter(fd, self._lock_path)
            if error.errno in _BUSY_ERRNOS:
                raise LocalE2ERunBusyError(
                    self._lock_path,
                    self._owner,
                    observed_owner,
                ) from error
            raise LocalE2ERunLockIOError(
                "acquire",
                self._lock_path,
                str(error),
            ) from error
        try:
            _save_owner(self._owner_path, self._owner)
        except OSError as error:
            _close_after_failed_enter(fd, self._lock_path)
            raise LocalE2ERunLockIOError(
                "owner metadata write",
                self._lock_path,
                str(error),
            ) from error
        self._fd = fd
        return self._owner

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        _ = (exc_value, traceback)
        fd = self._fd
        self._fd = None
        if fd is None:
            return
        try:
            os.close(fd)
        except OSError as error:
            if exc_type is None:
                raise LocalE2ERunLockIOError(
                    "release",
                    self._lock_path,
                    str(error),
                ) from error


def acquire_local_e2e_run_lock(
    repository_root: Path,
    mode: str,
) -> LocalE2ERunLease:
    """Create a non-blocking lease for one repository-local E2E invocation."""
    return LocalE2ERunLease(repository_root, mode)


def local_e2e_run_lock_path(repository_root: Path) -> Path:
    return (
        repository_root.resolve()
        / "output"
        / "playwright"
        / "e2e-scheduler"
        / "local-e2e-run.lock"
    )


def local_e2e_run_owner_path(repository_root: Path) -> Path:
    return local_e2e_run_lock_path(repository_root).with_name(
        "local-e2e-run.owner.json"
    )


def _open_lock_file(path: Path) -> int:
    fd: int | None = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        if os.fstat(fd).st_size == 0:
            _ = os.write(fd, b"\0")
            os.fsync(fd)
        _ = os.lseek(fd, 0, os.SEEK_SET)
    except OSError as error:
        if fd is not None:
            _close_after_failed_enter(fd, path)
        raise LocalE2ERunLockIOError("open", path, str(error)) from error
    return fd


def _acquire_kernel_lock(fd: int) -> None:
    if os.name == "nt":
        import msvcrt

        _ = os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        return
    import fcntl

    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _save_owner(path: Path, owner: RunLockOwner) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{uuid4().hex}")
    try:
        _ = temporary.write_text(
            owner.model_dump_json(indent=2) + "\n",
            encoding="utf-8",
        )
        _ = temporary.replace(path)
    except OSError as error:
        try:
            temporary.unlink(missing_ok=True)
        except OSError as cleanup_error:
            raise OSError(
                f"{error}; owner metadata cleanup failed: {cleanup_error}"
            ) from cleanup_error
        raise


def _read_owner(path: Path) -> RunLockOwner | None:
    try:
        return RunLockOwner.model_validate_json(path.read_bytes())
    except (OSError, ValidationError):
        return None


def _close_after_failed_enter(fd: int, path: Path) -> None:
    try:
        os.close(fd)
    except OSError as error:
        raise LocalE2ERunLockIOError(
            "failed-acquire cleanup",
            path,
            str(error),
        ) from error
