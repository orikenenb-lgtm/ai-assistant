"""Fare calendar (V6 §1): validation, shapes, no invented prices, no-service days, statuses, sources, limits."""

from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.config import reset_settings_cache
from app.models import ProviderConfiguration
from app.modules.providers import registry
from app.modules.providers.demo import DemoSkylineAdapter
from app.modules.providers.demo.flights import non_operating_weekdays, service_status
from app.modules.providers.service import reset_health_cache
from app.modules.search import calendar
from app.modules.search import service as search_service

TODAY = date.today()
URL = "/api/search/flight/calendar"
CELL_KEYS = {"depart_date", "return_date", "nights", "status", "min_total", "per_person", "travelers", "tier", "mode",
             "provider_id", "provider_name", "offers_count", "fetched_at", "message"}
TOP_KEYS = {"origin", "destination", "currency", "cabin", "depart_dates", "trip_nights", "cells", "stats", "sources",
            "legend_note", "coverage_note", "has_demo", "generated_at"}
DEMO_FLIGHT_IDS = {"demo_skyline", "demo_aurora"}


def future(days: int) -> date:
    return TODAY + timedelta(days=days)


def cal(start: int = 20, days: int = 42, **kw) -> dict:
    body = {"origin": "TLV", "destination": "FCO", "depart_from": future(start).isoformat(),
            "depart_to": future(start + days - 1).isoformat(), "trip_nights": [5], "adults": 2, "children_ages": [7],
            "cabin": "economy", "max_stops": None, "checked_bags": 0, "currency": "ILS"}
    body.update(kw)
    return body


def normal_search_body(cell: dict, body: dict) -> dict:
    """What the UI sends when a calendar cell is clicked."""
    return {"origin": body["origin"], "destination": body["destination"], "depart_date": cell["depart_date"],
            "return_date": cell["return_date"], "adults": body["adults"], "children_ages": body["children_ages"],
            "cabin": body.get("cabin", "economy"), "max_stops": body.get("max_stops"),
            "checked_bags": body.get("checked_bags", 0), "currency": body.get("currency", "ILS")}


@pytest.fixture(autouse=True)
def _registry():
    registry.reset_registry()
    reset_health_cache()
    yield
    registry.reset_registry()
    reset_health_cache()


class FakeLiveFlights(DemoSkylineAdapter):
    """A configured LIVE flight provider (no network). ``forbid`` makes any search call fail the test."""

    provider_id = "test_live_flights"
    display_name = "ספק טיסות חי לבדיקה"
    supplier_prefix = "LIV"

    def __init__(self):
        super().__init__()
        self.forbid = False
        self.calls = 0

    def capabilities(self):
        return super().capabilities().model_copy(update={"mode": "LIVE"})

    def search(self, category, params, ctx):
        if self.forbid:
            raise AssertionError("LIVE adapter must never be called by the fare calendar")
        self.calls += 1
        return super().search(category, params, ctx)

    def normalize(self, category, raw, ctx):
        o = super().normalize(category, raw, ctx)
        return o.model_copy(update={"source": o.source.model_copy(update={"mode": "LIVE", "note": None})})


class SlowDemoFlights(DemoSkylineAdapter):
    provider_id = "test_slow_demo"
    display_name = "ספק הדגמה איטי"

    def search(self, category, params, ctx):
        time.sleep(0.2)
        return super().search(category, params, ctx)


def disable(db, *provider_ids: str) -> None:
    registry.ensure_configs(db)
    db.query(ProviderConfiguration).filter(ProviderConfiguration.provider_id.in_(provider_ids)).update(
        {"enabled": False}, synchronize_session=False)
    db.commit()


def enable_live(monkeypatch) -> None:
    monkeypatch.setenv("ORI_LIVE_PROVIDERS_ENABLED", "true")
    reset_settings_cache()


# ------------------------------------------------------------------ auth / validation


def test_calendar_requires_auth(client):
    assert client.post(URL, json=cal()).status_code == 401


def test_calendar_requires_csrf(auth_client):
    c = auth_client("adult")
    c.headers.pop("X-CSRF-Token")
    assert c.post(URL, json=cal(days=1)).status_code == 403


