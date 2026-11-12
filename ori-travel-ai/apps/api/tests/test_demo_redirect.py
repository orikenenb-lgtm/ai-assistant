"""DEMO supplier-hosted checkout (booking-safety.md §5): provider redirect that never claims a confirmed
booking until the supplier's reference is recorded — and, for DEMO, verified. No network."""

from __future__ import annotations

import re
from datetime import timedelta

import pytest
from sqlalchemy import update

from app.core.db import utcnow
from app.models import Approval, AuditEvent, BookingIntent, Reservation
from app.models.booking import SimulatedSupplierBooking
from app.modules.booking import demo_supplier
from app.modules.providers import registry
from app.modules.providers.base import BookingOptions
from app.modules.providers.demo.activities import DemoKidVenturesAdapter
from tests.test_booking import (  # noqa: F401 - `live` is a fixture
    B,
    FLIGHT,
    LiveStub,
    _live_create,
    add_member,
    approve,
    count,
    err,
    future,
    get,
    live,
    member_id,
    offers,
    revalidate,
    sql,
    state_of,
    submit,
)

KID = "demo_kidventures"
URL_RE = re.compile(r"^/demo-supplier/checkout\?ref=[A-Za-z0-9_-]{16,64}$")
S = "/api/demo-supplier/checkout"
AWAITING = "ממתין להשלמה באתר הספק"


# ------------------------------------------------------------------ helpers ----


def kid_offer(c, n=0) -> dict:
    """A DEMO activity offer sold by the provider that has a DEMO supplier page."""
    found: list[dict] = []
    for city in ("ATH", "ROM", "PAR", "LON", "BCN"):
        body = {"destination": city, "date_from": future(25), "date_to": future(31), "adults": 1}
        found += [o for o in offers(c, "activity", body) if o["source"]["provider_id"] == KID]
        if len(found) > n:
            return found[n]
    raise AssertionError("no demo_kidventures offer in the DEMO catalog")


def hosted(c, db, n=0, **extra) -> dict:
    res = c.post(B, json={"offer_id": kid_offer(c, n)["id"], "traveler_member_ids": [member_id(db, c)],
                          "execution_mode": "HOSTED_CHECKOUT", **extra})
    assert res.status_code == 201, res.text
    return res.json()


def hosted_approved(c, db, n=0) -> dict:
    b = hosted(c, db, n)
    assert revalidate(c, b["id"])["state"] == "READY_FOR_APPROVAL"
    res = approve(c, b["id"])
    assert res.status_code == 200, res.text
    return res.json()


def link(c, bid):
    return c.post(f"{B}/{bid}/checkout-link")


def ref_of(url: str) -> str:
    assert URL_RE.fullmatch(url), url
    return url.split("ref=")[1]


def page(c, ref):
    return c.get(S, params={"ref": ref})


def complete(c, ref):
    return c.post(f"{S}/complete", json={"ref": ref})


def record(c, bid, reference, **extra):
    return c.post(f"{B}/{bid}/record-confirmation", json={"supplier_reference": reference, **extra})


# ----------------------------------------------------------------- lifecycle ----


def test_demo_provider_declares_hosted_checkout_and_in_app_url_only():
    adapter = registry.get_adapter(KID)
    caps = adapter.capabilities()
    assert caps.mode == "DEMO" and caps.supports_hosted_checkout and caps.supports_revalidate
    assert caps.deep_link_domains == [] and caps.supports_live_booking is False
    # every other DEMO provider stays simulation-only
    for other in registry.all_adapters():
        if other.capabilities().mode == "DEMO" and other.provider_id != KID:
            assert other.capabilities().supports_hosted_checkout is False, other.provider_id


