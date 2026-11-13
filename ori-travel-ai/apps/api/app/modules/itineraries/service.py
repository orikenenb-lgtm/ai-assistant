"""Trips and trip items: CRUD, validation, offer snapshots, day grouping, summaries."""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.audit import record_audit
from app.core.db import utcnow
from app.core.errors import ConflictError, NotFoundError
from app.core.money import from_minor, to_minor
from app.models._common import new_id
from app.models.auth import User
from app.models.family import FamilyMember
from app.models.trips import Trip, TripItem, TripTraveler
from app.modules.itineraries.overlaps import find_overlaps, overlaps_for
from app.modules.itineraries.schemas import (
    CurrencyTotal,
    DayOut,
    OverlapOut,
    TravelerOut,
    TripCreate,
    TripDetail,
    TripItemCreate,
    TripItemOut,
    TripItemUpdate,
    TripSummary,
    TripUpdate,
)
from app.modules.providers.errors import UnprocessableError
from app.modules.search.service import get_offer
from app.schemas.common import Money
from app.schemas.offers import ActivityDetails, CanonicalOffer, CarDetails, FlightDetails, HotelDetails

log = logging.getLogger("ori.trips")

HOTEL_CHECK_IN = time(15, 0)
HOTEL_CHECK_OUT = time(11, 0)
DEFAULT_ACTIVITY_START = time(9, 0)


# ---------------- time zone helpers ----------------


def validate_timezone(name: str | None) -> str | None:
    if name is None:
        return None
    name = name.strip()
    if not name:
        return None
    try:
        ZoneInfo(name)
    except Exception:  # ZoneInfoNotFoundError, ValueError, OSError
        raise UnprocessableError(
            "אזור הזמן אינו תקין (נדרש שם IANA, למשל Europe/Rome)",
            details=[{"field": "timezone", "message": "אזור זמן לא מוכר"}],
        ) from None
    return name


def zone_of(*names: str | None) -> tzinfo:
    """First usable IANA zone among ``names``; UTC when none is known."""
    for n in names:
        if n:
            try:
                return ZoneInfo(n)
            except Exception:  # noqa: S112 - fall through to the next candidate
                continue
    return UTC


