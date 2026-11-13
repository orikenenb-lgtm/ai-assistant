"""FastAPI dependencies: authentication, CSRF and role-based authorization.

Usage in routers::

    @router.get("/things")
    def list_things(ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)): ...

    @router.post("/things")
    def create_thing(ctx: AuthContext = Depends(require_roles("owner", "adult")), ...): ...

Any authenticated request with an unsafe method (POST/PUT/PATCH/DELETE) is
automatically CSRF-checked: the ``X-CSRF-Token`` header must equal the
session's CSRF token (double-submit with server-side binding).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.errors import ForbiddenError, UnauthorizedError
from app.core.middleware import SAFE_METHODS
from app.core.security import constant_time_equals, sha256_hex
from app.models.auth import ROLE_ADULT, ROLE_OWNER, AuthSession, User

CSRF_HEADER = "x-csrf-token"
REAUTH_WINDOW = timedelta(minutes=10)


@dataclass
class AuthContext:
    user: User
    session: AuthSession

    @property
    def user_id(self) -> str:
        return self.user.id

    @property
    def role(self) -> str:
        return self.user.role

    @property
    def is_owner(self) -> bool:
        return self.user.role == ROLE_OWNER

    @property
    def can_book(self) -> bool:
        """Only owner/adult roles that are attested legal adults may prepare bookings."""
        return self.user.role in (ROLE_OWNER, ROLE_ADULT) and bool(self.user.legal_adult_attested)

    @property
    def recently_reauthenticated(self) -> bool:
        ts = self.session.reauth_at
        return ts is not None and utcnow() - ts <= REAUTH_WINDOW


def load_session(db: Session, raw_token: str | None) -> AuthSession | None:
    if not raw_token or len(raw_token) > 200:
        return None
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == sha256_hex(raw_token)))
    if session is None or session.revoked_at is not None:
        return None
    settings = get_settings()
    now = utcnow()
    if session.expires_at <= now:
        return None
    if now - session.last_seen_at > timedelta(hours=settings.session_idle_timeout_hours):
        return None
    return session


def current_user(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    settings = get_settings()
    session = load_session(db, request.cookies.get(settings.session_cookie_name))
    if session is None:
        raise UnauthorizedError()
    user = session.user
    if user is None or not user.is_active:
        raise UnauthorizedError()

    if request.method not in SAFE_METHODS:
        header = request.headers.get(CSRF_HEADER, "")
        if not header or not constant_time_equals(header, session.csrf_token):
            raise ForbiddenError("אסימון CSRF חסר או שגוי — רעננו את הדף ונסו שוב", code="CSRF_FAILED")

    # Touch last_seen at most once a minute to limit writes.
    now = utcnow()
    if now - session.last_seen_at > timedelta(minutes=1):
        session.last_seen_at = now
        db.commit()
    request.state.user_id = user.id
    return AuthContext(user=user, session=session)


def require_roles(*roles: str) -> Callable[..., AuthContext]:
    allowed = set(roles)

    def _dep(ctx: AuthContext = Depends(current_user)) -> AuthContext:
        if ctx.user.role not in allowed:
            raise ForbiddenError()
        return ctx

    return _dep


def require_owner(ctx: AuthContext = Depends(current_user)) -> AuthContext:
    if not ctx.is_owner:
        raise ForbiddenError("פעולה זו שמורה לבעל/ת החשבון המשפחתי")
    return ctx


def require_editor(ctx: AuthContext = Depends(current_user)) -> AuthContext:
    """Owner or adult (anyone except viewers) may create/modify family content."""
    if ctx.user.role not in (ROLE_OWNER, ROLE_ADULT):
        raise ForbiddenError("לצופים יש הרשאת קריאה בלבד")
    return ctx


def require_booking_adult(ctx: AuthContext = Depends(current_user)) -> AuthContext:
    if not ctx.can_book:
        raise ForbiddenError("רק מבוגר/ת מורשה במשפחה יכול/ה להכין הזמנה", code="BOOKING_NOT_ALLOWED")
    return ctx
