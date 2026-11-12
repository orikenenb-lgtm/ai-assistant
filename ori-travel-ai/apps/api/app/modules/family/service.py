"""Family members, user administration and invitations."""

from __future__ import annotations

from datetime import timedelta

from fastapi import Request
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.config import get_settings
from app.core.db import utcnow
from app.core.deps import AuthContext
from app.core.errors import AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import new_token, sha256_hex
from app.models.auth import ROLE_ADULT, ROLE_OWNER, AuthSession, Invitation, User
from app.models.booking import Approval, BookingIntent, Reservation
from app.models.family import FamilyMember
from app.modules.auth.service import normalize_email
from app.modules.family.schemas import (
    InvitationCreate,
    InvitationCreated,
    InvitationOut,
    MemberCreate,
    MemberOut,
    MemberUpdate,
    MemberUserOut,
    UserUpdate,
)

DELETED_NAME = "[נמחק]"


class UnprocessableError(AppError):
    status_code = 422
    code = "VALIDATION_ERROR"
    default_message = "חלק מהשדות אינם תקינים"


ATTESTATION_MSG = "תפקיד מבוגר/ת או בעל/ת חשבון מחייב אישור שהאדם בגיר"


# ---------------- members ----------------


def member_out(member: FamilyMember, user: User | None) -> MemberOut:
    return MemberOut(
        id=member.id,
        display_name=member.display_name,
        relation=member.relation,
        age_group=member.age_group,
        is_minor=member.is_minor,
        has_traveler_profile=member.traveler_profile is not None,
        user=MemberUserOut(id=user.id, email=user.email, role=user.role, is_active=user.is_active) if user else None,
    )


def list_members(db: Session) -> list[MemberOut]:
    rows = db.execute(
        select(FamilyMember, User).outerjoin(User, FamilyMember.user_id == User.id).order_by(FamilyMember.created_at, FamilyMember.id)
    ).all()
    return [member_out(m, u) for m, u in rows]


def get_member(db: Session, member_id: str) -> FamilyMember:
    member = db.get(FamilyMember, member_id)
    if member is None:
        raise NotFoundError("בן/בת המשפחה לא נמצא/ה")
    return member


def _out(db: Session, member: FamilyMember) -> MemberOut:
    user = db.get(User, member.user_id) if member.user_id else None
    return member_out(member, user)


def _resolve_minor(age_group: str, is_minor: bool | None) -> bool:
    expected = age_group != "adult"
    if is_minor is not None and is_minor != expected:
        raise UnprocessableError("קבוצת הגיל וסימון הקטין אינם עקביים (ילד/תינוק חייבים להיות קטינים, מבוגר אינו קטין)")
    return expected


def create_member(db: Session, actor: User, body: MemberCreate, request: Request | None) -> MemberOut:
    is_minor = _resolve_minor(body.age_group, body.is_minor)
    member = FamilyMember(
        display_name=body.display_name,
        relation=body.relation.strip() if body.relation else None,
        age_group=body.age_group,
        is_minor=is_minor,
        created_by_id=actor.id,
    )
    db.add(member)
    db.flush()
    record_audit(db, "family.member_create", actor_user_id=actor.id, entity_type="family_member", entity_id=member.id, request=request)
    db.commit()
    db.refresh(member)
    return _out(db, member)


def update_member(db: Session, ctx: AuthContext, member_id: str, body: MemberUpdate, request: Request | None) -> MemberOut:
    actor = ctx.user
    member = get_member(db, member_id)
    if member.user_id and member.user_id != actor.id and not ctx.is_owner:
        raise ForbiddenError("רשומה של בן/בת משפחה עם חשבון יכולה להיערך רק על ידי המשתמש/ת עצמו/ה או בעל/ת החשבון")
    data = body.model_dump(exclude_unset=True)
    if "display_name" in data and data["display_name"] is None:
        raise BadRequestError("שם אינו יכול להיות ריק")
    if "age_group" in data and data["age_group"] is None:
        raise BadRequestError("קבוצת גיל אינה יכולה להיות ריקה")
    if "is_minor" in data and data["is_minor"] is None:
        data.pop("is_minor")
    if "age_group" in data or "is_minor" in data:
        data["is_minor"] = _resolve_minor(data.get("age_group", member.age_group), data.get("is_minor"))
    if "relation" in data and data["relation"] is not None:
        data["relation"] = data["relation"].strip() or None
    for k, v in data.items():
        setattr(member, k, v)
    record_audit(
        db,
        "family.member_update",
        actor_user_id=actor.id,
        entity_type="family_member",
        entity_id=member.id,
        details={"fields": sorted(data)},
        request=request,
    )
    db.commit()
    db.refresh(member)
    return _out(db, member)


