from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.audit import client_ip, record_audit
from app.core.db import get_db, utcnow
from app.core.deps import AuthContext, current_user
from app.core.errors import RateLimitedError, UnauthorizedError
from app.core.ratelimit import limiter
from app.core.security import verify_password
from app.modules.auth import service
from app.modules.auth.schemas import (
    AcceptInvitationRequest,
    ChangePasswordRequest,
    InvitationPreview,
    InvitationTokenBody,
    LoginRequest,
    ReauthRequest,
    SessionOut,
)
from app.schemas.common import OkResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=SessionOut)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> SessionOut:
    user = service.authenticate(db, body.email, body.password, request)
    session = service.create_session(db, user, request, response)
    record_audit(db, "auth.login", actor_user_id=user.id, request=request)
    db.commit()
    return SessionOut(user=service.user_out(user), csrf_token=session.csrf_token)


@router.post("/logout", response_model=OkResponse)
def logout(request: Request, response: Response, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    service.revoke_session(db, ctx.session)
    record_audit(db, "auth.logout", actor_user_id=ctx.user_id, request=request)
    db.commit()
    service.clear_session_cookies(response)
    return OkResponse()


@router.get("/me", response_model=SessionOut)
def me(ctx: AuthContext = Depends(current_user)) -> SessionOut:
    return SessionOut(user=service.user_out(ctx.user), csrf_token=ctx.session.csrf_token)


@router.post("/change-password", response_model=OkResponse)
def change_password(
    body: ChangePasswordRequest, request: Request, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)
):
    if not limiter.hit(f"chpw:{ctx.user_id}", limit=5, window_seconds=300):
        raise RateLimitedError()
    if not verify_password(ctx.user.password_hash, body.current_password):
        record_audit(db, "auth.change_password", actor_user_id=ctx.user_id, outcome="failure", request=request, commit=True)
        raise UnauthorizedError("הסיסמה הנוכחית שגויה", code="INVALID_CREDENTIALS")
    service.set_password(ctx.user, body.new_password)
    revoked = service.revoke_other_sessions(db, ctx.user_id, keep_session_id=ctx.session.id)
    record_audit(db, "auth.change_password", actor_user_id=ctx.user_id, details={"revoked_sessions": revoked}, request=request)
    db.commit()
    return OkResponse()


@router.post("/reauth", response_model=OkResponse)
def reauth(body: ReauthRequest, request: Request, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)):
    """Step-up authentication for sensitive actions (valid for 10 minutes)."""
    service.check_password_for_step_up(db, ctx.user, body.password, request)
    ctx.session.reauth_at = utcnow()
    record_audit(db, "auth.reauth", actor_user_id=ctx.user_id, request=request)
    db.commit()
    return OkResponse()


def _preview(token: str, request: Request, db: Session) -> InvitationPreview:
    if not limiter.hit(f"inv-preview:{client_ip(request)}", limit=20, window_seconds=300):
        raise RateLimitedError()
    inv = service.find_active_invitation(db, token)
    return InvitationPreview(email=inv.email, display_name=inv.display_name, role=inv.role, expires_at=inv.expires_at)


@router.post("/invitations/preview", response_model=InvitationPreview)
def preview_invitation(body: InvitationTokenBody, request: Request, db: Session = Depends(get_db)) -> InvitationPreview:
    """Preferred: the token travels in the JSON body, never in a URL (URLs end up in logs)."""
    return _preview(body.token, request, db)


@router.get("/invitations/{token}", response_model=InvitationPreview, deprecated=True)
def preview_invitation_legacy(token: str, request: Request, db: Session = Depends(get_db)) -> InvitationPreview:
    """Legacy path-based preview (kept for compatibility; paths are redacted in all logs)."""
    return _preview(token, request, db)


@router.post("/invitations/accept", response_model=SessionOut)
def accept_invitation(
    body: AcceptInvitationRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> SessionOut:
    if not limiter.hit(f"inv-accept:{client_ip(request)}", limit=10, window_seconds=300):
        raise RateLimitedError()
    user = service.accept_invitation(db, body.token, body.password, request)
    session = service.create_session(db, user, request, response)
    user.last_login_at = utcnow()
    db.commit()
    return SessionOut(user=service.user_out(user), csrf_token=session.csrf_token)
