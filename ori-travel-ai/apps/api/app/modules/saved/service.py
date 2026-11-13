"""Per-user shortlist of offers."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import ConflictError, NotFoundError
from app.models.search import Offer, SavedOffer
from app.models.trips import Trip
from app.modules.providers.errors import UnprocessableError
from app.modules.saved.schemas import SavedOfferCreate, SavedOfferOut, SavedOfferUpdate
from app.schemas.offers import CanonicalOffer


def _out(row: SavedOffer, offer_row: Offer) -> SavedOfferOut:
    offer = CanonicalOffer.model_validate({**offer_row.data, "id": offer_row.id})
    expires = offer.source.expires_at
    return SavedOfferOut(
        id=row.id,
        offer_id=row.offer_id,
        category=offer.category,
        note=row.note,
        trip_id=row.trip_id,
        is_expired=bool(expires and expires < utcnow()),
        created_at=row.created_at,
        offer=offer,
    )


def _check_trip(db: Session, trip_id: str | None) -> None:
    if trip_id is not None and db.get(Trip, trip_id) is None:
        raise UnprocessableError("הטיול שנבחר לא נמצא", details=[{"field": "trip_id", "message": "טיול לא קיים"}])


def list_saved(db: Session, user_id: str, category: str | None) -> list[SavedOfferOut]:
    stmt = (
        select(SavedOffer, Offer)
        .join(Offer, Offer.id == SavedOffer.offer_id)
        .where(SavedOffer.user_id == user_id)
        .order_by(SavedOffer.created_at.desc(), SavedOffer.id)
    )
    if category:
        stmt = stmt.where(Offer.category == category)
    return [_out(s, o) for s, o in db.execute(stmt).all()]


def _own(db: Session, user_id: str, saved_id: str) -> SavedOffer:
    row = db.get(SavedOffer, saved_id) if saved_id and len(saved_id) <= 64 else None
    # Other users' rows are indistinguishable from missing ones
    if row is None or row.user_id != user_id:
        raise NotFoundError("ההצעה השמורה לא נמצאה", code="SAVED_OFFER_NOT_FOUND")
    return row


def create_saved(db: Session, user_id: str, body: SavedOfferCreate) -> SavedOfferOut:
    offer_row = db.get(Offer, body.offer_id)
    if offer_row is None:
        raise NotFoundError("ההצעה לא נמצאה", code="OFFER_NOT_FOUND")
    _check_trip(db, body.trip_id)
    exists = db.scalar(select(SavedOffer.id).where(SavedOffer.user_id == user_id, SavedOffer.offer_id == body.offer_id))
    if exists:
        raise ConflictError("ההצעה כבר שמורה ברשימה שלך", code="ALREADY_SAVED")
    row = SavedOffer(user_id=user_id, offer_id=body.offer_id, note=body.note, trip_id=body.trip_id)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError("ההצעה כבר שמורה ברשימה שלך", code="ALREADY_SAVED") from None
    return _out(row, offer_row)


def update_saved(db: Session, user_id: str, saved_id: str, body: SavedOfferUpdate) -> SavedOfferOut:
    row = _own(db, user_id, saved_id)
    fields = body.model_fields_set
    if "trip_id" in fields:
        _check_trip(db, body.trip_id)
        row.trip_id = body.trip_id
    if "note" in fields:
        row.note = body.note
    db.commit()
    return _out(row, db.get(Offer, row.offer_id))  # type: ignore[arg-type]


def delete_saved(db: Session, user_id: str, saved_id: str) -> None:
    row = _own(db, user_id, saved_id)
    db.delete(row)
    db.commit()
