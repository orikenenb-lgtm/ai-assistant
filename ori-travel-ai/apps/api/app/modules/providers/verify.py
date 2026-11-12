"""Owner-run check of the real provider integrations (``python -m app.cli verify-providers``).

Verifies — against ACTUAL provider responses, never fixtures — that:

* the Duffel token is present and is a TEST (sandbox) token (the value is never printed);
* Duffel answers an authenticated health request;
* one TLV→ATH search returns offers that Duffel itself marks ``live_mode=false`` and that the app labels SANDBOX;
* the ECB exchange-rate feed answers and the app reports it as LIVE;
* real booking stays impossible and no paid AI is enabled.

Exit code 0 only when everything was verified. Nothing is stored in the database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from app.core.config import get_settings
from app.core.db import utcnow
from app.modules.providers.base import SearchContext
from app.modules.providers.live.duffel import DuffelAdapter
from app.modules.providers.normalization import finalize_offer
from app.schemas.search import FlightSearchParams

# Other credentials that ORI_LIVE_PROVIDERS_ENABLED would also switch on (names only, never values).
OTHER_LIVE_KEYS = {
    "viator_api_key": "ORI_VIATOR_API_KEY",
    "booking_demand_api_key": "ORI_BOOKING_DEMAND_API_KEY",
    "amadeus_client_id": "ORI_AMADEUS_CLIENT_ID",
}


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


@dataclass
class Report:
    checks: list[Check] = field(default_factory=list)

    def add(self, name: str, ok: bool, detail: str) -> bool:
        self.checks.append(Check(name, ok, detail))
        return ok

    @property
    def ok(self) -> bool:
        return all(c.ok for c in self.checks)


def token_kind(token: str | None) -> str:
    """"missing" / "test" / "live" / "invalid" — derived from the prefix only; the value never leaves this function."""
    t = (token or "").strip()
    if not t:
        return "missing"
    if t.startswith("duffel_test_"):
        return "test"
    if t.startswith("duffel_live_"):
        return "live"
    return "invalid"


def _safety(report: Report) -> bool:
    s = get_settings()
    ok = report.add("הזמנות אמיתיות", True, "ביצוע חי חסום בקוד ללא תלות בהגדרות (booking/service.py)")
    paid_ai = s.ai_provider == "anthropic" and s.ai_allow_paid
    ok &= report.add("AI בתשלום", not paid_ai, "כבוי" if not paid_ai else "פעיל — ORI_AI_PROVIDER=anthropic עם ORI_AI_ALLOW_PAID=true")
    others = [env for attr, env in OTHER_LIVE_KEYS.items() if getattr(s, attr, None)]
    ok &= report.add(
        "ספקים חיים נוספים",
        not others,
        "אין מפתחות לספקים חיים אחרים — רק Duffel יופעל" if not others
        else f"קיימים מפתחות גם ל: {', '.join(others)} — הם יופעלו יחד עם ORI_LIVE_PROVIDERS_ENABLED",
    )
    return ok


def _duffel(report: Report, *, search: bool) -> bool:
    s = get_settings()
    kind = token_kind(s.duffel_access_token)
    if not report.add("טוקן Duffel", kind == "test", {
        "test": "קיים, טוקן בדיקה (duffel_test_…) — הערך לא מוצג",
        "live": "טוקן חי (duffel_live_…) — נעצר: מותר כאן רק טוקן בדיקה",
        "missing": "חסר ORI_DUFFEL_ACCESS_TOKEN ב-apps/api/.env",
        "invalid": "הערך אינו בפורמט של טוקן Duffel",
    }[kind]):
        return False
    if not report.add("ORI_LIVE_PROVIDERS_ENABLED", bool(s.live_providers_enabled),
                      "true" if s.live_providers_enabled else "false — ספקים חיים כבויים"):
        return False

    adapter = DuffelAdapter()
    health = adapter.health()
    if not report.add("בדיקת חיבור ל-Duffel", health.status == "OK",
                      f"{health.status} ({health.latency_ms} ms): {health.message}"):
        return False
    if not search:
        return True

    depart = date.today() + timedelta(days=30)
    params = FlightSearchParams(category="flight", origin="TLV", destination="ATH", depart_date=depart,
                                return_date=depart + timedelta(days=4), adults=1)
    ctx = SearchContext("verify", utcnow(), 20, {})
    raws = adapter.search("flight", params, ctx)
    payloads: list[dict[str, Any]] = [r.payload.get("offer") or {} for r in raws]
    live_flags = {p.get("live_mode") for p in payloads}
    offers = [finalize_offer(adapter, adapter.normalize("flight", r, ctx)) for r in raws]
    modes = {o.source.mode for o in offers}
    ids_ok = all(str(r.supplier_offer_id).startswith("off_") for r in raws)
    currencies = sorted({o.price.total.currency for o in offers})
    carriers = sorted({seg.carrier_name for o in offers if o.details.kind == "flight"
                       for sl in o.details.slices for seg in sl.segments})[:4]
    verified = bool(raws) and ids_ok and live_flags == {False} and modes == {"SANDBOX"}
    return report.add(
        "חיפוש Duffel TLV→ATH",
        verified,
        f"{len(raws)} הצעות מ-Duffel (מזהי off_: {'כן' if ids_ok else 'לא'}), live_mode={sorted(map(str, live_flags))}, "
        f"סימון באפליקציה={sorted(modes)}, מטבע={currencies}, חברות לדוגמה={carriers}, יציאה {depart.isoformat()}",
    )


def _fx(report: Report) -> bool:
    from app.modules.comparison.fx import fx_rates

    s = get_settings()
    if not report.add("ORI_FX_LIVE_ENABLED", bool(s.fx_live_enabled), "true" if s.fx_live_enabled else "false"):
        return False
    out = fx_rates()
    return report.add(
        "שערי מטבע ECB",
        out.mode == "LIVE",
        f"mode={out.mode}, מקור={out.source}, תאריך={out.as_of.date().isoformat()}, "
        f"USD={out.rates.get('USD')}, ILS={out.rates.get('ILS')} (בסיס {out.base})"
        + (f" — {out.warning}" if out.warning else ""),
    )


def verify_providers(*, search: bool = True) -> Report:
    report = Report()
    _safety(report)
    try:
        _duffel(report, search=search)
    except Exception as exc:  # report, never leak details that could include request data
        report.add("Duffel", False, f"שגיאה: {type(exc).__name__}: {getattr(exc, 'message', '')}"[:300])
    try:
        _fx(report)
    except Exception as exc:
        report.add("שערי מטבע ECB", False, f"שגיאה: {type(exc).__name__}"[:300])
    return report
