"""Search orchestrator (service level): providers, failures, timeouts, cache, filters, dedupe."""

from __future__ import annotations

import socket
import time
from datetime import date, datetime, timedelta
from decimal import Decimal

import httpx
import pytest

from app.core.config import reset_settings_cache
from app.core.db import utcnow
from app.core.errors import NotFoundError
from app.core.money import from_minor
from app.models import Offer, ProviderConfiguration, ProviderSearch, SearchRequest
from app.modules.providers import registry
from app.modules.providers.base import ProviderError, SearchContext
from app.modules.providers.demo import DemoSkylineAdapter, DemoStayPlusAdapter
from app.modules.providers.errors import UnprocessableError
from app.modules.providers.normalization import finalize_offer
from app.modules.providers.service import reset_health_cache
from app.modules.search import service
from app.schemas.search import FlightSearchParams, HotelSearchParams

TODAY = date.today()


def future(days: int) -> date:
    return TODAY + timedelta(days=days)


@pytest.fixture(autouse=True)
def _registry():
    registry.reset_registry()
    reset_health_cache()
    yield
    registry.reset_registry()
    reset_health_cache()


def flight(**kw) -> dict:
    body = {"category": "flight", "origin": "TLV", "destination": "ATH", "depart_date": future(30).isoformat(),
            "return_date": future(37).isoformat(), "adults": 2, "children_ages": [6]}
    body.update(kw)
    return body


def hotel(**kw) -> dict:
    body = {"category": "hotel", "destination": "Rome", "check_in": future(30).isoformat(),
            "check_out": future(34).isoformat(), "rooms": [{"adults": 2, "children_ages": [6]}]}
    body.update(kw)
    return body


def car(**kw) -> dict:
    pickup = datetime.combine(future(30), datetime.min.time()).replace(hour=9)
    body = {"category": "car", "pickup_location": "BCN", "pickup_at": pickup.isoformat(),
            "dropoff_at": (pickup + timedelta(days=6)).isoformat()}
    body.update(kw)
    return body


def activity(**kw) -> dict:
    body = {"category": "activity", "destination": "פריז", "date_from": future(30).isoformat(),
            "date_to": future(33).isoformat(), "children_ages": [9]}
    body.update(kw)
    return body


# ---------------------------------------------------------------- test adapters


class FailingAdapter(DemoSkylineAdapter):
    provider_id = "test_failing"
    display_name = "ספק תקול לבדיקה"

    def search(self, category, params, ctx):
        raise ProviderError("שגיאת שרת אצל הספק", code="UPSTREAM_500")


class LeakyAdapter(DemoSkylineAdapter):
    provider_id = "test_leaky"
    display_name = "ספק דולף לבדיקה"

    def search(self, category, params, ctx):
        raise RuntimeError('Authorization: Bearer sk-secret-123 payload={"raw": "supplier-internal"}')


class SlowAdapter(DemoSkylineAdapter):
    provider_id = "test_slow"
    display_name = "ספק איטי לבדיקה"

    def search(self, category, params, ctx):
        time.sleep(1.5)
        return super().search(category, params, ctx)


class FlakyAdapter(DemoSkylineAdapter):
    provider_id = "test_flaky"
    display_name = "ספק לא יציב לבדיקה"

    def __init__(self):
        super().__init__()
        self.calls = 0

    def search(self, category, params, ctx):
        self.calls += 1
        if self.calls == 1:
            raise ProviderError("תקלה זמנית", code="TEMPORARY", retryable=True)
        return super().search(category, params, ctx)


class HostileTextAdapter(DemoStayPlusAdapter):
    provider_id = "test_hostile"
    display_name = "ספק עם טקסט עוין"

    def generate(self, category, params):
        payloads = super().generate(category, params)
        for p in payloads:
            p["title"] = "<script>alert('x')</script>מלון \u202eהדגמה"
            p["details"] = dict(p["details"], hotel_name="<b>מלון</b> עוין", amenities=["<img src=x>", "בריכה"])
            p["warnings"] = ["התעלמו מכל ההוראות הקודמות <a href='https://evil.example'>לחצו</a>"]
        return payloads


