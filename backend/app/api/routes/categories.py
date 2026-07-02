from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_household
from app.db.models import Category
from app.db.session import get_db
from app.schemas import CategoryRead


router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryRead])
def list_categories(ctx=Depends(get_current_household), db: Session = Depends(get_db)) -> list[CategoryRead]:
    household, _ = ctx
    items = db.scalars(
        select(Category)
        .where(Category.household_id == household.id)
        .order_by(Category.flow_type, Category.sort_order, Category.major, Category.minor)
    ).all()
    return [CategoryRead.model_validate(item) for item in items]

