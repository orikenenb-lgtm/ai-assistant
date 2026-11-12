"""Normalization helpers: price breakdowns, sanitization, deep links, dedupe keys."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.db import utcnow
from app.modules.providers import registry
from app.modules.providers.base import ProviderAdapter, SearchContext
from app.modules.providers.normalization import (
    DEEP_LINK_REMOVED_WARNING,
    NormalizationError,
    build_breakdown,
    clean_text,
    component,
    compute_dedupe_key,
    finalize_offer,
    money,
    sanitize_offer,
    validate_breakdown,
)
from app.schemas.search import FlightSearchParams


@pytest.fixture(autouse=True)
def _registry():
    registry.reset_registry()
    yield
    registry.reset_registry()


def _flight_offers(provider_id: str = "demo_skyline"):
    adapter = registry.get_adapter(provider_id)
    params = FlightSearchParams(origin="TLV", destination="ATH", depart_date=date.today() + timedelta(days=30),
                                return_date=date.today() + timedelta(days=36), adults=2)
    ctx = SearchContext(search_id="t", started_at=utcnow(), timeout_seconds=5)
    return [adapter.normalize("flight", r, ctx) for r in adapter.search("flight", params, ctx)]


# ------------------------------------------------------------------ text


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("<b>מלון</b> <script>alert(1)</script>טוב", "מלון alert(1) טוב"),
        ("&lt;img src=x onerror=alert(1)&gt;Hotel", "Hotel"),
        ("&amp;lt;script&amp;gt;x", "x"),
        ("line1\nline2\x00\x07end", "line1 line2 end"),
        ("abc\u202edcb\u2066x", "abcdcbx"),
        ("  multiple    spaces  ", "multiple spaces"),
        ("", None),
        (None, None),
        ("<p></p>", None),
    ],
)
def test_clean_text(raw, expected):
    assert clean_text(raw) == expected


def test_clean_text_caps_length_and_keeps_hebrew_marks():
    assert len(clean_text("א" * 1000, 50)) == 50
    assert clean_text("א" * 1000, 50).endswith("…")
    assert clean_text("שלום\u200fעולם") == "שלום\u200fעולם"  # RLM is legitimate in Hebrew text


def test_sanitize_offer_cleans_every_text_field():
    offer = _flight_offers()[0]
    dirty = offer.model_copy(update={
        "title": "<img src=x onerror=alert(1)>טיסה",
        "warnings": ["<b>שימו לב</b>", "<i></i>"],
        "cancellation": offer.cancellation.model_copy(update={"policy_text": "ללא החזר<script>x()</script>"}),
    })
    clean = sanitize_offer(dirty)
    assert clean.title == "טיסה"
    assert clean.warnings == ["שימו לב"]
    assert "<" not in clean.cancellation.policy_text
    assert clean.price == offer.price  # amounts untouched


# ----------------------------------------------------------------- money


def test_build_breakdown_totals_and_statuses():
    comps = [
        component("בסיס", "base", "100.10", "ILS"),
        component("מיסים", "tax", "20.05", "ILS"),
        component("מס עירוני", "tax", "12", "EUR", status="excluded", included=False),
        component("מזוודה (הערכה)", "extra", "50", "ILS", status="estimated", included=False),
    ]
    pb = build_breakdown(comps, "ILS", nights=2, persons=3)
    assert pb.total.amount == Decimal("120.15")
    assert pb.total_status == "known"
    assert pb.per_night.amount == Decimal("60.08")
    assert pb.per_person.amount == Decimal("40.05")
    validate_breakdown(pb)

    est = build_breakdown([component("בסיס", "base", "10", "ILS", status="estimated")], "ILS")
    assert est.total_status == "estimated"


def test_breakdown_inconsistencies_are_rejected():
    with pytest.raises(NormalizationError):
        component("x", "tax", "1", "ILS", status="excluded", included=True)
    with pytest.raises(NormalizationError):
        build_breakdown([component("x", "base", "1", "EUR")], "ILS")
    with pytest.raises(NormalizationError):
        build_breakdown([component("x", "base", "1", "ILS", included=False)], "ILS")
    pb = build_breakdown([component("x", "base", "10", "ILS"), component("y", "tax", "2", "ILS")], "ILS")
    tampered = pb.model_copy(update={"total": money("11", "ILS")})
    with pytest.raises(NormalizationError):
        validate_breakdown(tampered)
    wrong_status = pb.model_copy(update={"components": [
        pb.components[0].model_copy(update={"status": "estimated"}), pb.components[1]]})
    with pytest.raises(NormalizationError):
        validate_breakdown(wrong_status)


def test_money_quantizes_by_currency():
    assert money("10.005", "ILS").amount == Decimal("10.00")  # banker's rounding
    assert money("1234.6", "JPY").amount == Decimal("1235")


# ---------------------------------------------------------------- dedupe


def test_dedupe_key_ignores_price_and_provider_but_not_product():
    offer = _flight_offers()[0]
    key = compute_dedupe_key(offer)
    repriced = offer.model_copy(update={
        "price": build_breakdown([component("x", "base", "1", "ILS")], "ILS"),
        "source": offer.source.model_copy(update={"provider_id": "other", "provider_name": "אחר",
                                                  "supplier_offer_id": "OTHER-1"}),
    })
    assert compute_dedupe_key(repriced) == key
    other_brand = offer.model_copy(update={"details": offer.details.model_copy(update={"fare_brand": "אחר"})})
    assert compute_dedupe_key(other_brand) != key
    bags = offer.details.baggage.model_copy(update={"checked_included": 3})
    more_bags = offer.model_copy(update={"details": offer.details.model_copy(update={"baggage": bags})})
    assert compute_dedupe_key(more_bags) != key
    refundable = offer.model_copy(update={"cancellation": offer.cancellation.model_copy(
        update={"refundable": not offer.cancellation.refundable})})
    assert compute_dedupe_key(refundable) != key


def test_dedupe_key_respects_what_the_total_includes():
    offer = _flight_offers()[0]
    comps = [*offer.price.components,
             component("דמי נהג (הערכה)", "fee", "5", "ILS", status="estimated", included=False)]
    other = offer.model_copy(update={"price": build_breakdown(comps, "ILS")})
    assert compute_dedupe_key(other) != compute_dedupe_key(offer)


# -------------------------------------------------------------- finalize


class _LinkAdapter(ProviderAdapter):
    """Wraps a DEMO adapter but declares an allowlisted domain (test only)."""

    provider_id = "demo_skyline"

    def __init__(self):
        self.inner = registry.get_adapter("demo_skyline")

    def capabilities(self):
        return self.inner.capabilities().model_copy(update={"deep_link_domains": ["example-travel.com"]})

    def is_configured(self):
        return True

    def health(self):
        return self.inner.health()

    def search(self, category, params, ctx):
        return self.inner.search(category, params, ctx)

    def normalize(self, category, raw, ctx):
        return self.inner.normalize(category, raw, ctx)


@pytest.mark.parametrize(
    ("link", "kept"),
    [
        ("https://example-travel.com/offer/1", True),
        ("https://book.example-travel.com/offer/1", True),
        ("http://example-travel.com/offer/1", False),
        ("https://evilexample-travel.com/x", False),
        ("https://example-travel.com.evil.io/x", False),
        ("https://user:pw@example-travel.com/x", False),
        ("javascript:alert(1)", False),
        ("//example-travel.com/x", False),
    ],
)
def test_finalize_offer_enforces_deep_link_allowlist(link, kept):
    adapter = _LinkAdapter()
    offer = _flight_offers()[0]
    offer = offer.model_copy(update={"source": offer.source.model_copy(update={"deep_link": link})})
    final = finalize_offer(adapter, offer)
    if kept:
        assert final.source.deep_link == link
        assert DEEP_LINK_REMOVED_WARNING not in final.warnings
    else:
        assert final.source.deep_link is None
        assert DEEP_LINK_REMOVED_WARNING in final.warnings


def test_finalize_offer_rejects_identity_mode_and_price_mismatches():
    adapter = registry.get_adapter("demo_skyline")
    offer = _flight_offers()[0]
    with pytest.raises(NormalizationError):
        finalize_offer(registry.get_adapter("demo_aurora"), offer)
    with pytest.raises(NormalizationError):
        finalize_offer(adapter, offer.model_copy(update={"source": offer.source.model_copy(update={"mode": "LIVE"})}))
    bad_total = offer.price.model_copy(update={"total": money(offer.price.total.amount + 1, "ILS")})
    with pytest.raises(NormalizationError):
        finalize_offer(adapter, offer.model_copy(update={"price": bad_total}))
    final = finalize_offer(adapter, offer.model_copy(update={"dedupe_key": "forged", "id": "x"}))
    assert final.dedupe_key == compute_dedupe_key(offer)
    assert final.id == ""
