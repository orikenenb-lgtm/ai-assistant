"""Booking safety: state machine, terms binding, step-up approval, idempotent simulated submission,
UNKNOWN/reconcile, hosted checkout, roles, CSRF, concurrency, audit. No network."""

from __future__ import annotations

import copy
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select, update

from app.core.config import get_settings, reset_settings_cache
from app.core.db import utcnow
from app.core.errors import BadRequestError, ConflictError
from app.core.money import CURRENCY_SYMBOLS
from app.core.ratelimit import limiter
from app.models import Approval, AuditEvent, BookingIntent, FamilyMember, Notification, Offer, Reservation
from app.models.booking import BOOKING_STATES, SimulatedSupplierBooking
from app.modules.booking import mock_supplier, service
from app.modules.booking import state_machine as sm
from app.modules.booking.terms import build_terms_summary, canonical_terms, compute_terms_hash
from app.modules.providers import registry
from app.modules.providers import service as provider_service
from app.modules.providers.base import BookingOptions, RevalidationResult
from app.modules.providers.demo.hotels import DemoStayPlusAdapter
from tests.conftest import DEFAULT_PASSWORD

TODAY = date.today()


def future(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


FLIGHT = {"origin": "TLV", "destination": "LCA", "depart_date": future(25), "return_date": future(29), "adults": 1}
HOTEL = {"destination": "אתונה", "check_in": future(25), "check_out": future(28), "rooms": [{"adults": 1}]}
B = "/api/bookings"


# ------------------------------------------------------------------ helpers ----


def offers(c, category="flight", body=None) -> list[dict]:
    limiter.reset()
    res = c.post(f"/api/search/{category}", json=body or FLIGHT)
    assert res.status_code == 200, res.text
    return res.json()["offers"]


def member_id(db, c) -> str:
    return db.scalar(select(FamilyMember.id).where(FamilyMember.user_id == c.user.id))


def add_member(db, name="ילדה", age_group="child") -> str:
    m = FamilyMember(display_name=name, age_group=age_group, is_minor=age_group != "adult")
    db.add(m)
    db.commit()
    return m.id


def create(c, db, *, scenario=None, n=0, category="flight", body=None, **extra) -> dict:
    offer = offers(c, category, body)[n]
    payload = {"offer_id": offer["id"], "traveler_member_ids": [member_id(db, c)], **extra}
    if scenario:
        payload["simulation_scenario"] = scenario
    res = c.post(B, json=payload)
    assert res.status_code == 201, res.text
    return res.json()


def get(c, bid) -> dict:
    res = c.get(f"{B}/{bid}")
    assert res.status_code == 200, res.text
    return res.json()


def revalidate(c, bid) -> dict:
    res = c.post(f"{B}/{bid}/revalidate")
    assert res.status_code == 200, res.text
    return res.json()


def approve(c, bid, terms_hash=None, password=DEFAULT_PASSWORD):
    limiter.reset()  # the step-up throttle is exercised explicitly in its own test
    terms_hash = terms_hash or get(c, bid)["terms_hash"]
    return c.post(f"{B}/{bid}/approve", json={"terms_hash": terms_hash, "password": password, "confirm": True})


def submit(c, bid, key=None):
    return c.post(f"{B}/{bid}/submit", json={"idempotency_key": key or str(uuid.uuid4())})


def approved(c, db, **kw) -> dict:
    b = create(c, db, **kw)
    assert revalidate(c, b["id"])["state"] == "READY_FOR_APPROVAL"
    res = approve(c, b["id"])
    assert res.status_code == 200, res.text
    return res.json()


def err(res, status, code):
    assert res.status_code == status, res.text
    assert res.json()["error"]["code"] == code, res.text
    return res.json()["error"]


def sql(db, stmt):
    db.execute(stmt)
    db.commit()


def state_of(db, bid) -> str:
    db.expire_all()
    return db.scalar(select(BookingIntent.state).where(BookingIntent.id == bid))


def count(db, model, **filters) -> int:
    db.expire_all()
    return db.query(model).filter_by(**filters).count()


# ------------------------------------------------------ state machine (unit) ----


def test_transition_table_matches_spec_exactly():
    assert sm.TRANSITIONS == {
        "DRAFT": {"QUOTE_SELECTED", "CANCELLED"},
        "QUOTE_SELECTED": {"REVALIDATING", "CANCELLED", "EXPIRED"},
        "REVALIDATING": {"READY_FOR_APPROVAL", "QUOTE_SELECTED", "EXPIRED", "FAILED"},
        "READY_FOR_APPROVAL": {"APPROVED", "QUOTE_SELECTED", "CANCELLED", "EXPIRED"},
        "APPROVED": {"SUBMITTING", "QUOTE_SELECTED", "READY_FOR_APPROVAL", "CANCELLED", "EXPIRED"},
        "SUBMITTING": {"CONFIRMED", "FAILED", "UNKNOWN"},
        "UNKNOWN": {"CONFIRMED", "FAILED"},
        "CONFIRMED": set(),
        "EXPIRED": set(),
        "FAILED": set(),
        "CANCELLED": set(),
    }
    assert sm.TERMINAL_STATES == {"CONFIRMED", "EXPIRED", "FAILED", "CANCELLED"}


def _raw_intent(db, state: str) -> BookingIntent:
    intent = BookingIntent(category="flight", provider_id="demo", offer_snapshot={}, travelers=[],
                           quoted_amount_minor=100, current_amount_minor=100, currency="USD", history=[])
    db.add(intent)
    db.commit()
    sql(db, update(BookingIntent).where(BookingIntent.id == intent.id).values(state=state))
    db.refresh(intent)
    return intent


@pytest.mark.parametrize("source", BOOKING_STATES)
def test_every_transition_outside_the_table_is_rejected(db, source):
    for target in BOOKING_STATES:
        intent = _raw_intent(db, source)
        if target in sm.TRANSITIONS[source]:
            sm.transition(db, intent, target, action="test", actor_user_id=None, reason="r")
            db.commit()
            assert intent.state == target
            assert intent.history[-1]["from"] == source and intent.history[-1]["to"] == target
            assert intent.history[-1]["reason"] == "r" and intent.history[-1]["at"]
        else:
            with pytest.raises(ConflictError) as exc:
                sm.transition(db, intent, target, action="test", actor_user_id=None)
            assert exc.value.code == "INVALID_TRANSITION" and exc.value.status_code == 409
            assert intent.state == source and intent.history == []


def test_state_cannot_be_assigned_outside_the_state_machine(db):
    intent = _raw_intent(db, "QUOTE_SELECTED")
    with pytest.raises(sm.DirectStateAssignmentError):
        intent.state = "CONFIRMED"
    with pytest.raises(sm.DirectStateAssignmentError):
        setattr(intent, "state", "APPROVED")  # noqa: B010
    with pytest.raises(sm.DirectStateAssignmentError):
        BookingIntent(state="CONFIRMED")
    assert state_of(db, intent.id) == "QUOTE_SELECTED"


# ------------------------------------------------------------- terms (unit) ----


TA = {"family_member_id": "a", "display_name": "אבא", "age_group": "adult"}
TB = {"family_member_id": "b", "display_name": "אמא", "age_group": "adult"}


def _hash(snap, travelers, amount, cur, mode="SIMULATION"):
    return compute_terms_hash(snap, travelers, amount, cur, mode)


def test_terms_hash_binds_material_fields_only(auth_client):
    c = auth_client("owner")
    snap = offers(c)[0]
    amount, cur = 12345, snap["price"]["total"]["currency"]
    base = _hash(snap, [TA, TB], amount, cur)
    assert len(base) == 64 and base == _hash(snap, [TB, TA], amount, cur)

    volatile = copy.deepcopy(snap)
    volatile["source"]["fetched_at"] = "2030-01-01T00:00:00Z"
    volatile["source"]["expires_at"] = "2030-01-01T00:30:00Z"
    volatile["score"] = None
    volatile["subtitle"] = "טקסט שיווקי"
    assert _hash(volatile, [TA, TB], amount, cur) == base

    def mutated(fn):
        m = copy.deepcopy(snap)
        fn(m)
        return _hash(m, [TA, TB], amount, cur)

    changes = [
        lambda m: m["source"].__setitem__("provider_id", "other"),
        lambda m: m["source"].__setitem__("supplier_offer_id", "X"),
        lambda m: m["details"].__setitem__("fare_brand", "other-brand"),
        lambda m: m["details"]["baggage"].__setitem__("checked_included", 7),
        lambda m: m["details"]["slices"][0].__setitem__("departing_at", "2031-01-01T00:00:00+02:00"),
        lambda m: m["details"]["slices"][0]["segments"][0].__setitem__("flight_number", "9999"),
        lambda m: m["cancellation"].__setitem__("refundable", not m["cancellation"].get("refundable")),
        # AUD-01: every line the approver reads is bound
        lambda m: m.__setitem__("title", "הצעה אחרת לגמרי"),
        lambda m: m["price"].__setitem__("excluded_notes", ["מס עירוני בתשלום במקום"]),
        lambda m: m["price"].__setitem__("total_status", "estimated"),
        lambda m: m["details"]["slices"][0].__setitem__("stops", 3),
        lambda m: m["source"].__setitem__("provider_name", "ספק אחר"),
        lambda m: m["details"]["slices"][0]["segments"].append(dict(m["details"]["slices"][0]["segments"][0], flight_number="77")),
        lambda m: m["cancellation"].__setitem__("policy_text", "נוסח חדש"),
    ]
    hashes = {mutated(fn) for fn in changes}
    assert base not in hashes and len(hashes) == len(changes)
    assert _hash(snap, [TA], amount, cur) != base
    assert _hash(snap, [TA, {**TB, "display_name": "שם אחר"}], amount, cur) != base
    assert _hash(snap, [TA, TB], amount + 1, cur) != base
    assert _hash(snap, [TA, TB], amount, "EUR" if cur != "EUR" else "USD") != base
    assert _hash(snap, [TA, TB], amount, cur, "HOSTED_CHECKOUT") != base
    # the hash covers exactly the lines shown to the approver
    for line in build_terms_summary(snap, [TA, TB], amount, cur, "SIMULATION"):
        assert line in canonical_terms(snap, [TB, TA], amount, cur, "SIMULATION")["summary"]


@pytest.mark.parametrize(("category", "body"), [
    ("flight", FLIGHT),
    ("hotel", HOTEL),
    ("car", {"pickup_location": "ATH", "pickup_at": f"{future(25)}T10:00:00", "dropoff_at": f"{future(28)}T10:00:00"}),
    ("activity", {"destination": "ATH", "date_from": future(25), "date_to": future(27), "adults": 1}),
])
def test_terms_summary_is_hebrew_and_complete_for_every_category(auth_client, db, category, body):
    c = auth_client("owner")
    b = create(c, db, category=category, body=body)
    lines = b["terms_summary"]
    text = "\n".join(lines)
    assert lines[0].startswith("מה מזמינים:")
    assert f"נוסעים (1): {c.user.display_name}" in text
    currency = b["current_price"]["currency"]
    assert "מחיר כולל:" in text and (CURRENCY_SYMBOLS.get(currency) or currency) in text
    # BUG-QA-03: no raw enum values / ISO codes next to a symbol inside the Hebrew lines
    assert f"{currency} (" not in text and "None" not in text and "True" not in text
    for raw in ("economy", "business", "room_only", "midsize", "compact", "automatic"):
        assert raw not in text.replace(b["offer"]["source"]["supplier_offer_id"], "")
    assert "או דומה או דומה" not in text
    assert "ביטול:" in text and "ספק:" in text and "סימולציה בלבד" in text
    assert lines == build_terms_summary(b["offer"], b["travelers"], round(Decimal(b["current_price"]["amount"]) * 100),
                                        b["current_price"]["currency"], "SIMULATION") or b["current_price"]["currency"] in ("JPY", "KRW")
    assert b["is_simulation"] is True and b["execution_mode"] == "SIMULATION" and b["category"] == category


# --------------------------------------------------------------- happy path ----


def test_happy_path_to_confirmed_with_reference_history_audit_and_notifications(auth_client, db):
    c = auth_client("owner")
    other = auth_client("adult")
    b = create(c, db)
    bid = b["id"]
    assert b["state"] == "QUOTE_SELECTED" and b["simulation_scenario"] == "success"
    assert b["quoted_price"] == b["current_price"] == b["offer"]["price"]["total"]
    assert isinstance(b["current_price"]["amount"], str) and b["price_changed"] is False
    assert b["can"] == {"edit_travelers": True, "revalidate": True, "approve": False, "submit": False,
                        "reconcile": False, "cancel": True, "record_confirmation": False, "open_checkout": False}
    assert b["approval"] is None and b["supplier_reference"] is None and b["created_by"] == c.user.display_name

    r = revalidate(c, bid)
    assert r["state"] == "READY_FOR_APPROVAL" and r["revalidation_fresh"] and r["can"]["approve"] and not r["can"]["submit"]
    assert r["terms_hash"] == b["terms_hash"] and r["notice"]

    res = approve(c, bid, r["terms_hash"])
    assert res.status_code == 200, res.text
    a = res.json()
    assert a["state"] == "APPROVED" and a["can"]["submit"] and not a["can"]["approve"]
    assert a["approval"]["valid"] is True and a["approval"]["approved_by"] == c.user.display_name
    assert a["approval"]["terms_hash"] == r["terms_hash"] and a["approval"]["amount"] == a["current_price"]
    ttl = get_settings().approval_ttl_minutes
    approval = db.query(Approval).one()
    assert timedelta(minutes=ttl - 1) < approval.expires_at - approval.created_at <= timedelta(minutes=ttl)
    assert "מחיר כולל" in approval.summary and "סימולציה" in approval.summary

    res = submit(c, bid)
    assert res.status_code == 200, res.text
    s = res.json()
    assert s["state"] == "CONFIRMED" and s["supplier_reference"].startswith("SIM-") and len(s["supplier_reference"]) == 10
    assert s["reservation"]["mode"] == "SIMULATION" and s["reservation"]["supplier_reference"] == s["supplier_reference"]
    assert s["reservation"]["amount"] == s["current_price"] and s["approval"]["consumed_at"] and not s["approval"]["valid"]
    assert not any(s["can"].values()) and s["idempotent_replay"] is False
    assert any("ספק מדומה" in w for w in s["warnings"])

    assert [(h["from"], h["to"]) for h in s["history"]] == [
        ("DRAFT", "QUOTE_SELECTED"), ("QUOTE_SELECTED", "REVALIDATING"), ("REVALIDATING", "READY_FOR_APPROVAL"),
        ("READY_FOR_APPROVAL", "APPROVED"), ("APPROVED", "SUBMITTING"), ("SUBMITTING", "CONFIRMED"),
    ]
    assert all(h["by"] == c.user.id and h["by_name"] == c.user.display_name and h["at"] for h in s["history"])

    actions = [e.action for e in db.query(AuditEvent).filter_by(entity_id=bid).order_by(AuditEvent.created_at)]
    for expected in ("booking.create", "booking.select_quote", "booking.revalidate_start", "booking.revalidate",
                     "booking.approve", "booking.submit", "booking.confirm"):
        assert expected in actions, expected
    assert DEFAULT_PASSWORD not in str([e.details for e in db.query(AuditEvent).all()])

    assert count(db, Reservation) == 1 and count(db, SimulatedSupplierBooking, status="CONFIRMED") == 1
    notes = db.query(Notification).filter_by(user_id=other.user.id).all()
    assert len(notes) == 2 and all(n.link == f"/bookings/{bid}" and n.kind == "booking" for n in notes)
    assert count(db, Notification, user_id=c.user.id) == 0

    listing = other.get(B, params={"state": "CONFIRMED"}).json()
    assert listing["total"] == 1 and listing["items"][0]["id"] == bid
    assert listing["items"][0]["supplier_reference"] == s["supplier_reference"]
    assert other.get(B, params={"state": "APPROVED"}).json()["total"] == 0
    assert other.get(B, params={"state": "NOPE"}).status_code == 400


def test_create_validation(auth_client, db):
    c = auth_client("owner")
    offer_id = offers(c)[0]["id"]
    me = member_id(db, c)
    err(c.post(B, json={"offer_id": "missing", "traveler_member_ids": [me]}), 404, "OFFER_NOT_FOUND")
    err(c.post(B, json={"offer_id": offer_id, "traveler_member_ids": ["nobody"]}), 400, "TRAVELER_NOT_FOUND")
    err(c.post(B, json={"offer_id": offer_id, "traveler_member_ids": [me], "trip_id": "nope"}), 404, "TRIP_NOT_FOUND")
    for bad in ([], [me, me], [f"m{i}" for i in range(10)]):
        assert c.post(B, json={"offer_id": offer_id, "traveler_member_ids": bad}).status_code == 422
    res = c.post(B, json={"offer_id": offer_id, "traveler_member_ids": [me], "simulation_scenario": "free_money"})
    assert res.status_code == 422
    assert count(db, BookingIntent) == 0
    # minors may travel; an authorized adult prepares the booking
    kid = add_member(db)
    family = offers(c, body={**FLIGHT, "children_ages": [6]})[0]
    b = c.post(B, json={"offer_id": family["id"], "traveler_member_ids": [me, kid]}).json()
    assert [t["is_minor"] for t in b["travelers"]] == [False, True] and b["travelers_count"] == 2
    assert not any("תומחרה" in w for w in b["warnings"])


def test_traveler_composition_must_match_the_offer(auth_client, db):
    """AUD-04: nobody can be booked on a price quoted for a different party."""
    c = auth_client("owner")
    me, adult2 = member_id(db, c), add_member(db, "סבתא", "adult")
    kid, kid2, baby = add_member(db), add_member(db, "ילד"), add_member(db, "תינוקת", "infant")

    def refuse(offer, ids):
        e = err(c.post(B, json={"offer_id": offer["id"], "traveler_member_ids": ids}), 400, "TRAVELER_MISMATCH")
        assert e["details"]["selected"] and e["message"]
        return e

    two_adults = offers(c, body={**FLIGHT, "adults": 2})[0]
    e = refuse(two_adults, [kid, baby])  # the audited case: 2 adults quoted, child + infant booked
    assert "2 מבוגרים" in e["message"] and "1 ילדים" in e["message"] and e["details"]["expected"] == {"adult": 2, "child": 0, "infant": 0}
    for ids in ([me], [me, kid], [me, adult2, kid], [me, baby]):
        refuse(two_adults, ids)
    ok = c.post(B, json={"offer_id": two_adults["id"], "traveler_member_ids": [me, adult2]})
    assert ok.status_code == 201, ok.text
    bid = ok.json()["id"]
    revalidate(c, bid)
    assert approve(c, bid).json()["state"] == "APPROVED"
    # PATCH enforces the same rule and leaves the approval untouched when it refuses
    for ids in ([me, kid], [kid, baby], [me], [me, adult2, kid]):
        err(c.patch(f"{B}/{bid}/travelers", json={"traveler_member_ids": ids}), 400, "TRAVELER_MISMATCH")
    g = get(c, bid)
    assert g["state"] == "APPROVED" and g["approval"]["valid"] and g["travelers_count"] == 2

    with_infant = offers(c, body={**FLIGHT, "children_ages": [6, 1]})[0]
    assert with_infant["details"]["passengers"] == {"adult": 1, "child": 1, "infant": 1}
    refuse(with_infant, [me, kid, kid2])
    assert c.post(B, json={"offer_id": with_infant["id"], "traveler_member_ids": [baby, kid, me]}).status_code == 201

    hotel = offers(c, "hotel", {**HOTEL, "rooms": [{"adults": 2, "children_ages": [4]}]})[0]
    e = refuse(hotel, [me, adult2])
    assert "2 מבוגרים ו-1 ילדים" in e["message"]
    refuse(hotel, [me, kid, kid2])
    assert c.post(B, json={"offer_id": hotel["id"], "traveler_member_ids": [me, adult2, baby]}).status_code == 201

    activity = offers(c, "activity", {"destination": "ATH", "date_from": future(25), "date_to": future(27), "adults": 2})[0]
    refuse(activity, [me])
    refuse(activity, [me, kid])
    assert c.post(B, json={"offer_id": activity["id"], "traveler_member_ids": [me, adult2]}).status_code == 201

    car = offers(c, "car", {"pickup_location": "ATH", "pickup_at": f"{future(25)}T10:00:00",
                            "dropoff_at": f"{future(28)}T10:00:00"})[0]
    e = refuse(car, [kid, kid2])
    assert "מבוגר אחד" in e["message"]
    assert c.post(B, json={"offer_id": car["id"], "traveler_member_ids": [me, kid, baby]}).status_code == 201
    assert count(db, AuditEvent, action="booking.create", outcome="denied") == 11


def test_composition_rules_unit():
    def t(*groups):
        return [{"family_member_id": str(i), "age_group": g} for i, g in enumerate(groups)]

    flight = {"kind": "flight", "passengers": {"adult": 0, "child": 0, "infant": 1}}
    for details, travelers in [
        (flight, t("infant")),  # an infant always needs an adult, even if the offer says otherwise
        ({"kind": "flight", "passengers": {"adult": 1, "senior": 1}}, t("adult")),
        ({"kind": "flight", "passengers": {}}, t("adult")),
        ({"kind": "activity", "participants": {}}, t("child")),
        ({"kind": "car"}, t("adult", "teen")),
        ({"kind": "something-new"}, t("child")),
    ]:
        with pytest.raises(BadRequestError) as exc:
            service._validate_composition(details, travelers)
        assert exc.value.code == "TRAVELER_MISMATCH"
    service._validate_composition({"kind": "activity", "participants": {}}, t("adult", "child"))
    service._validate_composition({"kind": "car"}, t("adult"))


def test_create_rejects_expired_offer(auth_client, db):
    c = auth_client("owner")
    offer = offers(c)[0]
    row = db.get(Offer, offer["id"])
    data = copy.deepcopy(row.data)
    data["source"]["expires_at"] = (utcnow() - timedelta(minutes=1)).isoformat()
    row.data = data
    db.commit()
    e = err(c.post(B, json={"offer_id": offer["id"], "traveler_member_ids": [member_id(db, c)]}), 409, "OFFER_EXPIRED")
    assert e["details"] == {"reason": "EXPIRED"} and count(db, BookingIntent) == 0
    assert count(db, AuditEvent, action="booking.create", outcome="denied") == 1


# ------------------------------------------------------ invalid transitions ----


def _in_state(c, db, state: str) -> str:
    if state == "QUOTE_SELECTED":
        return create(c, db)["id"]
    if state == "READY_FOR_APPROVAL":
        b = create(c, db)
        revalidate(c, b["id"])
        return b["id"]
    if state == "APPROVED":
        return approved(c, db)["id"]
    if state == "CONFIRMED":
        b = approved(c, db)
        assert submit(c, b["id"]).json()["state"] == "CONFIRMED"
        return b["id"]
    if state == "FAILED":
        b = approved(c, db, scenario="supplier_failure")
        assert submit(c, b["id"]).json()["state"] == "FAILED"
        return b["id"]
    if state == "UNKNOWN":
        b = approved(c, db, scenario="timeout_unknown")
        assert submit(c, b["id"]).json()["state"] == "UNKNOWN"
        return b["id"]
    if state == "CANCELLED":
        b = create(c, db)
        assert c.post(f"{B}/{b['id']}/cancel", json={"reason": "התחרטנו"}).json()["state"] == "CANCELLED"
        return b["id"]
    if state == "EXPIRED":
        b = create(c, db, scenario="expired")
        assert revalidate(c, b["id"])["state"] == "EXPIRED"
        return b["id"]
    raise AssertionError(state)


def _attempts(c, db, bid) -> dict:
    limiter.reset()
    h = get(c, bid)["terms_hash"]
    return {
        "travelers": lambda: c.patch(f"{B}/{bid}/travelers", json={"traveler_member_ids": [add_member(db, "מבוגר", "adult")]}),
        "revalidate": lambda: c.post(f"{B}/{bid}/revalidate"),
        "approve": lambda: approve(c, bid, h),
        "submit": lambda: submit(c, bid),
        "reconcile": lambda: c.post(f"{B}/{bid}/reconcile"),
        "cancel": lambda: c.post(f"{B}/{bid}/cancel", json={}),
        "record": lambda: c.post(f"{B}/{bid}/record-confirmation", json={"supplier_reference": "ABC-1234"}),
        "checkout": lambda: c.post(f"{B}/{bid}/checkout-link"),
    }


ALL = ("travelers", "revalidate", "approve", "submit", "reconcile", "cancel", "record", "checkout")
FORBIDDEN_BY_STATE = {
    "QUOTE_SELECTED": ("approve", "submit", "reconcile", "record", "checkout"),
    "READY_FOR_APPROVAL": ("submit", "reconcile", "record", "checkout"),
    "APPROVED": ("approve", "reconcile", "record", "checkout"),
    "CONFIRMED": ALL,
    "FAILED": ALL,
    "CANCELLED": ALL,
    "EXPIRED": ALL,
    "UNKNOWN": tuple(a for a in ALL if a != "reconcile"),
}


@pytest.mark.parametrize("state", FORBIDDEN_BY_STATE)
def test_invalid_actions_are_rejected_in_every_state(auth_client, db, state):
    c = auth_client("owner")
    bid = _in_state(c, db, state)
    before = get(c, bid)
    for name in FORBIDDEN_BY_STATE[state]:
        res = _attempts(c, db, bid)[name]()
        assert res.status_code == 409, (state, name, res.text)
        code = res.json()["error"]["code"]
        if name in ("record", "checkout"):
            assert code == "NOT_HOSTED_CHECKOUT"
        elif state == "UNKNOWN":
            assert code == "RECONCILE_REQUIRED", (name, code)
        elif state == "CONFIRMED" and name == "cancel":
            assert code == "CANCEL_WITH_SUPPLIER" and "הספק" in res.json()["error"]["message"]
        else:
            assert code == "INVALID_TRANSITION", (state, name, code)
    after = get(c, bid)
    assert after["state"] == state and after["history"] == before["history"]
    assert after["supplier_reference"] == before["supplier_reference"] and after["version"] == before["version"]
    assert count(db, Reservation) == (1 if state == "CONFIRMED" else 0)
    assert count(db, AuditEvent, entity_id=bid, outcome="denied") == len(FORBIDDEN_BY_STATE[state])


def test_cancel_from_each_pre_submission_state(auth_client, db):
    c = auth_client("owner")
    for state in ("QUOTE_SELECTED", "READY_FOR_APPROVAL", "APPROVED"):
        bid = _in_state(c, db, state)
        out = c.post(f"{B}/{bid}/cancel").json()
        assert out["state"] == "CANCELLED" and not any(out["can"].values())
        if state == "APPROVED":
            assert out["approval"]["valid"] is False and out["approval"]["invalidated_at"]
            err(submit(c, bid), 409, "INVALID_TRANSITION")
    assert count(db, SimulatedSupplierBooking) == 0


# ------------------------------------------------------------------ approve ----


def test_approve_rejects_stale_or_mismatched_terms_hash(auth_client, db):
    c = auth_client("owner")
    b = create(c, db)
    revalidate(c, b["id"])
    err(approve(c, b["id"], "0" * 64), 409, "TERMS_CHANGED")
    assert c.post(f"{B}/{b['id']}/approve", json={"terms_hash": "short", "password": DEFAULT_PASSWORD,
                                                  "confirm": True}).status_code == 422
    for confirm in (False, None, "yes"):
        res = c.post(f"{B}/{b['id']}/approve", json={"terms_hash": b["terms_hash"], "password": DEFAULT_PASSWORD,
                                                     "confirm": confirm})
        assert res.status_code == 422
    assert c.post(f"{B}/{b['id']}/approve", json={"terms_hash": b["terms_hash"], "password": DEFAULT_PASSWORD}).status_code == 422
    # the stored hash no longer matches the stored terms (tampering / missed recompute) -> refuse
    sql(db, update(BookingIntent).where(BookingIntent.id == b["id"]).values(current_amount_minor=1))
    err(approve(c, b["id"], b["terms_hash"]), 409, "TERMS_CHANGED")
    assert state_of(db, b["id"]) == "READY_FOR_APPROVAL" and count(db, Approval) == 0


def test_approve_wrong_password_and_throttling(auth_client, db):
    c = auth_client("owner")
    b = create(c, db)
    revalidate(c, b["id"])
    body = {"terms_hash": b["terms_hash"], "password": "wrong-password", "confirm": True}
    limiter.reset()
    for _ in range(5):
        err(c.post(f"{B}/{b['id']}/approve", json=body), 401, "REAUTH_FAILED")
    # throttled now — even the correct password is refused
    err(c.post(f"{B}/{b['id']}/approve", json={**body, "password": DEFAULT_PASSWORD}), 429, "RATE_LIMITED")
    assert state_of(db, b["id"]) == "READY_FOR_APPROVAL" and count(db, Approval) == 0
    assert count(db, AuditEvent, action="auth.reauth", outcome="failure") == 5
    assert count(db, AuditEvent, action="booking.approve", outcome="denied") == 6
    assert c.get("/api/auth/me").status_code == 200  # the session survives a failed step-up


def test_approve_requires_recent_revalidation(auth_client, db):
    c = auth_client("owner")
    b = create(c, db)
    revalidate(c, b["id"])
    sql(db, update(BookingIntent).where(BookingIntent.id == b["id"]).values(revalidated_at=utcnow() - timedelta(minutes=16)))
    g = get(c, b["id"])
    assert g["can"]["approve"] is False and g["revalidation_fresh"] is False and any("עדכנית" in w for w in g["warnings"])
    err(approve(c, b["id"]), 409, "REVALIDATION_REQUIRED")
    assert revalidate(c, b["id"])["state"] == "READY_FOR_APPROVAL"
    assert approve(c, b["id"]).json()["state"] == "APPROVED"


def test_approval_is_per_user_password_not_shared(auth_client, db):
    owner = auth_client("owner")
    adult = auth_client("adult", password="Another-Passw0rd-9")
    b = create(owner, db)
    revalidate(owner, b["id"])
    err(approve(adult, b["id"], b["terms_hash"], DEFAULT_PASSWORD), 401, "REAUTH_FAILED")
    out = approve(adult, b["id"], b["terms_hash"], "Another-Passw0rd-9").json()
    assert out["state"] == "APPROVED" and out["approval"]["approved_by_id"] == adult.user.id
    assert count(db, Notification, user_id=owner.user.id) == 1


# ------------------------------------------------------------------- submit ----


def test_submit_without_approval_is_rejected(auth_client, db):
    c = auth_client("owner")
    b = create(c, db)
    err(submit(c, b["id"]), 409, "INVALID_TRANSITION")
    revalidate(c, b["id"])
    err(submit(c, b["id"]), 409, "INVALID_TRANSITION")
    # APPROVED state without any usable approval row (e.g. tampered data) must not submit either
    bid = approved(c, db, n=1)["id"]
    sql(db, update(Approval).where(Approval.booking_intent_id == bid).values(invalidated_at=utcnow()))
    err(submit(c, bid), 409, "APPROVAL_EXPIRED")
    assert state_of(db, bid) == "READY_FOR_APPROVAL"
    assert count(db, SimulatedSupplierBooking) == 0 and count(db, Reservation) == 0


def test_submit_with_expired_approval_requires_new_approval(auth_client, db):
    c = auth_client("owner")
    bid = approved(c, db)["id"]
    sql(db, update(Approval).values(expires_at=utcnow() - timedelta(seconds=1)))
    g = get(c, bid)
    assert g["approval"]["valid"] is False and g["can"]["submit"] is False and any("תוקף האישור" in w for w in g["warnings"])
    err(submit(c, bid), 409, "APPROVAL_EXPIRED")
    g = get(c, bid)
    assert g["state"] == "READY_FOR_APPROVAL" and g["approval"]["invalidated_at"] and count(db, SimulatedSupplierBooking) == 0
    assert approve(c, bid).json()["state"] == "APPROVED"
    assert submit(c, bid).json()["state"] == "CONFIRMED"
    assert count(db, Approval) == 2 and count(db, Reservation) == 1


def test_revalidate_demotes_lapsed_approval(auth_client, db):
    c = auth_client("owner")
    bid = approved(c, db)["id"]
    sql(db, update(Approval).values(expires_at=utcnow() - timedelta(seconds=1)))
    out = revalidate(c, bid)
    assert out["state"] == "READY_FOR_APPROVAL" and out["approval"]["valid"] is False and out["can"]["approve"]


def test_submit_approval_bound_to_other_terms_is_refused(auth_client, db):
    c = auth_client("owner")
    bid = approved(c, db)["id"]
    sql(db, update(Approval).values(terms_hash="f" * 64))
    err(submit(c, bid), 409, "TERMS_CHANGED")
    assert state_of(db, bid) == "QUOTE_SELECTED" and count(db, SimulatedSupplierBooking) == 0
    bid = approved(c, db, n=1)["id"]
    sql(db, update(Approval).where(Approval.booking_intent_id == bid).values(approved_amount_minor=1))
    err(submit(c, bid), 409, "TERMS_CHANGED")
    assert count(db, SimulatedSupplierBooking) == 0


def test_idempotent_double_submit_creates_exactly_one_reservation(auth_client, db):
    c = auth_client("owner")
    bid = approved(c, db)["id"]
    key = str(uuid.uuid4())
    first = submit(c, bid, key).json()
    second = submit(c, bid, key)
    assert second.status_code == 200
    again = second.json()
    assert again["idempotent_replay"] is True and first["idempotent_replay"] is False
    for field in ("state", "supplier_reference", "reservation", "history", "current_price", "version"):
        assert again[field] == first[field], field
    assert submit(c, bid, key.upper()).json()["supplier_reference"] == first["supplier_reference"]
    assert count(db, Reservation) == 1 and count(db, SimulatedSupplierBooking) == 1
    assert count(db, AuditEvent, action="booking.submit") == 1 and count(db, AuditEvent, action="booking.submit_replay") == 2
    # a different key cannot re-run a finished booking
    err(submit(c, bid), 409, "INVALID_TRANSITION")
    assert count(db, Reservation) == 1 and count(db, SimulatedSupplierBooking) == 1


def test_same_idempotency_key_on_another_intent_conflicts(auth_client, db):
    c = auth_client("owner")
    first = approved(c, db)["id"]
    second = approved(c, db, n=1)["id"]
    key = str(uuid.uuid4())
    assert submit(c, first, key).json()["state"] == "CONFIRMED"
    err(submit(c, second, key), 409, "IDEMPOTENCY_KEY_REUSED")
    g = get(c, second)
    assert g["state"] == "APPROVED" and g["approval"]["valid"] and g["supplier_reference"] is None
    assert count(db, Reservation) == 1 and count(db, SimulatedSupplierBooking) == 1
    # the supplier ledger alone also blocks reuse (e.g. our own key column was lost)
    sql(db, update(BookingIntent).where(BookingIntent.id == first).values(idempotency_key=None))
    err(submit(c, second, key), 409, "IDEMPOTENCY_KEY_REUSED")
    assert submit(c, second).json()["state"] == "CONFIRMED"
    assert count(db, Reservation) == 2


@pytest.mark.parametrize("key", ["", "abc", "x" * 36, "12345678123456781234567812345678", "{" + str(uuid.uuid4())[1:-1] + "}",
                                 None, 5])
def test_idempotency_key_must_be_a_uuid(auth_client, db, key):
    c = auth_client("owner")
    bid = approved(c, db)["id"]
    assert c.post(f"{B}/{bid}/submit", json={"idempotency_key": key}).status_code == 422
    assert c.post(f"{B}/{bid}/submit", json={}).status_code == 422
    assert state_of(db, bid) == "APPROVED"


def test_supplier_failure_scenario(auth_client, db):
    c = auth_client("owner")
    other = auth_client("adult")
    bid = approved(c, db, scenario="supplier_failure")["id"]
    key = str(uuid.uuid4())
    out = submit(c, bid, key).json()
    assert out["state"] == "FAILED" and out["supplier_reference"] is None and out["reservation"] is None
    assert "כשל ספק" in out["failure_reason"] and not any(out["can"].values())
    assert count(db, Reservation) == 0 and count(db, SimulatedSupplierBooking, status="REJECTED") == 1
    assert submit(c, bid, key).json()["state"] == "FAILED"  # replay
    err(c.post(f"{B}/{bid}/reconcile"), 409, "INVALID_TRANSITION")
    titles = [n.title for n in db.query(Notification).filter_by(user_id=other.user.id)]
    assert "ההזמנה נכשלה" in titles


def test_timeout_unknown_blocks_until_reconciled(auth_client, db):
    c = auth_client("owner")
    other = auth_client("adult")
    bid = approved(c, db, scenario="timeout_unknown")["id"]
    key = str(uuid.uuid4())
    out = submit(c, bid, key).json()
    assert out["state"] == "UNKNOWN" and out["supplier_reference"] is None and out["reservation"] is None
    assert out["can"] == {**dict.fromkeys(out["can"], False), "reconcile": True}
    # the supplier DID create the booking — we just do not know it yet
    assert count(db, SimulatedSupplierBooking, status="CONFIRMED") == 1 and count(db, Reservation) == 0
    assert any("נדרש בירור" in n.body for n in db.query(Notification).filter_by(user_id=other.user.id))

    err(submit(c, bid), 409, "RECONCILE_REQUIRED")
    err(approve(c, bid), 409, "RECONCILE_REQUIRED")
    err(c.post(f"{B}/{bid}/revalidate"), 409, "RECONCILE_REQUIRED")
    err(c.post(f"{B}/{bid}/cancel"), 409, "RECONCILE_REQUIRED")
    replay = submit(c, bid, key).json()  # same key: no re-execution, still UNKNOWN
    assert replay["state"] == "UNKNOWN" and replay["idempotent_replay"] is True
    assert count(db, SimulatedSupplierBooking) == 1

    done = c.post(f"{B}/{bid}/reconcile").json()
    assert done["state"] == "CONFIRMED" and done["supplier_reference"].startswith("SIM-")
    assert done["supplier_reference"] == db.query(SimulatedSupplierBooking).one().reference
    assert done["reservation"]["mode"] == "SIMULATION" and done["failure_reason"] is None
    assert [(h["from"], h["to"]) for h in done["history"]][-3:] == [
        ("APPROVED", "SUBMITTING"), ("SUBMITTING", "UNKNOWN"), ("UNKNOWN", "CONFIRMED")]
    assert count(db, Reservation) == 1 and count(db, AuditEvent, action="booking.reconcile", outcome="success") == 1
    err(c.post(f"{B}/{bid}/reconcile"), 409, "INVALID_TRANSITION")
    assert count(db, Reservation) == 1


def test_reconcile_without_supplier_record_fails_the_booking(auth_client, db):
    c = auth_client("owner")
    bid = approved(c, db, scenario="timeout_unknown")["id"]
    submit(c, bid)
    sql(db, SimulatedSupplierBooking.__table__.delete())
    out = c.post(f"{B}/{bid}/reconcile").json()
    assert out["state"] == "FAILED" and out["supplier_reference"] is None and count(db, Reservation) == 0


def test_interrupted_submission_is_never_retried(auth_client, db):
    """A crash between "SUBMITTING committed" and the supplier answer must end in UNKNOWN, not a second send."""
    c = auth_client("owner")
    bid = approved(c, db)["id"]
    key = str(uuid.uuid4())
    sql(db, update(BookingIntent).where(BookingIntent.id == bid).values(state="SUBMITTING", idempotency_key=key))
    err(submit(c, bid), 409, "INVALID_TRANSITION")
    out = submit(c, bid, key).json()
    assert out["state"] == "UNKNOWN" and count(db, SimulatedSupplierBooking) == 0
    assert c.post(f"{B}/{bid}/reconcile").json()["state"] == "FAILED"


def test_supplier_crash_during_submission_becomes_unknown(auth_client, db, monkeypatch):
    c = auth_client("owner")
    bid = approved(c, db)["id"]

    def boom(*_a, **_k):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(mock_supplier, "create_booking", boom)
    out = submit(c, bid).json()
    assert out["state"] == "UNKNOWN" and out["supplier_reference"] is None and count(db, Reservation) == 0


def test_confirmed_is_impossible_without_reference(db):
    intent = _raw_intent(db, "SUBMITTING")
    for ref in (None, "", "   "):
        with pytest.raises(RuntimeError):
            service._confirm(db, intent, ref, "SIMULATION", None, None, action="confirm", reason="x")
    db.rollback()
    assert state_of(db, intent.id) == "SUBMITTING" and count(db, Reservation) == 0


# --------------------------------------------- price change / expiry / errors ----


def test_price_change_scenario_blocks_submit_and_requires_reapproval(auth_client, db):
    c = auth_client("owner")
    b = approved(c, db, scenario="price_change")
    bid, old_hash, old_price = b["id"], b["terms_hash"], b["current_price"]
    e = err(submit(c, bid), 409, "PRICE_CHANGED")
    new_amount = Decimal(e["details"]["new_price"]["amount"])
    assert e["details"]["old_price"] == old_price and new_amount > Decimal(old_price["amount"])
    assert count(db, SimulatedSupplierBooking) == 0 and count(db, Reservation) == 0

    g = get(c, bid)
    assert g["state"] == "QUOTE_SELECTED" and g["price_changed"] is True and g["terms_hash"] != old_hash
    assert g["quoted_price"] == old_price and Decimal(g["current_price"]["amount"]) == new_amount
    assert g["offer"]["price"]["total"] == g["current_price"]
    assert g["approval"]["valid"] is False and "המחיר השתנה" in g["approval"]["invalidation_reason"]
    assert g["can"]["submit"] is False and g["can"]["approve"] is False and any("המחיר השתנה" in w for w in g["warnings"])
    assert g["supplier_reference"] is None and g["history"][-1]["from"] == "APPROVED"
    assert count(db, AuditEvent, action="booking.price_changed") == 1
    assert count(db, AuditEvent, action="booking.approval_invalidated") == 1

    err(submit(c, bid), 409, "INVALID_TRANSITION")
    err(approve(c, bid, g["terms_hash"]), 409, "INVALID_TRANSITION")  # must re-check the price first
    r = revalidate(c, bid)
    assert r["state"] == "READY_FOR_APPROVAL" and r["current_price"] == g["current_price"]
    err(approve(c, bid, old_hash), 409, "TERMS_CHANGED")  # approving what was seen BEFORE the change
    a = approve(c, bid, r["terms_hash"]).json()
    assert a["state"] == "APPROVED" and a["approval"]["amount"] == g["current_price"]
    s = submit(c, bid).json()
    assert s["state"] == "CONFIRMED" and s["reservation"]["amount"] == g["current_price"] and s["price_changed"] is True
    assert count(db, Reservation) == 1 and count(db, Approval) == 2


def test_explicit_revalidate_after_approval(auth_client, db):
    c = auth_client("owner")
    ok = approved(c, db)
    out = revalidate(c, ok["id"])  # unchanged price: the approval survives
    assert out["state"] == "APPROVED" and out["approval"]["valid"] is True and out["approval"]["id"] == ok["approval"]["id"]
    changed = approved(c, db, scenario="price_change", n=1)
    out = revalidate(c, changed["id"])
    assert out["state"] == "QUOTE_SELECTED" and out["price_changed"] and out["approval"]["valid"] is False
    assert "המחיר השתנה" in out["notice"] and "בוטל" in out["notice"]
    assert revalidate(c, changed["id"])["state"] == "READY_FOR_APPROVAL"  # the change happens once


def test_expired_scenario_and_local_quote_expiry(auth_client, db):
    c = auth_client("owner")
    b = create(c, db, scenario="expired")
    out = revalidate(c, b["id"])
    assert out["state"] == "EXPIRED" and out["failure_reason"] and not any(out["can"].values())
    assert [(h["from"], h["to"]) for h in out["history"]][-1] == ("REVALIDATING", "EXPIRED")

    # the stored quote lapsed: ANY attempt to move the intent turns it EXPIRED
    for name in ("travelers", "approve", "submit", "cancel"):
        bid = approved(c, db, n=1)["id"] if name == "submit" else _in_state(c, db, "READY_FOR_APPROVAL")
        sql(db, update(BookingIntent).where(BookingIntent.id == bid).values(offer_expires_at=utcnow() - timedelta(seconds=5)))
        g = get(c, bid)
        assert g["offer_expired"] is True and not any(g["can"].values()) and g["state"] != "EXPIRED"  # GET never mutates
        err(_attempts(c, db, bid)[name](), 409, "OFFER_EXPIRED")
        g = get(c, bid)
        assert g["state"] == "EXPIRED" and (g["approval"] is None or g["approval"]["valid"] is False), name
    bid = _in_state(c, db, "QUOTE_SELECTED")
    sql(db, update(BookingIntent).where(BookingIntent.id == bid).values(offer_expires_at=utcnow() - timedelta(seconds=5)))
    assert revalidate(c, bid)["state"] == "EXPIRED"
    assert count(db, SimulatedSupplierBooking) == 0


def test_provider_error_never_advances_or_submits(auth_client, db, monkeypatch):
    c = auth_client("owner")
    b = create(c, db)
    ready_id = _in_state(c, db, "READY_FOR_APPROVAL")
    approved_id = approved(c, db, n=1)["id"]

    def broken(_db, _offer):
        raise RuntimeError("provider exploded with secret=abc")

    monkeypatch.setattr(provider_service, "revalidate_offer", broken)
    out = revalidate(c, b["id"])
    assert out["state"] == "QUOTE_SELECTED" and out["revalidated_at"] is None and out["notice"].startswith("אזהרה")
    assert "secret" not in out["notice"]
    assert [(h["from"], h["to"]) for h in out["history"]][-2:] == [
        ("QUOTE_SELECTED", "REVALIDATING"), ("REVALIDATING", "QUOTE_SELECTED")]
    assert revalidate(c, ready_id)["state"] == "READY_FOR_APPROVAL"
    assert revalidate(c, approved_id)["state"] == "APPROVED"
    e = err(submit(c, approved_id), 503, "REVALIDATION_FAILED")
    assert "לא נשלחה" in e["message"]
    g = get(c, approved_id)
    assert g["state"] == "APPROVED" and g["approval"]["valid"] and g["approval"]["consumed_at"] is None
    assert count(db, SimulatedSupplierBooking) == 0
    assert count(db, AuditEvent, action="booking.revalidate", outcome="failure") == 3

    # an "error" status object from the provider layer behaves the same way
    monkeypatch.setattr(provider_service, "revalidate_offer", lambda _db, offer: RevalidationResult(
        status="error", offer_id=offer.id, checked_at=utcnow(), message="הספק אינו זמין"))
    assert revalidate(c, b["id"])["state"] == "QUOTE_SELECTED"


def test_unchanged_answer_with_different_terms_is_treated_as_change(auth_client, db, monkeypatch):
    """A supplier that says "unchanged" but returns different terms must not keep the approval alive."""
    c = auth_client("owner")
    b = approved(c, db)

    def sneaky(_db, offer):
        cancellation = offer.cancellation.model_copy(update={"refundable": not offer.cancellation.refundable,
                                                             "policy_text": "ללא החזר"})
        return RevalidationResult(status="unchanged", offer_id=offer.id, checked_at=utcnow(), message="ללא שינוי",
                                  new_total=offer.price.total, refreshed_offer=offer.model_copy(update={"cancellation": cancellation}))

    monkeypatch.setattr(provider_service, "revalidate_offer", sneaky)
    err(submit(c, b["id"]), 409, "TERMS_CHANGED")
    g = get(c, b["id"])
    assert g["state"] == "QUOTE_SELECTED" and g["approval"]["valid"] is False and g["terms_hash"] != b["terms_hash"]
    assert g["price_changed"] is False and count(db, SimulatedSupplierBooking) == 0

    # inconsistent answer (new_total disagrees with the refreshed offer) -> treated as a provider error
    def inconsistent(_db, offer):
        total = offer.price.total.model_copy(update={"amount": offer.price.total.amount + 1})
        return RevalidationResult(status="unchanged", offer_id=offer.id, checked_at=utcnow(), message="x",
                                  new_total=total, refreshed_offer=offer)

    monkeypatch.setattr(provider_service, "revalidate_offer", inconsistent)
    out = revalidate(c, b["id"])
    assert out["state"] == "QUOTE_SELECTED" and out["notice"].startswith("אזהרה") and out["revalidated_at"] is None


def test_provider_reported_price_change_before_approval(auth_client, db):
    c = auth_client("owner")
    b = create(c, db)
    registry.get_adapter(b["provider_id"]).set_revalidation_override(b["offer"]["source"]["supplier_offer_id"], "price_changed")
    out = revalidate(c, b["id"])
    assert out["state"] == "QUOTE_SELECTED" and out["price_changed"] and out["terms_hash"] != b["terms_hash"]
    assert Decimal(out["current_price"]["amount"]) > Decimal(out["quoted_price"]["amount"]) and out["approval"] is None
    registry.get_adapter(b["provider_id"]).set_revalidation_override(b["offer"]["source"]["supplier_offer_id"], "unavailable")
    assert revalidate(c, b["id"])["state"] == "EXPIRED"


# ---------------------------------------------------------------- travelers ----


def test_travelers_change_invalidates_approval(auth_client, db):
    c = auth_client("owner")
    b = approved(c, db)
    bid, me, other = b["id"], member_id(db, c), add_member(db, "דודה", "adult")
    same = c.patch(f"{B}/{bid}/travelers", json={"traveler_member_ids": [me]}).json()
    assert same["state"] == "APPROVED" and same["approval"]["valid"] is True  # not a change

    out = c.patch(f"{B}/{bid}/travelers", json={"traveler_member_ids": [other]})
    assert out.status_code == 200, out.text
    out = out.json()
    assert out["state"] == "QUOTE_SELECTED" and out["terms_hash"] != b["terms_hash"] and out["travelers_count"] == 1
    assert out["approval"]["valid"] is False and "הנוסעים" in out["approval"]["invalidation_reason"]
    assert out["revalidated_at"] is None and "נוסעים (1): דודה" in "\n".join(out["terms_summary"])
    err(submit(c, bid), 409, "INVALID_TRANSITION")
    revalidate(c, bid)
    err(approve(c, bid, b["terms_hash"]), 409, "TERMS_CHANGED")
    assert approve(c, bid).json()["state"] == "APPROVED"

    err(c.patch(f"{B}/{bid}/travelers", json={"traveler_member_ids": ["ghost"]}), 400, "TRAVELER_NOT_FOUND")
    for bad in ([], [me, me], [f"m{i}" for i in range(10)]):
        assert c.patch(f"{B}/{bid}/travelers", json={"traveler_member_ids": bad}).status_code == 422
    assert state_of(db, bid) == "APPROVED"
    assert count(db, AuditEvent, action="booking.travelers_changed", outcome="success") == 1


# ------------------------------------------------------- LIVE / hosted checkout ----


class LiveStub(DemoStayPlusAdapter):
    """Fake LIVE provider (no network) offering a provider-hosted checkout page."""

    provider_id = "test_live_hotels"
    display_name = "ספק חי לבדיקה"
    checkout_url: str | None = "https://book.example-travel.com/checkout/abc"
    calls = 0

    def capabilities(self):
        return super().capabilities().model_copy(update={"mode": "LIVE", "deep_link_domains": ["example-travel.com"],
                                                         "supports_hosted_checkout": True})

    def booking_options(self, offer):
        type(self).calls += 1
        return BookingOptions(hosted_checkout_url=self.checkout_url, simulation_available=False, live_api_booking=True,
                              instructions="השלימו את ההזמנה באתר הספק")


@pytest.fixture
def live(monkeypatch, auth_client, db):
    """A LIVE offer (copied from a DEMO hotel offer) owned by a registered fake LIVE adapter."""
    monkeypatch.setenv("ORI_LIVE_PROVIDERS_ENABLED", "true")
    monkeypatch.setenv("ORI_BOOKING_LIVE_EXECUTION", "true")
    reset_settings_cache()
    assert get_settings().booking_live_execution is True
    adapter = LiveStub()
    LiveStub.checkout_url = "https://book.example-travel.com/checkout/abc"
    registry.register_adapter(adapter)
    c = auth_client("owner")
    demo = next(o for o in offers(c, "hotel", HOTEL) if o["source"]["provider_id"] == "demo_stayplus")
    src = db.get(Offer, demo["id"])
    data = copy.deepcopy(src.data)
    data["source"].update(provider_id=adapter.provider_id, provider_name=adapter.display_name, mode="LIVE", note=None)
    row = Offer(provider_id=adapter.provider_id, mode="LIVE", category="hotel", supplier_offer_id=src.supplier_offer_id,
                dedupe_key=src.dedupe_key, title=src.title, total_amount_minor=src.total_amount_minor, currency=src.currency,
                price_status=src.price_status, fetched_at=src.fetched_at, expires_at=src.expires_at, data=data)
    db.add(row)
    db.commit()
    yield c, row.id, adapter
    reset_settings_cache()


def _live_create(c, db, offer_id, **extra):
    return c.post(B, json={"offer_id": offer_id, "traveler_member_ids": [member_id(db, c)], **extra})


def test_live_offer_without_allowlisted_checkout_is_refused(live, db):
    c, offer_id, _ = live
    for url in (None, "http://book.example-travel.com/x", "https://evil.example/checkout",
                "https://example-travel.com.evil.example/x", "https://user:pw@book.example-travel.com/x", "javascript:alert(1)"):
        LiveStub.checkout_url = url
        e = err(_live_create(c, db, offer_id), 409, "BOOKING_UNAVAILABLE")
        assert "לא ניתן להכין הזמנה" in e["message"]
    assert count(db, BookingIntent) == 0
    # a LIVE-labelled offer can never ride on a DEMO adapter into simulation, and vice versa
    sql(db, update(Offer).where(Offer.id == offer_id).values(provider_id="demo_stayplus"))
    row = db.get(Offer, offer_id)
    data = copy.deepcopy(row.data)
    data["source"]["provider_id"] = "demo_stayplus"
    row.data = data
    db.commit()
    err(_live_create(c, db, offer_id), 409, "BOOKING_UNAVAILABLE")
    data["source"]["provider_id"] = "no_such_provider"
    row.data = copy.deepcopy(data)
    db.commit()
    err(_live_create(c, db, offer_id), 409, "BOOKING_UNAVAILABLE")


def test_hosted_checkout_flow_and_live_execution_always_refused(live, db):
    c, offer_id, _ = live
    err(_live_create(c, db, offer_id, simulation_scenario="success"), 400, "SCENARIO_NOT_ALLOWED")
    res = _live_create(c, db, offer_id)
    assert res.status_code == 201, res.text
    b = res.json()
    bid = b["id"]
    assert b["execution_mode"] == "HOSTED_CHECKOUT" and b["is_simulation"] is False and b["simulation_scenario"] is None
    assert any("באתר הספק" in line for line in b["terms_summary"]) and not any("סימולציה" in line for line in b["terms_summary"])

    err(c.post(f"{B}/{bid}/checkout-link"), 409, "INVALID_TRANSITION")
    err(c.post(f"{B}/{bid}/record-confirmation", json={"supplier_reference": "REAL-12345"}), 409, "INVALID_TRANSITION")
    assert revalidate(c, bid)["state"] == "READY_FOR_APPROVAL"
    err(c.post(f"{B}/{bid}/checkout-link"), 409, "INVALID_TRANSITION")
    a = approve(c, bid).json()
    assert a["state"] == "APPROVED"
    assert a["can"]["open_checkout"] and a["can"]["record_confirmation"] and a["can"]["submit"] is False

    # LIVE execution through our API is refused even though ORI_BOOKING_LIVE_EXECUTION=true
    err(submit(c, bid), 409, "USE_HOSTED_CHECKOUT")
    assert state_of(db, bid) == "APPROVED" and count(db, SimulatedSupplierBooking) == 0

    link = c.post(f"{B}/{bid}/checkout-link")
    assert link.status_code == 200, link.text
    assert link.json()["url"] == "https://book.example-travel.com/checkout/abc" and link.json()["warnings"]
    ev = db.query(AuditEvent).filter_by(action="booking.checkout_link", outcome="success").one()
    assert ev.details["host"] == "book.example-travel.com" and ev.entity_id == bid

    # the adapter starts returning a non-allowlisted URL -> never exposed
    LiveStub.checkout_url = "https://phish.example/checkout"
    err(c.post(f"{B}/{bid}/checkout-link"), 409, "CHECKOUT_LINK_UNAVAILABLE")
    assert count(db, AuditEvent, action="booking.checkout_link", outcome="denied") >= 1

    for bad in ("abc", "x" * 65, "REF 123", "REF_123", "<script>", "ref;drop", ""):
        assert c.post(f"{B}/{bid}/record-confirmation", json={"supplier_reference": bad}).status_code == 422
    assert c.post(f"{B}/{bid}/record-confirmation", json={"supplier_reference": "REAL-12345", "state": "CONFIRMED"}).status_code == 422
    done = c.post(f"{B}/{bid}/record-confirmation", json={"supplier_reference": "REAL-12345", "notes": "שולם באתר הספק"})
    assert done.status_code == 200, done.text
    d = done.json()
    assert d["state"] == "CONFIRMED" and d["supplier_reference"] == "REAL-12345"
    assert d["reservation"]["mode"] == "HOSTED_CHECKOUT" and d["reservation"]["notes"] == "שולם באתר הספק"
    assert [(h["from"], h["to"]) for h in d["history"]][-2:] == [("APPROVED", "SUBMITTING"), ("SUBMITTING", "CONFIRMED")]
    err(c.post(f"{B}/{bid}/record-confirmation", json={"supplier_reference": "REAL-99999"}), 409, "INVALID_TRANSITION")
    assert count(db, Reservation) == 1 and count(db, SimulatedSupplierBooking) == 0

    # the same supplier reference cannot confirm a second intent
    LiveStub.checkout_url = "https://book.example-travel.com/checkout/abc"
    second = _live_create(c, db, offer_id).json()["id"]
    revalidate(c, second)
    approve(c, second)
    err(c.post(f"{B}/{second}/record-confirmation", json={"supplier_reference": "REAL-12345"}), 409, "REFERENCE_ALREADY_USED")
    assert state_of(db, second) == "APPROVED"


def test_live_execution_refused_even_when_flag_and_data_say_live(live, db):
    c, _, _ = live
    assert get_settings().booking_live_execution is True
    bid = approved(c, db)["id"]
    sql(db, update(BookingIntent).where(BookingIntent.id == bid).values(execution_mode="LIVE"))
    e = err(submit(c, bid), 403, "LIVE_EXECUTION_DISABLED")
    assert "כבוי" in e["message"]
    g = get(c, bid)
    assert g["state"] == "APPROVED" and not g["can"]["submit"] and not g["is_simulation"] and g["supplier_reference"] is None
    assert any("כבוי" in w for w in g["warnings"])
    # a SIMULATION-labelled intent that actually points at a LIVE provider is refused too
    other = approved(c, db, n=1)["id"]
    sql(db, update(BookingIntent).where(BookingIntent.id == other).values(provider_id="test_live_hotels"))
    err(submit(c, other), 403, "LIVE_EXECUTION_DISABLED")
    sql(db, update(BookingIntent).where(BookingIntent.id == other).values(provider_id="gone"))
    err(submit(c, other), 403, "LIVE_EXECUTION_DISABLED")
    assert count(db, SimulatedSupplierBooking) == 0 and count(db, Reservation) == 0
    assert count(db, AuditEvent, action="booking.submit", outcome="denied") == 3
    with pytest.raises(RuntimeError):
        mock_supplier.create_booking(db, db.get(BookingIntent, bid), str(uuid.uuid4()), "success")


# ------------------------------------------------------- roles / CSRF / auth ----


def _mutations(c, bid, me):
    return [
        c.post(B, json={"offer_id": "x", "traveler_member_ids": [me]}),
        c.patch(f"{B}/{bid}/travelers", json={"traveler_member_ids": [me]}),
        c.post(f"{B}/{bid}/revalidate"),
        c.post(f"{B}/{bid}/approve", json={"terms_hash": "0" * 64, "password": DEFAULT_PASSWORD, "confirm": True}),
        c.post(f"{B}/{bid}/submit", json={"idempotency_key": str(uuid.uuid4())}),
        c.post(f"{B}/{bid}/reconcile"),
        c.post(f"{B}/{bid}/cancel", json={}),
        c.post(f"{B}/{bid}/record-confirmation", json={"supplier_reference": "REAL-12345"}),
        c.post(f"{B}/{bid}/checkout-link"),
    ]


@pytest.mark.parametrize(("role", "attested"), [("viewer", False), ("adult", False)])
def test_viewer_and_non_attested_adult_cannot_mutate(auth_client, db, role, attested):
    owner = auth_client("owner")
    bid = approved(owner, db)["id"]
    c = auth_client(role, attested=attested)
    responses = _mutations(c, bid, member_id(db, c))
    for res in responses:
        err(res, 403, "BOOKING_NOT_ALLOWED")
    assert state_of(db, bid) == "APPROVED" and count(db, BookingIntent) == 1
    assert count(db, AuditEvent, action="booking.access_denied", outcome="denied", actor_user_id=c.user.id) == len(responses)
    # reading is allowed, with every action flag off for this user
    g = get(c, bid)
    assert g["state"] == "APPROVED" and not any(g["can"].values())
    assert c.get(B).json()["total"] == 1
    assert get(owner, bid)["can"]["submit"] is True


def test_csrf_and_authentication_are_enforced(auth_client, client, db):
    c = auth_client("owner")
    bid = approved(c, db)["id"]
    token = c.headers.pop("X-CSRF-Token")
    for res in _mutations(c, bid, member_id(db, c)):
        err(res, 403, "CSRF_FAILED")
    c.headers["X-CSRF-Token"] = "wrong"
    err(submit(c, bid), 403, "CSRF_FAILED")
    assert state_of(db, bid) == "APPROVED" and count(db, SimulatedSupplierBooking) == 0
    c.headers["X-CSRF-Token"] = token
    for res in [*_mutations(client, bid, "m"), client.get(B), client.get(f"{B}/{bid}")]:
        assert res.status_code == 401
    assert c.get(f"{B}/nope").status_code == 404


def test_no_endpoint_accepts_a_state(auth_client, db, app):
    c = auth_client("owner")
    b = create(c, db)
    bid, me = b["id"], member_id(db, c)
    assert c.post(B, json={"offer_id": b["offer_id"], "traveler_member_ids": [me], "state": "CONFIRMED"}).status_code == 422
    assert c.post(B, json={"offer_id": b["offer_id"], "traveler_member_ids": [me], "execution_mode": "LIVE"}).status_code == 422
    assert c.patch(f"{B}/{bid}/travelers", json={"traveler_member_ids": [me], "state": "APPROVED"}).status_code == 422
    assert c.post(f"{B}/{bid}/cancel", json={"state": "CONFIRMED"}).status_code == 422
    assert c.post(f"{B}/{bid}/submit", json={"idempotency_key": str(uuid.uuid4()), "supplier_reference": "X"}).status_code == 422
    for method in ("PATCH", "PUT", "DELETE", "POST"):
        assert c.request(method, f"{B}/{bid}", json={"state": "CONFIRMED"}).status_code in (404, 405)
    c.post(f"{B}/{bid}/revalidate", json={"state": "CONFIRMED", "supplier_reference": "SIM-HACKED"})  # body is ignored
    assert state_of(db, bid) == "READY_FOR_APPROVAL" and get(c, bid)["supplier_reference"] is None
    routes = {(m.upper(), path) for path, ops in app.openapi()["paths"].items() if path.startswith(B) for m in ops}
    assert routes == {
        ("POST", B), ("GET", B), ("GET", B + "/{booking_id}"), ("PATCH", B + "/{booking_id}/travelers"),
        ("POST", B + "/{booking_id}/revalidate"), ("POST", B + "/{booking_id}/approve"),
        ("POST", B + "/{booking_id}/submit"), ("POST", B + "/{booking_id}/reconcile"),
        ("POST", B + "/{booking_id}/cancel"), ("POST", B + "/{booking_id}/record-confirmation"),
        ("POST", B + "/{booking_id}/checkout-link"),
    }


# -------------------------------------------------------------- concurrency ----


def test_concurrent_update_is_rejected_with_409(auth_client, db, monkeypatch):
    c = auth_client("owner")
    bid = approved(c, db)["id"]
    original = service._invalidate_approvals

    def racing(*args, **kwargs):
        # another request commits a change to the same intent while this one is in flight
        sql(db, update(BookingIntent).where(BookingIntent.id == bid).values(version=BookingIntent.version + 1))
        return original(*args, **kwargs)

    monkeypatch.setattr(service, "_invalidate_approvals", racing)
    err(c.post(f"{B}/{bid}/cancel"), 409, "CONCURRENT_UPDATE")
    monkeypatch.setattr(service, "_invalidate_approvals", original)
    g = get(c, bid)
    assert g["state"] == "APPROVED" and g["approval"]["valid"] is True
    assert count(db, AuditEvent, action="booking.cancel", outcome="denied") == 1
    assert c.post(f"{B}/{bid}/cancel").json()["state"] == "CANCELLED"


def test_concurrent_double_submit_sends_once(auth_client, db, monkeypatch):
    """Two submits race past the checks; the optimistic lock lets exactly one reach the supplier."""
    c = auth_client("owner")
    bid = approved(c, db)["id"]
    original = service._recheck_before_handoff

    def racing(*args, **kwargs):
        approval = original(*args, **kwargs)
        sql(db, update(BookingIntent).where(BookingIntent.id == bid).values(version=BookingIntent.version + 1))
        return approval

    monkeypatch.setattr(service, "_recheck_before_handoff", racing)
    err(submit(c, bid), 409, "CONCURRENT_UPDATE")
    assert count(db, SimulatedSupplierBooking) == 0 and count(db, Reservation) == 0
    monkeypatch.setattr(service, "_recheck_before_handoff", original)
    assert submit(c, bid).json()["state"] == "CONFIRMED"
    assert count(db, SimulatedSupplierBooking) == 1 and count(db, Reservation) == 1


# ------------------------------------------------------ audit regressions ----


REQUOTE_CHANGES = {
    "title": lambda m: m.__setitem__("title", "טיסה אחרת"),
    "excluded_notes": lambda m: m["price"].__setitem__("excluded_notes", ["דמי טיפול בשדה — בתשלום במקום"]),
    "total_status": lambda m: m["price"].__setitem__("total_status", "estimated"),
    "stops": lambda m: m["details"]["slices"][0].__setitem__("stops", 2),
    "provider_name": lambda m: m["source"].__setitem__("provider_name", "ספק בשם אחר"),
    "segments": lambda m: m["details"]["slices"][0]["segments"].append(
        dict(m["details"]["slices"][0]["segments"][0], flight_number="4321")),
    "policy_text": lambda m: m["cancellation"].__setitem__("policy_text", "דמי ביטול מלאים"),
    "fare_brand": lambda m: m["details"].__setitem__("fare_brand", "Basic"),
}


@pytest.mark.parametrize("field", REQUOTE_CHANGES)
def test_requote_changing_any_displayed_line_invalidates_approval(auth_client, db, monkeypatch, field):
    """AUD-01: a supplier re-quote that alters anything the approver read is never "unchanged"."""
    from app.schemas.offers import CanonicalOffer

    c = auth_client("owner")
    b = approved(c, db)

    def requote(_db, offer):
        data = offer.model_dump(mode="json")
        REQUOTE_CHANGES[field](data)
        return RevalidationResult(status="unchanged", offer_id=offer.id, checked_at=utcnow(), message="ללא שינוי",
                                  new_total=offer.price.total, refreshed_offer=CanonicalOffer.model_validate(data))

    monkeypatch.setattr(provider_service, "revalidate_offer", requote)
    err(submit(c, b["id"]), 409, "TERMS_CHANGED")
    g = get(c, b["id"])
    assert g["state"] == "QUOTE_SELECTED" and g["terms_hash"] != b["terms_hash"] and g["price_changed"] is False
    assert g["approval"]["valid"] is False and g["approval"]["invalidated_at"] and g["terms_summary"] != b["terms_summary"]
    assert count(db, SimulatedSupplierBooking) == 0 and count(db, Reservation) == 0
    # the explicit revalidate endpoint behaves the same way for a READY intent: back to QUOTE_SELECTED, no approval possible
    other = create(c, db, n=1)
    monkeypatch.undo()
    assert revalidate(c, other["id"])["state"] == "READY_FOR_APPROVAL"
    monkeypatch.setattr(provider_service, "revalidate_offer", requote)
    out = revalidate(c, other["id"])
    assert out["state"] == "QUOTE_SELECTED" and out["terms_hash"] != other["terms_hash"] and not out["can"]["approve"]
    err(approve(c, other["id"], other["terms_hash"]), 409, "INVALID_TRANSITION")


def test_hosted_checkout_requires_revalidation_support(live, db, monkeypatch):
    """AUD-05: a provider that cannot re-check prices must not start a flow that can never finish."""
    c, offer_id, adapter = live
    base_caps = LiveStub.capabilities

    def no_revalidate(self):
        return base_caps(self).model_copy(update={"supports_revalidate": False})

    monkeypatch.setattr(LiveStub, "capabilities", no_revalidate)
    e = err(_live_create(c, db, offer_id), 409, "BOOKING_UNAVAILABLE")
    assert "לאמת את המחיר מראש" in e["message"] and "באתר הספק" in e["message"]
    assert e["details"] == {"reason": "REVALIDATION_UNSUPPORTED"} and count(db, BookingIntent) == 0
    monkeypatch.setattr(LiveStub, "capabilities", base_caps)
    assert _live_create(c, db, offer_id).status_code == 201


def test_no_shipped_live_adapter_can_start_hosted_checkout():
    """Documents reality: today only test adapters satisfy the hosted-checkout preconditions."""
    registry.reset_registry()
    for adapter in registry.all_adapters():
        caps = adapter.capabilities()
        if caps.mode == "LIVE":
            assert not (caps.supports_revalidate and caps.supports_hosted_checkout), caps.provider_id


def test_checkout_link_is_post_with_csrf(live, db):
    """AUD-09: the endpoint can change state, so it is an unsafe method."""
    c, offer_id, _ = live
    bid = _live_create(c, db, offer_id).json()["id"]
    revalidate(c, bid)
    approve(c, bid)
    assert c.get(f"{B}/{bid}/checkout-link").status_code in (404, 405)
    token = c.headers.pop("X-CSRF-Token")
    err(c.post(f"{B}/{bid}/checkout-link"), 403, "CSRF_FAILED")
    assert count(db, AuditEvent, action="booking.checkout_link") == 0
    c.headers["X-CSRF-Token"] = token
    res = c.post(f"{B}/{bid}/checkout-link")
    assert res.status_code == 200 and set(res.json()) == {"url", "provider_id", "provider_name", "instructions", "warnings",
                                                         "is_demo"} and res.json()["is_demo"] is False
