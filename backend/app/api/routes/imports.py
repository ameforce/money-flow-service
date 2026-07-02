from __future__ import annotations

from datetime import UTC, datetime, timedelta
import logging
import os
import threading
import tempfile
from pathlib import Path
from typing import Literal
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_editor_household
from app.core.config import settings
from app.core.errors import app_error
from app.db.models import ImportExecutionLock
from app.db.session import SessionLocal, get_db
from app.schemas import ImportReport, ImportRequest
from app.services.runtime import importer


router = APIRouter(prefix="/imports", tags=["imports"])
_MIN_IMPORT_LOCK_TIMEOUT_SECONDS = 30
_MIN_IMPORT_LOCK_HEARTBEAT_SECONDS = 5
logger = logging.getLogger(__name__)
_import_process_guard_registry_lock = threading.Lock()
_import_process_guard_registry: set[str] = set()

if os.name == "nt":
    import msvcrt
else:  # pragma: no cover - exercised on non-Windows platforms only.
    import fcntl


def _allowed_root() -> Path:
    return Path(settings.import_allowed_root).resolve()


def _ensure_allowed_path(path: Path) -> Path:
    candidate = path.resolve()
    root = _allowed_root()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise app_error(
            status_code=400,
            code="IMPORT_PATH_NOT_ALLOWED",
            message="허용된 경로의 파일만 가져올 수 있습니다.",
            action="허용된 import 디렉터리 경로를 사용해 주세요.",
        ) from error
    return candidate


def _validate_workbook_file(workbook_path: Path) -> None:
    if not workbook_path.exists():
        raise app_error(
            status_code=404,
            code="IMPORT_WORKBOOK_NOT_FOUND",
            message="파일을 찾을 수 없습니다.",
            action="파일 경로를 확인하거나 파일 업로드로 다시 시도해 주세요.",
        )
    if workbook_path.suffix.lower() != ".xlsx":
        raise app_error(
            status_code=400,
            code="IMPORT_WORKBOOK_EXTENSION_INVALID",
            message=".xlsx 파일만 가져올 수 있습니다.",
            action="파일 형식을 확인해 주세요.",
        )
    size = workbook_path.stat().st_size
    if size > settings.import_max_upload_bytes:
        raise app_error(
            status_code=413,
            code="IMPORT_FILE_TOO_LARGE",
            message="업로드 가능한 파일 크기를 초과했습니다.",
            action="파일 크기를 줄여 다시 시도해 주세요.",
            context={"max_bytes": settings.import_max_upload_bytes},
        )
    _validate_workbook_archive(workbook_path)


def _validate_workbook_archive(workbook_path: Path) -> None:
    try:
        with zipfile.ZipFile(workbook_path, "r") as archive:
            infos = archive.infolist()
            if len(infos) > settings.import_max_zip_entries:
                raise app_error(
                    status_code=413,
                    code="IMPORT_ARCHIVE_TOO_COMPLEX",
                    message="압축 구조가 너무 복잡해 가져오기를 중단했습니다.",
                    action="불필요한 시트/개체를 제거한 뒤 다시 시도해 주세요.",
                    context={"max_entries": settings.import_max_zip_entries},
                )

            expanded = 0
            for info in infos:
                expanded += int(getattr(info, "file_size", 0) or 0)
                if expanded > settings.import_max_uncompressed_bytes:
                    raise app_error(
                        status_code=413,
                        code="IMPORT_ARCHIVE_EXPANDS_TOO_LARGE",
                        message="파일 내부 압축 해제 크기가 제한을 초과했습니다.",
                        action="파일 크기와 시트 구성을 줄인 뒤 다시 시도해 주세요.",
                        context={"max_uncompressed_bytes": settings.import_max_uncompressed_bytes},
                    )
    except zipfile.BadZipFile as error:
        raise app_error(
            status_code=400,
            code="IMPORT_WORKBOOK_INVALID_ARCHIVE",
            message="유효한 XLSX 파일이 아닙니다.",
            action="파일 손상 여부를 확인해 주세요.",
        ) from error


