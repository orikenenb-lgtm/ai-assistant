"""Optional ECB live FX source (display only) — offline, httpx.MockTransport."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest

from app.core.config import reset_settings_cache
from app.modules.comparison import fx
from app.modules.comparison.fx import FxParseError, convert, fx_rates, parse_ecb_xml, rate
from app.schemas.common import Money
from tests.test_live_common import Recorder, load_text

XML = load_text("ecb_daily.xml")


@pytest.fixture(autouse=True)
def _clean():
    fx.reset_fx_cache()
    fx.set_fx_transport(None)
    yield
    fx.reset_fx_cache()
    fx.set_fx_transport(None)


def live_on(monkeypatch, handler) -> Recorder:
    monkeypatch.setenv("ORI_FX_LIVE_ENABLED", "true")
    reset_settings_cache()
    rec = Recorder(handler)
    fx.set_fx_transport(rec.transport)
    return rec


def ok(_request):
    return httpx.Response(200, content=XML.encode(), headers={"content-type": "text/xml"})


def test_disabled_by_default_never_fetches():
    rec = Recorder(ok)
    fx.set_fx_transport(rec.transport)
    out = fx_rates()
    assert out.mode == "DEMO" and out.warning is None and out.base == "USD"
    assert convert(Money(amount=Decimal("10"), currency="EUR"), "ILS").rate_mode == "DEMO"
    assert rec.requests == []


def test_parse_valid_fixture():
    parsed = parse_ecb_xml(XML.encode())
    assert parsed.as_of == datetime(2026, 11, 11, tzinfo=UTC)
    assert parsed.rates["USD"] == Decimal("1.1600") and parsed.rates["EUR"] == Decimal(1)
    assert set(parsed.rates) == {"EUR", "USD", "JPY", "GBP", "ILS", "CHF"}


@pytest.mark.parametrize(
    "payload",
    [
        b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]>'
        b'<Cube><Cube time="2026-11-11"><Cube currency="USD" rate="&a;"/></Cube></Cube>',
        b'<!doctype html><Cube/>',
        XML.replace("<gesmes:subject>", "<!ENTITY x 'y'><gesmes:subject>").encode(),
        b"<not-xml",
        b"\xff\xfe<\x00C\x00",
        b"<Cube><Cube time='2026-11-11'><Cube currency='USD' rate='abc'/></Cube></Cube>",
        b"<Cube><Cube time='2026-11-11'><Cube currency='USD' rate='-1'/></Cube></Cube>",
        b"<Cube><Cube time='2026-11-11'><Cube currency='usd' rate='1.1'/></Cube></Cube>",
        b"<Cube><Cube time='not-a-date'><Cube currency='USD' rate='1.1'/></Cube></Cube>",
        b"<Cube><Cube time='2026-11-11'/></Cube>",
        b"<Cube/>",
        b"<Cube>" + b" " * (70 * 1024) + b"</Cube>",
    ],
)
def test_parse_rejects_dangerous_or_bad_input(payload):
    with pytest.raises(FxParseError):
        parse_ecb_xml(payload)


def test_live_rates_and_cross_conversion(monkeypatch):
    rec = live_on(monkeypatch, ok)
    out = fx_rates()
    assert out.mode == "LIVE" and out.source == "European Central Bank reference rates"
    assert out.base == "EUR" and out.as_of == datetime(2026, 11, 11, tzinfo=UTC) and out.warning is None
    assert out.rates["ILS"] == Decimal("3.8000") and out.rates["EUR"] == Decimal(1)
    assert "AED" not in out.rates  # ECB does not publish it
    assert len(rec.requests) == 1 and str(rec.requests[0].url) == fx.ECB_URL

    conv = convert(Money(amount=Decimal("100.00"), currency="USD"), "ILS")  # 3.8 / 1.16 via EUR
    assert conv.rate_mode == "LIVE" and conv.rate_source == "European Central Bank reference rates"
    assert conv.rate == (Decimal("3.8") / Decimal("1.16")).quantize(Decimal("0.00000001"))
    assert conv.converted.amount == (Decimal("100") * conv.rate).quantize(Decimal("0.01"))
    assert conv.rate_timestamp == datetime(2026, 11, 11, tzinfo=UTC) and conv.original.amount == Decimal("100.00")
    assert convert(Money(amount=Decimal("100"), currency="EUR"), "JPY").converted.amount == Decimal("17500")  # 0 decimals
    assert rate("ILS", "ILS") == Decimal(1) and rate("EUR", "ILS") == Decimal("3.8").quantize(Decimal("0.00000001"))
    assert len(rec.requests) == 1  # cached (6h)


def test_currency_not_published_by_ecb_falls_back_to_labeled_demo(monkeypatch):
    live_on(monkeypatch, ok)
    conv = convert(Money(amount=Decimal("10"), currency="AED"), "ILS")
    assert conv.rate_mode == "DEMO" and conv.rate_source == "טבלת הדגמה סטטית"


def test_cache_ttl_six_hours(monkeypatch):
    rec = live_on(monkeypatch, ok)
    clock = {"t": 1000.0}
    monkeypatch.setattr(fx.time, "monotonic", lambda: clock["t"])
    fx_rates()
    clock["t"] += 5 * 3600
    fx_rates()
    assert len(rec.requests) == 1
    clock["t"] += 2 * 3600  # > 6h total
    fx_rates()
    assert len(rec.requests) == 2


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, text="err"),
        httpx.Response(200, content=b"<!DOCTYPE x [<!ENTITY a 'b'>]><Cube/>"),
        httpx.Response(200, content=b"garbage"),
        httpx.Response(302, headers={"location": "https://evil.example/"}),
    ],
)
def test_failures_fall_back_to_demo_with_warning(monkeypatch, response):
    live_on(monkeypatch, lambda r: response)
    out = fx_rates()
    assert out.mode == "DEMO" and out.base == "USD" and out.source == "טבלת הדגמה סטטית"
    assert out.warning and "שערי הדגמה" in out.warning
    assert convert(Money(amount=Decimal("10"), currency="USD"), "ILS").rate_mode == "DEMO"


def test_network_error_and_oversize_fall_back(monkeypatch):
    def boom(request):
        raise httpx.ConnectTimeout("t", request=request)

    live_on(monkeypatch, boom)
    assert fx_rates().warning
    fx.reset_fx_cache()
    live_on(monkeypatch, lambda r: httpx.Response(200, content=b"<a>" + b"x" * (200 * 1024) + b"</a>"))
    assert fx_rates().mode == "DEMO"


def test_failure_is_negatively_cached(monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    rec = live_on(monkeypatch, lambda r: httpx.Response(500))
    clock = {"t": 50.0}
    monkeypatch.setattr(fx.time, "monotonic", lambda: clock["t"])
    for _ in range(3):
        assert fx_rates().warning
    assert len(rec.requests) == 1  # not re-fetched on every call
    clock["t"] += fx.ECB_FAILURE_TTL_SECONDS + 1
    fx_rates()
    assert len(rec.requests) == 2
    assert any("ECB FX fetch failed" in r.message for r in caplog.records)


def test_fx_endpoint_reports_live_mode(monkeypatch, client, auth_client):
    live_on(monkeypatch, ok)
    body = auth_client("viewer").get("/api/fx/rates").json()
    assert body["mode"] == "LIVE" and body["base"] == "EUR" and body["as_of"].startswith("2026-11-11")
    assert body["source"] == "European Central Bank reference rates" and body["rates"]["USD"] == "1.1600"
