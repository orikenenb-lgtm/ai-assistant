"""Search highlights (V6 §2): cheapest / fastest / best-score among comparable (same-currency) offers."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.modules.providers import registry
from app.modules.providers.demo import DemoAuroraAdapter
from app.modules.providers.demo.flights import non_operating_weekdays
from app.modules.providers.service import reset_health_cache
from app.modules.search import service
from app.modules.search.highlights import HIGHLIGHTS_NOTE, compute_highlights, dominant_currency
from app.schemas.common import Money

TODAY = date.today()
HIGHLIGHT_KEYS = {"currency", "cheapest_offer_id", "fastest_offer_id", "best_score_offer_id", "comparable_count", "note"}


def future(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


FLIGHT = {"origin": "TLV", "destination": "ATH", "depart_date": future(30), "return_date": future(36), "adults": 2,
          "children_ages": [6]}


@pytest.fixture(autouse=True)
def _registry():
    registry.reset_registry()
    reset_health_cache()
    yield
    registry.reset_registry()
    reset_health_cache()


class EuroOnlyFlights(DemoAuroraAdapter):
    """A DEMO reseller that always prices in EUR, whatever currency was requested."""

    provider_id = "test_euro_flights"
    display_name = "ספק אירו לבדיקה"
    supplier_prefix = "EUR"

    def generate(self, category, params):
        return super().generate(category, params.model_copy(update={"currency": "EUR"}))


def _amount(o: dict) -> Decimal:
    return Decimal(o["price"]["total"]["amount"])


def test_highlights_on_a_flight_search(auth_client):
    res = auth_client("viewer").post("/api/search/flight", json=FLIGHT)
    assert res.status_code == 200
    body = res.json()
    offers = {o["id"]: o for o in body["offers"]}
    h = body["highlights"]
    assert set(h) == HIGHLIGHT_KEYS
    assert h["currency"] == "ILS" and h["comparable_count"] == len(offers)
    assert h["note"] == HIGHLIGHTS_NOTE and "לא בהכרח בכל השוק" in h["note"]
    cheapest = offers[h["cheapest_offer_id"]]
    assert _amount(cheapest) == min(_amount(o) for o in offers.values())
    fastest = offers[h["fastest_offer_id"]]
    assert fastest["details"]["total_duration_minutes"] == min(
        o["details"]["total_duration_minutes"] for o in offers.values())
    best = offers[h["best_score_offer_id"]]
    assert Decimal(best["score"]["total"]) == max(Decimal(o["score"]["total"]) for o in offers.values())
    assert best["score"]["rank"] == 1


def test_cheapest_is_among_offers_left_after_filters(auth_client):
    c = auth_client("adult")
    base = c.post("/api/search/flight", json={**FLIGHT, "destination": "JFK"}).json()
    nonstop_prices = sorted(_amount(o) for o in base["offers"] if o["details"]["max_stops"] == 0)
    cap = nonstop_prices[len(nonstop_prices) // 2]
    filtered = c.post("/api/search/flight",
                      json={**FLIGHT, "destination": "JFK", "max_stops": 0, "max_price": str(cap)}).json()
    offers = {o["id"]: o for o in filtered["offers"]}
    assert offers and all(o["details"]["max_stops"] == 0 and _amount(o) <= cap for o in offers.values())
    h = filtered["highlights"]
    assert h["comparable_count"] == len(offers)
    assert _amount(offers[h["cheapest_offer_id"]]) == min(_amount(o) for o in offers.values())
    # Never cheaper than the unfiltered search's cheapest, and equal to the cheapest NONSTOP offer found there
    unfiltered_cheapest = min(_amount(o) for o in base["offers"])
    assert _amount(offers[h["cheapest_offer_id"]]) >= unfiltered_cheapest
    assert _amount(offers[h["cheapest_offer_id"]]) == nonstop_prices[0]


def test_mixed_currencies_use_the_dominant_currency(auth_client):
    registry.register_adapter(EuroOnlyFlights())
    body = auth_client("adult").post("/api/search/flight", json=FLIGHT).json()
    offers = {o["id"]: o for o in body["offers"]}
    by_cur: dict[str, list[dict]] = {}
    for o in offers.values():
        by_cur.setdefault(o["price"]["total"]["currency"], []).append(o)
    assert set(by_cur) == {"ILS", "EUR"} and len(by_cur["ILS"]) > len(by_cur["EUR"])
    # Numerically the EUR prices are lower — they must never be called "the cheapest" (no FX)
    assert min(_amount(o) for o in by_cur["EUR"]) < min(_amount(o) for o in by_cur["ILS"])
    h = body["highlights"]
    assert h["currency"] == "ILS" and h["comparable_count"] == len(by_cur["ILS"])
    for key in ("cheapest_offer_id", "fastest_offer_id", "best_score_offer_id"):
        assert offers[h[key]]["price"]["total"]["currency"] == "ILS"
    assert _amount(offers[h["cheapest_offer_id"]]) == min(_amount(o) for o in by_cur["ILS"])
    assert f"{len(by_cur['EUR'])} הצעות במטבע אחר" in h["note"]


def test_highlights_in_rerank_and_cached_responses(auth_client):
    c = auth_client("adult")
    first = c.post("/api/search/flight", json=FLIGHT).json()
    h1 = first["highlights"]
    by_conv = c.get(f"/api/search/{first['search_id']}",
                    params={"weights": "cost:0,convenience:100,flexibility:0,quality:0"}).json()
    hr = by_conv["highlights"]
    assert hr["cheapest_offer_id"] == h1["cheapest_offer_id"]
    assert hr["fastest_offer_id"] == h1["fastest_offer_id"]
    assert hr["best_score_offer_id"] == by_conv["offers"][0]["id"]
    cached = c.post("/api/search/flight", json=FLIGHT).json()
    assert {p["status"] for p in cached["providers"] if p["mode"] == "DEMO"} == {"CACHED"}
    hc = cached["highlights"]
    ids = {o["id"]: o for o in cached["offers"]}
    assert hc["cheapest_offer_id"] in ids and hc["cheapest_offer_id"] != h1["cheapest_offer_id"]
    first_cheapest = next(o for o in first["offers"] if o["id"] == h1["cheapest_offer_id"])
    assert ids[hc["cheapest_offer_id"]]["price"]["total"] == first_cheapest["price"]["total"]


def test_highlights_null_without_offers_and_no_fastest_for_hotels(db, make_user):
    user = make_user()
    thin = non_operating_weekdays("TLV", "RHO")
    day = next(TODAY + timedelta(days=30 + i) for i in range(7) if (TODAY + timedelta(days=30 + i)).weekday() in thin)
    empty = service.run_search(db, user.id, {"category": "flight", "origin": "TLV", "destination": "RHO",
                                             "depart_date": day.isoformat()})
    assert empty.offers == [] and empty.highlights is None and empty.status == "completed"
    hotel = service.run_search(db, user.id, {"category": "hotel", "destination": "Rome", "check_in": future(30),
                                             "check_out": future(33)})
    assert hotel.highlights is not None and hotel.highlights.fastest_offer_id is None
    assert hotel.highlights.cheapest_offer_id in {o.id for o in hotel.offers}


def test_compute_highlights_unit(db, make_user):
    res = service.run_search(db, make_user().id, {"category": "flight", **FLIGHT})
    offers = res.offers
    assert compute_highlights([]) is None
    # Tie on counts -> the requested (preferred) currency wins, then alphabetical
    half = len(offers) // 2
    eur = [o.model_copy(update={"price": o.price.model_copy(update={"total": Money(amount=Decimal("1.00"), currency="EUR")})})
           for o in offers[:half]]
    mixed = eur + offers[half:half + len(eur)]
    assert dominant_currency(mixed, "ILS") == "ILS"
    assert dominant_currency(mixed, "EUR") == "EUR"
    assert dominant_currency(mixed, None) == "EUR"
    h = compute_highlights(mixed, "ILS")
    assert h is not None and h.currency == "ILS" and h.comparable_count == len(eur)
    assert h.cheapest_offer_id in {o.id for o in offers[half:half + len(eur)]}
