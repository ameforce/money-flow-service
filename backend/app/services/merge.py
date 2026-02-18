from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import EntityPatchLog


@dataclass
class MergeConflictError(Exception):
    entity_type: str
    entity_id: str
    current_version: int
    conflict_fields: list[str]
    current_data: dict[str, Any]

    def __str__(self) -> str:
        return f"merge conflict: {self.entity_type}:{self.entity_id} fields={self.conflict_fields}"


def changed_fields_since(
    db: Session,
    entity_type: str,
    entity_id: str,
    base_version: int,
) -> tuple[set[str], set[int]]:
    rows = db.scalars(
        select(EntityPatchLog).where(
            EntityPatchLog.entity_type == entity_type,
            EntityPatchLog.entity_id == entity_id,
            EntityPatchLog.resulting_version > base_version,
        )
    ).all()
    changed: set[str] = set()
    covered_versions: set[int] = set()
    for row in rows:
        changed.update(row.changed_fields or [])
        covered_versions.add(int(row.resulting_version))
    return changed, covered_versions


def merge_patch_or_raise(
    *,
    db: Session,
    entity_type: str,
    entity: Any,
    household_id: str,
    actor_user_id: str | None,
    base_version: int,
    patch_data: dict[str, Any],
    current_data: dict[str, Any],
) -> tuple[bool, list[str]]:
    current_version = int(entity.version)
    effective_patch = {key: value for key, value in patch_data.items() if getattr(entity, key) != value}
    patch_fields = sorted(effective_patch.keys())
    if not patch_fields:
        return False, []
    merged = False

    if base_version < current_version:
        changed, covered_versions = changed_fields_since(db, entity_type, entity.id, base_version)
        expected_versions = set(range(base_version + 1, current_version + 1))
        missing_versions = expected_versions - covered_versions
        if missing_versions:
            # If version advanced without patch logs (e.g. import path update),
            # stale patch must fail closed to avoid silent overwrite.
            raise MergeConflictError(
                entity_type=entity_type,
                entity_id=entity.id,
                current_version=current_version,
                conflict_fields=patch_fields,
                current_data=current_data,
            )
        conflict_fields = sorted([field for field in patch_fields if field in changed])
        if conflict_fields:
            raise MergeConflictError(
                entity_type=entity_type,
                entity_id=entity.id,
                current_version=current_version,
                conflict_fields=conflict_fields,
                current_data=current_data,
            )
        merged = True
    elif base_version > current_version:
        raise MergeConflictError(
            entity_type=entity_type,
            entity_id=entity.id,
            current_version=current_version,
            conflict_fields=patch_fields,
            current_data=current_data,
        )

    for key, value in effective_patch.items():
        setattr(entity, key, value)

    entity.version = current_version + 1
    db.add(
        EntityPatchLog(
            household_id=household_id,
            entity_type=entity_type,
            entity_id=entity.id,
            base_version=base_version,
            resulting_version=entity.version,
            changed_fields=patch_fields,
            merged=merged,
            conflict_fields=[],
            actor_user_id=actor_user_id,
        )
    )
    return merged, patch_fields