def test_full_redirect_lifecycle_never_confirmed_before_reference(auth_client, db):
    c = auth_client("owner")
    offer = kid_offer(c)
    opts = registry.get_adapter(KID).booking_options(_canonical(db, offer["id"]))
    assert URL_RE.fullmatch(opts.hosted_checkout_url) and opts.simulation_available and opts.live_api_booking is False

    # default stays SIMULATION; a simulation scenario is refused for the redirect path
    payload = {"offer_id": offer["id"], "traveler_member_ids": [member_id(db, c)]}
    assert c.post(B, json=payload).json()["execution_mode"] == "SIMULATION"
    err(c.post(B, json={**payload, "execution_mode": "HOSTED_CHECKOUT", "simulation_scenario": "success"}), 400,
        "SCENARIO_NOT_ALLOWED")
    assert c.post(B, json={**payload, "execution_mode": "LIVE"}).status_code == 422

    b = hosted(c, db)
    bid = b["id"]
    assert b["execution_mode"] == "HOSTED_CHECKOUT" and b["is_demo"] is True and b["is_simulation"] is False
    assert b["provider_id"] == KID and b["simulation_scenario"] is None
    assert any("ספק הדגמה" in line and "לא יבוצע חיוב" in line for line in b["terms_summary"])
    assert any("ספק הדגמה" in w for w in b["warnings"])

    # nothing is reachable before a human approval
    err(link(c, bid), 409, "INVALID_TRANSITION")
    err(record(c, bid, "DEMO-0123456789"), 409, "INVALID_TRANSITION")
    assert revalidate(c, bid)["state"] == "READY_FOR_APPROVAL"
    err(link(c, bid), 409, "INVALID_TRANSITION")
    err(approve(c, bid, "0" * 64), 409, "TERMS_CHANGED")
    a = approve(c, bid).json()
    assert a["state"] == "APPROVED" and a["state_label"] == AWAITING
    assert a["can"]["open_checkout"] and a["can"]["record_confirmation"] and a["can"]["submit"] is False
    assert any(AWAITING in w and "אינה מאושרת" in w for w in a["warnings"])
    err(submit(c, bid), 409, "USE_HOSTED_CHECKOUT")
    assert count(db, SimulatedSupplierBooking) == 0

    # the hand-off: an in-app URL, the same session on repeat, audited without an external host
    out = link(c, bid)
    assert out.status_code == 200, out.text
    data = out.json()
    ref = ref_of(data["url"])
    assert data["is_demo"] is True and data["provider_name"] == b["provider_name"]
    assert any("DEMO" in w and "אין חיוב" in w for w in data["warnings"])
    assert link(c, bid).json()["url"] == data["url"] and count(db, SimulatedSupplierBooking) == 1
    ev = db.query(AuditEvent).filter_by(action="booking.checkout_link", outcome="success").first()
    assert ev.details["host"] == "in-app:demo-supplier" and ev.details["demo"] is True and ref not in str(ev.details)

    # the DEMO supplier page: supplier, offer, price — and no reference yet
    p = page(c, ref).json()
    assert p["status"] == "OPEN" and p["is_demo"] is True and p["can_complete"] is True
    assert p["provider_name"] == b["provider_name"] and p["title"] == b["title"] and p["price"] == a["current_price"]
    assert p["summary"] == a["terms_summary"] and p["supplier_reference"] is None and p["booking_id"] == bid
    assert not {"card", "card_number", "cvv", "payment"} & set(p)

    # a reference typed before the supplier issued one is refused
    err(record(c, bid, "DEMO-0123456789"), 409, "SUPPLIER_REFERENCE_NOT_FOUND")

    done = complete(c, ref)
    assert done.status_code == 200, done.text
    reference = done.json()["supplier_reference"]
    assert re.fullmatch(r"DEMO-[0-9A-F]{10}", reference) and done.json()["status"] == "COMPLETED"
    assert done.json()["recorded"] is False and "אינה מאושרת" in done.json()["message"]
    assert complete(c, ref).json()["supplier_reference"] == reference  # idempotent: never a second reference
    assert count(db, AuditEvent, action="booking.demo_supplier_completed", outcome="success") == 1

    # completing at the supplier does NOT confirm the booking
    after = get(c, bid)
    assert after["state"] == "APPROVED" and after["state_label"] == AWAITING
    assert after["supplier_reference"] is None and after["reservation"] is None and reference not in str(after)
    assert "אושר על ידי הספק" not in after["state_label"] and count(db, Reservation) == 0
    assert [h["to"] for h in after["history"]][-1] == "APPROVED"
    listed = next(i for i in c.get(B).json()["items"] if i["id"] == bid)
    assert listed["state"] == "APPROVED" and listed["state_label"] == AWAITING and listed["supplier_reference"] is None

    # wrong / mistyped references are refused and change nothing
    for wrong in ("DEMO-0000000000", reference[:-1] + ("0" if reference[-1] != "0" else "1"), reference[:-1],
                  "SIM-ABCDEF", "REAL-12345"):
        err(record(c, bid, wrong), 409, "SUPPLIER_REFERENCE_NOT_FOUND")
    assert state_of(db, bid) == "APPROVED" and count(db, Reservation) == 0
    assert count(db, AuditEvent, action="booking.record_confirmation", outcome="denied") >= 5

    final = record(c, bid, reference.lower(), notes="הושלם בדף הספק לדוגמה")
    assert final.status_code == 200, final.text
    d = final.json()
    assert d["state"] == "CONFIRMED" and d["supplier_reference"] == reference and d["is_simulation"] is False
    assert d["reservation"]["mode"] == "HOSTED_CHECKOUT" and d["reservation"]["supplier_reference"] == reference
    assert [(h["from"], h["to"]) for h in d["history"]][-2:] == [("APPROVED", "SUBMITTING"), ("SUBMITTING", "CONFIRMED")]
    assert any("ספק הדגמה" in w and "לא בוצע חיוב" in w for w in d["warnings"])
    assert d["approval"]["consumed_at"] is not None and not any(d["can"].values())
    row = db.query(Reservation).one()
    assert row.details["is_demo"] is True and row.details["reference_verified"] is True
    assert page(c, ref).json()["recorded"] is True
    err(record(c, bid, reference), 409, "INVALID_TRANSITION")
    err(link(c, bid), 409, "INVALID_TRANSITION")


