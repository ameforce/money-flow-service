from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
import hashlib
import hmac
import io
import logging
import os
import threading
import tempfile
from pathlib import Path
from typing import Literal
import zipfile

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_editor_household
from app.core.config import settings
from app.core.errors import app_error
from app.db.models import Category, FlowType, ImportExecutionLock, Transaction, User
from app.db.session import SessionLocal, get_db
from app.schemas import (
    ImportReport,
    ImportRequest,
    MigrationPackageReport,
    TossCategoryRecommendationRead,
    TossExcludedCandidate as TossExcludedCandidateSchema,
    TossImportRow as TossImportRowSchema,
    TossImportSummary,
    TossScreenshotApplyRequest,
    TossScreenshotApplyResponse,
    TossScreenshotPreviewResponse,
)
from app.services import toss_screenshot_importer
from app.services.migration_package import MigrationPackageService
from app.services.owner_links import resolve_owner_fields
from app.services.runtime import importer
from app.services.runtime import hub
from app.services.toss_screenshot_importer import (
    TossCategoryOption,
    TossOcrError,
    TossOcrUnavailableError,
    TossParsedRow,
)


router = APIRouter(prefix="/imports", tags=["imports"])
_MIN_IMPORT_LOCK_TIMEOUT_SECONDS = 30
_MIN_IMPORT_LOCK_HEARTBEAT_SECONDS = 5
_TOSS_TRANSACTION_ORDER_STEP = 1024
logger = logging.getLogger(__name__)
_import_process_guard_registry_lock = threading.Lock()
_import_process_guard_registry: set[str] = set()
migration_package_service = MigrationPackageService()

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


def _toss_allowed_extensions() -> set[str]:
    return {
        item.strip().lower()
        for item in str(settings.toss_import_allowed_extensions or "").split(",")
        if item.strip()
    }


def _validate_toss_image_file(file: UploadFile) -> str:
    file_name = str(file.filename or "").strip()
    suffix = Path(file_name).suffix.lower()
    if suffix not in _toss_allowed_extensions():
        raise app_error(
            status_code=400,
            code="TOSS_IMPORT_IMAGE_EXTENSION_INVALID",
            message="지원하지 않는 이미지 형식입니다.",
            action="png, jpg, jpeg, webp 이미지로 다시 시도해 주세요.",
        )
    return suffix


def _copy_toss_upload_with_limit(file: UploadFile, destination: Path) -> None:
    max_bytes = int(settings.toss_import_max_image_bytes)
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
                    code="TOSS_IMPORT_IMAGE_TOO_LARGE",
                    message="업로드 가능한 이미지 크기를 초과했습니다.",
                    action="이미지 크기를 줄여 다시 시도해 주세요.",
                    context={"max_bytes": max_bytes},
                )
            output.write(chunk)


def _load_toss_category_options(db: Session, household_id: str) -> list[TossCategoryOption]:
    categories = db.scalars(select(Category).where(Category.household_id == household_id)).all()
    return [
        TossCategoryOption(
            id=str(category.id),
            flow_type=category.flow_type,
            major=str(category.major or ""),
            minor=str(category.minor or ""),
        )
        for category in categories
    ]


def _to_toss_recommendation_schema(recommendation) -> TossCategoryRecommendationRead | None:
    if recommendation is None:
        return None
    return TossCategoryRecommendationRead(
        suggested_major=recommendation.suggested_major,
        suggested_minor=recommendation.suggested_minor,
        reason=recommendation.reason,
        create_allowed=False,
    )