@pytest.mark.parametrize(
    ("body", "needle"),
    [
        (cal(days=43), "עד 42 תאריכי יציאה"),
        (cal(days=31, trip_nights=[3, 4, 5, 6, 7]), "יותר מדי תאים"),  # 31 x 5 = 155 > 150
        (cal(start=-5, days=3), "עבר"),
        ({**cal(), "depart_to": future(10).isoformat()}, "טווח התאריכים"),
        (cal(adults=1, children_ages=[0, 1]), "תינוק"),
        (cal(destination="TLV"), "שונים"),
        (cal(adults=5, children_ages=[3, 4, 5, 6, 7]), "עד 9 נוסעים"),
        (cal(start=350, days=14), "שנה קדימה"),  # last return = today + 368
        (cal(currency="XYZ"), "אינו נתמך"),
    ],
)
def test_calendar_validation_is_hebrew_422(auth_client, body, needle):
    res = auth_client("adult").post(URL, json=body)
    assert res.status_code == 422, res.text
    err = res.json()["error"]
    assert err["code"] == "VALIDATION_ERROR" and needle in err["message"], err


@pytest.mark.parametrize(
    ("body", "field"),
    [
        (cal(trip_nights=[1, 2, 3, 4, 5, 6, 7, 8]), "trip_nights"),
        (cal(trip_nights=[0]), "trip_nights.0"),
        (cal(trip_nights=[31]), "trip_nights.0"),
        (cal(origin="T1"), "origin"),
        ({k: v for k, v in cal().items() if k != "depart_from"}, "depart_from"),
    ],
)
def test_calendar_field_errors_are_hebrew_422(auth_client, body, field):
    res = auth_client("viewer").post(URL, json=body)
    assert res.status_code == 422, res.text
    details = res.json()["error"]["details"]
    assert any(d["field"] == field for d in details), details
    assert all(any("֐" <= ch <= "׿" for ch in d["message"]) for d in details)


def test_calendar_limits_accept_the_maximums(auth_client):
    c = auth_client("adult")
    month = c.post(URL, json=cal(days=42, trip_nights=[]))  # 42 one-way cells
    assert month.status_code == 200, month.text
    assert len(month.json()["cells"]) == 42
    matrix = c.post(URL, json=cal(days=21, trip_nights=[1, 2, 3, 4, 5, 6, 30]))  # 21 x 7 = 147 cells
    assert matrix.status_code == 200, matrix.text
    assert len(matrix.json()["cells"]) == 147


# ------------------------------------------------------------------------ shapes


def test_round_trip_shape_and_sources(auth_client):
    body = cal()
    res = auth_client("viewer").post(URL, json=body)
    assert res.status_code == 200, res.text
    out = res.json()
    assert set(out) == TOP_KEYS
    assert (out["origin"], out["destination"], out["currency"], out["cabin"]) == ("TLV", "FCO", "ILS", "economy")
    assert out["trip_nights"] == [5]
    assert out["depart_dates"] == [future(20 + i).isoformat() for i in range(42)]
    assert len(out["cells"]) == 42
    for cell, d in zip(out["cells"], out["depart_dates"], strict=True):
        assert set(cell) == CELL_KEYS
        assert cell["depart_date"] == d and cell["nights"] == 5
        assert cell["return_date"] == (date.fromisoformat(d) + timedelta(days=5)).isoformat()
        assert cell["travelers"] == 3
    # TLV-FCO is a daily trunk route in DEMO data: every date is priced by a DEMO provider
    assert all(c["status"] == "priced" for c in out["cells"])
    for c in out["cells"]:
        total = Decimal(c["min_total"]["amount"])
        assert isinstance(c["min_total"]["amount"], str) and c["min_total"]["currency"] == "ILS"
        assert Decimal(c["per_person"]["amount"]) == (total / 3).quantize(Decimal("0.01"))
        assert c["mode"] == "DEMO" and c["provider_id"] in DEMO_FLIGHT_IDS and c["provider_name"]
        assert c["offers_count"] > 0 and c["fetched_at"] and c["message"] is None
        assert c["tier"] in {"best", "low", "mid", "high"}
    stats = out["stats"]
    assert (stats["priced"], stats["no_offers"], stats["not_searched"], stats["error"]) == (42, 0, 0, 0)
    sources = {s["provider_id"]: s for s in out["sources"]}
    assert sources["demo_skyline"]["status"] == "OK" and sources["demo_aurora"]["status"] == "OK"
    assert sources["demo_skyline"]["mode"] == "DEMO"
    assert sum(s["cells_priced"] for s in out["sources"]) == 42
    live = [s for s in out["sources"] if s["mode"] in ("LIVE", "CACHED")]
    assert live and all(s["status"] == "NOT_CONFIGURED" for s in live)
    assert all("אינם נשאלים עבור לוח המחירים" in s["message"] for s in live)
    assert out["has_demo"] is True
    assert "נתוני הדגמה" in out["coverage_note"] and "אינם נשאלים" in out["coverage_note"]
    assert "אין התחייבות לכיסוי מלא" in out["coverage_note"]
    assert "הזול ביותר" in out["legend_note"] and "לא נבדק" in out["legend_note"]
    assert out["generated_at"].endswith("Z") or "+00:00" in out["generated_at"]


