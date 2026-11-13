"""SANDBOX data mode: a real supplier API answering from its TEST environment (Duffel test mode).

Rules: the offer's own ``live_mode`` flag decides (token prefix only as fallback); SANDBOX offers are never counted as
live results, never merged with real or DEMO offers, never bookable, and only a LIVE adapter may produce them.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.modules.providers import registry
from app.modules.providers.demo import DemoSkylineAdapter
from app.modules.providers.normalization import NormalizationError, finalize_offer
from app.modules.search import service
from tests.test_booking import B, err, member_id
from tests.test_live_common import enable_live
from tests.test_live_duffel import LIVE_TOKEN, TOKEN, adapter_with, ctx, params

FLIGHT = {"origin": "TLV", "destination": "LHR", "depart_date": (date.today() + timedelta(days=30)).isoformat(),
          "return_date": (date.today() + timedelta(days=37)).isoformat(), "adults": 2, "children_ages": [8]}


def _first_raw(monkeypatch, token: str, live_flag):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=token)
    adapter, _ = adapter_with()
    raw = adapter.search("flight", params(), ctx({"allow_live_mode": True}))[0]
    if live_flag == "missing":
        raw.payload["offer"].pop("live_mode", None)
    else:
        raw.payload["offer"]["live_mode"] = live_flag
    return adapter, raw


def test_supplier_live_mode_flag_decides_the_data_mode(monkeypatch):
    adapter, raw = _first_raw(monkeypatch, LIVE_TOKEN, False)  # live-looking token, but Duffel says test
    assert finalize_offer(adapter, adapter.normalize("flight", raw, ctx())).source.mode == "SANDBOX"
    adapter, raw = _first_raw(monkeypatch, LIVE_TOKEN, True)
    assert finalize_offer(adapter, adapter.normalize("flight", raw, ctx())).source.mode == "LIVE"


def test_token_prefix_is_only_a_fallback(monkeypatch):
    adapter, raw = _first_raw(monkeypatch, TOKEN, "missing")
    offer = finalize_offer(adapter, adapter.normalize("flight", raw, ctx()))
    assert offer.source.mode == "SANDBOX"
    assert any("נתוני בדיקה" in w for w in offer.warnings)


def test_only_a_live_adapter_may_label_offers_sandbox(monkeypatch):
    demo = DemoSkylineAdapter()
    offer = demo.normalize("flight", demo.search("flight", params(), ctx())[0], ctx())
    sneaky = offer.model_copy(update={"source": offer.source.model_copy(update={"mode": "SANDBOX"})})
    try:
        finalize_offer(demo, sneaky)
    except NormalizationError:
        pass
    else:  # pragma: no cover
        raise AssertionError("a DEMO adapter must not produce SANDBOX offers")


def test_sandbox_offers_are_never_merged_with_real_or_demo_ones(monkeypatch):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=TOKEN)
    from tests.test_live_duffel import normalized

    adapter, _ = adapter_with()
    raw = adapter.search("flight", params(), ctx())[0]
    sandbox = normalized(adapter, raw)
    real = sandbox.model_copy(update={"source": sandbox.source.model_copy(update={"mode": "LIVE"})})
    demo = sandbox.model_copy(update={"source": sandbox.source.model_copy(update={"mode": "DEMO"})})
    groups = {service.dedupe_group(o) for o in (sandbox, real, demo)}
    assert len(groups) == 3


def test_sandbox_search_is_labeled_and_cannot_be_booked(monkeypatch, auth_client, db):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=TOKEN)
    c = auth_client("owner")
    adapter, _ = adapter_with()
    with registry.override_adapters(adapter, replace_all=True):
        res = service.run_search(db, c.user.id, {"category": "flight", **FLIGHT}, use_cache=False)
        db.commit()
    runs = {p.provider_id: p for p in res.providers}
    assert runs["duffel"].mode == "SANDBOX" and runs["duffel"].status == "OK"
    assert res.offers and all(o.source.mode == "SANDBOX" for o in res.offers)
    assert res.has_live_results is False  # sandbox data never counts as live, bookable fares

    e = err(c.post(B, json={"offer_id": res.offers[0].id, "traveler_member_ids": [member_id(db, c)]}),
            409, "BOOKING_UNAVAILABLE")
    assert "Sandbox" in e["message"]
    assert e["details"]["reason"] == "SANDBOX_OFFER"


def test_sandbox_offers_rank_after_offers_the_family_can_act_on(monkeypatch):
    from app.modules.comparison.scoring import score_offers
    from tests.test_live_duffel import normalized

    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=TOKEN)
    adapter, _ = adapter_with()
    sandbox = [normalized(adapter, r) for r in adapter.search("flight", params(), ctx())]
    demo_adapter = DemoSkylineAdapter()
    demo = [finalize_offer(demo_adapter, demo_adapter.normalize("flight", r, ctx()))
            for r in demo_adapter.search("flight", params(), ctx())]
    ranked = score_offers(sandbox + demo, None)
    modes = [o.source.mode for o in ranked]
    assert modes == sorted(modes, key=lambda m: m == "SANDBOX")
    assert [o.score.rank for o in ranked] == list(range(1, len(ranked) + 1))


def test_provider_status_reports_sandbox_for_a_test_token(monkeypatch, auth_client):
    enable_live(monkeypatch, ORI_DUFFEL_ACCESS_TOKEN=TOKEN)
    providers = {p["provider_id"]: p for p in auth_client("owner").get("/api/providers").json()}
    assert providers["duffel"]["mode"] == "SANDBOX"
    assert providers["demo_skyline"]["mode"] == "DEMO"