def _resolve_workbook_path(path_text: str | None) -> Path:
    root = Path(settings.project_root)
    if path_text:
        path = Path(path_text)
        if not path.is_absolute():
            path = root / path
        return _ensure_allowed_path(path)
    try:
        return _ensure_allowed_path(importer.load_default_path(root))
    except FileNotFoundError as error:
        raise app_error(
            status_code=404,
            code="IMPORT_WORKBOOK_NOT_FOUND",
            message="파일을 찾을 수 없습니다.",
            action="파일 경로를 확인하거나 파일 업로드를 사용해 주세요.",
        ) from error


def _run_import_with_guard(db: Session, *, household, workbook_path: Path, mode: str) -> ImportReport:
    process_guard = _acquire_import_process_guard(db, household_id=household.id, mode=mode)
    try:
        lock_acquired_at = _acquire_import_lock(db, household.id)
        lease_state: dict[str, datetime] = {"acquired_at": lock_acquired_at}
        lease_state_lock = threading.Lock()
        heartbeat_failed = threading.Event()
        heartbeat_stop: threading.Event | None = None
        heartbeat_thread: threading.Thread | None = None
        if mode == "apply" and _should_use_background_heartbeat(db):
            heartbeat_stop, heartbeat_thread = _start_import_lock_heartbeat(
                household_id=household.id,
                lease_state=lease_state,
                lease_state_lock=lease_state_lock,
                heartbeat_failed=heartbeat_failed,
            )
        try:
            report = importer.run(
                db,
                household=household,
                workbook_path=workbook_path,
                mode=mode,
                commit=False,
            )
            if mode == "apply":
                if heartbeat_stop is not None and heartbeat_thread is not None:
                    _stop_import_lock_heartbeat(stop_event=heartbeat_stop, thread=heartbeat_thread)
                    heartbeat_stop = None
                    heartbeat_thread = None
                with lease_state_lock:
                    acquired_at = lease_state["acquired_at"]
                if heartbeat_failed.is_set() or not _is_import_lock_current(
                    db,
                    household.id,
                    acquired_at=acquired_at,
                ):
                    db.rollback()
                    raise app_error(
                        status_code=409,
                        code="IMPORT_LOCK_LOST",
                        message="가져오기 잠금을 유지하지 못해 작업을 중단했습니다.",
                        action="잠시 후 다시 시도해 주세요.",
                    )
                db.commit()
            return report
        except ValueError as error:
            db.rollback()
            text = str(error or "").strip().lower()
            if "too many sheets" in text:
                raise app_error(
                    status_code=400,
                    code="IMPORT_WORKBOOK_TOO_MANY_SHEETS",
                    message="워크북 시트 수가 허용 범위를 초과했습니다.",
                    action="시트 수를 줄인 뒤 다시 시도해 주세요.",
                    context={"max_sheets": int(settings.import_max_sheets)},
                ) from error
            raise app_error(
                status_code=400,
                code="IMPORT_WORKBOOK_INVALID",
                message="가져오기 파일 형식이 올바르지 않습니다.",
                action="입력 파일을 확인한 뒤 다시 시도해 주세요.",
            ) from error
        except HTTPException:
            db.rollback()
            raise
        except Exception as error:  # noqa: BLE001
            db.rollback()
            logger.exception("Import pipeline failed unexpectedly.")
            raise app_error(
                status_code=500,
                code="IMPORT_PROCESS_INTERNAL_ERROR",
                message="가져오기 처리 중 서버 오류가 발생했습니다.",
                action="잠시 후 다시 시도해 주세요.",
            ) from error
        finally:
            if heartbeat_stop is not None and heartbeat_thread is not None:
                _stop_import_lock_heartbeat(stop_event=heartbeat_stop, thread=heartbeat_thread)
            _release_import_lock(db, household.id, acquired_at=lease_state["acquired_at"])
    finally:
        if process_guard is not None:
            process_guard.release()


def _import_lock_file_dir() -> Path:
    path = Path(settings.project_root) / ".runtime" / "import-locks"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _dialect_name(db: Session) -> str:
    bind = db.get_bind()
    return str(getattr(getattr(bind, "dialect", None), "name", "")).strip().lower()