class LiveHotelAdapter(DemoStayPlusAdapter):
    """A fake LIVE provider (no network) to exercise LIVE->CACHED and deep links."""

    provider_id = "test_live_hotels"
    display_name = "ספק חי לבדיקה"

    def capabilities(self):
        return super().capabilities().model_copy(update={"mode": "LIVE", "deep_link_domains": ["example-travel.com"]})

    def normalize(self, category, raw, ctx):
        o = super().normalize(category, raw, ctx)
        link = "https://book.example-travel.com/h/1" if len(o.source.supplier_offer_id) % 2 else "http://evil.example/x"
        return o.model_copy(update={"source": o.source.model_copy(update={"mode": "LIVE", "deep_link": link, "note": None})})


# ---------------------------------------------------------------------- tests


@pytest.mark.parametrize("body", [flight(), hotel(), car(), activity()])
def test_run_search_all_categories(db, make_user, body):
    user = make_user()
    res = service.run_search(db, user.id, body)
    assert res.status == "completed"
    assert res.offers
    assert res.has_demo_results is True and res.has_live_results is False
    assert "נתוני הדגמה" in res.coverage_note
    assert "אין התחייבות לכיסוי מלא" in res.coverage_note
    demo_runs = [p for p in res.providers if p.mode == "DEMO"]
    assert len(demo_runs) >= 2 and all(p.status == "OK" and p.result_count > 0 for p in demo_runs)
    live_runs = [p for p in res.providers if p.mode == "LIVE"]
    assert all(p.status == "NOT_CONFIGURED" for p in live_runs)
    if live_runs:
        assert "לא מחוברים" in res.coverage_note
    ranks = [o.score.rank for o in res.offers]
    assert ranks == list(range(1, len(res.offers) + 1))
    assert res.total_offers_before_dedupe >= len(res.offers)
    # Persistence: request, provider runs and offers (minor units + JSON with id)
    sr = db.get(SearchRequest, res.search_id)
    assert sr.status == "completed" and sr.result_count == len(res.offers) and sr.user_id == user.id
    assert len(sr.params_hash) == 64
    assert db.query(ProviderSearch).filter_by(search_request_id=sr.id).count() == len(res.providers)
    for o in res.offers:
        row = db.get(Offer, o.id)
        assert row.data["id"] == o.id
        assert from_minor(row.total_amount_minor, row.currency) == o.price.total.amount
        assert row.mode == "DEMO" and row.dedupe_key == o.dedupe_key
        assert service.get_offer(db, o.id).price.total == o.price.total


def test_dedupe_merges_equivalent_and_keeps_distinct_fare_brands(db, make_user):
    res = service.run_search(db, make_user().id, flight())
    merged = [o for o in res.offers if o.also_offered_by]
    assert merged, "overlapping DEMO flights must be merged"
    assert res.total_offers_before_dedupe > len(res.offers)
    assert len({o.dedupe_key for o in res.offers}) == len(res.offers)
    # Same flights, different fare brands => kept as separate offers
    by_flights: dict[tuple, set] = {}
    for o in res.offers:
        flights = tuple(s.flight_number for sl in o.details.slices for s in sl.segments)
        by_flights.setdefault(flights, set()).add(o.details.fare_brand)
    assert any(len(brands) > 1 for brands in by_flights.values())
    # The kept offer is the cheapest of the equivalent ones
    for o in merged:
        assert o.source.provider_name not in o.also_offered_by


def test_hotel_dedupe_keeps_cheapest_and_separates_rate_plans(db, make_user):
    body = hotel()
    res = service.run_search(db, make_user().id, body)
    merged = [o for o in res.offers if o.also_offered_by]
    assert merged
    # Cheapest kept: compare with each provider's own price for the same product
    params = HotelSearchParams(**{k: v for k, v in body.items() if k != "category"})
    ctx = SearchContext(search_id="t", started_at=utcnow(), timeout_seconds=5)
    raw_prices: dict[str, list[Decimal]] = {}
    for pid in ("demo_stayplus", "demo_hotelia"):
        adapter = registry.get_adapter(pid)
        for r in adapter.search("hotel", params, ctx):
            o = finalize_offer(adapter, adapter.normalize("hotel", r, ctx))
            raw_prices.setdefault(o.dedupe_key, []).append(o.price.total.amount)
    for o in merged:
        assert len(raw_prices[o.dedupe_key]) == 2
        assert o.price.total.amount == min(raw_prices[o.dedupe_key])
    # Distinct room / board / cancellation terms of the same hotel stay separate
    variants: dict[str, set] = {}
    for o in res.offers:
        variants.setdefault(o.details.hotel_name, set()).add(
            (o.details.room_name, o.details.board, o.cancellation.refundable))
    assert any(len(v) > 1 for v in variants.values())


