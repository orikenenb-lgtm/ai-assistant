"""Viator LIVE adapter (Basic affiliate search) — offline, httpx.MockTransport."""

from __future__ import annotations

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
    ProviderUnsupportedError,
    SearchContext,
)
from app.modules.providers.live.viator import VIATOR_DESTINATION_IDS, ViatorAdapter
from app.modules.providers.normalization import NormalizationError, finalize_offer, validate_breakdown
from app.modules.providers.service import reset_health_cache
from app.schemas.search import ActivitySearchParams
from tests.test_live_common import Recorder, enable_live, load_json

KEY = "viator-secret-key-0123456789"


@pytest.fixture(autouse=True)
def _clean():
    registry.reset_registry()
    reset_health_cache()
    yield
    registry.reset_registry()
    reset_health_cache()


@pytest.fixture
def live(monkeypatch):
    enable_live(monkeypatch, ORI_VIATOR_API_KEY=KEY)


def params(**kw) -> ActivitySearchParams:
    body = {"destination": "Rome", "date_from": date.today() + timedelta(days=30), "date_to": date.today() + timedelta(days=33),
            "adults": 2, "children_ages": [9], "currency": "USD"}
    body.update(kw)
    return ActivitySearchParams(**body)


def ctx(settings: dict | None = None) -> SearchContext:
    return SearchContext("s1", utcnow(), 5, settings or {})


def handler(request: httpx.Request) -> httpx.Response:
    if request.method == "POST" and request.url.path == "/partner/products/search":
        return httpx.Response(200, json=load_json("viator_products_search.json"))
    return httpx.Response(404, json={})


def adapter_with(h=handler) -> tuple[ViatorAdapter, Recorder]:
    rec = Recorder(h)
    return ViatorAdapter(transport=rec.transport), rec


def test_not_configured_makes_no_http_request(monkeypatch):
    adapter, rec = adapter_with()
    with pytest.raises(ProviderNotConfiguredError):
        adapter.search("activity", params(), ctx())
    assert adapter.health().status == "NOT_CONFIGURED"
    monkeypatch.setenv("ORI_VIATOR_API_KEY", KEY)  # key without opt-in
    reset_settings_cache()
    assert adapter.is_configured() is False and registry.is_usable(adapter) is False
    with pytest.raises(ProviderNotConfiguredError):
        adapter.search("activity", params(), ctx())
    assert rec.requests == []


def test_capabilities(live):
    caps = ViatorAdapter().capabilities()
    assert caps.categories == ["activity"] and caps.deep_link_domains == ["viator.com"]
    assert caps.supports_booking_options and caps.supports_hosted_checkout
    assert caps.supports_live_booking is False and caps.supports_revalidate is False
    assert "החל מ" in (caps.notes or "") and caps.requires_credentials == ["ORI_VIATOR_API_KEY"]


def test_search_request_shape(live):
    adapter, rec = adapter_with()
    raws = adapter.search("activity", params(), ctx())
    assert [r.supplier_offer_id for r in raws] == ["5010SYDNEY", "7788ROME", "NOPRICE1"]
    (req,) = rec.requests
    assert req.url.scheme == "https" and req.url.host == "api.viator.com" and req.url.path == "/partner/products/search"
    assert req.headers["exp-api-key"] == KEY
    assert req.headers["accept"] == "application/json;version=2.0"
    assert req.headers["accept-language"] == "en-US"
    body = json.loads(req.content)
    assert body["filtering"]["destination"] == VIATOR_DESTINATION_IDS["ROM"]
    assert body["filtering"]["startDate"] == (date.today() + timedelta(days=30)).isoformat()
    assert body["pagination"] == {"start": 1, "count": 20} and body["currency"] == "USD"


def test_search_sandbox_hebrew_currency_fallback_and_count(live):
    adapter, rec = adapter_with(lambda r: httpx.Response(200, json=load_json("viator_products_search.json")))
    adapter.search("activity", params(currency="ILS"), ctx({"environment": "sandbox", "language": "he", "max_results": 5}))
    (req,) = rec.requests
    assert req.url.host == "api.sandbox.viator.com" and req.headers["accept-language"] == "he"
    body = json.loads(req.content)
    assert body["currency"] == "USD" and body["pagination"]["count"] == 5


def test_search_unsupported_destination_and_category(live):
    adapter, rec = adapter_with()
    with pytest.raises(ProviderUnsupportedError) as e:
        adapter.search("activity", params(destination="Eilat"), ctx())
    assert e.value.code == "UNSUPPORTED_LOCATION"
    with pytest.raises(ProviderUnsupportedError):
        adapter.search("activity", params(destination="Atlantis"), ctx())
    with pytest.raises(ProviderUnsupportedError):
        adapter.search("hotel", params(), ctx())
    assert rec.requests == []