class _ImportProcessGuard:
    def __init__(self, household_id: str) -> None:
        self.household_id = str(household_id or "").strip()
        self._file_handle = None

    def acquire(self) -> bool:
        if not self.household_id:
            return False
        with _import_process_guard_registry_lock:
            if self.household_id in _import_process_guard_registry:
                return False
            _import_process_guard_registry.add(self.household_id)
        lock_file = _import_lock_file_dir() / f"{self.household_id}.lock"
        handle = None
        try:
            handle = lock_file.open("a+b")
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:  # pragma: no cover - exercised on non-Windows platforms only.
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self._file_handle = handle
            return True
        except OSError:
            if handle is not None:
                try:
                    handle.close()
                except Exception:  # noqa: BLE001
                    pass
            if self._file_handle is not None:
                try:
                    self._file_handle.close()
                except Exception:  # noqa: BLE001
                    pass
                self._file_handle = None
            with _import_process_guard_registry_lock:
                _import_process_guard_registry.discard(self.household_id)
            return False

    def release(self) -> None:
        handle = self._file_handle
        self._file_handle = None
        if handle is not None:
            try:
                handle.seek(0)
                if os.name == "nt":
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:  # pragma: no cover - exercised on non-Windows platforms only.
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
            finally:
                try:
                    handle.close()
                except Exception:  # noqa: BLE001
                    pass
        with _import_process_guard_registry_lock:
            _import_process_guard_registry.discard(self.household_id)


def _acquire_import_process_guard(db: Session, *, household_id: str, mode: str) -> _ImportProcessGuard | None:
    if mode != "apply" or _dialect_name(db) != "sqlite":
        return None
    guard = _ImportProcessGuard(household_id)
    if guard.acquire():
        return guard
    raise app_error(
        status_code=429,
        code="IMPORT_ALREADY_RUNNING",
        message="다른 가져오기 작업이 진행 중입니다.",
        action="잠시 후 다시 시도해 주세요.",
    )


def _lock_timeout_seconds() -> int:
    return max(_MIN_IMPORT_LOCK_TIMEOUT_SECONDS, int(settings.import_lock_timeout_seconds))


