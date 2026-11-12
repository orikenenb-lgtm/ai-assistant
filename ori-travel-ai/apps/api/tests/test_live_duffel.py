"""Duffel LIVE adapter — every HTTP behaviour is exercised against httpx.MockTransport fixtures."""

from __future__ import annotations

import copy
import json
import logging
from datetime import date, timedelta
from decimal import Decimal

import httpx
import pytest

from app.core.config import reset_settings_cache
from app.core.db import utcnow
from app.modules.providers import registry
from app.modules.providers.base import (
    ProviderError,
    ProviderNotConfiguredError,
    ProviderRateLimitedError,
    ProviderTimeoutError,
    ProviderUnsupportedError,
    RawOffer,
    SearchContext,
)
from app.modules.providers.live.duffel import (
    DuffelAdapter,
    parse_iso_duration_minutes,
    reset_daily_search_counter,
    searches_used_today,
)
from app.modules.providers.normalization import NormalizationError, finalize_offer, validate_breakdown
from app.modules.providers.service import reset_health_cache
from app.schemas.offers import CanonicalOffer
from app.schemas.search import FlightSearchParams
from tests.test_live_common import Recorder, enable_live, load_json

TOKEN = "duffel_test_SECRETSECRET123456"
LIVE_TOKEN = "duffel_live_SECRETSECRET123456"


@pytest.fixture(autouse=True)
def _clean():
    registry.reset_registry()
    reset_health_cache()
    reset_daily_search_counter()
    yield
    reset_daily_search_counter()
    registry.reset_registry()
    reset_health_cache()


def params(**kw) -> FlightSearchParams:
    body = {"origin": "TLV", "destination": "LHR", "depart_date": date.today() + timedelta(days=30),
            "return_date": date.today() + timedelta(days=37), "adults": 2, "children_ages": [8]}
    body.update(kw)
    return FlightSearchParams(**body)


def ctx(settings: dict | None = None) -> SearchContext:
    return SearchContext("s1", utcnow(), 5, settings or {})


def duffel_handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if request.method == "POST" and path == "/air/offer_requests":
        return httpx.Response(201, json=load_json("duffel_offer_request.json"))
    if request.method == "GET" and path == "/air/offers":
        return httpx.Response(200, json=load_json("duffel_offers_list.json"))
    if request.method == "GET" and path.startswith("/air/offers/"):
        return httpx.Response(200, json=load_json("duffel_offer_single.json"))
    if path == "/air/airlines":
        return httpx.Response(200, json=load_json("duffel_airlines.json"))
    return httpx.Response(404, json={"errors": []})


@pytest.fixture
def live(monkeypatch):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=TOKEN)


def adapter_with(handler=duffel_handler) -> tuple[DuffelAdapter, Recorder]:
    rec = Recorder(handler)
    return DuffelAdapter(transport=rec.transport), rec


def normalized(adapter: DuffelAdapter, raw: RawOffer) -> CanonicalOffer:
    return finalize_offer(adapter, adapter.normalize("flight", raw, ctx()))


# ------------------------------------------------------------ not configured


def test_not_configured_makes_no_http_request(monkeypatch):
    adapter, rec = adapter_with()
    assert adapter.is_configured() is False
    with pytest.raises(ProviderNotConfiguredError):
        adapter.search("flight", params(), ctx())
    assert adapter.health().status == "NOT_CONFIGURED"
    # token present but live providers not enabled -> still not usable
    monkeypatch.setenv("ORI_DUFFEL_ACCESS_TOKEN", TOKEN)
    reset_settings_cache()
    assert adapter.is_configured() is False and registry.is_usable(adapter) is False
    with pytest.raises(ProviderNotConfiguredError):
        adapter.search("flight", params(), ctx())
    assert adapter.health().status == "NOT_CONFIGURED"
    assert rec.requests == []


def test_malformed_token_is_not_configured(monkeypatch):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN="not-a-duffel-token")
    adapter, rec = adapter_with()
    assert adapter.is_configured() is False
    with pytest.raises(ProviderNotConfiguredError):
        adapter.search("flight", params(), ctx())
    assert rec.requests == []


