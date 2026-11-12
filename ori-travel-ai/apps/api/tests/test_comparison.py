"""Scoring determinism/weights/currency rules and the comparisons API."""

from __future__ import annotations

import random
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.modules.comparison.scoring import (
    WeightsError,
    normalize_weights,
    parse_weights_param,
    score_offers,
)
from app.modules.providers import registry
from app.modules.providers.normalization import build_breakdown, component
from app.modules.search import service

TODAY = date.today()


def future(days: int) -> str:
    return (TODAY + timedelta(days=days)).isoformat()


@pytest.fixture(autouse=True)
def _registry():
    registry.reset_registry()
    yield
    registry.reset_registry()


def _search(db, user_id, **kw):
    body = {"category": "flight", "origin": "TLV", "destination": "BUD", "depart_date": future(28),
            "return_date": future(33), "adults": 2}
    body.update(kw)
    return service.run_search(db, user_id, body)


def _strip(offers):
    return [o.model_copy(update={"score": None}) for o in offers]


def test_score_offers_is_deterministic_and_order_independent(db, make_user):
    offers = _strip(_search(db, make_user().id).offers)
    weights = {"cost": 40, "convenience": 25, "flexibility": 20, "quality": 15}
    first = score_offers(offers, weights)
    shuffled = list(offers)
    random.Random(7).shuffle(shuffled)
    second = score_offers(shuffled, weights)
    assert [o.id for o in first] == [o.id for o in second]
    assert [o.score for o in first] == [o.score for o in second]
    assert all(o.score is None for o in offers)  # input not mutated
    for o in first:
        s = o.score
        for f in ("cost", "convenience", "flexibility", "quality"):
            assert Decimal(0) <= getattr(s, f) <= Decimal(100)
        expected = (40 * s.cost + 25 * s.convenience + 20 * s.flexibility + 15 * s.quality) / 100
        assert abs(s.total - expected) <= Decimal("0.1")
        assert s.reasons and s.comparable is True
    cheapest = min(first, key=lambda o: o.price.total.amount)
    assert cheapest.score.cost == Decimal(100)
    assert "המחיר הנמוך ביותר בקבוצה" in cheapest.score.reasons


def test_custom_weights_change_ranking(db, make_user):
    offers = _strip(_search(db, make_user().id).offers)
    by_cost = score_offers(offers, {"cost": 100, "convenience": 0, "flexibility": 0, "quality": 0})
    assert by_cost[0].price.total.amount == min(o.price.total.amount for o in offers)
    by_flex = score_offers(offers, {"cost": 0, "convenience": 0, "flexibility": 100, "quality": 0})
    assert by_flex[0].cancellation.refundable is True
    by_quality = score_offers(offers, {"cost": 0, "convenience": 0, "flexibility": 0, "quality": 100})
    assert by_quality[0].details.baggage.checked_included
    # Ties are broken by price, then provider, then supplier id
    tied = [o for o in by_flex if o.score.total == by_flex[0].score.total]
    assert [o.price.total.amount for o in tied] == sorted(o.price.total.amount for o in tied)


def test_preferences_affect_flight_convenience_and_quality(db, make_user):
    offers = _strip(_search(db, make_user().id).offers)
    w = {"cost": 0, "convenience": 50, "flexibility": 0, "quality": 50}
    plain = {o.id: o.score for o in score_offers(offers, w)}
    prefs = {o.id: o.score for o in score_offers(offers, w, preferences={"preferred_departure_window": "night",
                                                                       "checked_bags": 2})}
    assert any(prefs[k].convenience < plain[k].convenience for k in plain)
    assert all(prefs[k].quality <= plain[k].quality for k in plain)
    assert any("המזוודות" in r for s in prefs.values() for r in s.reasons)


def test_mixed_currency_is_not_comparable(db, make_user):
    user = make_user()
    ils = _strip(_search(db, user.id).offers[:2])
    eur = _strip(_search(db, user.id, currency="EUR").offers[:2])
    scored = score_offers(ils + eur, None)
    assert all(o.score.comparable is False for o in scored)
    assert all(any("מטבעות שונים" in r for r in o.score.reasons) for o in scored)
    # Cost is computed within each currency group: each group has its own "cheapest" = 100
    assert sum(1 for o in scored if o.score.cost == Decimal(100)) >= 2