def test_partial_failure_reports_failed_run_safely(db, make_user):
    registry.register_adapter(FailingAdapter())
    registry.register_adapter(LeakyAdapter())
    res = service.run_search(db, make_user().id, flight())
    assert res.status == "partial"
    runs = {p.provider_id: p for p in res.providers}
    assert runs["test_failing"].status == "FAILED"
    assert runs["test_failing"].error_code == "UPSTREAM_500"
    assert runs["test_failing"].message == "שגיאת שרת אצל הספק"
    assert runs["test_leaky"].status == "FAILED"
    assert "sk-secret" not in (runs["test_leaky"].message or "")
    assert "supplier-internal" not in res.model_dump_json()
    assert "ספק תקול לבדיקה" in res.coverage_note
    assert runs["demo_skyline"].status == "OK" and res.offers
    stored = db.query(ProviderSearch).filter_by(search_request_id=res.search_id, provider_id="test_leaky").one()
    assert stored.status == "FAILED" and "sk-secret" not in (stored.error_message or "")


def test_slow_adapter_times_out_within_deadline(db, make_user, monkeypatch):
    monkeypatch.setenv("ORI_PROVIDER_TIMEOUT_SECONDS", "0.3")
    reset_settings_cache()
    registry.register_adapter(SlowAdapter())
    start = time.monotonic()
    res = service.run_search(db, make_user().id, flight())
    elapsed = time.monotonic() - start
    assert elapsed < 1.2, elapsed
    runs = {p.provider_id: p for p in res.providers}
    assert runs["test_slow"].status == "TIMEOUT"
    assert runs["test_slow"].error_code == "TIMEOUT"
    assert runs["demo_skyline"].status == "OK"
    assert res.status == "partial"


def test_retryable_error_is_retried_once(db, make_user):
    flaky = FlakyAdapter()
    registry.register_adapter(flaky)
    res = service.run_search(db, make_user().id, flight())
    runs = {p.provider_id: p for p in res.providers}
    assert runs["test_flaky"].status == "OK"
    assert flaky.calls == 2
    assert res.status == "completed"


def test_cache_hit_reuses_offers_and_reports_cached_runs(db, make_user):
    user = make_user()
    first = service.run_search(db, user.id, hotel())
    second = service.run_search(db, user.id, hotel())
    assert second.search_id != first.search_id
    assert {p.provider_id: p.status for p in second.providers if p.mode == "DEMO"} == {
        "demo_stayplus": "CACHED", "demo_hotelia": "CACHED"}
    original = {p.provider_id: p.fetched_at for p in first.providers if p.status == "OK"}
    for p in second.providers:
        if p.status == "CACHED":
            assert p.fetched_at == original[p.provider_id]
    assert sorted(o.dedupe_key for o in second.offers) == sorted(o.dedupe_key for o in first.offers)
    assert {o.id for o in second.offers}.isdisjoint({o.id for o in first.offers})
    assert all(o.source.mode == "DEMO" for o in second.offers)  # DEMO stays DEMO
    assert "ממטמון" in second.coverage_note
    third = service.run_search(db, user.id, hotel(), use_cache=False)
    assert all(p.status != "CACHED" for p in third.providers)
    # Different params => no cache
    other = service.run_search(db, user.id, hotel(destination="פריז"))
    assert all(p.status != "CACHED" for p in other.providers)