def delete_member(db: Session, actor: User, member_id: str, request: Request | None) -> None:
    member = get_member(db, member_id)
    if member.user_id:
        linked = db.get(User, member.user_id)
        if linked is not None and linked.role == ROLE_OWNER and linked.is_active:
            raise ConflictError("לא ניתן למחוק בן/בת משפחה המקושר/ת לבעל/ת חשבון פעיל/ה", code="MEMBER_LINKED_TO_OWNER")
    had_profile = member.traveler_profile is not None
    scrubbed = _scrub_member_name(db, member)
    db.delete(member)  # cascades to the traveler profile (data deletion)
    record_audit(
        db,
        "family.member_delete",
        actor_user_id=actor.id,
        entity_type="family_member",
        entity_id=member_id,
        details={"traveler_profile_deleted": had_profile, "scrubbed_records": scrubbed},
        request=request,
    )
    db.commit()


def _scrub_member_name(db: Session, member: FamilyMember) -> int:
    """Replace the member's display name in stored booking records (ids are kept).

    Touches booking_intents.travelers, reservations.details.travelers and the human-readable
    approvals.summary (approval evidence; only the name text is replaced).
    """
    name = member.display_name
    count = 0
    intents = list(db.scalars(select(BookingIntent)))
    scrub_ids: set[str] = set()
    for intent in intents:
        if any(t.get("family_member_id") == member.id for t in intent.travelers or []):
            intent.travelers = [
                {**t, "display_name": DELETED_NAME} if t.get("family_member_id") == member.id else t for t in intent.travelers
            ]
            scrub_ids.add(intent.id)
            count += 1
    if scrub_ids:
        for res in db.scalars(select(Reservation).where(Reservation.booking_intent_id.in_(scrub_ids))):
            details = dict(res.details or {})
            details["travelers"] = [
                {**t, "display_name": DELETED_NAME} if t.get("family_member_id") == member.id else t
                for t in details.get("travelers") or []
            ]
            res.details = details
            count += 1
        for appr in db.scalars(select(Approval).where(Approval.booking_intent_id.in_(scrub_ids))):
            if name and name in appr.summary:
                appr.summary = appr.summary.replace(name, DELETED_NAME)
                count += 1
    return count


# ---------------- users ----------------


def list_users(db: Session) -> list[User]:
    return list(db.scalars(select(User).order_by(User.created_at, User.id)))


def _active_owner_count(db: Session, exclude_id: str | None = None) -> int:
    stmt = select(func.count()).select_from(User).where(User.role == ROLE_OWNER, User.is_active.is_(True))
    if exclude_id:
        stmt = stmt.where(User.id != exclude_id)
    return int(db.scalar(stmt) or 0)


def update_user(db: Session, actor: User, user_id: str, body: UserUpdate, request: Request | None) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise NotFoundError("המשתמש/ת לא נמצא/ה")
    data = body.model_dump(exclude_unset=True)
    is_self = target.id == actor.id

    new_role = data.get("role", target.role) or target.role
    new_active = data.get("is_active", target.is_active)
    new_active = target.is_active if new_active is None else new_active
    new_attested = data.get("legal_adult_attested", target.legal_adult_attested)
    new_attested = target.legal_adult_attested if new_attested is None else new_attested

    if is_self and new_role != target.role:
        raise ConflictError("לא ניתן לשנות את התפקיד של עצמך", code="CANNOT_CHANGE_OWN_ROLE")
    if is_self and new_active is False:
        raise ConflictError("לא ניתן להשבית את החשבון של עצמך", code="CANNOT_DEACTIVATE_SELF")
    if new_role in (ROLE_OWNER, ROLE_ADULT) and not new_attested:
        raise BadRequestError(ATTESTATION_MSG, code="ATTESTATION_REQUIRED")
    losing_owner = target.role == ROLE_OWNER and target.is_active and (new_role != ROLE_OWNER or not new_active)
    if losing_owner and _active_owner_count(db, exclude_id=target.id) == 0:
        raise ConflictError("חייב להישאר לפחות בעל/ת חשבון פעיל/ה אחד/ת", code="LAST_OWNER")

    changes: dict[str, object] = {}
    if new_role != target.role:
        changes["role"] = {"from": target.role, "to": new_role}
        target.role = new_role
    if new_attested != target.legal_adult_attested:
        changes["legal_adult_attested"] = new_attested
        target.legal_adult_attested = new_attested
    revoked = 0
    if new_active != target.is_active:
        changes["is_active"] = new_active
        target.is_active = new_active
        if not new_active:
            revoked = db.execute(
                update(AuthSession).where(AuthSession.user_id == target.id, AuthSession.revoked_at.is_(None)).values(revoked_at=utcnow())
            ).rowcount or 0
    if changes:
        record_audit(
            db,
            "family.user_update",
            actor_user_id=actor.id,
            entity_type="user",
            entity_id=target.id,
            details={**changes, "revoked_sessions": revoked},
            request=request,
        )
    db.commit()
    db.refresh(target)
    return target