def test_capabilities_are_honest(live):
    caps = DuffelAdapter().capabilities()
    assert caps.mode == "LIVE" and caps.categories == ["flight"]
    assert caps.supports_revalidate and caps.supports_booking_options
    assert caps.supports_live_booking is False and caps.supports_hosted_checkout is False
    assert caps.deep_link_domains == [] and caps.requires_credentials == ["ORI_DUFFEL_ACCESS_TOKEN"]
    assert "50" in (caps.notes or "") and "50" in (caps.rate_limit_note or "")
    assert DuffelAdapter.implemented is True


# ----------------------------------------------------------------- search


def test_search_happy_path_request_shape(live):
    adapter, rec = adapter_with()
    raws = adapter.search("flight", params(max_stops=1, cabin="premium_economy"), ctx())
    assert [r.supplier_offer_id for r in raws] == ["off_0000A1B2C3D4E5F6G7H8", "off_0000Z9Y8X7W6V5U4T3S2"]
    assert raws[0].expires_at is not None and raws[0].payload["test_mode"] is True

    create, listing = rec.requests
    assert create.method == "POST" and create.url.host == "api.duffel.com" and create.url.scheme == "https"
    assert create.url.path == "/air/offer_requests" and create.url.params["return_offers"] == "false"
    assert create.headers["authorization"] == f"Bearer {TOKEN}"
    assert create.headers["duffel-version"] == "v2"
    assert create.headers["accept"] == "application/json" and create.headers["content-type"] == "application/json"
    assert create.headers["user-agent"].startswith("OriTravelAI/")
    body = json.loads(create.content)["data"]
    assert [s["origin"] for s in body["slices"]] == ["TLV", "LHR"]
    assert body["slices"][0]["departure_date"] == (date.today() + timedelta(days=30)).isoformat()
    assert body["passengers"] == [{"type": "adult"}, {"type": "adult"}, {"age": 8}]
    assert body["cabin_class"] == "premium_economy" and body["max_connections"] == 1

    assert listing.method == "GET" and listing.url.path == "/air/offers"
    assert listing.url.params["offer_request_id"] == "orq_0000ABCDEFGHIJKLMNOP"
    assert listing.url.params["sort"] == "total_amount" and listing.url.params["limit"] == "50"
    assert searches_used_today() == 1


def test_search_one_way_without_stop_limit_and_result_cap(live):
    adapter, rec = adapter_with()
    raws = adapter.search("flight", params(return_date=None, max_stops=3), ctx({"max_results": 1}))
    body = json.loads(rec.requests[0].content)["data"]
    assert len(body["slices"]) == 1 and "max_connections" not in body
    assert rec.requests[1].url.params["limit"] == "1" and len(raws) == 1


def test_search_rejects_other_categories(live):
    adapter, rec = adapter_with()
    with pytest.raises(ProviderUnsupportedError):
        adapter.search("hotel", params(), ctx())
    assert rec.requests == []


def test_search_ignores_items_without_valid_ids(live):
    data = load_json("duffel_offers_list.json")
    data["data"] += [{"id": "../../evil"}, {"nope": 1}, "str"]

    def handler(request):
        if request.url.path == "/air/offers":
            return httpx.Response(200, json=data)
        return duffel_handler(request)

    adapter, _ = adapter_with(handler)
    assert len(adapter.search("flight", params(), ctx())) == 2


def test_search_bad_offer_request_response(live):
    def handler(request):
        if request.method == "POST":
            return httpx.Response(201, json={"data": {"id": "../etc/passwd"}})
        return duffel_handler(request)

    adapter, rec = adapter_with(handler)
    with pytest.raises(ProviderError) as e:
        adapter.search("flight", params(), ctx())
    assert e.value.code == "BAD_RESPONSE" and len(rec.requests) == 1


# ----------------------------------------------------------------- errors


@pytest.mark.parametrize(
    ("response", "exc_type", "code", "retryable"),
    [
        (httpx.Response(401, json=load_json("duffel_error_401.json")), ProviderNotConfiguredError, "AUTH_FAILED", False),
        (httpx.Response(403, json={"errors": []}), ProviderError, "FORBIDDEN", False),
        (httpx.Response(422, json=load_json("duffel_error_422.json")), ProviderError, "VALIDATION_ERROR", False),
        (httpx.Response(500, text="boom"), ProviderError, "UPSTREAM_ERROR", True),
        (httpx.Response(200, content=b"<html>not json</html>"), ProviderError, "BAD_RESPONSE", False),
    ],
)
def test_search_error_paths(live, response, exc_type, code, retryable):
    adapter, _ = adapter_with(lambda r: response)
    with pytest.raises(exc_type) as e:
        adapter.search("flight", params(), ctx())
    assert e.value.code == code and e.value.retryable is retryable
    assert TOKEN not in e.value.message and e.value.message


