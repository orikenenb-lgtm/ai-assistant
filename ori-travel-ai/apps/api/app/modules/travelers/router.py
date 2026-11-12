"""Traveler profiles (contract 3.2). Identity fields are encrypted at rest."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user, require_editor
from app.modules.travelers import service
from app.modules.travelers.schemas import PassportReveal, TravelerDetail, TravelerSummary, TravelerUpsert
from app.schemas.common import OkResponse

router = APIRouter(prefix="/api/travelers", tags=["travelers"])


@router.get("", response_model=list[TravelerSummary])
def list_travelers(ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.list_travelers(db, ctx)


@router.get("/{member_id}", response_model=TravelerDetail)
def get_traveler(member_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.get_traveler(db, ctx, member_id)


@router.put("/{member_id}", response_model=TravelerDetail)
def upsert_traveler(
    member_id: str, body: TravelerUpsert, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)
):
    return service.upsert_traveler(db, ctx, member_id, body, request)


@router.delete("/{member_id}", response_model=OkResponse)
def delete_traveler(member_id: str, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    service.delete_traveler(db, ctx, member_id, request)
    return OkResponse()


@router.post("/{member_id}/passport/reveal", response_model=PassportReveal)
def reveal_passport(member_id: str, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    return service.reveal_passport(db, ctx, member_id, request)