def _canonical(db, offer_id):
    from app.modules.search.service import get_offer

    return get_offer(db, offer_id)


def test_reference_of_another_booking_is_rejected(auth_client, db):
    c = auth_client("owner")
    first = hosted_approved(c, db, 0)["id"]
    second = hosted_approved(c, db, 1)["id"]
    ref1, ref2 = ref_of(link(c, first).json()["url"]), ref_of(link(c, second).json()["url"])
    assert ref1 != ref2
    reference1 = complete(c, ref1).json()["supplier_reference"]
    # the second booking never completed at the supplier: the first one's reference cannot confirm it
    err(record(c, second, reference1), 409, "SUPPLIER_REFERENCE_NOT_FOUND")
    assert state_of(db, second) == "APPROVED"
    reference2 = complete(c, ref2).json()["supplier_reference"]
    assert reference2 != reference1
    err(record(c, second, reference1), 409, "SUPPLIER_REFERENCE_NOT_FOUND")
    err(record(c, first, reference2), 409, "SUPPLIER_REFERENCE_NOT_FOUND")
    assert record(c, first, reference1).json()["state"] == "CONFIRMED"
    assert record(c, second, reference2).json()["state"] == "CONFIRMED"
    assert count(db, Reservation) == 2


def test_session_dies_with_the_approved_terms(auth_client, db):
    c = auth_client("owner")
    a = hosted_approved(c, db)
    bid = a["id"]
    old_ref = ref_of(link(c, bid).json()["url"])
    old_reference = complete(c, old_ref).json()["supplier_reference"]

    # the supplier changes the price: approval is cancelled, the booking goes back, nothing is confirmed
    adapter = registry.get_adapter(KID)
    sid = a["offer"]["source"]["supplier_offer_id"]
    adapter.set_revalidation_override(sid, "price_changed")
    assert revalidate(c, bid)["state"] == "QUOTE_SELECTED"
    adapter.set_revalidation_override(sid, None)
    err(record(c, bid, old_reference), 409, "INVALID_TRANSITION")
    err(link(c, bid), 409, "INVALID_TRANSITION")

    # re-approved at the new price: the reference issued for the OLD terms is not accepted
    assert revalidate(c, bid)["state"] == "READY_FOR_APPROVAL"
    assert approve(c, bid).status_code == 200
    err(record(c, bid, old_reference), 409, "SUPPLIER_REFERENCE_NOT_FOUND")
    new_ref = ref_of(link(c, bid).json()["url"])
    assert new_ref != old_ref
    new_reference = complete(c, new_ref).json()["supplier_reference"]
    assert new_reference != old_reference
    assert record(c, bid, new_reference).json()["state"] == "CONFIRMED"