def test_search_rate_limited_reads_reset_header(live):
    adapter, _ = adapter_with(lambda r: httpx.Response(429, json={"errors": [{"code": "rate_limit_exceeded"}]},
                                                      headers={"ratelimit-reset": "30"}))
    with pytest.raises(ProviderRateLimitedError) as e:
        adapter.search("flight", params(), ctx())
    assert e.value.retryable and e.value.retry_after_seconds == 30 and "30" in e.value.message


def test_search_timeout(live):
    def handler(request):
        raise httpx.ConnectTimeout("t", request=request)

    adapter, _ = adapter_with(handler)
    with pytest.raises(ProviderTimeoutError) as e:
        adapter.search("flight", params(), ctx())
    assert e.value.retryable


# --------------------------------------------------------- cost guard & modes


def test_daily_search_cap(live):
    adapter, rec = adapter_with()
    settings = {"daily_search_cap": 2}
    adapter.search("flight", params(), ctx(settings))
    adapter.search("flight", params(), ctx(settings))
    before = len(rec.requests)
    with pytest.raises(ProviderError) as e:
        adapter.search("flight", params(), ctx(settings))
    assert e.value.code == "DAILY_SEARCH_CAP" and e.value.retryable is False and "2" in e.value.message
    assert len(rec.requests) == before  # blocked BEFORE any network traffic
    assert searches_used_today() == 2
    # raising the cap re-enables searching; the default cap is 50
    adapter.search("flight", params(), ctx({"daily_search_cap": 3}))
    assert searches_used_today() == 3


def test_failed_searches_still_count_against_the_cap(live):
    adapter, _ = adapter_with(lambda r: httpx.Response(500))
    for _ in range(2):
        with pytest.raises(ProviderError):
            adapter.search("flight", params(), ctx())
    assert searches_used_today() == 2


def test_live_token_requires_explicit_setting(monkeypatch):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=LIVE_TOKEN)
    adapter, rec = adapter_with()
    assert adapter.is_configured() is True
    with pytest.raises(ProviderUnsupportedError) as e:
        adapter.search("flight", params(), ctx())
    assert e.value.code == "LIVE_MODE_NOT_ALLOWED" and rec.requests == []
    raws = adapter.search("flight", params(), ctx({"allow_live_mode": True}))
    assert raws and raws[0].payload["test_mode"] is False


# ------------------------------------------------------------- normalize


def test_normalize_round_trip_with_connection_child_baggage_conditions(live):
    adapter, _ = adapter_with()
    raw = adapter.search("flight", params(), ctx())[0]
    offer = normalized(adapter, raw)

    assert offer.category == "flight" and offer.source.mode == "LIVE" and offer.source.deep_link is None
    assert offer.source.provider_id == "duffel" and offer.source.supplier_offer_id == "off_0000A1B2C3D4E5F6G7H8"
    assert offer.source.note == "מצב בדיקה של Duffel — חברת תעופה בדיונית"
    assert offer.source.expires_at is not None
    assert any("נתוני בדיקה" in w for w in offer.warnings)
    assert offer.title == "תל אביב – לונדון"
    assert "Duffel Airways" in (offer.subtitle or "") and "הלוך-חזור" in (offer.subtitle or "")

    price = offer.price
    assert price.total.amount == Decimal("1284.60") and price.total.currency == "EUR"
    assert price.total_status == "known"
    assert {c.kind: c.amount.amount for c in price.components} == {"base": Decimal("1071.40"), "tax": Decimal("213.20")}
    assert price.per_person is not None and price.per_person.amount == Decimal("428.20")
    validate_breakdown(price)

    d = offer.details
    assert d.passengers == {"adult": 2, "child": 1}
    assert d.cabin == "economy" and d.fare_brand == "Economy Classic" and d.validating_carrier == "ZZ"
    assert len(d.slices) == 2 and d.max_stops == 1
    out, ret = d.slices
    assert (out.origin, out.destination, out.stops) == ("TLV", "LHR", 1)
    assert [s.flight_number for s in out.segments] == ["401", "822"]
    assert out.segments[0].carrier_code == "ZZ" and out.segments[0].carrier_name == "Duffel Airways"
    assert out.segments[1].operating_carrier_name == "Duffel Express" and out.segments[0].operating_carrier_name is None
    assert out.layovers_minutes == [100] and ret.layovers_minutes == [] and ret.stops == 0
    assert [s.duration_minutes for s in out.segments] == [125, 235] and out.duration_minutes == 460
    assert ret.duration_minutes == 280 and d.total_duration_minutes == 740
    # local wall-clock times keep their wall time and gain the airport's UTC offset
    dep = out.segments[0].departing_at
    assert (dep.hour, dep.minute) == (8, 15) and dep.utcoffset() == timedelta(hours=2)
    arr = out.segments[1].arriving_at
    assert (arr.hour, arr.minute) == (13, 55) and arr.utcoffset() == timedelta(0)
    assert out.segments[0].origin_name
    # baggage is read for the ADULT (child has no checked bag)
    assert d.baggage.checked_included == 1 and d.baggage.carry_on_included == 1
    # conditions
    c = offer.cancellation
    assert c.refundable is True and c.changeable is True
    assert c.change_fee is not None and c.change_fee.amount == Decimal("50.00") and c.change_fee.currency == "EUR"
    assert "100.00" in (c.policy_text or "") and "50.00" in (c.policy_text or "")
    assert offer.dedupe_key.startswith("flight:")
    CanonicalOffer.model_validate(offer.model_dump(mode="json"))