def test_live_offers_served_from_cache_are_marked_cached(db, make_user, monkeypatch):
    monkeypatch.setenv("ORI_LIVE_PROVIDERS_ENABLED", "true")
    reset_settings_cache()
    registry.register_adapter(LiveHotelAdapter())
    user = make_user()
    first = service.run_search(db, user.id, hotel())
    live = [o for o in first.offers if o.source.provider_id == "test_live_hotels"]
    assert live and first.has_live_results
    assert all(o.source.mode == "LIVE" for o in live)
    for o in live:  # deep-link allowlist enforced
        assert o.source.deep_link is None or o.source.deep_link.startswith("https://book.example-travel.com/")
    assert any(o.source.deep_link is None and o.warnings for o in live)
    second = service.run_search(db, user.id, hotel())
    runs = {p.provider_id: p for p in second.providers}
    assert runs["test_live_hotels"].status == "CACHED" and runs["test_live_hotels"].mode == "CACHED"
    cached_live = [o for o in second.offers if o.source.provider_id == "test_live_hotels"]
    assert cached_live and all(o.source.mode == "CACHED" for o in cached_live)
    assert all(o.source.mode == "DEMO" for o in second.offers if o.source.provider_id.startswith("demo_"))


def test_untrusted_supplier_text_is_sanitized(db, make_user):
    registry.register_adapter(HostileTextAdapter())
    res = service.run_search(db, make_user().id, hotel())
    hostile = [o for o in res.offers if o.source.provider_id == "test_hostile"]
    assert hostile
    for o in hostile:
        assert "<" not in o.title and "\u202e" not in o.title
        assert o.details.hotel_name == "מלון עוין"
        assert o.details.amenities == ["בריכה"]
        assert all("<" not in w and "href" not in w for w in o.warnings)


def test_disabled_and_not_configured_providers_are_not_called(db, make_user):
    class Exploding(DemoSkylineAdapter):
        provider_id = "test_exploding"
        display_name = "לא אמור להיקרא"

        def search(self, category, params, ctx):  # pragma: no cover - must not run
            raise AssertionError("disabled provider was called")

    registry.register_adapter(Exploding())
    registry.ensure_configs(db)
    db.query(ProviderConfiguration).filter_by(provider_id="test_exploding").update({"enabled": False})
    db.commit()
    res = service.run_search(db, make_user().id, flight())
    runs = {p.provider_id: p for p in res.providers}
    assert runs["test_exploding"].status == "DISABLED"
    assert "מושבתים" in res.coverage_note
    assert res.status == "completed"


def test_all_providers_unavailable_gives_failed(db, make_user):
    registry.ensure_configs(db)
    db.query(ProviderConfiguration).filter(ProviderConfiguration.provider_id.in_(["demo_drive", "demo_rentway"])).update(
        {"enabled": False}, synchronize_session=False)
    db.commit()
    res = service.run_search(db, make_user().id, car())
    assert res.status == "failed" and res.offers == []
    assert "לא נמצאו הצעות" in res.coverage_note


def test_unsupported_destination(db, make_user):
    res = service.run_search(db, make_user().id, hotel(destination="Atlantis"))
    assert res.status == "failed"
    assert {p.status for p in res.providers if p.mode == "DEMO"} == {"UNSUPPORTED"}
    assert "אינם תומכים" in res.coverage_note


def test_live_placeholders_never_touch_network(db, make_user, monkeypatch):
    def boom(*a, **k):  # pragma: no cover - must never be called
        raise AssertionError("network access attempted")

    monkeypatch.setattr(socket.socket, "connect", boom)
    monkeypatch.setattr(socket, "create_connection", boom)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", boom)
    # Credentials present but no explicit opt-in => still NOT_CONFIGURED
    monkeypatch.setenv("ORI_DUFFEL_ACCESS_TOKEN", "duffel_test_dummy")
    monkeypatch.setenv("ORI_VIATOR_API_KEY", "dummy")
    reset_settings_cache()
    user = make_user()
    for body in (flight(), hotel(), car(), activity()):
        res = service.run_search(db, user.id, body)
        assert all(p.status == "NOT_CONFIGURED" for p in res.providers if p.mode == "LIVE")
    # With opt-in, partner-gated placeholders (Booking.com / Expedia) are configured but refuse
    # to search without making any request. (Duffel/Viator are real adapters now; their HTTP
    # behaviour is tested offline in tests/test_live_*.py.)
    monkeypatch.delenv("ORI_DUFFEL_ACCESS_TOKEN")
    monkeypatch.delenv("ORI_VIATOR_API_KEY")
    monkeypatch.setenv("ORI_BOOKING_DEMAND_API_KEY", "key-value")
    monkeypatch.setenv("ORI_BOOKING_DEMAND_AFFILIATE_ID", "123456")
    monkeypatch.setenv("ORI_LIVE_PROVIDERS_ENABLED", "true")
    reset_settings_cache()
    res = service.run_search(db, user.id, hotel(), use_cache=False)
    runs = {p.provider_id: p for p in res.providers}
    assert runs["booking_demand"].status == "UNSUPPORTED"
    assert runs["amadeus"].status == "NOT_CONFIGURED"  # discontinued
    assert runs["expedia_rapid"].status == "NOT_CONFIGURED"  # no credentials
    assert res.status == "completed"