def _to_toss_row_schema(
    row: TossParsedRow,
    *,
    source_image_name: str | None,
    source_image_index: int,
    row_index: int,
) -> TossImportRowSchema:
    source_ref = _toss_source_ref_from_parsed_row(
        row,
        source_image_index=source_image_index,
        row_index=row_index,
    )
    return TossImportRowSchema(
        row_id=f"{row.row_id}-{source_image_index}-{row_index}",
        source_ref=source_ref,
        source_ref_signature=_sign_toss_source_ref(source_ref),
        source_image_name=source_image_name,
        source_image_index=source_image_index,
        occurred_on=row.occurred_on,
        time=row.time,
        item_name=row.item_name,
        detail=row.detail,
        amount=row.amount,
        signed_amount=row.signed_amount,
        balance=row.balance,
        flow_type=row.flow_type,
        category_id=row.category_id,
        category_recommendation=_to_toss_recommendation_schema(row.category_recommendation),
        included=row.included,
        duplicate_group_id=row.duplicate_group_id,
        exclusion_reason=row.exclusion_reason,
    )


def _to_toss_excluded_schema(
    candidate,
    *,
    source_image_name: str | None,
    source_image_index: int,
) -> TossExcludedCandidateSchema:
    return TossExcludedCandidateSchema(
        source_image_name=source_image_name,
        source_image_index=source_image_index,
        item_name=str(candidate.item_name or ""),
        raw_text=str(candidate.raw_text or ""),
        exclusion_reason=str(candidate.exclusion_reason or "unrecognized"),
    )


def _toss_duplicate_candidate_count(rows: list[TossImportRowSchema]) -> int:
    return sum(1 for row in rows if row.duplicate_group_id)


def _mark_toss_duplicate_candidates(rows: list[TossImportRowSchema]) -> None:
    grouped: dict[str, list[TossImportRowSchema]] = {}
    for row in rows:
        key = "|".join(
            [
                row.occurred_on.isoformat(),
                row.time,
                " ".join(row.item_name.strip().lower().split()),
                str(row.signed_amount),
                str(row.balance or ""),
            ]
        )
        grouped.setdefault(key, []).append(row)

    duplicate_index = 0
    for duplicate_rows in grouped.values():
        if len(duplicate_rows) <= 1:
            continue
        duplicate_index += 1
        duplicate_group_id = f"dup-{duplicate_index}"
        for row in duplicate_rows:
            row.duplicate_group_id = duplicate_group_id
            row.included = False
            row.exclusion_reason = "duplicate_candidate"


def _sign_toss_source_ref(source_ref: str) -> str:
    return hmac.new(settings.secret_key.encode("utf-8"), source_ref.encode("utf-8"), hashlib.sha256).hexdigest()


def _toss_source_ref_from_parsed_row(
    row: TossParsedRow,
    *,
    source_image_index: int,
    row_index: int,
) -> str:
    payload = f"{row.row_id}|{source_image_index}|{row_index}"
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()
    return f"toss:{digest}"


def _verified_toss_source_ref(row: TossImportRowSchema) -> str:
    source_ref = str(row.source_ref or "").strip()
    expected_signature = _sign_toss_source_ref(source_ref)
    if not hmac.compare_digest(str(row.source_ref_signature or ""), expected_signature):
        raise app_error(
            status_code=400,
            code="TOSS_IMPORT_SOURCE_REF_INVALID",
            message="토스 가져오기 행의 원본 식별자가 유효하지 않습니다.",
            action="검토 표를 다시 생성한 뒤 적용해 주세요.",
        )
    return source_ref


def _ensure_toss_category_matches(
    db: Session,
    *,
    household_id: str,
    category_id: str | None,
    flow_type: FlowType,
) -> None:
    if not category_id:
        return
    category = db.get(Category, category_id)
    if category is None or str(category.household_id) != str(household_id):
        raise app_error(
            status_code=400,
            code="CATEGORY_INVALID",
            message="유효하지 않은 category_id 입니다.",
            action="가계 내 카테고리 ID를 확인해 주세요.",
        )
    if category.flow_type != flow_type:
        raise app_error(
            status_code=400,
            code="TRANSACTION_CATEGORY_FLOW_TYPE_MISMATCH",
            message="거래 유형과 카테고리 유형이 일치하지 않습니다.",
            action="동일한 유형의 카테고리를 선택해 주세요.",
        )


def _toss_source_ref(row: TossImportRowSchema) -> str:
    return _verified_toss_source_ref(row)