def test_one_way_and_matrix_shapes(auth_client):
    c = auth_client("adult")
    one_way = c.post(URL, json={k: v for k, v in cal(days=7).items() if k != "trip_nights"}).json()
    assert one_way["trip_nights"] == [None]
    assert len(one_way["cells"]) == 7
    assert all(x["return_date"] is None and x["nights"] is None for x in one_way["cells"])
    assert "בכיוון אחד" in one_way["legend_note"]
    null_nights = c.post(URL, json=cal(days=2, trip_nights=None)).json()
    assert null_nights["trip_nights"] == [None]
    matrix = c.post(URL, json=cal(days=4, trip_nights=[7, 3, 3, 5])).json()  # deduped + sorted
    assert matrix["trip_nights"] == [3, 5, 7]
    assert [(x["depart_date"], x["nights"]) for x in matrix["cells"]] == [
        (future(20 + i).isoformat(), n) for i in range(4) for n in (3, 5, 7)]


def test_calendar_is_deterministic(auth_client):
    c = auth_client("adult")
    body = cal(days=14, destination="RHO", trip_nights=[3, 4])

    def stable(res):
        return [{k: v for k, v in cell.items() if k != "fetched_at"} for cell in res.json()["cells"]]

    assert stable(c.post(URL, json=body)) == stable(c.post(URL, json=body))


def test_calendar_is_not_persisted(auth_client, db):
    from app.models import Offer, SearchRequest

    auth_client("adult").post(URL, json=cal(days=5))
    assert db.query(SearchRequest).count() == 0 and db.query(Offer).count() == 0


# ------------------------------------------------------------- no invented prices


@pytest.mark.parametrize(
    "body",
    [
        cal(days=6),
        cal(days=6, trip_nights=[], destination="ATH", adults=1, children_ages=[]),
        cal(days=6, destination="JFK", max_stops=0, checked_bags=1, currency="USD", trip_nights=[4, 9]),
        cal(days=6, destination="RHO", children_ages=[1, 9], cabin="business"),
    ],
)
def test_priced_cells_equal_the_cheapest_offer_of_a_normal_search(auth_client, body):
    c = auth_client("adult")
    out = c.post(URL, json=body).json()
    priced = [x for x in out["cells"] if x["status"] == "priced"]
    assert priced
    for cell in priced[:4]:
        search = c.post("/api/search/flight", json=normal_search_body(cell, body))
        assert search.status_code == 200, search.text
        offers = search.json()["offers"]
        cheapest = min(offers, key=lambda o: Decimal(o["price"]["total"]["amount"]))
        assert cell["min_total"] == cheapest["price"]["total"], (cell, cheapest["price"]["total"])
        assert cell["provider_id"] == cheapest["source"]["provider_id"]
        assert cell["offers_count"] == len(offers)
        if body.get("max_stops") == 0:
            assert all(o["details"]["max_stops"] == 0 for o in offers)
    for cell in out["cells"]:
        if cell["status"] == "no_offers":
            search = c.post("/api/search/flight", json=normal_search_body(cell, body)).json()
            assert search["offers"] == [] and search["status"] == "completed"
            break


