"""Regression tests for the independent audit fixes owned by the Director (AUD-02/03/13/14/16/17/20)."""

from __future__ import annotations

import logging
from decimal import Decimal

import pytest

from app.core.config import Settings
from app.core.redaction import RedactingFilter, redact_text
from app.core.security import validate_password_strength
from app.modules.providers import registry


def test_invitation_token_redacted_in_paths():
    assert "AbCdEfGhIjKlMnOp" not in redact_text("GET /api/auth/invitations/AbCdEfGhIjKlMnOp_12 HTTP/1.1")
    assert "AbCdEfGhIjKlMnOp" not in redact_text("GET /invite/AbCdEfGhIjKlMnOp_12 HTTP/1.1")
    assert redact_text("POST /api/auth/invitations/accept") == "POST /api/auth/invitations/accept"


def test_uvicorn_access_logger_has_redacting_filter(app):
    assert any(isinstance(f, RedactingFilter) for f in logging.getLogger("uvicorn.access").filters)


def test_invitation_preview_by_body(client):
    res = client.post("/api/auth/invitations/preview", json={"token": "x" * 20})
    assert res.status_code == 404 and res.json()["error"]["code"] == "INVITATION_INVALID"


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://www.viator.com/tours/x", True),
        ("https://evil.com\\.viator.com/x", False),  # browsers navigate to evil.com
        ("https://viator.com.evil.example/x", False),
        ("https://user@viator.com/x", False),
        ("https://viator.com:8443/x", False),
        ("https://www.viator.com/a b", False),
        ("https://www.viator.com/‮x", False),
        ("http://www.viator.com/x", False),
        ("javascript:alert(1)//viator.com", False),
    ],
)
def test_deep_link_allowlist_rejects_ambiguous_urls(url, ok):
    assert registry.get_adapter("viator").is_allowed_deep_link(url) is ok


def test_chunked_body_over_limit_rejected(client):
    def gen():
        for _ in range(40):
            yield b"x" * 100_000  # 4 MB, no Content-Length header

    res = client.post("/api/auth/login", content=gen(), headers={"Content-Type": "application/json"})
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_untrusted_host_rejected(client):
    res = client.get("/api/health", headers={"Host": "evil.example"})
    assert res.status_code == 400


def test_cross_origin_with_spoofed_host_rejected(client):
    res = client.post(
        "/api/auth/login",
        json={"email": "a@b.co", "password": "x"},
        headers={"Host": "evil.example", "Origin": "https://evil.example"},
    )
    assert res.status_code == 400  # Host is not allowlisted


@pytest.mark.parametrize(
    ("password", "ok"),
    [
        ("aaaaaaaaa1", False),
        ("password123!", False),
        ("Abcdefghi1", True),
        ("Test-Password-123", True),
        ("correct horse battery staple", True),
        ("aaaaaaaaaaaaaaaaaaaaB1!", False),
    ],
)
def test_password_policy(password, ok):
    assert (validate_password_strength(password) is None) is ok


def test_production_requires_secure_settings():
    s = Settings(env="production", cookie_secure=False, data_key=None)
    problems = s.production_problems()
    assert any("COOKIE_SECURE" in p for p in problems) and any("DATA_KEY" in p for p in problems)
    assert Settings(env="development").production_problems() == []


def test_demo_never_hides_live_offer_in_dedupe(db, make_user):
    from datetime import date, timedelta

    from app.modules.search import service

    user = make_user()
    res = service.run_search(
        db, user.id, {"category": "hotel", "destination": "Rome",
                      "check_in": (date.today() + timedelta(days=30)).isoformat(),
                      "check_out": (date.today() + timedelta(days=33)).isoformat()},
    )
    demo = res.offers[0]
    cheaper = demo.price.total.model_copy(update={"amount": demo.price.total.amount - Decimal("1")})
    live = demo.model_copy(
        update={
            "source": demo.source.model_copy(update={"mode": "LIVE", "provider_id": "real_x", "provider_name": "Real"}),
            "price": demo.price.model_copy(update={"total": cheaper}),
        }
    )
    kept, merged = service.dedupe_offers([demo, live])
    assert merged == 0 and {o.source.mode for o in kept} == {"DEMO", "LIVE"}


def test_api_404_and_bad_json_envelopes(client):
    res = client.get("/api/definitely-missing")
    assert res.status_code == 404 and res.json()["error"]["request_id"]
    bad = client.post("/api/auth/login", content=b'{"email": "a@b.co", "password": ', headers={"Content-Type": "application/json"})
    assert bad.status_code == 422
    detail = bad.json()["error"]["details"][0]
    assert detail["type"] == "json_invalid" and detail["field"] == ""


def test_request_log_line_has_request_id(client, caplog):
    with caplog.at_level(logging.INFO, logger="ori.http"):
        res = client.get("/api/health", headers={"X-Request-ID": "abcdef1234567890"})
    assert res.headers["x-request-id"] == "abcdef1234567890"
    assert any("rid=abcdef1234567890" in r.getMessage() for r in caplog.records if r.name == "ori.http")


def test_huge_money_amount_is_422_not_500(auth_client):
    c = auth_client("owner")
    res = c.post("/api/trips", json={"title": "x", "budget": {"amount": "1" + "0" * 30, "currency": "ILS"}})
    assert res.status_code == 422
    res = c.post("/api/trips", json={"title": "x", "budget": {"amount": "NaN", "currency": "ILS"}})
    assert res.status_code == 422
    ok = c.post("/api/trips", json={"title": "x", "budget": {"amount": "12000.50", "currency": "ILS"}})
    assert ok.status_code == 201, ok.text