def test_normalize_one_way_basic_fare_and_requested_bag_warning(live):
    adapter, _ = adapter_with()
    raw = adapter.search("flight", params(return_date=None, destination="ATH", checked_bags=1), ctx())[1]
    offer = normalized(adapter, raw)
    assert len(offer.details.slices) == 1 and offer.details.max_stops == 0
    assert offer.details.baggage.checked_included == 0
    assert offer.cancellation.refundable is False and offer.cancellation.changeable is None
    assert any("מזוודות" in w for w in offer.warnings)
    assert offer.price.excluded_notes
    assert any("תשלום מיידי" in w for w in offer.warnings)


def test_live_mode_note_is_not_test_labeled(monkeypatch):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=LIVE_TOKEN)
    adapter, _ = adapter_with()
    raw = adapter.search("flight", params(), ctx({"allow_live_mode": True}))[0]
    raw.payload["offer"]["live_mode"] = True
    offer = normalized(adapter, raw)
    assert "בדיקה" not in (offer.source.note or "") and not any("נתוני בדיקה" in w for w in offer.warnings)


def _raw_with(mutate) -> RawOffer:
    offer = copy.deepcopy(load_json("duffel_offers_list.json")["data"][0])
    mutate(offer)
    return RawOffer("off_0000A1B2C3D4E5F6G7H8", {"offer": offer, "request": {}, "test_mode": True}, utcnow(), None)


def test_normalize_price_inconsistency_is_flagged(live):
    adapter = DuffelAdapter()

    def higher_total(o):
        o["total_amount"] = "1300.00"  # base+tax = 1284.60 -> 15.40 unexplained

    offer = normalized(adapter, _raw_with(higher_total))
    assert offer.price.total.amount == Decimal("1300.00") and offer.price.total_status == "estimated"
    assert any(c.kind == "fee" and c.status == "estimated" and c.amount.amount == Decimal("15.40") for c in offer.price.components)
    assert any("אינו תואם" in w for w in offer.warnings)

    def lower_total(o):
        o["total_amount"] = "1200.00"

    offer = normalized(adapter, _raw_with(lower_total))
    assert offer.price.total.amount == Decimal("1200.00") and offer.price.total_status == "estimated"
    assert len(offer.price.components) == 1 and any("אינו עקבי" in w for w in offer.warnings)

    def no_breakdown(o):
        o["base_amount"] = None
        o["tax_amount"] = None

    offer = normalized(adapter, _raw_with(no_breakdown))
    assert offer.price.total.amount == Decimal("1284.60") and offer.price.total_status == "known"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda o: o.update(total_amount="abc"),
        lambda o: o.update(total_amount="-5"),
        lambda o: o.update(total_currency="XXX"),
        lambda o: o.update(total_currency=None),
        lambda o: o.update(slices=[]),
        lambda o: o.update(passengers=[]),
        lambda o: o["slices"][0]["segments"][0].update(departing_at="garbage"),
        lambda o: o["slices"][0]["segments"][0].update(marketing_carrier=None, operating_carrier=None),
    ],
)
def test_normalize_rejects_unusable_payloads(live, mutate):
    adapter = DuffelAdapter()
    with pytest.raises(NormalizationError):
        adapter.normalize("flight", _raw_with(mutate), ctx())