def to_utc(dt: datetime, fallback_zone: tzinfo) -> datetime:
    """Aware datetimes are converted; naive ones are read as wall-clock time in ``fallback_zone``."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=fallback_zone)
    return dt.astimezone(UTC)


def item_local_date(item: TripItem, trip: Trip) -> date | None:
    if item.start_at is None:
        return None
    return item.start_at.astimezone(zone_of(item.timezone, trip.timezone)).date()


# ---------------- money / snapshot helpers ----------------


def _money(minor: int | None, currency: str | None) -> Money | None:
    if minor is None or not currency:
        return None
    return Money(amount=from_minor(minor, currency), currency=currency)


def snapshot_mode(snapshot: dict | None) -> str | None:
    if not snapshot:
        return None
    return ((snapshot.get("source") or {}).get("mode")) or None


def snapshot_expired(snapshot: dict | None, now: datetime | None = None) -> bool:
    if not snapshot:
        return False
    raw = (snapshot.get("source") or {}).get("expires_at")
    if not raw:
        return False
    try:
        exp = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=UTC)
    return exp < (now or utcnow())


def item_out(item: TripItem, trip: Trip, overlaps: list[OverlapOut] | None = None) -> TripItemOut:
    """``overlaps`` = all trip overlaps (``trip_detail`` passes them in); computed here when omitted."""
    snap = item.offer_snapshot
    if overlaps is None:
        overlaps = find_overlaps(trip.items)
    return TripItemOut(
        id=item.id,
        trip_id=item.trip_id,
        kind=item.kind,
        title=item.title,
        start_at=item.start_at,
        end_at=item.end_at,
        timezone=item.timezone,
        local_date=item_local_date(item, trip),
        location=item.location,
        latitude=item.latitude,
        longitude=item.longitude,
        offer_id=item.offer_id,
        cost=_money(item.cost_amount_minor, item.cost_currency),
        cost_status=item.cost_status,
        notes=item.notes,
        sort_order=item.sort_order,
        offer_snapshot=snap,
        data_mode=snapshot_mode(snap),  # type: ignore[arg-type]
        offer_expired=snapshot_expired(snap),
        overlaps=overlaps_for(overlaps, item.id),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


# ---------------- loading ----------------


def get_trip(db: Session, trip_id: str) -> Trip:
    trip = None
    if trip_id and len(trip_id) <= 64:
        trip = db.scalar(
            select(Trip).where(Trip.id == trip_id).options(selectinload(Trip.items), selectinload(Trip.travelers))
        )
    if trip is None:
        raise NotFoundError("הטיול לא נמצא", code="TRIP_NOT_FOUND")
    return trip


def get_item(db: Session, trip: Trip, item_id: str) -> TripItem:
    for it in trip.items:
        if it.id == item_id:
            return it
    raise NotFoundError("פריט הטיול לא נמצא", code="TRIP_ITEM_NOT_FOUND")


def _members_by_ids(db: Session, ids: list[str]) -> list[FamilyMember]:
    unique = list(dict.fromkeys(ids))
    if not unique:
        return []
    members = list(db.scalars(select(FamilyMember).where(FamilyMember.id.in_(unique))))
    found = {m.id for m in members}
    missing = [i for i in unique if i not in found]
    if missing:
        raise UnprocessableError(
            "אחד או יותר מהנוסעים אינם בני משפחה קיימים",
            details=[{"field": "traveler_ids", "message": "בן/בת משפחה לא נמצא/ה", "ids": missing}],
        )
    order = {i: n for n, i in enumerate(unique)}
    members.sort(key=lambda m: order[m.id])
    return members


# ---------------- summaries / detail ----------------


def _totals(items: list[TripItem]) -> list[CurrencyTotal]:
    acc: dict[str, dict[str, Decimal]] = defaultdict(lambda: {"known": Decimal(0), "estimate": Decimal(0)})
    for it in items:
        if it.cost_amount_minor is None or not it.cost_currency or it.cost_status not in ("known", "estimate"):
            continue
        acc[it.cost_currency][it.cost_status] += from_minor(it.cost_amount_minor, it.cost_currency)
    return [
        CurrencyTotal(currency=cur, known=v["known"], estimated=v["estimate"]) for cur, v in sorted(acc.items())
    ]


def _summary_fields(trip: Trip) -> dict:
    day_count = None
    if trip.start_date and trip.end_date:
        day_count = (trip.end_date - trip.start_date).days + 1
    return {
        "id": trip.id,
        "title": trip.title,
        "destination": trip.destination,
        "start_date": trip.start_date,
        "end_date": trip.end_date,
        "timezone": trip.timezone,
        "status": trip.status,
        "budget": _money(trip.budget_amount_minor, trip.budget_currency),
        "item_count": len(trip.items),
        "traveler_count": len(trip.travelers),
        "day_count": day_count,
        "totals": _totals(list(trip.items)),
        "has_demo_data": any(snapshot_mode(i.offer_snapshot) == "DEMO" for i in trip.items),
        "created_at": trip.created_at,
        "updated_at": trip.updated_at,
    }


def trip_summary(trip: Trip) -> TripSummary:
    return TripSummary(**_summary_fields(trip))


def group_days(trip: Trip) -> tuple[list[DayOut], list[str]]:
    """Group items by local date; items without start_at go to the unscheduled bucket."""
    by_day: dict[date, list[TripItem]] = defaultdict(list)
    unscheduled: list[TripItem] = []
    for it in trip.items:
        d = item_local_date(it, trip)
        if d is None:
            unscheduled.append(it)
        else:
            by_day[d].append(it)
    days = []
    for d in sorted(by_day):
        items = sorted(by_day[d], key=lambda i: (i.start_at, i.sort_order))
        days.append(DayOut(date=d, item_ids=[i.id for i in items]))
    unscheduled.sort(key=lambda i: i.sort_order)
    return days, [i.id for i in unscheduled]


def trip_detail(db: Session, trip: Trip) -> TripDetail:
    members = _members_by_ids(db, [t.family_member_id for t in trip.travelers]) if trip.travelers else []
    members.sort(key=lambda m: (m.display_name, m.id))
    days, unscheduled = group_days(trip)
    items = sorted(trip.items, key=lambda i: (i.sort_order, i.created_at))
    overlaps = find_overlaps(trip.items)
    return TripDetail(
        **_summary_fields(trip),
        notes=trip.notes,
        travelers=[TravelerOut.model_validate(m) for m in members],
        items=[item_out(i, trip, overlaps) for i in items],
        days=days,
        unscheduled_item_ids=unscheduled,
        overlaps=overlaps,
    )


def list_trips(db: Session) -> list[TripSummary]:
    trips = db.scalars(
        select(Trip)
        .options(selectinload(Trip.items), selectinload(Trip.travelers))
        .order_by(Trip.start_date.asc().nulls_last(), Trip.created_at.desc())
    ).all()
    return [trip_summary(t) for t in trips]


# ---------------- trip CRUD ----------------


def _check_dates(start: date | None, end: date | None) -> None:
    if start and end and end < start:
        raise UnprocessableError(
            "תאריך הסיום חייב להיות אחרי תאריך ההתחלה",
            details=[{"field": "end_date", "message": "תאריך הסיום לפני תאריך ההתחלה"}],
        )


def create_trip(db: Session, user: User, body: TripCreate, request: Request | None = None) -> Trip:
    _check_dates(body.start_date, body.end_date)
    tz = validate_timezone(body.timezone)
    members = _members_by_ids(db, body.traveler_ids)
    trip = Trip(
        title=body.title,
        destination=(body.destination or "").strip() or None,
        start_date=body.start_date,
        end_date=body.end_date,
        timezone=tz,
        status=body.status,
        notes=body.notes,
        created_by_id=user.id,
    )
    if body.budget is not None:
        trip.budget_amount_minor = to_minor(body.budget.amount, body.budget.currency)
        trip.budget_currency = body.budget.currency
    db.add(trip)
    db.flush()
    for m in members:
        db.add(TripTraveler(trip_id=trip.id, family_member_id=m.id))
    record_audit(db, "trip.create", actor_user_id=user.id, entity_type="trip", entity_id=trip.id, request=request)
    db.commit()
    return get_trip(db, trip.id)


def update_trip(db: Session, user: User, trip: Trip, body: TripUpdate, request: Request | None = None) -> Trip:
    fields = body.model_fields_set
    if "title" in fields and body.title is None:
        raise UnprocessableError("כותרת הטיול אינה יכולה להיות ריקה")
    if "status" in fields and body.status is None:
        raise UnprocessableError("סטטוס הטיול אינו יכול להיות ריק")
    start = body.start_date if "start_date" in fields else trip.start_date
    end = body.end_date if "end_date" in fields else trip.end_date
    _check_dates(start, end)
    if "timezone" in fields:
        trip.timezone = validate_timezone(body.timezone)
    if "title" in fields:
        trip.title = body.title  # type: ignore[assignment]
    if "destination" in fields:
        trip.destination = (body.destination or "").strip() or None
    if "notes" in fields:
        trip.notes = body.notes
    if "status" in fields:
        trip.status = body.status  # type: ignore[assignment]
    trip.start_date, trip.end_date = start, end
    if "budget" in fields:
        if body.budget is None:
            trip.budget_amount_minor = None
            trip.budget_currency = None
        else:
            trip.budget_amount_minor = to_minor(body.budget.amount, body.budget.currency)
            trip.budget_currency = body.budget.currency
    if "traveler_ids" in fields:
        members = _members_by_ids(db, body.traveler_ids or [])
        wanted = {m.id for m in members}
        for t in list(trip.travelers):
            if t.family_member_id not in wanted:
                trip.travelers.remove(t)
        have = {t.family_member_id for t in trip.travelers}
        for m in members:
            if m.id not in have:
                trip.travelers.append(TripTraveler(trip_id=trip.id, family_member_id=m.id))
    trip.updated_at = utcnow()
    record_audit(db, "trip.update", actor_user_id=user.id, entity_type="trip", entity_id=trip.id, request=request)
    db.commit()
    return get_trip(db, trip.id)


def delete_trip(db: Session, user: User, trip: Trip, request: Request | None = None) -> None:
    trip_id = trip.id
    db.delete(trip)
    record_audit(db, "trip.delete", actor_user_id=user.id, entity_type="trip", entity_id=trip_id, request=request)
    db.commit()


# ---------------- items ----------------


def _validate_item_state(
    *, start_at: datetime | None, end_at: datetime | None, cost: Money | None, cost_status: str
) -> None:
    if start_at and end_at and end_at < start_at:
        raise UnprocessableError(
            "זמן הסיום חייב להיות אחרי זמן ההתחלה",
            details=[{"field": "end_at", "message": "זמן הסיום לפני זמן ההתחלה"}],
        )
    if end_at and not start_at:
        raise UnprocessableError(
            "לא ניתן להגדיר זמן סיום ללא זמן התחלה",
            details=[{"field": "end_at", "message": "חסר זמן התחלה"}],
        )
    if cost_status == "known" and cost is None:
        raise UnprocessableError(
            "עלות במצב ״ידוע״ מחייבת סכום ומטבע",
            details=[{"field": "cost", "message": "חסרים סכום ומטבע"}],
        )


def _next_sort_order(trip: Trip) -> int:
    return max((i.sort_order for i in trip.items), default=-1) + 1


@dataclass
class _Candidate:
    """An item that is about to be saved (not in the session yet)."""

    id: str
    kind: str
    title: str
    start_at: datetime | None
    end_at: datetime | None


def _enforce_no_overlap(
    trip: Trip, candidates: list, *, allow: bool, replacing: str | None = None, only_new: bool = False
) -> None:
    """Raise 409 ITEM_OVERLAP when saving ``candidates`` creates a forbidden overlap and ``allow`` is false.

    ``only_new`` (updates): ignore pairs that already overlapped before the edit.
    """
    if allow:
        return
    existing = [i for i in trip.items if i.id != replacing]
    ids = {c.id for c in candidates}
    found = [o for o in find_overlaps([*existing, *candidates]) if o.item_id in ids or o.other_item_id in ids]
    if only_new and replacing:
        before = {
            frozenset((o.item_id, o.other_item_id))
            for o in find_overlaps(trip.items)
            if replacing in (o.item_id, o.other_item_id)
        }
        found = [o for o in found if frozenset((o.item_id, o.other_item_id)) not in before]
    if not found:
        return
    titles = {i.id: i.title for i in [*existing, *candidates]}
    details = []
    for o in found:
        other = o.other_item_id if o.item_id in ids else o.item_id
        d = o.model_dump()
        d["conflicts_with_item_id"] = other
        d["conflicts_with_title"] = titles.get(other)
        details.append(d)
    raise ConflictError(
        "הפריט חופף בזמן לפריט אחר בטיול: " + found[0].message,
        code="ITEM_OVERLAP",
        details=details,
    )


def create_item(db: Session, user: User, trip: Trip, body: TripItemCreate, request: Request | None = None) -> TripItem:
    tz = validate_timezone(body.timezone)
    fallback = zone_of(tz, trip.timezone)
    start = to_utc(body.start_at, fallback) if body.start_at else None
    end = to_utc(body.end_at, fallback) if body.end_at else None
    _validate_item_state(start_at=start, end_at=end, cost=body.cost, cost_status=body.cost_status)
    new_item_id = new_id()
    _enforce_no_overlap(
        trip,
        [_Candidate(new_item_id, body.kind, body.title, start, end)],
        allow=body.allow_overlap,
    )
    item = TripItem(
        id=new_item_id,
        trip_id=trip.id,
        kind=body.kind,
        title=body.title,
        start_at=start,
        end_at=end,
        timezone=tz,
        location=body.location,
        latitude=body.latitude,
        longitude=body.longitude,
        cost_status=body.cost_status,
        notes=body.notes,
        sort_order=_next_sort_order(trip),
        created_by_id=user.id,
    )
    if body.cost is not None:
        item.cost_amount_minor = to_minor(body.cost.amount, body.cost.currency)
        item.cost_currency = body.cost.currency
    trip.items.append(item)
    trip.updated_at = utcnow()
    db.flush()
    record_audit(db, "trip.item.create", actor_user_id=user.id, entity_type="trip_item", entity_id=item.id, request=request)
    db.commit()
    return item


def update_item(
    db: Session, user: User, trip: Trip, item: TripItem, body: TripItemUpdate, request: Request | None = None
) -> TripItem:
    fields = body.model_fields_set
    for required in ("kind", "title", "cost_status"):
        if required in fields and getattr(body, required) is None:
            raise UnprocessableError("שדה חובה אינו יכול להיות ריק", details=[{"field": required, "message": "שדה חובה"}])
    tz = validate_timezone(body.timezone) if "timezone" in fields else item.timezone
    fallback = zone_of(tz, trip.timezone)
    start = (to_utc(body.start_at, fallback) if body.start_at else None) if "start_at" in fields else item.start_at
    end = (to_utc(body.end_at, fallback) if body.end_at else None) if "end_at" in fields else item.end_at
    if "cost" in fields:
        cost = body.cost
    else:
        cost = _money(item.cost_amount_minor, item.cost_currency)
    status = body.cost_status if "cost_status" in fields else item.cost_status
    _validate_item_state(start_at=start, end_at=end, cost=cost, cost_status=status or "estimate")
    if fields & {"kind", "title", "start_at", "end_at", "timezone"}:
        _enforce_no_overlap(
            trip,
            [
                _Candidate(
                    item.id,
                    body.kind if "kind" in fields and body.kind else item.kind,
                    body.title if "title" in fields and body.title else item.title,
                    start,
                    end,
                )
            ],
            allow=body.allow_overlap,
            replacing=item.id,
            only_new=True,
        )

    if "kind" in fields:
        item.kind = body.kind  # type: ignore[assignment]
    if "title" in fields:
        item.title = body.title  # type: ignore[assignment]
    for name in ("location", "latitude", "longitude", "notes"):
        if name in fields:
            setattr(item, name, getattr(body, name))
    item.timezone = tz
    item.start_at, item.end_at = start, end
    item.cost_status = status or "estimate"
    if cost is None:
        item.cost_amount_minor = None
        item.cost_currency = None
    else:
        item.cost_amount_minor = to_minor(cost.amount, cost.currency)
        item.cost_currency = cost.currency
    item.updated_at = utcnow()
    trip.updated_at = utcnow()
    record_audit(db, "trip.item.update", actor_user_id=user.id, entity_type="trip_item", entity_id=item.id, request=request)
    db.commit()
    return item


def delete_item(db: Session, user: User, trip: Trip, item: TripItem, request: Request | None = None) -> None:
    item_id = item.id
    trip.items.remove(item)
    trip.updated_at = utcnow()
    record_audit(db, "trip.item.delete", actor_user_id=user.id, entity_type="trip_item", entity_id=item_id, request=request)
    db.commit()


def reorder_items(db: Session, trip: Trip, item_ids: list[str]) -> None:
    current = {i.id for i in trip.items}
    if len(item_ids) != len(set(item_ids)) or set(item_ids) != current:
        raise UnprocessableError(
            "רשימת הפריטים חייבת לכלול בדיוק את כל פריטי הטיול, פעם אחת כל אחד",
            details=[{"field": "item_ids", "message": "רשימה לא תואמת"}],
        )
    pos = {i: n for n, i in enumerate(item_ids)}
    for it in trip.items:
        it.sort_order = pos[it.id]
    trip.updated_at = utcnow()
    db.commit()


# ---------------- from offer ----------------


def _local_dt(day: date, at: time, zone: tzinfo) -> datetime:
    return datetime.combine(day, at).replace(tzinfo=zone).astimezone(UTC)


def _airport_tz(code: str) -> str | None:
    try:
        from app.modules.providers.data.geo import city_of_airport, get_airport

        airport = get_airport(code)
        return city_of_airport(airport).tz if airport else None
    except Exception:  # geo data is optional enrichment
        return None


def _specs_from_offer(offer: CanonicalOffer, trip: Trip) -> list[dict]:
    d = offer.details
    trip_zone = zone_of(trip.timezone)
    specs: list[dict] = []
    if isinstance(d, FlightDetails):
        for n, sl in enumerate(d.slices):
            seg0 = sl.segments[0] if sl.segments else None
            tz = _airport_tz(sl.origin)
            fallback = zone_of(tz, trip.timezone)
            label = f"טיסה {sl.origin} → {sl.destination}"
            if seg0:
                label += f" · {seg0.carrier_name} {seg0.flight_number}"
            if sl.stops:
                label += f" ({sl.stops} עצירות)"
            origin_name = (seg0.origin_name if seg0 else None) or sl.origin
            specs.append(
                {
                    "title": label,
                    "start_at": to_utc(sl.departing_at, fallback),
                    "end_at": to_utc(sl.arriving_at, fallback),
                    "timezone": tz,
                    "location": f"{origin_name} ({sl.origin})",
                    "latitude": None,
                    "longitude": None,
                    "carry_cost": n == 0,
                }
            )
    elif isinstance(d, HotelDetails):
        specs.append(
            {
                "title": d.hotel_name,
                "start_at": _local_dt(d.check_in, HOTEL_CHECK_IN, trip_zone),
                "end_at": _local_dt(d.check_out, HOTEL_CHECK_OUT, trip_zone),
                "timezone": trip.timezone,
                "location": d.address or d.city,
                "latitude": d.latitude,
                "longitude": d.longitude,
                "carry_cost": True,
            }
        )
    elif isinstance(d, CarDetails):
        loc = d.pickup_location
        if d.dropoff_location and d.dropoff_location != d.pickup_location:
            loc = f"{d.pickup_location} → {d.dropoff_location}"
        specs.append(
            {
                "title": f"השכרת רכב · {d.vendor} ({d.car_class})",
                "start_at": to_utc(d.pickup_at, trip_zone),
                "end_at": to_utc(d.dropoff_at, trip_zone),
                "timezone": trip.timezone,
                "location": loc,
                "latitude": None,
                "longitude": None,
                "carry_cost": True,
            }
        )
    elif isinstance(d, ActivityDetails):
        start = end = None
        note = None
        if d.available_dates:
            day = min(d.available_dates)
            at = DEFAULT_ACTIVITY_START
            if d.start_times:
                try:
                    hh, mm = d.start_times[0].split(":")[:2]
                    at = time(int(hh), int(mm))
                except (ValueError, IndexError):
                    note = "שעת התחלה לא זוהתה — נקבעה שעה משוערת 09:00"
            else:
                note = "שעת התחלה לא צוינה — נקבעה שעה משוערת 09:00"
            start = _local_dt(day, at, trip_zone)
            if d.duration_minutes:
                end = start + timedelta(minutes=d.duration_minutes)
        specs.append(
            {
                "title": d.name,
                "start_at": start,
                "end_at": end,
                "timezone": trip.timezone,
                "location": d.meeting_point or d.city,
                "latitude": d.latitude,
                "longitude": d.longitude,
                "carry_cost": True,
                "notes": note,
            }
        )
    return specs


def add_items_from_offer(
    db: Session, user: User, trip: Trip, offer_id: str, request: Request | None = None, allow_overlap: bool = False
) -> list[TripItem]:
    offer = get_offer(db, offer_id)
    specs = _specs_from_offer(offer, trip)
    if not specs:
        raise UnprocessableError("לא ניתן להוסיף את ההצעה לטיול")
    snapshot = offer.model_dump(mode="json")
    snapshot["snapshot_at"] = utcnow().isoformat()
    total = offer.price.total
    cost_status = "estimate" if offer.price.total_status == "estimated" else "known"
    kind = offer.category
    created: list[TripItem] = []
    order = _next_sort_order(trip)
    for n, spec in enumerate(specs):
        item = TripItem(
            trip_id=trip.id,
            kind=kind,
            title=spec["title"][:300],
            start_at=spec["start_at"],
            end_at=spec["end_at"],
            timezone=spec["timezone"],
            location=(spec["location"] or None) and spec["location"][:300],
            latitude=spec["latitude"],
            longitude=spec["longitude"],
            offer_id=offer.id,
            offer_snapshot=snapshot,
            sort_order=order + n,
            notes=spec.get("notes"),
            created_by_id=user.id,
        )
        if spec["carry_cost"]:
            item.cost_amount_minor = to_minor(total.amount, total.currency)
            item.cost_currency = total.currency
            item.cost_status = cost_status
        else:
            item.cost_status = "excluded"
            item.notes = "המחיר מופיע בפריט הראשון של אותה הצעה (מחיר כולל לכל הטיסות)"
        item.id = new_id()
        created.append(item)
    _enforce_no_overlap(
        trip,
        [_Candidate(i.id, i.kind, i.title, i.start_at, i.end_at) for i in created],
        allow=allow_overlap,
    )
    for item in created:
        trip.items.append(item)
    trip.updated_at = utcnow()
    db.flush()
    record_audit(
        db,
        "trip.item.from_offer",
        actor_user_id=user.id,
        entity_type="trip",
        entity_id=trip.id,
        details={"offer_id": offer.id, "category": offer.category, "items": len(created)},
        request=request,
    )
    db.commit()
    return created