def _lock_heartbeat_interval_seconds() -> int:
    return max(_MIN_IMPORT_LOCK_HEARTBEAT_SECONDS, min(15, _lock_timeout_seconds() // 3))


def _should_use_background_heartbeat(db: Session) -> bool:
    dialect_name = _dialect_name(db)
    # SQLite single-writer locking can reject parallel lease updates from heartbeat sessions.
    return dialect_name != "sqlite"


def _renew_import_lock_lease(
    db: Session,
    household_id: str,
    *,
    acquired_at: datetime,
    renewed_at: datetime | None = None,
) -> datetime | None:
    next_acquired_at = _as_utc(renewed_at or datetime.now(UTC))
    updated_rows = db.execute(
        update(ImportExecutionLock)
        .where(
            ImportExecutionLock.household_id == household_id,
            ImportExecutionLock.acquired_at == acquired_at,
        )
        .values(acquired_at=next_acquired_at)
        .execution_options(synchronize_session=False)
    ).rowcount
    if int(updated_rows or 0) != 1:
        db.rollback()
        return None
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return None
    return next_acquired_at


def _start_import_lock_heartbeat(
    *,
    household_id: str,
    lease_state: dict[str, datetime],
    lease_state_lock: threading.Lock,
    heartbeat_failed: threading.Event,
) -> tuple[threading.Event, threading.Thread]:
    stop_event = threading.Event()
    heartbeat_interval = _lock_heartbeat_interval_seconds()

    def _heartbeat() -> None:
        while not stop_event.wait(heartbeat_interval):
            with lease_state_lock:
                acquired_at = lease_state.get("acquired_at")
            if acquired_at is None:
                return
            try:
                with SessionLocal() as heartbeat_db:
                    renewed_at = _renew_import_lock_lease(
                        heartbeat_db,
                        household_id,
                        acquired_at=acquired_at,
                    )
            except Exception:  # noqa: BLE001
                heartbeat_failed.set()
                return
            if renewed_at is None:
                heartbeat_failed.set()
                return
            with lease_state_lock:
                lease_state["acquired_at"] = renewed_at

    thread = threading.Thread(
        target=_heartbeat,
        name=f"import-lock-heartbeat-{household_id}",
        daemon=True,
    )
    thread.start()
    return stop_event, thread


def _stop_import_lock_heartbeat(*, stop_event: threading.Event, thread: threading.Thread) -> None:
    stop_event.set()
    thread.join()


def _acquire_import_lock(db: Session, household_id: str) -> datetime:
    existing = db.get(ImportExecutionLock, household_id)
    if existing is not None:
        stale_before = datetime.now(UTC) - timedelta(seconds=_lock_timeout_seconds())
        existing_acquired_at = _as_utc(existing.acquired_at)
        if existing_acquired_at < stale_before:
            deleted = (
                db.query(ImportExecutionLock)
                .filter(
                    ImportExecutionLock.household_id == household_id,
                    ImportExecutionLock.acquired_at == existing.acquired_at,
                )
                .delete(synchronize_session=False)
            )
            if int(deleted or 0) != 1:
                db.rollback()
                raise app_error(
                    status_code=429,
                    code="IMPORT_ALREADY_RUNNING",
                    message="다른 가져오기 작업이 진행 중입니다.",
                    action="잠시 후 다시 시도해 주세요.",
                )
            db.commit()
        else:
            raise app_error(
                status_code=429,
                code="IMPORT_ALREADY_RUNNING",
                message="다른 가져오기 작업이 진행 중입니다.",
                action="잠시 후 다시 시도해 주세요.",
            )

    lock_acquired_at = datetime.now(UTC)
    lock = ImportExecutionLock(household_id=household_id, acquired_at=lock_acquired_at)
    db.add(lock)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise app_error(
            status_code=429,
            code="IMPORT_ALREADY_RUNNING",
            message="다른 가져오기 작업이 진행 중입니다.",
            action="잠시 후 다시 시도해 주세요.",
        ) from error
    return lock_acquired_at


def _is_import_lock_current(db: Session, household_id: str, *, acquired_at: datetime) -> bool:
    current_acquired_at = db.execute(
        select(ImportExecutionLock.acquired_at).where(ImportExecutionLock.household_id == household_id)
    ).scalar_one_or_none()
    if current_acquired_at is None:
        return False
    return _as_utc(current_acquired_at) == _as_utc(acquired_at)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _release_import_lock(db: Session, household_id: str, *, acquired_at: datetime) -> None:
    deleted = (
        db.query(ImportExecutionLock)
        .filter(
            ImportExecutionLock.household_id == household_id,
            ImportExecutionLock.acquired_at == acquired_at,
        )
        .delete(synchronize_session=False)
    )
    if int(deleted or 0) <= 0:
        return
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


def _copy_upload_with_limit(file: UploadFile, destination: Path) -> None:
    max_bytes = int(settings.import_max_upload_bytes)
    written = 0
    chunk_size = 1024 * 1024
    with destination.open("wb") as output:
        while True:
            chunk = file.file.read(chunk_size)
            if not chunk:
                break
            written += len(chunk)
            if written > max_bytes:
                raise app_error(
                    status_code=413,
                    code="IMPORT_FILE_TOO_LARGE",
                    message="업로드 가능한 파일 크기를 초과했습니다.",
                    action="파일 크기를 줄여 다시 시도해 주세요.",
                    context={"max_bytes": max_bytes},
                )
            output.write(chunk)


@router.post("/workbook", response_model=ImportReport)
def import_workbook(
    payload: ImportRequest,
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> ImportReport:
    household, _ = ctx
    workbook_path = _resolve_workbook_path(payload.workbook_path)
    _validate_workbook_file(workbook_path)
    return _run_import_with_guard(
        db,
        household=household,
        workbook_path=workbook_path,
        mode=payload.mode,
    )


@router.post("/workbook/upload", response_model=ImportReport)
def import_workbook_upload(
    mode: Literal["dry_run", "apply"] = Query("dry_run"),
    file: UploadFile = File(...),
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> ImportReport:
    household, _ = ctx
    file_name = file.filename or ""
    if Path(file_name).suffix.lower() != ".xlsx":
        raise app_error(
            status_code=400,
            code="IMPORT_WORKBOOK_EXTENSION_INVALID",
            message=".xlsx 파일만 가져올 수 있습니다.",
            action="파일 형식을 확인해 주세요.",
        )

    project_root = Path(settings.project_root)
    temp_path: Path | None = None
    try:
        temp_dir = project_root / "tmp_import_uploads"
        temp_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=".xlsx",
            prefix="import-upload-",
            dir=temp_dir,
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            _copy_upload_with_limit(file, temp_path)
        _validate_workbook_file(temp_path)

        return _run_import_with_guard(
            db=db,
            household=household,
            workbook_path=temp_path,
            mode=mode,
        ).model_copy(update={"workbook_path": file_name})
    finally:
        file.file.close()
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()