def test_invalid_duration_falls_back_to_computed_value(live):
    def mutate(o):
        o["slices"][0]["segments"][0]["duration"] = "soon"
        o["slices"][0]["duration"] = None

    offer = DuffelAdapter().normalize("flight", _raw_with(mutate), ctx())
    assert offer.details.slices[0].segments[0].duration_minutes == 125
    assert offer.details.slices[0].duration_minutes == 125 + 235 + 100


def test_normalize_sanitizes_supplier_text_and_handles_unknown_airport(live):
    adapter = DuffelAdapter()

    def mutate(o):
        o["owner"]["name"] = "Evil <script>alert(1)</script> Air"
        o["slices"][0]["fare_brand_name"] = "Basic <b>X</b>"
        seg = o["slices"][1]["segments"][0]
        seg["origin"]["iata_code"] = "ZZZ"  # not in our geo table -> naive local time + warning
        seg["origin"]["city_name"] = "Nowhere"

    offer = normalized(adapter, _raw_with(mutate))
    assert "<script>" not in offer.model_dump_json() and "<b>" not in offer.model_dump_json()
    assert "<" not in (offer.subtitle or "")
    assert any("אזור זמן" in w for w in offer.warnings)
    assert offer.details.slices[1].segments[0].departing_at.tzinfo is None


@pytest.mark.parametrize(
    ("text", "minutes"),
    [("PT2H5M", 125), ("PT45M", 45), ("P1DT2H30M", 1590), ("PT0S", 0), ("PT90S", 1), ("P", None), ("PT", None),
     ("2h", None), (None, None), (125, None)],
)
def test_parse_iso_duration(text, minutes):
    assert parse_iso_duration_minutes(text) == minutes


# ------------------------------------------------------------ revalidate


def _fresh_offer(adapter: DuffelAdapter) -> CanonicalOffer:
    raw = adapter.search("flight", params(), ctx())[0]
    offer = normalized(adapter, raw)
    return offer.model_copy(update={"id": "offer-1"})


def _single(mutate):
    def handler(request):
        if request.url.path.startswith("/air/offers/"):
            data = copy.deepcopy(load_json("duffel_offer_single.json"))
            mutate(data["data"])
            return httpx.Response(200, json=data)
        return duffel_handler(request)

    return handler


def test_revalidate_unchanged(live):
    adapter, rec = adapter_with()
    offer = _fresh_offer(adapter)
    res = adapter.revalidate(offer)
    assert res.status == "unchanged" and res.offer_id == "offer-1"
    assert res.new_total == offer.price.total and res.refreshed_offer is not None
    assert res.refreshed_offer.id == "offer-1" and res.refreshed_offer.source.mode == "LIVE"
    assert rec.requests[-1].method == "GET" and rec.requests[-1].url.path == "/air/offers/off_0000A1B2C3D4E5F6G7H8"


def test_revalidate_price_changed(live):
    adapter, _ = adapter_with()
    offer = _fresh_offer(adapter)
    adapter._transport = Recorder(_single(lambda o: o.update(total_amount="1320.60", tax_amount="249.20"))).transport
    res = adapter.revalidate(offer)
    assert res.status == "price_changed"
    assert res.new_total is not None and res.new_total.amount == Decimal("1320.60")
    assert "1284.60" in res.message and "1320.60" in res.message
    assert res.refreshed_offer is not None and res.refreshed_offer.price.total.amount == Decimal("1320.60")


def test_revalidate_expired_by_404_and_by_expires_at(live):
    adapter, _ = adapter_with()
    offer = _fresh_offer(adapter)
    adapter._transport = Recorder(lambda r: httpx.Response(404, json={"errors": [{"code": "not_found"}]})).transport
    assert adapter.revalidate(offer).status == "expired"
    adapter._transport = Recorder(_single(lambda o: o.update(expires_at="2020-01-01T00:00:00Z"))).transport
    res = adapter.revalidate(offer)
    assert res.status == "expired" and res.new_total is None