def delete_user(db: Session, ctx: AuthContext, user_id: str, request: Request | None) -> None:
    target = db.get(User, user_id)
    if target is None:
        raise NotFoundError("המשתמש/ת לא נמצא/ה")
    if target.id == ctx.user_id:
        raise ConflictError("לא ניתן למחוק את החשבון של עצמך", code="CANNOT_DELETE_SELF")
    if target.role == ROLE_OWNER:
        raise ConflictError("לא ניתן למחוק בעל/ת חשבון", code="CANNOT_DELETE_OWNER")
    if target.is_active:
        raise ConflictError("יש להשבית את המשתמש/ת לפני המחיקה", code="USER_STILL_ACTIVE")
    if not ctx.recently_reauthenticated:
        raise ForbiddenError("נדרש אימות סיסמה מחדש למחיקת משתמש", code="REAUTH_REQUIRED")
    db.execute(update(AuthSession).where(AuthSession.user_id == target.id, AuthSession.revoked_at.is_(None)).values(revoked_at=utcnow()))
    db.execute(update(FamilyMember).where(FamilyMember.user_id == target.id).values(user_id=None))
    db.execute(update(Invitation).where(Invitation.accepted_user_id == target.id).values(accepted_user_id=None))
    record_audit(db, "family.user_delete", actor_user_id=ctx.user_id, entity_type="user", entity_id=target.id, request=request)
    db.delete(target)
    db.commit()


# ---------------- invitations ----------------


def invitation_status(inv: Invitation) -> str:
    if inv.accepted_at is not None:
        return "accepted"
    if inv.revoked_at is not None:
        return "revoked"
    if inv.expires_at <= utcnow():
        return "expired"
    return "pending"


def invitation_out(inv: Invitation) -> InvitationOut:
    return InvitationOut(
        id=inv.id,
        email=inv.email,
        display_name=inv.display_name,
        role=inv.role,
        legal_adult_attested=inv.legal_adult_attested,
        status=invitation_status(inv),  # type: ignore[arg-type]
        family_member_id=inv.family_member_id,
        created_at=inv.created_at,
        expires_at=inv.expires_at,
    )


def list_invitations(db: Session) -> list[InvitationOut]:
    rows = db.scalars(select(Invitation).order_by(Invitation.created_at.desc(), Invitation.id))
    return [invitation_out(i) for i in rows]


def create_invitation(db: Session, actor: User, body: InvitationCreate, request: Request | None) -> InvitationCreated:
    email = normalize_email(body.email)
    if body.role in (ROLE_OWNER, ROLE_ADULT) and not body.legal_adult_attested:
        raise BadRequestError(ATTESTATION_MSG, code="ATTESTATION_REQUIRED")
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise ConflictError("כבר קיים משתמש עם כתובת אימייל זו", code="USER_EXISTS")
    if body.family_member_id:
        member = db.get(FamilyMember, body.family_member_id)
        if member is None:
            raise NotFoundError("בן/בת המשפחה לא נמצא/ה")
        if member.user_id is not None:
            raise ConflictError("לבן/בת המשפחה כבר יש משתמש/ת מקושר/ת", code="MEMBER_HAS_USER")
        if member.is_minor and body.role in (ROLE_OWNER, ROLE_ADULT):
            raise BadRequestError("לא ניתן להזמין קטין/ה בתפקיד מבוגר/ת או בעל/ת חשבון", code="MINOR_CANNOT_BE_ADULT")

    now = utcnow()
    # A new invitation replaces any pending one for the same email.
    revoked = db.execute(
        update(Invitation)
        .where(Invitation.email == email, Invitation.accepted_at.is_(None), Invitation.revoked_at.is_(None))
        .values(revoked_at=now)
    ).rowcount or 0

    token = new_token(24)
    inv = Invitation(
        email=email,
        display_name=body.display_name,
        role=body.role,
        legal_adult_attested=body.legal_adult_attested,
        token_hash=sha256_hex(token),
        invited_by_id=actor.id,
        family_member_id=body.family_member_id,
        created_at=now,
        expires_at=now + timedelta(hours=get_settings().invitation_ttl_hours),
    )
    db.add(inv)
    db.flush()
    record_audit(
        db,
        "family.invitation_create",
        actor_user_id=actor.id,
        entity_type="invitation",
        entity_id=inv.id,
        details={"role": inv.role, "replaced_pending": revoked},
        request=request,
    )
    db.commit()
    db.refresh(inv)
    return InvitationCreated(invitation=invitation_out(inv), invite_path=f"/invite/{token}")


def revoke_invitation(db: Session, actor: User, invitation_id: str, request: Request | None) -> None:
    inv = db.get(Invitation, invitation_id)
    if inv is None:
        raise NotFoundError("ההזמנה לא נמצאה")
    if inv.accepted_at is not None:
        raise ConflictError("ההזמנה כבר התקבלה ולא ניתן לבטל אותה", code="INVITATION_ACCEPTED")
    if inv.revoked_at is None:
        inv.revoked_at = utcnow()
        record_audit(
            db, "family.invitation_revoke", actor_user_id=actor.id, entity_type="invitation", entity_id=inv.id, request=request
        )
    db.commit()
