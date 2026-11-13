"""verify-providers: verdicts come from the provider responses; the token value is never printed."""

from __future__ import annotations

import httpx
import pytest

from app import cli
from app.modules.providers import verify
from app.modules.providers.live.duffel import DuffelAdapter, reset_daily_search_counter
from tests.test_live_common import Recorder, enable_live
from tests.test_live_duffel import LIVE_TOKEN, TOKEN, duffel_handler


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    reset_daily_search_counter()
    rec = Recorder(duffel_handler)
    monkeypatch.setattr(verify, "DuffelAdapter", lambda: DuffelAdapter(transport=rec.transport))
    monkeypatch.setattr("app.modules.comparison.fx.fx_rates", lambda: _FakeFx())
    yield
    reset_daily_search_counter()


class _FakeFx:
    mode = "LIVE"
    source = "European Central Bank reference rates"
    base = "EUR"
    rates = {"USD": "1.1", "ILS": "3.5"}
    warning = None

    class as_of:  # noqa: N801
        @staticmethod
        def date():
            import datetime

            return datetime.date(2026, 11, 12)


def test_token_kind():
    assert verify.token_kind(None) == "missing"
    assert verify.token_kind(TOKEN) == "test"
    assert verify.token_kind(LIVE_TOKEN) == "live"
    assert verify.token_kind("abc") == "invalid"


def test_all_verified_with_sandbox_offers(monkeypatch, capsys):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=TOKEN, ORI_FX_LIVE_ENABLED="true")
    code = cli.main(["verify-providers"])
    out = capsys.readouterr().out
    assert code == 0, out
    assert "SECRET" not in out
    assert "SANDBOX" in out and "live_mode=['False']" in out


def test_live_token_is_refused_before_any_request(monkeypatch, capsys):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=LIVE_TOKEN, ORI_FX_LIVE_ENABLED="true")
    assert cli.main(["verify-providers"]) == 1
    out = capsys.readouterr().out
    assert "טוקן חי" in out and "SECRET" not in out


def test_offers_marked_live_by_duffel_fail_the_sandbox_verification(monkeypatch, capsys):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=TOKEN, ORI_FX_LIVE_ENABLED="true")

    def live_handler(request: httpx.Request) -> httpx.Response:
        res = duffel_handler(request)
        if request.method == "GET" and request.url.path == "/air/offers":
            data = res.json()
            for o in data["data"]:
                o["live_mode"] = True
            return httpx.Response(200, json=data)
        return res

    rec = Recorder(live_handler)
    monkeypatch.setattr(verify, "DuffelAdapter", lambda: DuffelAdapter(transport=rec.transport))
    assert cli.main(["verify-providers"]) == 1
    assert "✗ חיפוש Duffel" in capsys.readouterr().out