def test_stale_session_cannot_be_completed(auth_client, db):
    c = auth_client("owner")
    a = hosted_approved(c, db)
    bid = a["id"]
    ref = ref_of(link(c, bid).json()["url"])

    # approval past its TTL: the DEMO supplier refuses, and the page says so
    sql(db, update(Approval).where(Approval.booking_intent_id == bid).values(expires_at=utcnow() - timedelta(minutes=1)))
    err(complete(c, ref), 409, "CHECKOUT_SESSION_EXPIRED")
    p = page(c, ref).json()
    assert p["status"] == "EXPIRED" and p["can_complete"] is False and p["supplier_reference"] is None and p["summary"] == []
    assert count(db, SimulatedSupplierBooking, status="CONFIRMED") == 0

    # changed terms void the open session; a new link opens a new one
    sql(db, update(Approval).where(Approval.booking_intent_id == bid).values(expires_at=utcnow() + timedelta(minutes=20)))
    adapter = registry.get_adapter(KID)
    sid = a["offer"]["source"]["supplier_offer_id"]
    adapter.set_revalidation_override(sid, "price_changed")
    err(link(c, bid), 409, "PRICE_CHANGED")
    adapter.set_revalidation_override(sid, None)
    err(complete(c, ref), 409, "CHECKOUT_SESSION_EXPIRED")
    revalidate(c, bid)
    approve(c, bid)
    new_ref = ref_of(link(c, bid).json()["url"])
    assert new_ref != ref
    db.expire_all()
    assert demo_supplier.get_session(db, ref).status == "VOID"
    err(complete(c, ref), 409, "CHECKOUT_SESSION_EXPIRED")
    assert page(c, ref).json()["status"] == "EXPIRED"

    # cancelled booking: the page is dead as well
    assert c.post(f"{B}/{bid}/cancel").json()["state"] == "CANCELLED"
    err(complete(c, new_ref), 409, "CHECKOUT_SESSION_EXPIRED")
    err(page(c, "A" * 32), 404, "CHECKOUT_SESSION_NOT_FOUND")
    err(complete(c, "A" * 32), 404, "CHECKOUT_SESSION_NOT_FOUND")


def test_simulation_ledger_rows_are_not_checkout_sessions(auth_client, db):
    """A simulation booking's supplier record can never be used as a hosted-checkout session or reference."""
    c = auth_client("owner")
    payload = {"offer_id": kid_offer(c)["id"], "traveler_member_ids": [member_id(db, c)]}
    sim = c.post(B, json=payload).json()
    revalidate(c, sim["id"])
    approve(c, sim["id"])
    done = submit(c, sim["id"]).json()
    assert done["state"] == "CONFIRMED" and done["supplier_reference"].startswith("SIM-")
    err(record(c, sim["id"], done["supplier_reference"]), 409, "NOT_HOSTED_CHECKOUT")
    err(link(c, sim["id"]), 409, "NOT_HOSTED_CHECKOUT")
    bid = hosted_approved(c, db, 1)["id"]
    err(record(c, bid, done["supplier_reference"]), 409, "SUPPLIER_REFERENCE_NOT_FOUND")
    row = db.query(SimulatedSupplierBooking).filter_by(booking_intent_id=sim["id"]).one()
    assert demo_supplier.get_session(db, row.idempotency_key) is None


