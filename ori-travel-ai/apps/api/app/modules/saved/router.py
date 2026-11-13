"""Per-user shortlist (contract 3.4). Every signed-in role may use it; rows are private to their owner."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user
from app.modules.saved import service
from app.modules.saved.schemas import SavedOfferCreate, SavedOfferOut, SavedOfferUpdate
from app.schemas.common import Category, OkResponse

router = APIRouter(prefix="/api/saved-offers", tags=["saved"])


@router.get("", response_model=list[SavedOfferOut])
def list_saved(
    category: Category | None = Query(None), ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)
):
    return service.list_saved(db, ctx.user_id, category)


@router.post("", response_model=SavedOfferOut, status_code=201)
def create_saved(body: SavedOfferCreate, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.create_saved(db, ctx.user_id, body)


@router.patch("/{saved_id}", response_model=SavedOfferOut)
def update_saved(saved_id: str, body: SavedOfferUpdate, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.update_saved(db, ctx.user_id, saved_id, body)


@router.delete("/{saved_id}", response_model=OkResponse)
def delete_saved(saved_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    service.delete_saved(db, ctx.user_id, saved_id)
    return OkResponse()
