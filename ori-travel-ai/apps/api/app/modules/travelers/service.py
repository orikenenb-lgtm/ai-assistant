"""Traveler profiles: encrypted identity data, masked outputs, audited reveal."""

from __future__ import annotations

from datetime import date

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.audit import record_audit
from app.core.deps import AuthContext
from app.core.errors import ForbiddenError, NotFoundError, ServiceUnavailableError
from app.models.family import FamilyMember, TravelerProfile
from app.modules.travelers.schemas import PassportReveal, TravelerDetail, TravelerSummary, TravelerUpsert

ENC_MSG = "אחסון פרטי מטייל מוצפנים אינו זמין: מפתח ההצפנה לא הוגדר בשרת"
EDITOR_ROLES = ("owner", "adult")


def _enc(value: str | None) -> str | None:
    try:
        return crypto.encrypt_str(value)
    except crypto.EncryptionUnavailableError as exc:
        raise ServiceUnavailableError(ENC_MSG, code="ENCRYPTION_UNAVAILABLE") from exc


def _dec(value: str | None) -> str | None:
    try:
        return crypto.decrypt_str(value)
    except crypto.EncryptionUnavailableError as exc:
        raise ServiceUnavailableError(ENC_MSG, code="ENCRYPTION_UNAVAILABLE") from exc
    except crypto.DecryptionError as exc:
        raise ServiceUnavailableError("לא ניתן לפענח את נתוני המטייל (מפתח הצפנה שונה?)", code="DECRYPTION_FAILED") from exc


def age_group_for(dob: date, today: date | None = None) -> str:
    today = today or date.today()
    years = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    if years < 2:
        return "infant"
    if years < 18:
        return "child"
    return "adult"


def _is_editor(ctx: AuthContext) -> bool:
    return ctx.role in EDITOR_ROLES


def _get_member(db: Session, member_id: str) -> FamilyMember:
    member = db.get(FamilyMember, member_id)
    if member is None:
        raise NotFoundError("בן/בת המשפחה לא נמצא/ה")
    return member


def _get_profile(db: Session, member_id: str) -> TravelerProfile:
    profile = db.scalar(select(TravelerProfile).where(TravelerProfile.family_member_id == member_id))
    if profile is None:
        raise NotFoundError("לא קיים פרופיל מטייל עבור בן/בת המשפחה", code="TRAVELER_NOT_FOUND")
    return profile


def _expiry_month(profile: TravelerProfile) -> tuple[str | None, date | None]:
    raw = _dec(profile.passport_expiry_enc)
    if not raw:
        return None, None
    try:
        d = date.fromisoformat(raw)
    except ValueError:
        return None, None
    return f"{d.year:04d}-{d.month:02d}", d


def _summary_fields(profile: TravelerProfile, member: FamilyMember, *, strict: bool) -> dict:
    passport_masked = None
    if profile.passport_number_enc:
        try:
            passport_masked = crypto.mask(_dec(profile.passport_number_enc))
        except ServiceUnavailableError:
            if strict:
                raise
    expiry_month = None
    if profile.passport_expiry_enc:
        try:
            expiry_month, _ = _expiry_month(profile)
        except ServiceUnavailableError:
            if strict:
                raise
    return {
        "member_id": member.id,
        "display_name": member.display_name,
        "has_passport": bool(profile.passport_number_enc),
        "passport_masked": passport_masked,
        "passport_expiry_month": expiry_month,
        "nationality": profile.nationality,
        "seat_preference": profile.seat_preference,
        "meal_preference": profile.meal_preference,
        "kosher_required": profile.kosher_required,
        "accessibility_needs": list(profile.accessibility_needs or []),
        "updated_at": profile.updated_at,
    }


def list_travelers(db: Session) -> list[TravelerSummary]:
    rows = db.execute(
        select(TravelerProfile, FamilyMember)
        .join(FamilyMember, FamilyMember.id == TravelerProfile.family_member_id)
        .order_by(FamilyMember.created_at, FamilyMember.id)
    ).all()
    return [TravelerSummary(**_summary_fields(p, m, strict=False)) for p, m in rows]