# ------------------------------------------------------------- URL allowlist ----


@pytest.mark.parametrize("url", [
    "/demo-supplier/checkout?ref=" + "a" * 16,
    "/demo-supplier/checkout?ref=" + "Zz09_-" * 5,
    "/demo-supplier/checkout?ref=" + "b" * 64,
])
def test_demo_checkout_url_accepts_only_the_exact_form(url):
    assert demo_supplier.is_demo_checkout_url(url)


GOOD = "A1b2C3d4E5f6G7h8I9j0K1l2"
BAD_URLS = [
    None, "", 5,
    "/demo-supplier/checkout?ref=" + "a" * 15,
    "/demo-supplier/checkout?ref=" + "a" * 65,
    f"/demo-supplier/checkout?ref={GOOD}\n",
    f"/demo-supplier/checkout?ref={GOOD}&next=https://evil.example",
    f"/demo-supplier/checkout?ref={GOOD}#https://evil.example",
    f"/demo-supplier/checkout?ref={GOOD}%0a",
    f"/demo-supplier/checkout?next=//evil.example&ref={GOOD}",
    f"/demo-supplier/checkout/?ref={GOOD}",
    f"/demo-supplier/checkout/../../login?ref={GOOD}",
    f"//evil.example/demo-supplier/checkout?ref={GOOD}",
    f"/\\evil.example/demo-supplier/checkout?ref={GOOD}",
    f"\\\\evil.example/demo-supplier/checkout?ref={GOOD}",
    f"https://evil.example/demo-supplier/checkout?ref={GOOD}",
    f"https://book.example-travel.com/demo-supplier/checkout?ref={GOOD}",
    f"http://localhost/demo-supplier/checkout?ref={GOOD}",
    f"javascript:alert(1)//demo-supplier/checkout?ref={GOOD}",
    f"data:text/html,/demo-supplier/checkout?ref={GOOD}",
    f" /demo-supplier/checkout?ref={GOOD}",
    f"/Demo-Supplier/checkout?ref={GOOD}",
    f"demo-supplier/checkout?ref={GOOD}",
    f"/demo-supplier/checkout?ref={GOOD[:-1]}é",
    f"/demo-supplier/checkout?ref={GOOD}/../x",
]


@pytest.mark.parametrize("url", BAD_URLS)
def test_demo_checkout_url_rejects_everything_else(url):
    assert not demo_supplier.is_demo_checkout_url(url)


def _patch_kid_url(monkeypatch, make):
    def booking_options(self, offer, *, checkout_ref=None):
        return BookingOptions(hosted_checkout_url=make(checkout_ref), simulation_available=True, live_api_booking=False,
                              instructions="x")

    monkeypatch.setattr(DemoKidVenturesAdapter, "booking_options", booking_options)


@pytest.mark.parametrize("url", [u for u in BAD_URLS if isinstance(u, str) and u])
def test_open_redirect_attempts_from_a_demo_adapter_are_never_exposed(auth_client, db, monkeypatch, url):
    c = auth_client("owner")
    bid = hosted_approved(c, db)["id"]
    _patch_kid_url(monkeypatch, lambda ref: url)
    err(link(c, bid), 409, "CHECKOUT_LINK_UNAVAILABLE")
    assert count(db, AuditEvent, action="booking.checkout_link", outcome="denied") == 1
    assert count(db, AuditEvent, action="booking.checkout_link", outcome="success") == 0
    assert count(db, SimulatedSupplierBooking) == 0  # the session opened for the hand-off was rolled back
    # and such an adapter cannot start a redirect booking at all
    payload = {"offer_id": kid_offer(c, 1)["id"], "traveler_member_ids": [member_id(db, c)], "execution_mode": "HOSTED_CHECKOUT"}
    err(c.post(B, json=payload), 409, "BOOKING_UNAVAILABLE")


