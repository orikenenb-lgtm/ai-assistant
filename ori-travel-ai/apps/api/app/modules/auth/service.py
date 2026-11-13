"""Authentication service: login with lockout, sessions, invitations."""

from __future__ import annotations

from datetime import timedelta

from fastapi import Request, Response
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.audit import client_ip, record_audit
from app.core.config import get_settings
from app.core.db import utcnow
from app.core.errors import BadRequestError, NotFoundError, RateLimitedError, UnauthorizedError
from app.core.ratelimit import limiter
from app.core.security import (
    hash_password,
    needs_rehash,
    new_token,
    sha256_hex,
    validate_password_strength,
    verify_password,
)
from app.models.auth import ROLE_ADULT, ROLE_OWNER, AuthSession, Invitation, User
from app.models.family import FamilyMember
from app.modules.auth.schemas import UserOut

INVALID_CREDENTIALS = "אימייל או סיסמה שגויים"


def normalize_email(email: str) -> str:
    return email.strip().lower()


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        legal_adult_attested=user.legal_adult_attested,
        can_book=user.role in (ROLE_OWNER, ROLE_ADULT) and user.legal_adult_attested,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


def authenticate(db: Session, email: str, password: str, request: Request | None) -> User:
    settings = get_settings()
    email_n = normalize_email(email)
    ip = client_ip(request) or "unknown"
    # Throttle per IP and per email (also protects unknown emails)
    if not limiter.hit(f"login:ip:{ip}", limit=20, window_seconds=300) or not limiter.hit(
        f"login:email:{email_n}", limit=10, window_seconds=300
    ):
        record_audit(db, "auth.login", outcome="denied", details={"reason": "rate_limited"}, request=request, commit=True)
        raise RateLimitedError("יותר מדי ניסיונות התחברות. נסו שוב בעוד מספר דקות")

    user = db.scalar(select(User).where(User.email == email_n))
    now = utcnow()
    if user is not None and user.locked_until is not None and user.locked_until > now:
        verify_password(None, password)  # equalise timing
        record_audit(
            db, "auth.login", actor_user_id=user.id, outcome="denied", details={"reason": "locked"}, request=request, commit=True
        )
        raise RateLimitedError("החשבון ננעל זמנית בעקבות ניסיונות כושלים. נסו שוב מאוחר יותר")

    ok = verify_password(user.password_hash if user else None, password)
    if not ok or user is None or not user.is_active:
        if user is not None:
            user.failed_login_count += 1
            if user.failed_login_count >= settings.login_max_failures:
                user.locked_until = now + timedelta(minutes=settings.login_lockout_minutes)
                user.failed_login_count = 0
        record_audit(
            db,
            "auth.login",
            actor_user_id=user.id if user else None,
            outcome="failure",
            details={"reason": "invalid_credentials"},
            request=request,
            commit=True,
        )
        raise UnauthorizedError(INVALID_CREDENTIALS, code="INVALID_CREDENTIALS")

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    return user


def create_session(db: Session, user: User, request: Request | None, response: Response) -> AuthSession:
    settings = get_settings()
    raw = new_token(32)
    now = utcnow()
    session = AuthSession(
        token_hash=sha256_hex(raw),
        csrf_token=new_token(24),
        user_id=user.id,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(hours=settings.session_ttl_hours),
        # Step-up is NOT implied by login: sensitive actions (passport reveal, deletions)
        # always require re-entering the password via /api/auth/reauth.
        reauth_at=None,
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent", "")[:255] if request else None),
    )
    db.add(session)
    set_session_cookies(response, raw, session.csrf_token)
    return session


def set_session_cookies(response: Response, raw_token: str, csrf_token: str) -> None:
    settings = get_settings()
    max_age = settings.session_ttl_hours * 3600
    response.set_cookie(
        settings.session_cookie_name,
        raw_token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    # Readable by the SPA so it can send X-CSRF-Token (double submit)
    response.set_cookie(
        settings.csrf_cookie_name,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )


def clear_session_cookies(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(settings.session_cookie_name, path="/")
    response.delete_cookie(settings.csrf_cookie_name, path="/")


def revoke_session(db: Session, session: AuthSession) -> None:
    session.revoked_at = utcnow()


def revoke_other_sessions(db: Session, user_id: str, keep_session_id: str | None) -> int:
    stmt = (
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    if keep_session_id:
        stmt = stmt.where(AuthSession.id != keep_session_id)
    result = db.execute(stmt)
    return result.rowcount or 0


def check_password_for_step_up(db: Session, user: User, password: str, request: Request | None) -> None:
    """Verify the password again for sensitive actions.

    Only FAILED attempts count towards the limit (5 per 5 minutes), so a family
    member approving several bookings in a row is not locked out, while password
    guessing through step-up endpoints is still throttled.
    """
    key = f"reauth-fail:{user.id}"
    if limiter.is_blocked(key, limit=5, window_seconds=300):
        raise RateLimitedError("יותר מדי ניסיונות אימות שגויים. נסו שוב בעוד מספר דקות")
    if not verify_password(user.password_hash, password):
        limiter.hit(key, limit=1_000_000, window_seconds=300)
        record_audit(db, "auth.reauth", actor_user_id=user.id, outcome="failure", request=request, commit=True)
        raise UnauthorizedError("הסיסמה שגויה", code="REAUTH_FAILED")


def set_password(user: User, new_password: str) -> None:
    err = validate_password_strength(new_password)
    if err:
        raise BadRequestError(err, code="WEAK_PASSWORD")
    user.password_hash = hash_password(new_password)
    user.password_changed_at = utcnow()


# ---------------- invitations ----------------


def find_active_invitation(db: Session, raw_token: str) -> Invitation:
    inv = db.scalar(select(Invitation).where(Invitation.token_hash == sha256_hex(raw_token)))
    now = utcnow()
    if inv is None or inv.accepted_at is not None or inv.revoked_at is not None or inv.expires_at <= now:
        raise NotFoundError("ההזמנה אינה תקפה או שפג תוקפה", code="INVITATION_INVALID")
    return inv


def accept_invitation(db: Session, raw_token: str, password: str, request: Request | None) -> User:
    inv = find_active_invitation(db, raw_token)
    email = normalize_email(inv.email)
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise BadRequestError("כבר קיים משתמש עם כתובת אימייל זו", code="USER_EXISTS")
    user = User(
        email=email,
        display_name=inv.display_name,
        role=inv.role,
        legal_adult_attested=inv.legal_adult_attested,
        password_hash="!",  # noqa: S106 - placeholder, replaced by set_password() below
        is_active=True,
    )
    set_password(user, password)
    db.add(user)
    db.flush()
    inv.accepted_at = utcnow()
    inv.accepted_user_id = user.id
    if inv.family_member_id:
        member = db.get(FamilyMember, inv.family_member_id)
        if member is not None and member.user_id is None:
            member.user_id = user.id
    else:
        db.add(FamilyMember(display_name=user.display_name, user_id=user.id, age_group="adult", is_minor=False))
    record_audit(
        db,
        "auth.invitation_accepted",
        actor_user_id=user.id,
        entity_type="invitation",
        entity_id=inv.id,
        details={"role": inv.role},
        request=request,
    )
    return user