def _detail(ctx: AuthContext, profile: TravelerProfile, member: FamilyMember) -> TravelerDetail:
    fields = _summary_fields(profile, member, strict=True)
    if not _is_editor(ctx):
        return TravelerDetail(**fields, detail_level="masked")
    dob_raw = _dec(profile.date_of_birth_enc)
    dob = date.fromisoformat(dob_raw) if dob_raw else None
    _, expiry = _expiry_month(profile)
    return TravelerDetail(
        **fields,
        detail_level="full",
        legal_first_name=_dec(profile.legal_first_name_enc),
        legal_last_name=_dec(profile.legal_last_name_enc),
        date_of_birth=dob,
        passport_expiry=expiry,
        has_frequent_flyer=bool(profile.frequent_flyer_enc),
        gender=profile.gender,
        notes=profile.notes,
        age_group_suggestion=age_group_for(dob) if dob else None,
    )


def get_traveler(db: Session, ctx: AuthContext, member_id: str) -> TravelerDetail:
    member = _get_member(db, member_id)
    profile = _get_profile(db, member_id)
    return _detail(ctx, profile, member)


def upsert_traveler(db: Session, ctx: AuthContext, member_id: str, body: TravelerUpsert, request: Request | None) -> TravelerDetail:
    member = _get_member(db, member_id)
    provided = body.model_fields_set
    # Encrypt first so a missing key fails before anything is written.
    first = _enc(body.legal_first_name)
    last = _enc(body.legal_last_name)
    dob = _enc(body.date_of_birth.isoformat())
    passport = _enc(body.passport_number) if "passport_number" in provided else None
    expiry = _enc(body.passport_expiry.isoformat()) if body.passport_expiry else None
    ff = _enc(body.frequent_flyer) if "frequent_flyer" in provided else None

    profile = db.scalar(select(TravelerProfile).where(TravelerProfile.family_member_id == member_id))
    created = profile is None
    if profile is None:
        profile = TravelerProfile(family_member_id=member_id)
        db.add(profile)
    profile.legal_first_name_enc = first
    profile.legal_last_name_enc = last
    profile.date_of_birth_enc = dob
    # Omitted optional secrets keep their stored value; explicit null clears them.
    if "passport_number" in provided:
        profile.passport_number_enc = passport
    if "passport_expiry" in provided:
        profile.passport_expiry_enc = expiry
    if "frequent_flyer" in provided:
        profile.frequent_flyer_enc = ff
    profile.nationality = body.nationality
    profile.gender = body.gender
    profile.seat_preference = body.seat_preference
    profile.meal_preference = body.meal_preference
    profile.kosher_required = body.kosher_required
    profile.accessibility_needs = body.accessibility_needs
    profile.notes = body.notes
    db.flush()
    record_audit(
        db,
        "traveler.create" if created else "traveler.update",
        actor_user_id=ctx.user_id,
        entity_type="traveler_profile",
        entity_id=profile.id,
        details={"family_member_id": member_id, "has_passport": bool(profile.passport_number_enc)},
        request=request,
    )
    db.commit()
    db.refresh(profile)
    return _detail(ctx, profile, member)


def delete_traveler(db: Session, ctx: AuthContext, member_id: str, request: Request | None) -> None:
    _get_member(db, member_id)
    profile = _get_profile(db, member_id)
    pid = profile.id
    db.delete(profile)
    record_audit(
        db,
        "traveler.delete",
        actor_user_id=ctx.user_id,
        entity_type="traveler_profile",
        entity_id=pid,
        details={"family_member_id": member_id},
        request=request,
    )
    db.commit()


def reveal_passport(db: Session, ctx: AuthContext, member_id: str, request: Request | None) -> PassportReveal:
    _get_member(db, member_id)
    if not ctx.recently_reauthenticated:
        record_audit(
            db,
            "traveler.passport_reveal",
            actor_user_id=ctx.user_id,
            entity_type="family_member",
            entity_id=member_id,
            outcome="denied",
            details={"reason": "reauth_required"},
            request=request,
            commit=True,
        )
        raise ForbiddenError("נדרש אימות סיסמה מחדש לצפייה במספר הדרכון", code="REAUTH_REQUIRED")
    profile = _get_profile(db, member_id)
    number = _dec(profile.passport_number_enc)
    if not number:
        raise NotFoundError("לא נשמר מספר דרכון", code="PASSPORT_NOT_FOUND")
    record_audit(
        db,
        "traveler.passport_reveal",
        actor_user_id=ctx.user_id,
        entity_type="family_member",
        entity_id=member_id,
        request=request,
    )
    db.commit()
    return PassportReveal(passport_number=number)
