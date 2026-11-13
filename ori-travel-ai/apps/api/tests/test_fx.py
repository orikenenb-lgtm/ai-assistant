"""DEMO FX table: clearly labeled, display-only conversions."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.core.money import SUPPORTED_CURRENCIES
from app.modules.comparison.fx import DEMO_USD_RATES, FX_AS_OF, FxUnavailableError, convert, rate
from app.schemas.common import Money


def test_fx_rates_endpoint_is_labeled_demo(client, auth_client):
    assert client.get("/api/fx/rates").status_code == 401
    res = auth_client("viewer").get("/api/fx/rates")
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "DEMO"
    assert body["base"] == "USD"
    assert body["source"] == "טבלת הדגמה סטטית"
    assert body["as_of"].startswith(FX_AS_OF.date().isoformat())
    assert "הדגמה" in body["note"] and "לדירוג" in body["note"]
    assert set(body["rates"]) == set(SUPPORTED_CURRENCIES)
    assert all(isinstance(v, str) for v in body["rates"].values())
    assert body["rates"]["USD"] == "1"


def test_convert_is_labeled_and_preserves_original():
    original = Money(amount=Decimal("100.00"), currency="EUR")
    conv = convert(original, "ILS")
    assert conv.original == original
    assert conv.converted.currency == "ILS"
    assert conv.rate_mode == "DEMO" and conv.rate_source == "טבלת הדגמה סטטית"
    assert conv.rate_timestamp == FX_AS_OF
    assert conv.rate == (DEMO_USD_RATES["ILS"] / DEMO_USD_RATES["EUR"]).quantize(Decimal("0.00000001"))
    assert conv.converted.amount == (Decimal("100") * conv.rate).quantize(Decimal("0.01"))
    assert convert(Money(amount=Decimal("1000"), currency="ILS"), "JPY").converted.amount % 1 == 0
    assert rate("ILS", "ILS") == Decimal(1)


def test_convert_unknown_currency():
    with pytest.raises(FxUnavailableError):
        rate("USD", "XXX")