# --------------------------------------------------------------------- filters


def test_flight_filters_max_price_and_stops(db, make_user):
    user = make_user()
    base = service.run_search(db, user.id, flight(destination="JFK"))
    prices = sorted(o.price.total.amount for o in base.offers)
    assert {o.details.max_stops for o in base.offers} >= {0, 1}
    cap = prices[len(prices) // 2]
    capped = service.run_search(db, user.id, flight(destination="JFK", max_price=str(cap)))
    assert capped.offers and all(o.price.total.amount <= cap for o in capped.offers)
    assert "סוננו" in capped.coverage_note
    nonstop = service.run_search(db, user.id, flight(destination="JFK", max_stops=0))
    assert nonstop.offers and all(o.details.max_stops == 0 for o in nonstop.offers)


def test_hotel_filters(db, make_user):
    user = make_user()
    res = service.run_search(db, user.id, hotel(min_stars=4, board="breakfast", free_cancellation_only=True))
    assert res.offers
    for o in res.offers:
        assert o.details.star_rating >= 4
        assert o.details.board != "room_only"
        assert o.cancellation.refundable is True
    acc = service.run_search(db, user.id, hotel(accessibility_required=True))
    assert acc.offers and all(o.details.accessibility_features for o in acc.offers)


def test_car_filters(db, make_user):
    user = make_user()
    res = service.run_search(db, user.id, car(transmission="automatic", min_seats=7))
    assert res.offers
    assert all(o.details.transmission == "automatic" and o.details.seats >= 7 for o in res.offers)
    compact = service.run_search(db, user.id, car(car_class="compact"))
    assert compact.offers and all(o.details.car_class == "compact" for o in compact.offers)


def test_activity_interest_and_age_filters(db, make_user):
    user = make_user()
    res = service.run_search(db, user.id, activity(interests=["museum"]))
    assert res.offers and all(o.details.category == "museum" for o in res.offers)
    young = service.run_search(db, user.id, activity(children_ages=[4]))
    assert all((o.details.min_age or 0) <= 4 for o in young.offers)


# ---------------------------------------------------------- validation/lookup


def test_run_search_validation_errors_are_hebrew_422(db, make_user):
    user = make_user()
    with pytest.raises(UnprocessableError) as exc:
        service.run_search(db, user.id, flight(adults=1, children_ages=[0, 1]))
    assert exc.value.status_code == 422 and "תינוק" in exc.value.message
    with pytest.raises(UnprocessableError):
        service.run_search(db, user.id, {"category": "boat"})
    params = FlightSearchParams(origin="TLV", destination="LCA", depart_date=future(20))
    assert service.run_search(db, user.id, params).status == "completed"


def test_get_offer_not_found(db):
    with pytest.raises(NotFoundError):
        service.get_offer(db, "missing")
    with pytest.raises(NotFoundError):
        service.get_offer_row(db, "x" * 500)


def test_re_rank_with_weights(db, make_user):
    user = make_user()
    res = service.run_search(db, user.id, flight())
    by_cost = service.get_search(db, res.search_id, viewer_id=user.id,
                                 weights={"cost": 100, "convenience": 0, "flexibility": 0, "quality": 0})
    amounts = [o.price.total.amount for o in by_cost.offers]
    assert amounts == sorted(amounts)
    assert by_cost.weights["cost"] == 100
    by_flex = service.get_search(db, res.search_id, viewer_id=user.id,
                                 weights={"cost": 0, "convenience": 0, "flexibility": 100, "quality": 0})
    assert by_flex.offers[0].cancellation.refundable is True
    assert Decimal(by_flex.offers[0].score.flexibility) == Decimal(100)