@pytest.mark.parametrize(
    ("response", "exc_type", "retryable"),
    [
        (httpx.Response(401, json={}), ProviderNotConfiguredError, False),
        (httpx.Response(403, json={}), ProviderError, False),
        (httpx.Response(429, json={}, headers={"retry-after": "9"}), ProviderRateLimitedError, True),
        (httpx.Response(500, text="x"), ProviderError, True),
        (httpx.Response(200, text="<<not json"), ProviderError, False),
        (httpx.Response(200, json={"products": "nope"}), ProviderError, False),
    ],
)
def test_search_error_paths(live, response, exc_type, retryable):
    adapter, _ = adapter_with(lambda r: response)
    with pytest.raises(exc_type) as e:
        adapter.search("activity", params(), ctx())
    assert e.value.retryable is retryable and KEY not in e.value.message


def test_normalize_estimated_from_price_and_allowlisted_link(live):
    adapter, _ = adapter_with()
    raws = adapter.search("activity", params(), ctx())
    offer = finalize_offer(adapter, adapter.normalize("activity", raws[0], ctx()))
    assert offer.source.mode == "LIVE" and offer.source.provider_id == "viator"
    assert offer.source.supplier_offer_id == "5010SYDNEY"
    # "from" price 59.50 x 3 travellers = 178.50, explicitly an ESTIMATE
    assert offer.price.total.amount == Decimal("178.50") and offer.price.total.currency == "USD"
    assert offer.price.total_status == "estimated"
    assert offer.price.components[0].status == "estimated"
    assert offer.price.per_person is not None and offer.price.per_person.amount == Decimal("59.50")
    validate_breakdown(offer.price)
    assert any("החל מ" in w and "זמינות" in w for w in offer.warnings)
    assert offer.source.deep_link and offer.source.deep_link.startswith("https://www.viator.com/tours/")
    d = offer.details
    assert d.kind == "activity" and d.activity_id == "5010SYDNEY" and d.duration_minutes == 210
    assert d.rating == 4.7 and d.review_count == 2350 and d.participants == {"adult": 2, "child": 1}
    assert d.available_dates == [] and d.city == "רומא"
    assert "<b>" not in offer.title and "<script>" not in (d.description or "") and "Underground" in offer.title
    assert offer.cancellation.refundable is None
    assert "sandbox" not in (offer.source.note or "")


def test_normalize_drops_foreign_domain_link(live):
    adapter, _ = adapter_with()
    raws = adapter.search("activity", params(), ctx())
    offer = finalize_offer(adapter, adapter.normalize("activity", raws[1], ctx()))
    assert offer.source.deep_link is None
    assert any("קישור הספק הוסר" in w for w in offer.warnings)
    assert offer.price.total.amount == Decimal("267.00")  # string price "89.00" x 3
    assert offer.details.duration_minutes == 120 and offer.details.rating is None
    assert adapter.booking_options(offer).hosted_checkout_url is None


def test_normalize_rejects_product_without_price(live):
    adapter, _ = adapter_with()
    raws = adapter.search("activity", params(), ctx())
    with pytest.raises(NormalizationError):
        adapter.normalize("activity", raws[2], ctx())


def test_booking_options_affiliate_link_only(live):
    adapter, _ = adapter_with()
    offer = finalize_offer(adapter, adapter.normalize("activity", adapter.search("activity", params(), ctx())[0], ctx()))
    opts = adapter.booking_options(offer)
    assert opts.hosted_checkout_url == offer.source.deep_link
    assert opts.live_api_booking is False and "Viator" in opts.instructions
    with pytest.raises(ProviderUnsupportedError):
        adapter.revalidate(offer)  # Basic access has no availability check


def test_health(live):
    adapter, rec = adapter_with()
    assert adapter.health().status == "OK"
    assert json.loads(rec.requests[0].content)["pagination"]["count"] == 1
    assert adapter_with(lambda r: httpx.Response(401, json={}))[0].health().status == "NOT_CONFIGURED"
    assert adapter_with(lambda r: httpx.Response(500))[0].health().status == "FAILED"


def test_key_never_logged(live, caplog):
    caplog.set_level(logging.DEBUG)
    adapter, _ = adapter_with(lambda r: httpx.Response(500, text=KEY))
    with pytest.raises(ProviderError) as e:
        adapter.search("activity", params(), ctx())
    adapter_with()[0].search("activity", params(), ctx())
    assert KEY not in caplog.text and KEY not in e.value.message