# ----------------------------------------------------------------- no-service days


def test_demo_no_service_days_are_documented_and_deterministic():
    # Trunk routes operate daily; thin routes have 1-2 weekdays without service (same both directions).
    assert non_operating_weekdays("TLV", "ATH") == frozenset()
    assert non_operating_weekdays("TLV", "FCO") == frozenset()
    thin = non_operating_weekdays("TLV", "RHO")
    assert 1 <= len(thin) <= 2 and thin == non_operating_weekdays("RHO", "TLV")
    days = [future(30 + i) for i in range(28)]
    assert all(service_status("TLV", "ATH", d, "economy") == "operating" for d in days)
    statuses = [service_status("TLV", "RHO", d, "economy") for d in days]
    assert "no_service" in statuses and "operating" in statuses
    for d, s in zip(days, statuses, strict=True):
        assert (s == "no_service") == (d.weekday() in thin)


def test_no_offers_cells_on_thin_route(auth_client):
    out = auth_client("adult").post(URL, json=cal(days=21, destination="RHO", trip_nights=[])).json()
    thin = non_operating_weekdays("TLV", "RHO")
    by_status = {s: [c for c in out["cells"] if c["status"] == s] for s in ("priced", "no_offers")}
    assert by_status["priced"] and by_status["no_offers"]
    for cell in out["cells"]:
        d = date.fromisoformat(cell["depart_date"])
        if d.weekday() in thin:
            assert cell["status"] == "no_offers"
            assert cell["min_total"] is None and cell["tier"] is None and cell["offers_count"] == 0
            assert cell["message"] and cell["mode"] is None
        elif service_status("TLV", "RHO", d, "economy") == "operating":
            assert cell["status"] == "priced"
    assert out["stats"]["no_offers"] == len(by_status["no_offers"])
    # A trunk route never has no-service days
    trunk = auth_client("viewer").post(URL, json=cal(days=42, destination="ATH", trip_nights=[])).json()
    assert trunk["stats"]["no_offers"] == 0 and trunk["stats"]["priced"] == 42


# ------------------------------------------------------------------- tiers / stats