def test_revalidate_errors(live):
    adapter, rec = adapter_with()
    offer = _fresh_offer(adapter)
    foreign = offer.model_copy(update={"source": offer.source.model_copy(update={"provider_id": "other"})})
    assert adapter.revalidate(foreign).status == "error"
    bad_id = offer.model_copy(update={"source": offer.source.model_copy(update={"supplier_offer_id": "../x"})})
    n = len(rec.requests)
    assert adapter.revalidate(bad_id).status == "error" and len(rec.requests) == n
    adapter._transport = Recorder(lambda r: httpx.Response(500)).transport
    with pytest.raises(ProviderError):  # surfaced as status "error" by providers.service.revalidate_offer
        adapter.revalidate(offer)
    adapter._transport = Recorder(_single(lambda o: o.update(total_amount="oops"))).transport
    assert adapter.revalidate(offer).status == "error"


# --------------------------------------------------------- booking / health


def test_booking_options_never_offer_checkout_or_live_booking(live):
    adapter, _ = adapter_with()
    offer = _fresh_offer(adapter)
    opts = adapter.booking_options(offer)
    assert opts.hosted_checkout_url is None and opts.live_api_booking is False and opts.simulation_available is False
    assert "Duffel" in opts.instructions and "אינטגרציית הזמנות נפרדת" in opts.instructions


def test_health_ok_and_failures(live):
    adapter, rec = adapter_with()
    h = adapter.health()
    assert h.status == "OK" and h.latency_ms is not None and "בדיקה" in h.message
    assert rec.requests[0].url.path == "/air/airlines" and rec.requests[0].url.params["limit"] == "1"
    assert rec.requests[0].headers["authorization"] == f"Bearer {TOKEN}"
    cases = [(401, "NOT_CONFIGURED"), (403, "FAILED"), (429, "DEGRADED"), (500, "FAILED")]
    for status, expected in cases:
        a, _ = adapter_with(lambda r, s=status: httpx.Response(s, json={}))
        assert a.health().status == expected, status

    def boom(request):
        raise httpx.ReadTimeout("x", request=request)

    assert adapter_with(boom)[0].health().status == "FAILED"


# --------------------------------------------------------- secrets / logs


def test_token_never_appears_in_logs_or_error_messages(live, caplog):
    caplog.set_level(logging.DEBUG)
    messages: list[str] = []
    for response in (httpx.Response(401, json=load_json("duffel_error_401.json")), httpx.Response(500, text=f"echo {TOKEN}"),
                     httpx.Response(429, json={}), httpx.Response(200, text=f"{TOKEN} not json")):
        adapter, _ = adapter_with(lambda r, resp=response: resp)
        with pytest.raises(ProviderError) as e:
            adapter.search("flight", params(), ctx())
        messages.append(e.value.message)
        messages.append(repr(e.value))

    def timeout(request):
        raise httpx.ConnectTimeout(f"timeout talking with {TOKEN}", request=request)

    with pytest.raises(ProviderTimeoutError) as e:
        adapter_with(timeout)[0].search("flight", params(), ctx())
    messages.append(e.value.message)
    adapter_with()[0].search("flight", params(), ctx())
    adapter_with()[0].health()
    assert TOKEN not in caplog.text and "SECRETSECRET" not in caplog.text
    assert all("SECRETSECRET" not in m for m in messages)
    assert caplog.records  # logging did happen (we are not asserting on silence)


# ------------------------------------------------------ orchestrator wiring


def test_search_service_end_to_end_with_mock_transport(live, db, make_user):
    from app.modules.search import service

    adapter, _ = adapter_with()
    with registry.override_adapters(adapter, replace_all=True):
        body = {"category": "flight", "origin": "TLV", "destination": "LHR",
                "depart_date": (date.today() + timedelta(days=30)).isoformat(),
                "return_date": (date.today() + timedelta(days=37)).isoformat(), "adults": 2, "children_ages": [8]}
        res = service.run_search(db, make_user().id, body, use_cache=False)
    runs = {p.provider_id: p for p in res.providers}
    assert runs["duffel"].status == "OK" and runs["duffel"].result_count == 2
    assert res.has_live_results and not res.has_demo_results
    assert {o.source.provider_id for o in res.offers} == {"duffel"}
    assert all(o.source.mode == "LIVE" and o.source.deep_link is None for o in res.offers)