def test_demo_adapter_cannot_point_at_a_session_it_was_not_given(auth_client, db, monkeypatch):
    """Well-formed URL, but not the session the booking service opened for THIS booking."""
    c = auth_client("owner")
    other = hosted_approved(c, db, 1)["id"]
    other_ref = ref_of(link(c, other).json()["url"])
    bid = hosted_approved(c, db, 0)["id"]
    _patch_kid_url(monkeypatch, lambda ref: f"/demo-supplier/checkout?ref={other_ref}")
    err(link(c, bid), 409, "CHECKOUT_LINK_UNAVAILABLE")
    _patch_kid_url(monkeypatch, lambda ref: f"/demo-supplier/checkout?ref={GOOD}")
    err(link(c, bid), 409, "CHECKOUT_LINK_UNAVAILABLE")


def test_relative_url_is_rejected_for_non_demo_adapters(live, db):
    c, offer_id, _ = live
    relative = f"/demo-supplier/checkout?ref={GOOD}"
    assert demo_supplier.is_demo_checkout_url(relative)
    for url in (relative, "/checkout/abc", "//book.example-travel.com/checkout/abc"):
        LiveStub.checkout_url = url
        err(_live_create(c, db, offer_id), 409, "BOOKING_UNAVAILABLE")
        err(_live_create(c, db, offer_id, execution_mode="HOSTED_CHECKOUT"), 409, "BOOKING_UNAVAILABLE")
    assert count(db, BookingIntent) == 0

    LiveStub.checkout_url = "https://book.example-travel.com/checkout/abc"
    err(_live_create(c, db, offer_id, execution_mode="SIMULATION"), 409, "BOOKING_UNAVAILABLE")
    bid = _live_create(c, db, offer_id, execution_mode="HOSTED_CHECKOUT").json()["id"]
    revalidate(c, bid)
    approve(c, bid)
    for url in (relative, "//book.example-travel.com/checkout/abc"):
        LiveStub.checkout_url = url
        err(link(c, bid), 409, "CHECKOUT_LINK_UNAVAILABLE")
    assert count(db, SimulatedSupplierBooking) == 0
    LiveStub.checkout_url = "https://book.example-travel.com/checkout/abc"
    out = link(c, bid).json()
    assert out["url"] == "https://book.example-travel.com/checkout/abc" and out["is_demo"] is False

    # LIVE hosted checkout keeps accepting a user-typed reference (AUD-23), flagged as unverified
    d = record(c, bid, "REAL-12345").json()
    assert d["state"] == "CONFIRMED" and d["is_demo"] is False
    assert any("הוזנה ידנית" in w and "לא אומתה" in w for w in d["warnings"])
    assert db.query(Reservation).one().details["reference_verified"] is False


