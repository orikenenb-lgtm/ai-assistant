"""Year scan (cheapest day of the coming year): shape, honesty (DEMO only, LIVE never called), consistency with the
normal search, validation and the shared calendar rate limit."""

from __future__ import annotations

import time
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.config import get_settings
from app.modules.providers import registry
from app.modules.providers.service import reset_health_cache
from app.schemas.search import MAX_DAYS_AHEAD
from tests.test_calendar import FakeLiveFlights, enable_live

TODAY = date.today()
URL = "/api/search/flight/year-scan"


@pytest.fixture(autouse=True)
def _registry():
    registry.reset_registry()
    reset_health_cache()
    yield
    registry.reset_registry()
    reset_health_cache()


def body(**kw) -> dict:
    b = {"origin": "TLV", "destination": "ATH", "nights": 4, "adults": 2}
    b.update(kw)
    return b


def test_year_scan_requires_auth(client):
    assert client.post(URL, json=body()).status_code == 401


def test_year_scan_covers_the_whole_year_with_demo_prices_only(auth_client):
    c = auth_client("adult")
    started = time.monotonic()
    res = c.post(URL, json=body())
    took = time.monotonic() - started
    assert res.status_code == 200, res.text
    data = res.json()
    dates = [date.fromisoformat(d) for d in data["depart_dates"]]
    # Every depart date from tomorrow until the return still fits in the searchable year.
    assert dates[0] == TODAY + timedelta(days=1)
    assert dates[-1] == TODAY + timedelta(days=MAX_DAYS_AHEAD - 4)
    assert len(dates) == len(set(dates)) == (dates[-1] - dates[0]).days + 1
    assert data["trip_nights"] == [4]
    cells = data["cells"]
    assert len(cells) == len(dates)
    assert all(date.fromisoformat(cell["return_date"]) - date.fromisoformat(cell["depart_date"]) == timedelta(days=4)
               for cell in cells)
    priced = [cell for cell in cells if cell["status"] == "priced"]
    assert len(priced) > 300  # DEMO providers cover nearly every day (some DEMO no-service days are honest gaps)
    assert all(cell["mode"] == "DEMO" for cell in priced)
    assert data["has_demo"] is True
    assert "הדגמה" in data["coverage_note"]
    assert took < 30, f"year scan took {took:.1f}s"


def test_year_scan_stats_mean_and_minimum_are_consistent(auth_client):
    data = auth_client("adult").post(URL, json=body()).json()
    amounts = [Decimal(cell["min_total"]["amount"]) for cell in data["cells"] if cell["status"] == "priced"]
    stats = data["stats"]
    assert Decimal(stats["min"]["amount"]) == min(amounts)
    assert Decimal(stats["max"]["amount"]) == max(amounts)
    mean = Decimal(stats["mean"]["amount"])
    assert abs(mean - sum(amounts) / len(amounts)) < Decimal("0.01")
    assert min(amounts) <= mean <= max(amounts)
    assert stats["priced"] == len(amounts)
    best = [cell for cell in data["cells"] if cell["tier"] == "best"]
    assert best and all(Decimal(cell["min_total"]["amount"]) == min(amounts) for cell in best)


def test_cheapest_day_matches_the_normal_search_for_that_day(auth_client):
    c = auth_client("adult")
    data = c.post(URL, json=body()).json()
    best = next(cell for cell in data["cells"] if cell["tier"] == "best")
    res = c.post("/api/search/flight", json={
        "origin": "TLV", "destination": "ATH", "depart_date": best["depart_date"], "return_date": best["return_date"],
        "adults": 2,
    })
    assert res.status_code == 200, res.text
    totals = [Decimal(o["price"]["total"]["amount"]) for o in res.json()["offers"]]
    assert min(totals) == Decimal(best["min_total"]["amount"])


def test_one_way_scan(auth_client):
    data = auth_client("adult").post(URL, json=body(nights=None)).json()
    assert data["trip_nights"] == [None]
    assert data["depart_dates"][-1] == (TODAY + timedelta(days=MAX_DAYS_AHEAD)).isoformat()
    assert all(cell["return_date"] is None for cell in data["cells"])


@pytest.mark.parametrize(
    ("override", "needle"),
    [
        ({"nights": 0}, ""),
        ({"nights": 31}, ""),
        ({"destination": "TLV"}, "שונים"),
        ({"currency": "XYZ"}, ""),
        ({"adults": 1, "children_ages": [0, 1]}, "תינוק"),
    ],
)
def test_year_scan_validation_is_hebrew_422_and_free(auth_client, monkeypatch, override, needle):
    monkeypatch.setattr(get_settings(), "calendar_rate_limit", 1)
    c = auth_client("adult")
    res = c.post(URL, json=body(**override))
    assert res.status_code == 422, res.text
    err = res.json()["error"]
    assert err["code"] == "VALIDATION_ERROR"
    assert needle in err["message"]
    # Invalid requests do not consume the (shared) calendar budget.
    assert c.post(URL, json=body()).status_code == 200


def test_year_scan_shares_the_calendar_rate_limit(auth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "calendar_rate_limit", 1)
    c = auth_client("adult")
    assert c.post(URL, json=body()).status_code == 200
    res = c.post(URL, json=body())
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "RATE_LIMITED"


def test_year_scan_never_calls_live_providers(auth_client, monkeypatch):
    enable_live(monkeypatch)
    live = FakeLiveFlights()
    live.forbid = True
    registry.register_adapter(live)
    data = auth_client("adult").post(URL, json=body()).json()
    assert live.calls == 0
    assert all(cell["mode"] == "DEMO" for cell in data["cells"] if cell["status"] == "priced")
    sources = {s["provider_id"]: s for s in data["sources"]}
    assert sources["test_live_flights"]["status"] == "NOT_QUERIED"