def _toss_transaction_memo(row: TossImportRowSchema) -> str:
    parts = [row.time, row.item_name]
    if row.detail:
        parts.append(row.detail)
    return " | ".join(part.strip() for part in parts if part.strip())


@router.post("/toss-screenshots/preview", response_model=TossScreenshotPreviewResponse)
def preview_toss_screenshots(
    files: list[UploadFile] = File(...),
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> TossScreenshotPreviewResponse:
    household, _ = ctx
    if not files:
        raise app_error(
            status_code=400,
            code="TOSS_IMPORT_IMAGE_REQUIRED",
            message="가져올 이미지가 없습니다.",
            action="토스 거래내역 스크린샷을 선택해 주세요.",
        )
    if len(files) > int(settings.toss_import_max_images):
        raise app_error(
            status_code=413,
            code="TOSS_IMPORT_TOO_MANY_IMAGES",
            message="한 번에 업로드 가능한 이미지 수를 초과했습니다.",
            action="이미지를 나누어 다시 시도해 주세요.",
            context={"max_images": settings.toss_import_max_images},
        )

    category_options = _load_toss_category_options(db, str(household.id))
    rows: list[TossImportRowSchema] = []
    excluded_candidates: list[TossExcludedCandidateSchema] = []
    temp_paths: list[Path] = []
    temp_dir_context = tempfile.TemporaryDirectory(prefix="money-flow-toss-")
    temp_dir = Path(temp_dir_context.name)
    try:
        for image_index, file in enumerate(files):
            suffix = _validate_toss_image_file(file)
            source_image_name = str(file.filename or "").strip() or None
            with tempfile.NamedTemporaryFile(
                mode="wb",
                suffix=suffix,
                prefix="toss-upload-",
                dir=temp_dir,
                delete=False,
            ) as temp_file:
                temp_path = Path(temp_file.name)
            temp_paths.append(temp_path)
            _copy_toss_upload_with_limit(file, temp_path)
            try:
                text = toss_screenshot_importer.extract_text_from_image(
                    temp_path,
                    executable=settings.toss_import_ocr_executable,
                    language=settings.toss_import_ocr_language,
                    timeout_seconds=settings.toss_import_ocr_timeout_seconds,
                )
            except TossOcrUnavailableError as error:
                raise app_error(
                    status_code=503,
                    code="TOSS_OCR_UNAVAILABLE",
                    message="로컬 OCR 실행 파일을 찾을 수 없습니다.",
                    action="Tesseract OCR을 로컬에 설치하거나 실행 파일 경로를 설정해 주세요.",
                ) from error
            except TossOcrError as error:
                raise app_error(
                    status_code=400,
                    code="TOSS_OCR_FAILED",
                    message="이미지에서 거래내역 텍스트를 추출하지 못했습니다.",
                    action="토스 거래내역 화면이 선명하게 보이도록 다시 캡처해 주세요.",
                ) from error

            parsed = toss_screenshot_importer.parse_toss_ocr_text(
                text,
                categories=category_options,
                base_year=date.today().year,
            )
            rows.extend(
                _to_toss_row_schema(
                    row,
                    source_image_name=source_image_name,
                    source_image_index=image_index,
                    row_index=row_index,
                )
                for row_index, row in enumerate(parsed.rows)
            )
            excluded_candidates.extend(
                _to_toss_excluded_schema(
                    candidate,
                    source_image_name=source_image_name,
                    source_image_index=image_index,
                )
                for candidate in parsed.excluded_candidates
            )

        _mark_toss_duplicate_candidates(rows)
        return TossScreenshotPreviewResponse(
            rows=rows,
            excluded_candidates=excluded_candidates,
            summary=TossImportSummary(
                image_count=len(files),
                parsed_rows=len(rows),
                excluded_candidates=len(excluded_candidates),
                duplicate_candidates=_toss_duplicate_candidate_count(rows),
            ),
            issues=[],
        )
    finally:
        for file in files:
            file.file.close()
        for temp_path in temp_paths:
            if temp_path.exists():
                temp_path.unlink()
        temp_dir_context.cleanup()


@router.post("/toss-screenshots/apply", response_model=TossScreenshotApplyResponse)
def apply_toss_screenshots(
    payload: TossScreenshotApplyRequest,
    background_tasks: BackgroundTasks,
    ctx=Depends(require_editor_household),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TossScreenshotApplyResponse:
    household, _ = ctx
    applied = 0
    skipped = 0
    created_transactions: list[Transaction] = []
    seen_source_refs: set[str] = set()
    next_order_keys_by_date: dict[date, int] = {}

    for row in payload.rows:
        if not row.included:
            skipped += 1
            continue

        source_ref = _toss_source_ref(row)
        if source_ref in seen_source_refs:
            skipped += 1
            continue
        existing_transaction_id = db.scalar(
            select(Transaction.id).where(
                Transaction.household_id == household.id,
                Transaction.source_ref == source_ref,
            )
        )
        if existing_transaction_id is not None:
            skipped += 1
            continue

        _ensure_toss_category_matches(
            db,
            household_id=str(household.id),
            category_id=row.category_id,
            flow_type=row.flow_type,
        )
        owner_user_id, owner_name = resolve_owner_fields(
            db,
            household_id=str(household.id),
            owner_user_id=None,
            owner_name=None,
            invalid_code="TRANSACTION_OWNER_INVALID",
            invalid_message="거래자는 현재 가계 구성원만 선택할 수 있습니다.",
            invalid_action="가계 구성원 목록에서 거래자를 다시 선택해 주세요.",
        )
        if row.occurred_on not in next_order_keys_by_date:
            max_order_key = db.scalar(
                select(func.max(Transaction.order_key)).where(
                    Transaction.household_id == household.id,
                    Transaction.occurred_on == row.occurred_on,
                )
            )
            next_order_keys_by_date[row.occurred_on] = (
                int(max_order_key or 0) + _TOSS_TRANSACTION_ORDER_STEP
            )
        order_key = next_order_keys_by_date[row.occurred_on]
        next_order_keys_by_date[row.occurred_on] = order_key + _TOSS_TRANSACTION_ORDER_STEP
        transaction = Transaction(
            household_id=household.id,
            category_id=row.category_id,
            occurred_on=row.occurred_on,
            flow_type=row.flow_type,
            amount=row.amount,
            currency="KRW",
            order_key=order_key,
            memo=_toss_transaction_memo(row),
            owner_user_id=owner_user_id,
            owner_name=owner_name,
            source_ref=source_ref,
            created_by_user_id=user.id,
        )
        db.add(transaction)
        created_transactions.append(transaction)
        seen_source_refs.add(source_ref)
        applied += 1

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise app_error(
            status_code=409,
            code="TOSS_IMPORT_SOURCE_REF_CONFLICT",
            message="이미 적용된 토스 거래내역이 포함되어 있습니다.",
            action="미리보기를 다시 생성한 뒤 중복 후보를 제외해 주세요.",
        )

    created_transaction_ids: list[str] = []
    for transaction in created_transactions:
        db.refresh(transaction)
        created_transaction_ids.append(str(transaction.id))
        background_tasks.add_task(
            hub.broadcast,
            household.id,
            {
                "event": "transaction.created",
                "entity_id": transaction.id,
                "version": transaction.version,
            },
        )
    return TossScreenshotApplyResponse(
        applied_transactions=applied,
        skipped_transactions=skipped,
        created_transaction_ids=created_transaction_ids,
        issues=[],
    )


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


def _run_migration_package_with_guard(
    db: Session,
    *,
    household,
    actor_user_id: str,
    package_name: str,
    package_path: Path,
    mode: Literal["dry_run", "apply"],
    replace_existing: bool,
) -> MigrationPackageReport:
    process_guard = _acquire_import_process_guard(db, household_id=household.id, mode=mode)
    lease_state: dict[str, datetime] = {"acquired_at": datetime.now(UTC)}
    lease_state_lock = threading.Lock()
    heartbeat_failed = threading.Event()
    heartbeat_stop: threading.Event | None = None
    heartbeat_thread: threading.Thread | None = None
    try:
        if mode == "apply":
            lock_acquired_at = _acquire_import_lock(db, household.id)
            with lease_state_lock:
                lease_state["acquired_at"] = lock_acquired_at
            if _should_use_background_heartbeat(db):
                heartbeat_stop, heartbeat_thread = _start_import_lock_heartbeat(
                    household_id=household.id,
                    lease_state=lease_state,
                    lease_state_lock=lease_state_lock,
                    heartbeat_failed=heartbeat_failed,
                )
        try:
            payload = migration_package_service.load_package(package_path)
            report = migration_package_service.run_transfer(
                db,
                household=household,
                actor_user_id=actor_user_id,
                package_name=package_name,
                payload=payload,
                mode=mode,
                replace_existing=replace_existing,
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
                        message="이식 잠금을 유지하지 못해 작업을 중단했습니다.",
                        action="잠시 후 다시 시도해 주세요.",
                    )
                db.commit()
            else:
                db.rollback()
            return report
        except HTTPException:
            db.rollback()
            raise
        except Exception as error:  # noqa: BLE001
            db.rollback()
            logger.exception("Migration package processing failed unexpectedly.")
            raise app_error(
                status_code=500,
                code="MIGRATION_PACKAGE_INTERNAL_ERROR",
                message="이식 패키지 처리 중 서버 오류가 발생했습니다.",
                action="잠시 후 다시 시도해 주세요.",
            ) from error
        finally:
            if heartbeat_stop is not None and heartbeat_thread is not None:
                _stop_import_lock_heartbeat(stop_event=heartbeat_stop, thread=heartbeat_thread)
            if mode == "apply":
                _release_import_lock(db, household.id, acquired_at=lease_state["acquired_at"])
    finally:
        if process_guard is not None:
            process_guard.release()


@router.get("/migration-package/export")
def export_migration_package(
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    household, _ = ctx
    package_bytes, filename = migration_package_service.export_package(db, household)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(io.BytesIO(package_bytes), media_type="application/zip", headers=headers)


@router.post("/migration-package/upload", response_model=MigrationPackageReport)
def import_migration_package_upload(
    mode: Literal["dry_run", "apply"] = Query("dry_run"),
    replace_existing: bool = Query(False),
    file: UploadFile = File(...),
    ctx=Depends(require_editor_household),
    db: Session = Depends(get_db),
) -> MigrationPackageReport:
    household, member = ctx
    file_name = str(file.filename or "").strip()
    suffix = Path(file_name).suffix.lower()
    if suffix != ".zip":
        raise app_error(
            status_code=400,
            code="MIGRATION_PACKAGE_EXTENSION_INVALID",
            message="이식 패키지는 .zip 파일만 업로드할 수 있습니다.",
            action="dev에서 추출한 패키지 파일을 다시 선택해 주세요.",
        )
    if mode == "apply" and not replace_existing:
        raise app_error(
            status_code=400,
            code="MIGRATION_APPLY_REPLACE_REQUIRED",
            message="적용 모드에서는 기존 데이터를 교체하도록 확인해야 합니다.",
            action="적용 체크를 켠 뒤 다시 시도해 주세요.",
        )

    project_root = Path(settings.project_root)
    temp_path: Path | None = None
    try:
        temp_dir = project_root / "tmp_import_uploads"
        temp_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="wb",
            suffix=".zip",
            prefix="migration-upload-",
            dir=temp_dir,
            delete=False,
        ) as temp_file:
            temp_path = Path(temp_file.name)
            _copy_upload_with_limit(file, temp_path)

        return _run_migration_package_with_guard(
            db=db,
            household=household,
            actor_user_id=str(getattr(member, "user_id", "") or ""),
            package_name=file_name or temp_path.name,
            package_path=temp_path,
            mode=mode,
            replace_existing=replace_existing,
        )
    finally:
        file.file.close()
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()