def test_tiers_are_tertiles_with_best_minimum(auth_client):
    out = auth_client("adult").post(URL, json=cal(days=42, trip_nights=[4, 6])).json()
    priced = [c for c in out["cells"] if c["status"] == "priced"]
    amounts = sorted(Decimal(c["min_total"]["amount"]) for c in priced)
    n = len(amounts)
    low = amounts[0]
    for c in priced:
        a = Decimal(c["min_total"]["amount"])
        r = sum(1 for x in amounts if x < a)
        expected = "best" if a == low else ("low" if 3 * r < n else ("mid" if 3 * r < 2 * n else "high"))
        assert c["tier"] == expected
    order = {"best": 0, "low": 1, "mid": 2, "high": 3}
    by_amount = sorted(priced, key=lambda c: Decimal(c["min_total"]["amount"]))
    assert [order[c["tier"]] for c in by_amount] == sorted(order[c["tier"]] for c in by_amount)
    assert {c["tier"] for c in priced} == {"best", "low", "mid", "high"}
    stats = out["stats"]
    assert Decimal(stats["min"]["amount"]) == amounts[0] and Decimal(stats["max"]["amount"]) == amounts[-1]
    median = (amounts[n // 2 - 1] + amounts[n // 2]) / 2 if n % 2 == 0 else amounts[n // 2]
    assert Decimal(stats["median"]["amount"]) == median.quantize(Decimal("0.01"))
    assert stats["min"]["currency"] == "ILS"


def test_tier_helper_small_sets():
    assert calendar._tiers([Decimal(5)]) == {Decimal(5): "best"}
    assert calendar._tiers([Decimal(5), Decimal(5), Decimal(9)]) == {Decimal(5): "best", Decimal(9): "high"}
    t = calendar._tiers([Decimal(i) for i in range(1, 7)])
    assert [t[Decimal(i)] for i in range(1, 7)] == ["best", "low", "mid", "mid", "high", "high"]


# ------------------------------------------------- LIVE: never called; cached only


def test_live_adapter_is_never_called_and_cells_are_not_searched(auth_client, db, monkeypatch):
    enable_live(monkeypatch)
    live = FakeLiveFlights()
    live.forbid = True
    registry.register_adapter(live)
    disable(db, *DEMO_FLIGHT_IDS)
    out = auth_client("adult").post(URL, json=cal(days=10)).json()
    assert live.calls == 0
    assert all(c["status"] == "not_searched" and c["min_total"] is None for c in out["cells"])
    assert all("ספקים חיים אינם נשאלים" in c["message"] for c in out["cells"])
    assert out["stats"]["not_searched"] == 10 and out["stats"]["min"] is None
    sources = {s["provider_id"]: s for s in out["sources"]}
    assert sources["test_live_flights"]["status"] == "NOT_QUERIED"
    assert "אינם נשאלים עבור לוח המחירים" in sources["test_live_flights"]["message"]
    assert sources["demo_skyline"]["status"] == "DISABLED" and sources["demo_aurora"]["status"] == "DISABLED"
    assert out["has_demo"] is False
    assert "לא נבדקו מחירים" in out["coverage_note"]


def test_cached_live_offer_fills_cell_as_cached(auth_client, db, monkeypatch):
    enable_live(monkeypatch)
    live = FakeLiveFlights()
    registry.register_adapter(live)
    c = auth_client("adult")
    body = cal(days=5)
    # An earlier REAL search for the 3rd date stores LIVE offers
    target = {"depart_date": future(22).isoformat(), "return_date": future(27).isoformat()}
    search = c.post("/api/search/flight", json=normal_search_body(target, body)).json()
    live_offers = [o for o in search["offers"] if o["source"]["provider_id"] == "test_live_flights"]
    assert live_offers and live.calls == 1
    live.forbid = True

    disable(db, *DEMO_FLIGHT_IDS)
    out = c.post(URL, json=body).json()
    assert live.calls == 1  # never called by the calendar
    cells = {x["depart_date"]: x for x in out["cells"]}
    cell = cells[target["depart_date"]]
    cheapest = min(live_offers, key=lambda o: Decimal(o["price"]["total"]["amount"]))
    assert cell["status"] == "priced" and cell["mode"] == "CACHED"
    assert cell["min_total"] == cheapest["price"]["total"]
    assert cell["provider_id"] == "test_live_flights" and cell["tier"] == "best"
    assert cell["offers_count"] == len(live_offers)
    assert cell["fetched_at"] is not None
    others = [x for d, x in cells.items() if d != target["depart_date"]]
    assert all(x["status"] == "not_searched" for x in others)
    src = {s["provider_id"]: s for s in out["sources"]}["test_live_flights"]
    assert src["status"] == "CACHED" and src["mode"] == "CACHED" and src["cells_priced"] == 1
    assert "אינם נשאלים" in src["message"] and "שמורים" in src["message"]
    assert "שמורים" in out["coverage_note"]

    # With DEMO enabled again, the cell shows the cheapest of DEMO + cached real offers (the normal search's min)
    db.query(ProviderConfiguration).filter(ProviderConfiguration.provider_id.in_(DEMO_FLIGHT_IDS)).update(
        {"enabled": True}, synchronize_session=False)
    db.commit()
    mixed_out = c.post(URL, json=body).json()
    mixed = {x["depart_date"]: x for x in mixed_out["cells"]}
    overall = min(search["offers"], key=lambda o: (Decimal(o["price"]["total"]["amount"])))
    assert mixed[target["depart_date"]]["min_total"] == overall["price"]["total"]
    assert mixed[target["depart_date"]]["offers_count"] == len(search["offers"])
    assert all(x["status"] == "priced" for x in mixed.values())
    assert {s["provider_id"]: s["status"] for s in mixed_out["sources"]}["test_live_flights"] == "CACHED"
    assert live.calls == 1

    # Changing the LIVE provider's configuration invalidates quotes fetched before the change
    db.query(ProviderConfiguration).filter_by(provider_id="test_live_flights").update(
        {"settings": {"max_results": 5}}, synchronize_session=False)
    db.commit()
    after_change = c.post(URL, json=body).json()
    assert {s["provider_id"]: s["status"] for s in after_change["sources"]}["test_live_flights"] == "NOT_QUERIED"
    assert all(x["mode"] == "DEMO" for x in after_change["cells"])


def test_cached_offers_need_equivalent_params_and_fresh_data(auth_client, db, monkeypatch):
    enable_live(monkeypatch)
    live = FakeLiveFlights()
    registry.register_adapter(live)
    c = auth_client("adult")
    body = cal(days=3)
    target = {"depart_date": future(20).isoformat(), "return_date": future(25).isoformat()}
    # Different pax => different params hash => not used
    c.post("/api/search/flight", json={**normal_search_body(target, body), "adults": 1})
    # Same pax but a different currency => not used either
    c.post("/api/search/flight", json={**normal_search_body(target, body), "currency": "EUR"})
    live.forbid = True
    disable(db, *DEMO_FLIGHT_IDS)
    out = c.post(URL, json=body).json()
    assert all(x["status"] == "not_searched" for x in out["cells"])
    # TTL 0 disables cached filling entirely
    monkeypatch.setenv("ORI_SEARCH_CACHE_TTL_MINUTES", "0")
    reset_settings_cache()
    assert all(x["status"] == "not_searched" for x in c.post(URL, json=body).json()["cells"])


# --------------------------------------------------------- failures / budget / errors


def test_simulate_error_gives_sources_and_error_cells(auth_client):
    owner = auth_client("owner")
    res = owner.put("/api/providers/demo_skyline", json={"enabled": True, "settings": {"simulate_error": True}})
    assert res.status_code == 200, res.text
    body = cal(days=14, destination="RHO", trip_nights=[])
    out = owner.post(URL, json=body).json()
    sources = {s["provider_id"]: s for s in out["sources"]}
    assert sources["demo_skyline"]["status"] == "FAILED"
    assert sources["demo_skyline"]["error_code"] == "SIMULATED_ERROR" and sources["demo_skyline"]["message"]
    assert sources["demo_aurora"]["status"] == "OK"
    priced = [c for c in out["cells"] if c["status"] == "priced"]
    errors = [c for c in out["cells"] if c["status"] == "error"]
    # Priced by the healthy provider => still priced; otherwise "error" (never "no_offers": skyline didn't answer)
    assert priced and all(c["provider_id"] == "demo_aurora" for c in priced)
    assert errors and all("דמו סקייליין" in c["message"] for c in errors)
    assert out["stats"]["no_offers"] == 0 and out["stats"]["error"] == len(errors)
    assert "דמו סקייליין" in out["coverage_note"]

    owner.put("/api/providers/demo_aurora", json={"enabled": True, "settings": {"simulate_error": True}})
    both = owner.post(URL, json=body).json()
    assert all(c["status"] == "error" for c in both["cells"]) and both["stats"]["error"] == 14
    assert {s["status"] for s in both["sources"] if s["mode"] == "DEMO"} == {"FAILED"}


def test_time_budget_marks_unfinished_cells(auth_client, db, monkeypatch):
    monkeypatch.setattr(calendar, "CALENDAR_TIME_BUDGET_SECONDS", 0.6)
    registry.register_adapter(SlowDemoFlights())
    disable(db, *DEMO_FLIGHT_IDS)
    start = time.monotonic()
    out = auth_client("adult").post(URL, json=cal(days=20)).json()
    assert time.monotonic() - start < 2.5
    statuses = {c["status"] for c in out["cells"]}
    assert "priced" in statuses and "not_searched" in statuses
    skipped = [c for c in out["cells"] if c["status"] == "not_searched"]
    assert all("מגבלת הזמן" in c["message"] for c in skipped)
    # Earliest dates are quoted first; a quote still running at the deadline is a provider timeout ("error")
    first_skipped = min(c["depart_date"] for c in skipped)
    assert all(c["status"] in ("priced", "error") for c in out["cells"] if c["depart_date"] < first_skipped)
    assert all("ספק הדגמה איטי" in c["message"] for c in out["cells"] if c["status"] == "error")
    src = {s["provider_id"]: s for s in out["sources"]}["test_slow_demo"]
    assert src["status"] == "PARTIAL" and "מגבלת זמן" in src["message"]


def test_unknown_airport_cells_are_not_searched(auth_client):
    out = auth_client("adult").post(URL, json=cal(days=3, destination="XYZ")).json()
    assert all(c["status"] == "not_searched" for c in out["cells"])
    assert all("אינו נתמך" in c["message"] for c in out["cells"])
    assert {s["status"] for s in out["sources"] if s["mode"] == "DEMO"} == {"UNSUPPORTED"}


def test_calendar_rate_limit(auth_client):
    c = auth_client("adult")
    body = cal(days=1, trip_nights=[])
    for _ in range(calendar.CALENDAR_RATE_LIMIT):
        assert c.post(URL, json=body).status_code == 200
    res = c.post(URL, json=body)
    assert res.status_code == 429
    assert "לוח המחירים" in res.json()["error"]["message"]
    # Per user: another member is not affected, and normal searches have their own quota
    assert auth_client("viewer").post(URL, json=body).status_code == 200
    assert c.post("/api/search/flight", json=normal_search_body(
        {"depart_date": future(20).isoformat(), "return_date": None}, body)).status_code == 200


def test_full_month_is_fast(auth_client):
    c = auth_client("adult")
    start = time.perf_counter()
    res = c.post(URL, json=cal(days=42, trip_nights=[5]))
    elapsed = time.perf_counter() - start
    assert res.status_code == 200
    assert elapsed < 5.0, elapsed  # ~0.7 s locally; generous bound for slow CI machines


# --------------------------------------------- E2E: supplier failure -> partial search


def test_simulate_error_gives_partial_search_end_to_end(auth_client):
    owner = auth_client("owner")
    member = auth_client("adult")
    body = normal_search_body({"depart_date": future(25).isoformat(), "return_date": future(30).isoformat()}, cal())
    before = member.post("/api/search/flight", json=body).json()
    assert before["status"] == "completed"

    res = owner.put("/api/providers/demo_aurora", json={"enabled": True, "settings": {"simulate_error": True}})
    assert res.status_code == 200 and res.json()["settings"] == {"simulate_error": True}
    # Same params right after the change: NOT served from the cache made before the change
    after = member.post("/api/search/flight", json=body)
    assert after.status_code == 200
    out = after.json()
    assert out["status"] == "partial"
    runs = {p["provider_id"]: p for p in out["providers"]}
    assert runs["demo_aurora"]["status"] == "FAILED" and runs["demo_aurora"]["error_code"] == "SIMULATED_ERROR"
    assert runs["demo_aurora"]["message"]
    assert runs["demo_skyline"]["status"] == "OK"
    assert out["offers"] and all(o["source"]["provider_id"] == "demo_skyline" for o in out["offers"])
    assert "דמו אורורה" in out["coverage_note"]
    assert out["highlights"] is not None
    assert member.get(f"/api/search/{out['search_id']}").json()["status"] == "partial"

    owner.put("/api/providers/demo_aurora", json={"enabled": True, "settings": {}})
    healed = member.post("/api/search/flight", json=body).json()
    assert healed["status"] == "completed"
    assert {p["provider_id"]: p["status"] for p in healed["providers"]}["demo_aurora"] == "OK"


def test_search_cache_still_used_without_provider_changes(db, make_user):
    user = make_user()
    params = normal_search_body({"depart_date": future(25).isoformat(), "return_date": None}, cal())
    search_service.run_search(db, user.id, {**params, "category": "flight"})
    second = search_service.run_search(db, user.id, {**params, "category": "flight"})
    assert {p.status for p in second.providers if p.mode == "DEMO"} == {"CACHED"}
