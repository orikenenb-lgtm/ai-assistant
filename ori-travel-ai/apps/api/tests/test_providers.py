"""Provider registry, LIVE placeholders, deep-link allowlist and the providers API."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.core.config import reset_settings_cache
from app.core.db import utcnow
from app.core.errors import NotFoundError
from app.models import AuditEvent, ProviderConfiguration
from app.modules.providers import registry
from app.modules.providers.base import ProviderNotConfiguredError, ProviderUnsupportedError, SearchContext
from app.modules.providers.demo import DemoSkylineAdapter
from app.modules.providers.live import LIVE_ADAPTER_CLASSES
from app.modules.providers.service import reset_health_cache
from app.schemas.search import FlightSearchParams, HotelSearchParams


@pytest.fixture(autouse=True)
def _registry():
    registry.reset_registry()
    reset_health_cache()
    yield
    registry.reset_registry()
    reset_health_cache()


FLIGHT = {"origin": "TLV", "destination": "PRG", "depart_date": (date.today() + timedelta(days=21)).isoformat(),
          "adults": 2}
HOTEL = {"destination": "Rome", "check_in": (date.today() + timedelta(days=21)).isoformat(),
         "check_out": (date.today() + timedelta(days=24)).isoformat()}

EXPECTED_LIVE = {
    "duffel": (["flight"], ["ORI_DUFFEL_ACCESS_TOKEN"]),
    "amadeus": (["flight", "hotel"], ["ORI_AMADEUS_CLIENT_ID", "ORI_AMADEUS_CLIENT_SECRET"]),
    "booking_demand": (["hotel"], ["ORI_BOOKING_DEMAND_API_KEY", "ORI_BOOKING_DEMAND_AFFILIATE_ID"]),
    "expedia_rapid": (["hotel"], ["ORI_EXPEDIA_RAPID_API_KEY", "ORI_EXPEDIA_RAPID_SHARED_SECRET"]),
    "viator": (["activity"], ["ORI_VIATOR_API_KEY"]),
}


# ------------------------------------------------------------------ registry


def test_registry_lists_demo_and_live_adapters():
    ids = [a.provider_id for a in registry.all_adapters()]
    assert len(ids) == len(set(ids))
    for category in ("flight", "hotel", "car", "activity"):
        demo = [a for a in registry.adapters_for_category(category) if a.capabilities().mode == "DEMO"]
        assert len(demo) >= 2, category
        for a in demo:
            caps = a.capabilities()
            assert caps.supports_revalidate and caps.supports_booking_options
            assert not caps.supports_live_booking and not caps.requires_credentials
            assert registry.is_usable(a)
    assert registry.get_adapter("demo_skyline").capabilities().display_name == "דמו סקייליין"
    with pytest.raises(NotFoundError):
        registry.get_adapter("nope")


def test_registry_test_hooks():
    class Extra(DemoSkylineAdapter):
        provider_id = "test_extra"
        display_name = "נוסף"

    with registry.override_adapters(Extra()):
        assert registry.find_adapter("test_extra") is not None
    assert registry.find_adapter("test_extra") is None
    with registry.override_adapters(Extra(), replace_all=True):
        assert [a.provider_id for a in registry.all_adapters()] == ["test_extra"]
    assert registry.find_adapter("demo_skyline") is not None
    registry.register_adapter(Extra())
    registry.unregister_adapter("test_extra")
    assert registry.find_adapter("test_extra") is None


def test_live_placeholders_are_not_configured_by_default():
    live = {a.provider_id: a for a in registry.all_adapters() if a.capabilities().mode == "LIVE"}
    assert set(live) == set(EXPECTED_LIVE) == {c.provider_id for c in LIVE_ADAPTER_CLASSES}
    params = FlightSearchParams(**FLIGHT)
    ctx = SearchContext(search_id="t", started_at=utcnow(), timeout_seconds=1)
    for pid, (categories, env) in EXPECTED_LIVE.items():
        a = live[pid]
        caps = a.capabilities()
        assert caps.categories == categories
        assert caps.requires_credentials == env
        assert caps.official_docs_url and caps.official_docs_url.startswith("https://")
        assert caps.supports_live_booking is False
        assert a.is_configured() is False and registry.is_usable(a) is False
        assert a.health().status == "NOT_CONFIGURED"
        with pytest.raises(ProviderNotConfiguredError):
            a.search(categories[0], params, ctx)


def test_live_requires_credentials_and_explicit_opt_in(monkeypatch):
    duffel = registry.get_adapter("duffel")
    monkeypatch.setenv("ORI_DUFFEL_ACCESS_TOKEN", "duffel_test_secret_value")
    reset_settings_cache()
    assert duffel.is_configured() is False  # credentials alone are not enough
    monkeypatch.setenv("ORI_LIVE_PROVIDERS_ENABLED", "true")
    reset_settings_cache()
    # Duffel is a real adapter now (B6): configured + usable; its HTTP behaviour is
    # covered offline in tests/test_live_duffel.py with httpx.MockTransport.
    assert duffel.is_configured() is True and registry.is_usable(duffel)
    # Partner-gated placeholders stay inert even with credentials + opt-in
    monkeypatch.setenv("ORI_BOOKING_DEMAND_API_KEY", "key-value")
    monkeypatch.setenv("ORI_BOOKING_DEMAND_AFFILIATE_ID", "123456")
    reset_settings_cache()
    booking = registry.get_adapter("booking_demand")
    assert booking.is_configured() is True
    assert booking.health().status == "DEGRADED"
    with pytest.raises(ProviderUnsupportedError):
        booking.search("hotel", HotelSearchParams(**HOTEL), SearchContext("t", utcnow(), 1))
    # Amadeus Self-Service was discontinued: never configured, whatever the env says
    amadeus = registry.get_adapter("amadeus")
    monkeypatch.setenv("ORI_AMADEUS_CLIENT_ID", "id-value")
    monkeypatch.setenv("ORI_AMADEUS_CLIENT_SECRET", "secret-value")
    reset_settings_cache()
    assert amadeus.is_configured() is False


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://booking.com/hotel/x", True),
        ("https://www.booking.com/hotel/x?aid=1", True),
        ("http://www.booking.com/hotel/x", False),
        ("https://booking.com.evil.example/x", False),
        ("https://notbooking.com/x", False),
        ("https://user@booking.com/x", False),
        ("ftp://booking.com/x", False),
        ("", False),
        (None, False),
    ],
)
def test_deep_link_allowlist(url, ok):
    assert registry.get_adapter("booking_demand").is_allowed_deep_link(url) is ok
    # DEMO adapters allow no deep links at all
    assert registry.get_adapter("demo_stayplus").is_allowed_deep_link(url) is False


# ------------------------------------------------------------------- API


def test_list_providers_requires_auth_and_hides_secrets(client, auth_client, monkeypatch):
    assert client.get("/api/providers").status_code == 401
    monkeypatch.setenv("ORI_VIATOR_API_KEY", "viator-very-secret-key")
    reset_settings_cache()
    c = auth_client("viewer")
    res = c.get("/api/providers")
    assert res.status_code == 200
    assert "viator-very-secret-key" not in res.text
    items = {p["provider_id"]: p for p in res.json()}
    assert items["demo_skyline"]["status"] == "OK" and items["demo_skyline"]["configured"] is True
    assert items["demo_skyline"]["mode"] == "DEMO" and items["demo_skyline"]["enabled"] is True
    for pid, (_cats, env) in EXPECTED_LIVE.items():
        assert items[pid]["status"] == "NOT_CONFIGURED"
        assert items[pid]["configured"] is False
        assert items[pid]["requires_credentials"] == env
        assert items[pid]["setup_doc"].startswith("https://")
        assert "ORI_LIVE_PROVIDERS_ENABLED" in items[pid]["setup_instructions"]
    single = c.get("/api/providers/demo_aurora")
    assert single.status_code == 200 and single.json()["provider_id"] == "demo_aurora"
    assert c.get("/api/providers/unknown").status_code == 404


def test_only_owner_can_configure_providers(auth_client, db):
    adult = auth_client("adult")
    viewer = auth_client("viewer")
    assert adult.put("/api/providers/demo_aurora", json={"enabled": False}).status_code == 403
    assert viewer.put("/api/providers/demo_aurora", json={"enabled": False}).status_code == 403
    owner = auth_client("owner")
    res = owner.put("/api/providers/demo_aurora", json={"enabled": False, "settings": {"max_results": 5}})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "DISABLED" and res.json()["settings"] == {"max_results": 5}
    db.expire_all()
    row = db.query(ProviderConfiguration).filter_by(provider_id="demo_aurora").one()
    assert row.enabled is False and row.updated_by_id == owner.user.id
    assert db.query(AuditEvent).filter_by(action="provider.update", entity_id="demo_aurora").count() == 1
    search = adult.post("/api/search/flight", json=FLIGHT).json()
    runs = {p["provider_id"]: p for p in search["providers"]}
    assert runs["demo_aurora"]["status"] == "DISABLED"
    assert all(o["source"]["provider_id"] != "demo_aurora" for o in search["offers"])
    assert owner.put("/api/providers/demo_aurora", json={"enabled": True}).json()["status"] == "OK"
    assert owner.put("/api/providers/nope", json={"enabled": True}).status_code == 404


@pytest.mark.parametrize(
    "settings",
    [
        {"api_key": "x"},
        {"access_token": "x"},
        {"client_secret": "x"},
        {"unknown_setting": 1},
        {"max_results": 0},
        {"max_results": "10"},
        {"revalidation_scenario": "explode"},
        {"Bad-Key": 1},
    ],
)
def test_provider_settings_must_be_declared_and_non_secret(auth_client, settings):
    owner = auth_client("owner")
    res = owner.put("/api/providers/demo_skyline", json={"enabled": True, "settings": settings})
    assert res.status_code == 422, settings
    assert res.json()["error"]["message"]


def test_simulated_error_setting_produces_partial_search(auth_client):
    owner = auth_client("owner")
    assert owner.put("/api/providers/demo_skyline",
                     json={"enabled": True, "settings": {"simulate_error": True}}).status_code == 200
    body = owner.post("/api/search/flight", json=FLIGHT).json()
    runs = {p["provider_id"]: p for p in body["providers"]}
    assert body["status"] == "partial"
    assert runs["demo_skyline"]["status"] == "FAILED" and runs["demo_skyline"]["error_code"] == "SIMULATED_ERROR"
    assert runs["demo_aurora"]["status"] == "OK"
    providers = {p["provider_id"]: p for p in owner.get("/api/providers").json()}
    assert providers["demo_skyline"]["status"] == "DEGRADED"


def test_health_check_roles_results_and_rate_limit(auth_client, monkeypatch):
    viewer = auth_client("viewer")
    assert viewer.post("/api/providers/demo_skyline/health-check").status_code == 403
    adult = auth_client("adult")
    res = adult.post("/api/providers/demo_skyline/health-check")
    assert res.status_code == 200 and res.json()["status"] == "OK"
    assert adult.post("/api/providers/duffel/health-check").json()["status"] == "NOT_CONFIGURED"
    assert adult.post("/api/providers/nope/health-check").status_code == 404
    listed = {p["provider_id"]: p for p in adult.get("/api/providers").json()}
    assert listed["demo_skyline"]["last_health"]["status"] == "OK"
    from app.modules.providers import router as providers_router

    monkeypatch.setattr(providers_router, "HEALTH_CHECK_LIMIT", 3)
    codes = [adult.post("/api/providers/demo_aurora/health-check").status_code for _ in range(3)]
    assert codes[-1] == 429


def test_diagnostics(auth_client):
    viewer = auth_client("viewer")
    assert viewer.get("/api/providers/diagnostics").status_code == 403
    adult = auth_client("adult")
    adult.post("/api/search/flight", json=FLIGHT)
    adult.post("/api/search/flight", json=FLIGHT)  # cache hit
    res = adult.get("/api/providers/diagnostics")
    assert res.status_code == 200
    data = {p["provider_id"]: p for p in res.json()["providers"]}
    sky = data["demo_skyline"]
    assert sky["runs"] == 1 and sky["ok_runs"] == 1 and sky["cached_runs"] == 1
    assert sky["success_rate"] == "100.0"
    assert sky["avg_latency_ms"] is not None and sky["last_run_status"] == "OK"
    assert data["duffel"]["runs"] == 0 and data["duffel"]["skipped_runs"] >= 1
    assert data["duffel"]["status"] == "NOT_CONFIGURED"


def test_configured_live_placeholder_is_degraded_not_ok(auth_client, monkeypatch):
    monkeypatch.setenv("ORI_LIVE_PROVIDERS_ENABLED", "true")
    monkeypatch.setenv("ORI_BOOKING_DEMAND_API_KEY", "key-value")
    monkeypatch.setenv("ORI_BOOKING_DEMAND_AFFILIATE_ID", "123456")
    reset_settings_cache()
    c = auth_client("adult")
    items = {p["provider_id"]: p for p in c.get("/api/providers").json()}
    assert items["booking_demand"]["configured"] is True and items["booking_demand"]["status"] == "DEGRADED"
    assert items["amadeus"]["status"] == "NOT_CONFIGURED"
    assert items["duffel"]["status"] == "NOT_CONFIGURED"  # no Duffel token in this test
    health = c.post("/api/providers/booking_demand/health-check").json()
    assert health["status"] == "DEGRADED"


def test_revalidate_offer_helper_uses_owner_settings(auth_client, db):
    from app.modules.providers.service import booking_options_for, revalidate_offer
    from app.modules.search.service import get_offer

    owner = auth_client("owner")
    offer_id = owner.post("/api/search/flight", json=FLIGHT).json()["offers"][0]["id"]
    offer = get_offer(db, offer_id)
    assert revalidate_offer(db, offer).status == "unchanged"
    pid = offer.source.provider_id
    assert owner.put(f"/api/providers/{pid}", json={"enabled": True,
                                                   "settings": {"revalidation_scenario": "price_changed"}}).status_code == 200
    db.expire_all()
    res = revalidate_offer(db, offer)
    assert res.status == "price_changed" and res.new_total.amount > offer.price.total.amount
    assert res.offer_id == offer_id
    opts = booking_options_for(offer)
    assert opts.simulation_available and opts.live_api_booking is False and opts.hosted_checkout_url is None
