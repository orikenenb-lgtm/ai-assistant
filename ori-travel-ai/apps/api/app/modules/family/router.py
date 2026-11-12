"""Family members, user administration and invitations (contract 3.2)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user, require_editor, require_owner
from app.modules.auth.schemas import UserOut
from app.modules.auth.service import user_out
from app.modules.family import service
from app.modules.family.schemas import (
    InvitationCreate,
    InvitationCreated,
    InvitationOut,
    MemberCreate,
    MemberOut,
    MemberUpdate,
    UserUpdate,
)
from app.schemas.common import OkResponse

router = APIRouter(prefix="/api/family", tags=["family"])


@router.get("/members", response_model=list[MemberOut])
def list_members(ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    return service.list_members(db)


@router.post("/members", response_model=MemberOut, status_code=201)
def create_member(body: MemberCreate, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)):
    return service.create_member(db, ctx.user, body, request)


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member(
    member_id: str, body: MemberUpdate, request: Request, ctx: AuthContext = Depends(require_editor), db: Session = Depends(get_db)
):
    return service.update_member(db, ctx, member_id, body, request)


@router.delete("/members/{member_id}", response_model=OkResponse)
def delete_member(member_id: str, request: Request, ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)):
    service.delete_member(db, ctx.user, member_id, request)
    return OkResponse()


@router.get("/users", response_model=list[UserOut])
def list_users(ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)):
    return [user_out(u) for u in service.list_users(db)]


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: str, body: UserUpdate, request: Request, ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)
):
    return user_out(service.update_user(db, ctx.user, user_id, body, request))


@router.get("/invitations", response_model=list[InvitationOut])
def list_invitations(ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)):
    return service.list_invitations(db)


@router.post("/invitations", response_model=InvitationCreated, status_code=201)
def create_invitation(
    body: InvitationCreate, request: Request, ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)
):
    return service.create_invitation(db, ctx.user, body, request)


@router.delete("/invitations/{invitation_id}", response_model=OkResponse)
def revoke_invitation(
    invitation_id: str, request: Request, ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)
):
    service.revoke_invitation(db, ctx.user, invitation_id, request)
    return OkResponse()


@router.delete("/users/{user_id}", response_model=OkResponse)
def delete_user(user_id: str, request: Request, ctx: AuthContext = Depends(require_owner), db: Session = Depends(get_db)):
    service.delete_user(db, ctx, user_id, request)
    return OkResponse()
