"""Amadeus (discontinued), Booking.com Demand and Expedia Rapid (partner-gated placeholders)."""

from __future__ import annotations

import hashlib
from datetime import date, timedelta

import pytest

from app.core.config import reset_settings_cache
from app.core.db import utcnow
from app.modules.providers import registry
from app.modules.providers.base import ProviderNotConfiguredError, ProviderUnsupportedError, SearchContext
from app.modules.providers.live import (
    AmadeusAdapter,
    BookingDemandAdapter,
    ExpediaRapidAdapter,
)
from app.modules.providers.live.expedia_rapid import expedia_signature
from app.schemas.search import FlightSearchParams, HotelSearchParams
from tests.test_live_common import Recorder

FUTURE = date.today() + timedelta(days=30)
HOTEL = HotelSearchParams(destination="Rome", check_in=FUTURE, check_out=FUTURE + timedelta(days=3))
FLIGHT = FlightSearchParams(origin="TLV", destination="PRG", depart_date=FUTURE)


def ctx() -> SearchContext:
    return SearchContext("s", utcnow(), 2)


@pytest.fixture(autouse=True)
def _clean():
    registry.reset_registry()
    yield
    registry.reset_registry()


@pytest.fixture
def no_network(monkeypatch):
    """Any HTTP attempt through httpx fails the test."""
    rec = Recorder()

    def boom(self, request):  # pragma: no cover - must never run
        rec.requests.append(request)
        raise AssertionError("network access attempted")

    monkeypatch.setattr("httpx.HTTPTransport.handle_request", boom)
    return rec


def test_amadeus_is_always_disabled_even_with_credentials(monkeypatch, no_network):
    monkeypatch.setenv("ORI_LIVE_PROVIDERS_ENABLED", "true")
    monkeypatch.setenv("ORI_AMADEUS_CLIENT_ID", "id")
    monkeypatch.setenv("ORI_AMADEUS_CLIENT_SECRET", "secret")
    reset_settings_cache()
    a = AmadeusAdapter()
    assert a.is_configured() is False and registry.is_usable(a) is False
    h = a.health()
    assert h.status == "NOT_CONFIGURED" and "הופסק" in h.message and "2026" in h.message
    caps = a.capabilities()
    assert "הופסק" in (caps.notes or "") and "הופסק" in caps.display_name
    assert caps.requires_credentials == ["ORI_AMADEUS_CLIENT_ID", "ORI_AMADEUS_CLIENT_SECRET"]
    for cat, p in (("flight", FLIGHT), ("hotel", HOTEL)):
        with pytest.raises(ProviderNotConfiguredError) as e:
            a.search(cat, p, ctx())
        assert e.value.code == "DISCONTINUED"
    assert no_network.requests == []


@pytest.mark.parametrize(
    ("cls", "env"),
    [
        (BookingDemandAdapter, {"ORI_BOOKING_DEMAND_API_KEY": "k", "ORI_BOOKING_DEMAND_AFFILIATE_ID": "1"}),
        (ExpediaRapidAdapter, {"ORI_EXPEDIA_RAPID_API_KEY": "k", "ORI_EXPEDIA_RAPID_SHARED_SECRET": "s"}),
    ],
)
def test_partner_gated_placeholders_refuse(monkeypatch, no_network, cls, env):
    a = cls()
    # no credentials / no opt-in: not connected
    assert a.is_configured() is False and a.health().status == "NOT_CONFIGURED"
    with pytest.raises(ProviderNotConfiguredError):
        a.search("hotel", HOTEL, ctx())
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    reset_settings_cache()
    assert a.is_configured() is False  # credentials alone are not enough
    monkeypatch.setenv("ORI_LIVE_PROVIDERS_ENABLED", "true")
    reset_settings_cache()
    assert a.is_configured() is True
    h = a.health()
    assert h.status == "DEGRADED" and "נדרש אישור שותף" in h.message
    with pytest.raises(ProviderUnsupportedError) as e:
        a.search("hotel", HOTEL, ctx())
    assert e.value.code == "PARTNER_APPROVAL_REQUIRED" and "נדרש אישור שותף" in e.value.message
    assert cls.implemented is False
    caps = a.capabilities()
    assert caps.supports_live_booking is False and caps.requires_credentials == [f"ORI_{f.upper()}" for f in cls.credential_fields]
    assert no_network.requests == []


def test_expedia_signature_is_sha512_of_key_secret_timestamp():
    sig, ts = expedia_signature("my-key", "my-secret", 1_700_000_000)
    assert ts == 1_700_000_000
    assert sig == hashlib.sha512(b"my-keymy-secret1700000000").hexdigest() and len(sig) == 128
    sig2, ts2 = expedia_signature("my-key", "my-secret")
    assert abs(ts2 - int(utcnow().timestamp())) < 5 and sig2 != sig


def test_registry_lists_all_five_live_adapters():
    live = {a.provider_id for a in registry.all_adapters() if a.capabilities().mode == "LIVE"}
    assert live == {"duffel", "amadeus", "booking_demand", "expedia_rapid", "viator"}