def test_unknown_policy_and_estimated_totals_are_explained(db, make_user):
    offer = _strip(_search(db, make_user().id).offers)[0]
    unknown = offer.model_copy(update={
        "cancellation": offer.cancellation.model_copy(update={"refundable": None, "changeable": None}),
        "price": build_breakdown([component("בסיס", "base", "100", "ILS", status="estimated")], "ILS"),
    })
    s = score_offers([unknown], None)[0].score
    assert s.flexibility == Decimal(30)
    assert "מדיניות הביטול אינה ידועה" in s.reasons
    assert "המחיר הכולל הוא הערכה" in s.reasons


def test_weights_validation():
    assert normalize_weights(None) == {"cost": 40, "convenience": 25, "flexibility": 20, "quality": 15}
    assert parse_weights_param("quality:10, cost:70,convenience:10,flexibility:10")["cost"] == 70
    for bad in ({"cost": 100}, {"cost": 50, "convenience": 50, "flexibility": 0, "quality": 1},
                {"cost": 101, "convenience": 0, "flexibility": 0, "quality": -1},
                {"cost": True, "convenience": 0, "flexibility": 0, "quality": 99}):
        with pytest.raises(WeightsError):
            normalize_weights(bad)
    with pytest.raises(WeightsError):
        parse_weights_param("cost:40,cost:60")


# ----------------------------------------------------------------------- API


def test_comparisons_api_groups_by_category_and_currency(auth_client, db):
    c = auth_client("viewer")
    ils = c.post("/api/search/flight", json={"origin": "TLV", "destination": "BUD", "depart_date": future(28),
                                             "return_date": future(33)}).json()["offers"]
    eur = c.post("/api/search/flight", json={"origin": "TLV", "destination": "BUD", "depart_date": future(28),
                                             "return_date": future(33), "currency": "EUR"}).json()["offers"]
    hotels = c.post("/api/search/hotel", json={"destination": "Budapest", "check_in": future(28),
                                               "check_out": future(33)}).json()["offers"]
    ids = [ils[0]["id"], ils[1]["id"], eur[0]["id"], hotels[0]["id"]]
    res = c.post("/api/comparisons", json={"offer_ids": ids})
    assert res.status_code == 200, res.text
    body = res.json()
    groups = {(g["category"], g["currency"]): g for g in body["groups"]}
    assert set(groups) == {("flight", "ILS"), ("flight", "EUR"), ("hotel", "ILS")}
    ils_group = groups[("flight", "ILS")]
    assert [o["score"]["rank"] for o in ils_group["offers"]] == [1, 2]
    assert ils_group["cheapest_offer_id"] in ids
    assert all(o["score"]["comparable"] for o in ils_group["offers"])
    # Display-only DEMO FX conversion for the EUR group (family display currency is ILS)
    conv = groups[("flight", "EUR")]["display_conversions"][eur[0]["id"]]
    assert conv["rate_mode"] == "DEMO" and conv["converted"]["currency"] == "ILS"
    assert conv["original"]["amount"] == eur[0]["price"]["total"]["amount"]
    assert groups[("flight", "ILS")]["display_conversions"] == {}
    notes = " ".join(body["notes"])
    assert "קטגוריות שונות" in notes and "מטבעות שונים" in notes and "הדגמה" in notes
    assert body["weights"] == {"cost": 40, "convenience": 25, "flexibility": 20, "quality": 15}

    custom = c.post("/api/comparisons", json={"offer_ids": ids[:2],
                                              "weights": {"cost": 100, "convenience": 0, "flexibility": 0, "quality": 0}})
    first = custom.json()["groups"][0]["offers"]
    assert Decimal(first[0]["price"]["total"]["amount"]) <= Decimal(first[1]["price"]["total"]["amount"])


def test_comparisons_api_validation(client, auth_client):
    assert client.post("/api/comparisons", json={"offer_ids": ["a", "b"]}).status_code == 401
    c = auth_client("adult")
    offers = c.post("/api/search/flight", json={"origin": "TLV", "destination": "BUD", "depart_date": future(28)}).json()["offers"]
    assert c.post("/api/comparisons", json={"offer_ids": [offers[0]["id"]]}).status_code == 422
    assert c.post("/api/comparisons", json={"offer_ids": [offers[0]["id"]] * 2}).status_code == 422
    assert c.post("/api/comparisons", json={"offer_ids": [f"x{i}" for i in range(11)]}).status_code == 422
    assert c.post("/api/comparisons", json={"offer_ids": [offers[0]["id"], "missing"]}).status_code == 404
    bad = c.post("/api/comparisons", json={"offer_ids": [offers[0]["id"], offers[1]["id"]], "weights": {"cost": 10}})
    assert bad.status_code == 422 and "משקל" in bad.json()["error"]["message"]