def test_demo_hosted_checkout_needs_declared_capabilities(auth_client, db, monkeypatch):
    c = auth_client("owner")
    me = member_id(db, c)
    # a DEMO provider without a supplier page cannot be asked for the redirect path
    flight = offers(c, "flight", FLIGHT)[0]
    err(c.post(B, json={"offer_id": flight["id"], "traveler_member_ids": [me], "execution_mode": "HOSTED_CHECKOUT"}), 409,
        "BOOKING_UNAVAILABLE")
    assert c.post(B, json={"offer_id": flight["id"], "traveler_member_ids": [me], "execution_mode": "SIMULATION"}).status_code == 201

    # AUD-05 also holds for DEMO: no revalidation support, no redirect flow
    payload = {"offer_id": kid_offer(c)["id"], "traveler_member_ids": [me], "execution_mode": "HOSTED_CHECKOUT"}
    base = DemoKidVenturesAdapter.capabilities
    for field in ("supports_revalidate", "supports_hosted_checkout"):
        monkeypatch.setattr(DemoKidVenturesAdapter, "capabilities",
                            lambda self, f=field: base(self).model_copy(update={f: False}))
        err(c.post(B, json=payload), 409, "BOOKING_UNAVAILABLE")
    monkeypatch.setattr(DemoKidVenturesAdapter, "capabilities", base)
    assert c.post(B, json=payload).status_code == 201


# -------------------------------------------------------- CSRF / roles / auth ----


def test_checkout_link_and_completion_need_csrf_and_an_authorized_adult(auth_client, client, db):
    c = auth_client("owner")
    b = hosted(c, db)
    bid = b["id"]
    revalidate(c, bid)
    approve(c, bid)
    assert c.get(f"{B}/{bid}/checkout-link").status_code in (404, 405)

    token = c.headers.pop("X-CSRF-Token")
    err(link(c, bid), 403, "CSRF_FAILED")
    assert count(db, SimulatedSupplierBooking) == 0 and count(db, AuditEvent, action="booking.checkout_link") == 0
    c.headers["X-CSRF-Token"] = token
    ref = ref_of(link(c, bid).json()["url"])

    assert c.get(f"{S}/complete", params={"ref": ref}).status_code in (404, 405)
    c.headers.pop("X-CSRF-Token")
    err(complete(c, ref), 403, "CSRF_FAILED")
    err(record(c, bid, "DEMO-0123456789"), 403, "CSRF_FAILED")
    c.headers["X-CSRF-Token"] = token
    assert count(db, SimulatedSupplierBooking, status="CONFIRMED") == 0

    # not signed in: the page data and the completion are both closed
    assert client.get(S, params={"ref": ref}).status_code == 401
    assert client.post(f"{S}/complete", json={"ref": ref}).status_code in (401, 403)

    # a viewer may look (read-only, like the booking itself) but cannot complete, open a link or record
    viewer = auth_client("viewer")
    seen = page(viewer, ref)
    assert seen.status_code == 200 and seen.json()["can_complete"] is False and seen.json()["status"] == "OPEN"
    assert complete(viewer, ref).status_code == 403
    assert link(viewer, bid).status_code == 403
    assert record(viewer, bid, "DEMO-0123456789").status_code == 403
    assert count(db, AuditEvent, action="booking.access_denied") >= 3
    assert count(db, SimulatedSupplierBooking, status="CONFIRMED") == 0 and state_of(db, bid) == "APPROVED"

    # malformed refs never reach the ledger
    for bad in ("short", "a" * 65, "../../etc/passwd_______", "a" * 20 + "%", "a" * 20 + " "):
        assert page(c, bad).status_code == 422
        assert complete(c, bad).status_code == 422
    assert c.post(f"{S}/complete", json={"ref": ref, "supplier_reference": "DEMO-1"}).status_code == 422

    # a second adult completes and records: both are ordinary authorized adults
    adult = auth_client("adult")
    reference = complete(adult, ref).json()["supplier_reference"]
    assert record(adult, bid, reference).json()["state"] == "CONFIRMED"


def test_minor_traveler_allowed_but_only_adult_books(auth_client, db):
    """Composition rules (AUD-04) apply to the redirect path exactly as to simulation."""
    c = auth_client("owner")
    kid = add_member(db)
    offer = kid_offer(c)
    err(c.post(B, json={"offer_id": offer["id"], "traveler_member_ids": [kid], "execution_mode": "HOSTED_CHECKOUT"}), 400,
        "TRAVELER_MISMATCH")
    assert count(db, BookingIntent) == 0
