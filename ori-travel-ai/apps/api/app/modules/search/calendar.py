"""Fare calendar (V6 contract §1): cheapest known total per depart date (x trip nights).

``flight_calendar(db, user_id, payload)``:

1. validates the request (Hebrew 422) — span <= 41 days, <= 7 ``trip_nights``
   values (1..30), <= 150 cells, future dates — and reuses ``FlightSearchParams``'
   rules (passengers, infants, origin != destination) for every cell;
2. quotes every cell with each enabled + usable **DEMO** flight adapter,
   in-process, in a bounded ``ThreadPoolExecutor`` with an overall time budget
   (``CALENDAR_TIME_BUDGET_SECONDS``). The adapter is called exactly like a
   normal search (same params, same owner settings such as ``simulate_error`` /
   ``max_results``); the lightweight part is that only the cheapest matching
   offer per provider/cell is fully finalized (all offers are normalized and
   filtered, so counts and the minimum match a normal search);
3. **never calls LIVE adapters**. Cells may additionally be filled from offers
   stored by earlier real searches with the *same params hash* as the normal
   search for that cell, fetched within ``search_cache_ttl_minutes`` (and after
   the provider's configuration last changed, not expired, same currency) —
   reported as mode ``CACHED``;
4. builds cells (``priced`` / ``no_offers`` / ``not_searched`` / ``error``),
   tertile tiers, stats, per-provider ``sources`` and honest Hebrew notes.

Nothing is persisted (calendar quotes are not offers). Clicking a cell in the
UI runs the normal ``POST /api/search/flight`` for its dates. Only valid
requests count towards the per-user rate limit (validation runs first).

Currency: only quotes in the requested currency can price a cell — nothing is
ever converted or relabelled. A provider answering only in another currency is
``UNSUPPORTED`` for that cell (``error_code="CURRENCY_MISMATCH"``, reported in
``sources[]``). ``offers_count`` groups offers exactly like the normal search's
dedupe (``service.dedupe_group``: identical offers once; DEMO never merged with
real offers).

Cell status rules (per cell):
* ``priced``       — at least one real quote (DEMO now, or CACHED earlier real search).
* ``error``        — no quote, and a queried provider failed / timed out for this cell.
* ``not_searched`` — no quote, and nothing (complete) was asked: no usable DEMO provider,
                     route unsupported, or the time budget ran out before the cell was queried.
* ``no_offers``    — the queried providers answered with zero matching offers.

Tiers: among priced cells (all in the requested currency), the cheapest cell(s)
are ``best``; otherwise with r = number of priced cells strictly cheaper and n =
priced cells: ``low`` if r < n/3, ``mid`` if r < 2n/3, else ``high``.
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.money import quantize
from app.core.ratelimit import limiter
from app.models.search import Offer, SearchRequest
from app.modules.providers import registry
from app.modules.providers.base import ProviderAdapter, ProviderError, ProviderUnsupportedError, SearchContext
from app.modules.providers.errors import UnprocessableError
from app.modules.providers.normalization import compute_dedupe_key, finalize_offer
from app.modules.search.filters import passes
from app.modules.search.schemas import (
    CalendarCell,
    CalendarSource,
    CalendarStats,
    FlightCalendarRequest,
    FlightCalendarResponse,
    FlightYearScanRequest,
)
from app.modules.search.service import (
    MAX_RAW_OFFERS_PER_PROVIDER,
    MSG_DISABLED,
    MSG_NOT_CONFIGURED,
    MSG_PROVIDER_ERROR,
    _safe_message,
    _translate_errors,
    canonical_params,
    dedupe_group,
    params_hash,
)
from app.schemas.common import Money
from app.schemas.offers import CanonicalOffer
from app.schemas.search import FlightSearchParams

log = logging.getLogger("ori.search.calendar")

# Both request shapes expose the same attributes (origin, destination, trip_nights, depart_dates, travellers, …).
CalendarLike = FlightCalendarRequest | FlightYearScanRequest

CALENDAR_RATE_LIMIT = 10
CALENDAR_RATE_WINDOW_SECONDS = 600
CALENDAR_TIME_BUDGET_SECONDS = 8.0
YEAR_SCAN_TIME_BUDGET_SECONDS = 25.0
CALENDAR_MAX_WORKERS = 4

MSG_LIVE_NOT_QUERIED = "ספקים חיים אינם נשאלים עבור לוח המחירים (עלות ומגבלות קצב)"
MSG_NO_OFFERS = "לא נמצאו טיסות לתאריך זה אצל הספקים שנבדקו"
MSG_NOT_SEARCHED_LIVE_ONLY = "לא נבדק — ספקים חיים אינם נשאלים עבור לוח המחירים ואין מחיר שמור מחיפוש קודם לתאריך זה"
MSG_NOT_SEARCHED_BUDGET = "לא נבדק — חריגה ממגבלת הזמן של לוח המחירים. ניתן להריץ חיפוש רגיל לתאריך זה"
MSG_NOT_SEARCHED_UNSUPPORTED = "לא נבדק — המסלול אינו נתמך אצל הספקים הזמינים"
MSG_NOT_SEARCHED_CURRENCY = "לא נבדק — הספקים הזמינים אינם מחזירים מחירים במטבע המבוקש (ללא המרת מטבע)"
CURRENCY_MISMATCH = "CURRENCY_MISMATCH"
MSG_TIMEOUT = "הספק לא הגיב בזמן"


# ------------------------------------------------------------------ params ----


def check_calendar_rate_limit(user_id: str) -> None:
    limiter.check(
        f"calendar:{user_id}",
        get_settings().calendar_rate_limit or CALENDAR_RATE_LIMIT,
        CALENDAR_RATE_WINDOW_SECONDS,
        "הגעתם למגבלת הבקשות של לוח המחירים — נסו שוב בעוד מספר דקות",
    )


def _cell_payload(req: CalendarLike, depart: date, ret: date | None) -> dict[str, Any]:
    """The exact body a normal ``POST /api/search/flight`` for this cell would send."""
    return {
        "category": "flight",
        "origin": req.origin,
        "destination": req.destination,
        "depart_date": depart,
        "return_date": ret,
        "adults": req.adults,
        "children_ages": list(req.children_ages),
        "cabin": req.cabin,
        "max_stops": req.max_stops,
        "checked_bags": req.checked_bags,
        "currency": req.currency,
    }


def parse_calendar_request(payload: Any) -> FlightCalendarRequest:
    return _parse(FlightCalendarRequest, payload)


def parse_year_scan_request(payload: Any) -> FlightYearScanRequest:
    return _parse(FlightYearScanRequest, payload)


def _parse[R: (FlightCalendarRequest, FlightYearScanRequest)](model: type[R], payload: Any) -> R:
    if not isinstance(payload, dict):
        raise UnprocessableError("גוף הבקשה חייב להיות אובייקט JSON")
    try:
        req = model.model_validate(payload)
    except ValidationError as exc:
        message, details = _translate_errors(exc.errors(include_url=False))
        raise UnprocessableError(message, details=details) from None
    # Reuse the normal flight search rules (pax, infants, origin != destination) on the edge cells.
    nights = req.trip_nights or []
    for depart in (req.depart_from, req.depart_to):
        ret = depart + timedelta(days=max(nights)) if nights else None
        try:
            FlightSearchParams.model_validate(_cell_payload(req, depart, ret))
        except ValidationError as exc:
            message, details = _translate_errors(exc.errors(include_url=False))
            raise UnprocessableError(message, details=details) from None
    return req


# --------------------------------------------------------------- quoting ----


@dataclass
class _Quote:
    """One provider's answer for one cell."""

    status: str  # OK / FAILED / TIMEOUT / UNSUPPORTED / SKIPPED
    cheapest: CanonicalOffer | None = None
    keys: set[tuple[str, str, bool]] = field(default_factory=set)  # service.dedupe_group of matching offers
    error_code: str | None = None
    message: str | None = None
    # Currencies of offers this provider returned in a currency OTHER than requested (never relabelled/converted)
    other_currencies: frozenset[str] = frozenset()


@dataclass
class _Cell:
    depart: date
    ret: date | None
    nights: int | None
    params: FlightSearchParams
    phash: str


def _quote(adapter: ProviderAdapter, params: FlightSearchParams, settings: dict[str, Any], timeout: float) -> _Quote:
    """Quote one cell with one DEMO adapter. Never raises (adapters are untrusted)."""
    ctx = SearchContext(search_id="fare-calendar", started_at=utcnow(), timeout_seconds=timeout,
                        provider_settings=dict(settings))
    try:
        raws = list(adapter.search("flight", params, ctx) or [])[:MAX_RAW_OFFERS_PER_PROVIDER]
    except ProviderUnsupportedError as exc:
        return _Quote("UNSUPPORTED", error_code=exc.code, message=_safe_message(exc.message, "הספק אינו תומך בבקשה זו"))
    except ProviderError as exc:
        return _Quote("FAILED", error_code=(exc.code or "PROVIDER_ERROR")[:64],
                      message=_safe_message(exc.message, MSG_PROVIDER_ERROR))
    except Exception as exc:  # noqa: BLE001 - never leak raw details
        log.warning("calendar provider=%s raised %s", adapter.provider_id, type(exc).__name__)
        return _Quote("FAILED", error_code="PROVIDER_ERROR", message=MSG_PROVIDER_ERROR)
    now = utcnow()
    currency = params.currency
    matching: list[CanonicalOffer] = []
    rejected = same_currency = 0
    other: set[str] = set()
    for raw in raws:
        try:
            offer = adapter.normalize("flight", raw, ctx)
        except Exception:  # noqa: BLE001 - one bad offer must not fail the cell
            rejected += 1
            continue
        if offer.price.total.currency != currency:
            # Only quotes in the requested currency are comparable; never relabel or convert (RA-01).
            other.add(offer.price.total.currency)
            continue
        same_currency += 1
        if passes(offer, params, now):
            matching.append(offer if offer.dedupe_key else offer.model_copy(update={"dedupe_key": compute_dedupe_key(offer)}))
    if raws and rejected == len(raws):
        return _Quote("FAILED", error_code="NORMALIZATION_ERROR",
                      message="הנתונים שהתקבלו מהספק לא עברו בדיקת תקינות")
    if other and not same_currency:
        return _Quote("UNSUPPORTED", error_code=CURRENCY_MISMATCH, other_currencies=frozenset(other),
                      message=(f"הספק החזיר מחירים במטבע {', '.join(sorted(other))} ולא ב-{currency} — "
                               "מחיריו לא נכללו בלוח (ללא המרת מטבע)"))
    matching.sort(key=lambda o: (o.price.total.amount, o.source.supplier_offer_id))
    cheapest: CanonicalOffer | None = None
    for offer in matching:  # fully validate only the cheapest (lightweight path)
        try:
            final = finalize_offer(adapter, offer)
        except Exception as exc:  # noqa: BLE001 - skip an invalid offer, try the next cheapest
            log.warning("calendar provider=%s offer rejected: %s", adapter.provider_id, type(exc).__name__)
            continue
        if final.price.total.currency == currency:
            cheapest = final
            break
    keys = {dedupe_group(o) for o in matching}
    return _Quote("OK", cheapest=cheapest, keys=keys, other_currencies=frozenset(other))


def _quote_all(cells: list[_Cell], adapters: list[ProviderAdapter], provider_settings: dict[str, dict[str, Any]],
               budget: float) -> dict[tuple[int, str], _Quote]:
    results: dict[tuple[int, str], _Quote] = {}
    if not cells or not adapters:
        return results
    settings = get_settings()
    workers = max(1, min(CALENDAR_MAX_WORKERS, int(settings.provider_max_concurrency)))
    timeout = max(0.05, min(float(settings.provider_timeout_seconds), budget))
    deadline = time.monotonic() + budget
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ori-calendar")
    futures: dict[Future, tuple[int, str]] = {}
    try:
        for i, cell in enumerate(cells):  # earliest dates first
            for adapter in adapters:
                pid = adapter.provider_id
                futures[executor.submit(_quote, adapter, cell.params, provider_settings.get(pid, {}), timeout)] = (i, pid)
        done, not_done = wait(futures, timeout=max(0.0, deadline - time.monotonic()))
        for f in done:
            try:
                results[futures[f]] = f.result()
            except Exception:  # noqa: BLE001 - _quote never raises; be defensive anyway
                results[futures[f]] = _Quote("FAILED", error_code="PROVIDER_ERROR", message=MSG_PROVIDER_ERROR)
        for f in not_done:
            if f.cancel():  # never started => nothing was asked for this cell
                results[futures[f]] = _Quote("SKIPPED", message=MSG_NOT_SEARCHED_BUDGET)
            else:
                results[futures[f]] = _Quote("TIMEOUT", error_code="TIMEOUT", message=MSG_TIMEOUT)
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
    return results


# ------------------------------------------------------------ cached LIVE ----


def _cached_offers(db: Session, cells: list[_Cell], currency: str, live_ids: set[str],
                   configs: dict[str, Any]) -> dict[int, list[CanonicalOffer]]:
    """Real (LIVE/CACHED) offers stored by earlier equivalent searches, per cell index. No adapter calls."""
    ttl = get_settings().search_cache_ttl_minutes
    if ttl <= 0 or not live_ids or not cells:
        return {}
    now = utcnow()
    since = now - timedelta(minutes=ttl)
    by_hash: dict[str, list[int]] = {}
    for i, cell in enumerate(cells):
        by_hash.setdefault(cell.phash, []).append(i)
    rows = db.execute(
        select(Offer, SearchRequest.params_hash)
        .join(SearchRequest, Offer.search_request_id == SearchRequest.id)
        .where(
            SearchRequest.params_hash.in_(list(by_hash)),
            SearchRequest.category == "flight",
            SearchRequest.status.in_(("completed", "partial")),
            Offer.category == "flight",
            Offer.mode.in_(("LIVE", "CACHED")),
            Offer.provider_id.in_(sorted(live_ids)),
            Offer.currency == currency,
            Offer.fetched_at >= since,
        )
    ).all()
    out: dict[int, dict[str, CanonicalOffer]] = {}
    for row, phash in rows:
        changed_at = getattr(configs.get(row.provider_id), "updated_at", None)
        if changed_at is not None and row.fetched_at < changed_at:
            continue  # provider configuration changed after this quote was fetched
        if row.expires_at is not None and row.expires_at <= now:
            continue
        try:
            offer = CanonicalOffer.model_validate({**row.data, "id": row.id})
        except ValidationError:
            continue
        if offer.price.total.currency != currency:
            continue
        offer = offer.model_copy(update={"source": offer.source.model_copy(update={"mode": "CACHED"}), "score": None})
        for i in by_hash.get(phash, []):
            bucket = out.setdefault(i, {})
            current = bucket.get(offer.dedupe_key)
            if current is None or offer.price.total.amount < current.price.total.amount:
                bucket[offer.dedupe_key] = offer
    return {i: list(b.values()) for i, b in out.items()}


# ------------------------------------------------------------------- tiers ----


def _tiers(amounts: list[Decimal]) -> dict[Decimal, str]:
    ordered = sorted(amounts)
    n = len(ordered)
    out: dict[Decimal, str] = {}
    for amount in set(ordered):
        r = sum(1 for a in ordered if a < amount)
        if r == 0:
            out[amount] = "best"
        elif r * 3 < n:
            out[amount] = "low"
        elif r * 3 < 2 * n:
            out[amount] = "mid"
        else:
            out[amount] = "high"
    return out


def _median(amounts: list[Decimal], currency: str) -> Decimal:
    ordered = sorted(amounts)
    n = len(ordered)
    mid = n // 2
    value = ordered[mid] if n % 2 else (ordered[mid - 1] + ordered[mid]) / 2
    return quantize(value, currency)


# ------------------------------------------------------------------ public ----


def flight_calendar(db: Session, user_id: str | None, payload: Any) -> FlightCalendarResponse:
    req = parse_calendar_request(payload)  # invalid (422) requests do not consume the quota
    if user_id is not None:
        check_calendar_rate_limit(user_id)
    return _build_calendar(db, req, CALENDAR_TIME_BUDGET_SECONDS)


def flight_year_scan(db: Session, user_id: str | None, payload: Any) -> FlightCalendarResponse:
    """Every depart date of the coming year for one trip length — same honesty rules as the calendar.

    Counts as one request of the calendar budget (it is a single, server-bounded scan).
    """
    req = parse_year_scan_request(payload)
    if user_id is not None:
        check_calendar_rate_limit(user_id)
    return _build_calendar(db, req, YEAR_SCAN_TIME_BUDGET_SECONDS)


def _build_calendar(db: Session, req: CalendarLike, time_budget: float) -> FlightCalendarResponse:
    started = time.monotonic()
    currency = req.currency
    nights_axis: list[int | None] = list(req.trip_nights or []) or [None]

    cells: list[_Cell] = []
    for depart in req.depart_dates:
        for nights in nights_axis:
            ret = depart + timedelta(days=nights) if nights else None
            params = FlightSearchParams.model_validate(_cell_payload(req, depart, ret))
            cells.append(_Cell(depart, ret, nights, params, params_hash(canonical_params(params))))

    configs = registry.ensure_configs(db)
    db.commit()
    adapters = registry.adapters_for_category("flight")

    def enabled(a: ProviderAdapter) -> bool:
        cfg = configs.get(a.provider_id)
        return cfg is None or bool(cfg.enabled)

    demo = [a for a in adapters if a.capabilities().mode == "DEMO" and enabled(a) and registry.is_usable(a)]
    live_usable = {a.provider_id for a in adapters
                   if a.capabilities().mode == "LIVE" and enabled(a) and registry.is_usable(a)}
    cached = _cached_offers(db, cells, currency, live_usable, configs)
    quotes = _quote_all(cells, demo, {pid: dict(c.settings or {}) for pid, c in configs.items()}, time_budget)
    demo_names = {a.provider_id: a.capabilities().display_name for a in demo}

    # ---- cells ----
    out_cells: list[CalendarCell] = []
    priced_amounts: list[Decimal] = []
    priced_by: dict[str, int] = {}
    cached_cells: dict[str, int] = {}  # provider -> cells that include its cached real offers
    for i, cell in enumerate(cells):
        cell_quotes = {a.provider_id: quotes.get((i, a.provider_id)) for a in demo}
        candidates = [q.cheapest for q in cell_quotes.values() if q is not None and q.cheapest is not None]
        cell_cached = cached.get(i, [])
        candidates.extend(cell_cached)
        # Never label a price with a currency it was not quoted in (RA-01)
        candidates = [o for o in candidates if o.price.total.currency == currency]
        for pid in {o.source.provider_id for o in cell_cached}:
            cached_cells[pid] = cached_cells.get(pid, 0) + 1
        # Same grouping as the normal search's dedupe: identical offers counted once, DEMO never merged with real
        keys = {k for q in cell_quotes.values() if q is not None for k in q.keys}
        keys |= {dedupe_group(o) for o in cell_cached}
        base = {"depart_date": cell.depart, "return_date": cell.ret, "nights": cell.nights,
                "travelers": req.travelers, "offers_count": len(keys)}
        if candidates:
            best = min(candidates, key=lambda o: (o.price.total.amount, o.source.mode == "DEMO", o.source.provider_id,
                                                  o.source.supplier_offer_id))
            total = best.price.total.amount
            priced_amounts.append(total)
            priced_by[best.source.provider_id] = priced_by.get(best.source.provider_id, 0) + 1
            out_cells.append(CalendarCell(
                **base, status="priced",
                min_total=Money(amount=total, currency=currency),
                per_person=Money(amount=quantize(total / req.travelers, currency), currency=currency),
                mode=best.source.mode, provider_id=best.source.provider_id, provider_name=best.source.provider_name,
                fetched_at=best.source.fetched_at,
            ))
            continue
        answered = [q for q in cell_quotes.values() if q is not None]
        failed = [pid for pid, q in cell_quotes.items() if q is not None and q.status in ("FAILED", "TIMEOUT")]
        if failed:
            names = ", ".join(demo_names[pid] for pid in failed)
            out_cells.append(CalendarCell(
                **base, status="error",
                message=f"הבדיקה נכשלה אצל {names} — נסו שוב מאוחר יותר או הריצו חיפוש רגיל לתאריך זה",
            ))
        elif any(q.status == "SKIPPED" for q in answered):
            out_cells.append(CalendarCell(**base, status="not_searched", message=MSG_NOT_SEARCHED_BUDGET))
        elif any(q.status == "OK" for q in answered):
            out_cells.append(CalendarCell(**base, status="no_offers", message=MSG_NO_OFFERS))
        elif answered:  # every queried provider: route unsupported / prices only in another currency
            currency_only = all(q.error_code == CURRENCY_MISMATCH for q in answered)
            out_cells.append(CalendarCell(**base, status="not_searched", message=(
                MSG_NOT_SEARCHED_CURRENCY if currency_only else MSG_NOT_SEARCHED_UNSUPPORTED)))
        else:
            out_cells.append(CalendarCell(**base, status="not_searched", message=MSG_NOT_SEARCHED_LIVE_ONLY))

    tiers = _tiers(priced_amounts)
    for idx, c in enumerate(out_cells):
        if c.status == "priced" and c.min_total is not None:
            out_cells[idx] = c.model_copy(update={"tier": tiers[c.min_total.amount]})

    counts = {s: sum(1 for c in out_cells if c.status == s) for s in ("priced", "no_offers", "not_searched", "error")}
    stats = CalendarStats(
        min=Money(amount=min(priced_amounts), currency=currency) if priced_amounts else None,
        max=Money(amount=max(priced_amounts), currency=currency) if priced_amounts else None,
        median=Money(amount=_median(priced_amounts, currency), currency=currency) if priced_amounts else None,
        mean=(Money(amount=quantize(sum(priced_amounts) / len(priced_amounts), currency), currency=currency)
              if priced_amounts else None),
        **counts,
    )

    # ---- sources ----
    ttl = get_settings().search_cache_ttl_minutes
    sources: list[CalendarSource] = []
    failed_names: list[str] = []
    for a in adapters:
        caps = a.capabilities()
        pid = a.provider_id
        src = {"provider_id": pid, "provider_name": caps.display_name, "mode": caps.mode,
               "cells_priced": priced_by.get(pid, 0)}
        if not enabled(a):
            sources.append(CalendarSource(**src, status="DISABLED", message=MSG_DISABLED))
        elif not registry.is_usable(a):
            msg = MSG_NOT_CONFIGURED + (f". {MSG_LIVE_NOT_QUERIED}" if caps.mode == "LIVE" else "")
            sources.append(CalendarSource(**src, status="NOT_CONFIGURED", message=msg))
        elif caps.mode == "LIVE":
            n = cached_cells.get(pid, 0)
            if n:
                sources.append(CalendarSource(**{**src, "mode": "CACHED"}, status="CACHED", message=(
                    f"{MSG_LIVE_NOT_QUERIED}. ב-{n} תאריכים נכללו מחירים שמורים מחיפושים קודמים (עד {ttl} דקות)")))
            else:
                sources.append(CalendarSource(**src, status="NOT_QUERIED", message=(
                    f"{MSG_LIVE_NOT_QUERIED} — מוצגים רק מחירים שמורים מחיפושים קודמים, ולא נמצאו כאלה לתאריכים בלוח")))
        else:
            own = [quotes[(i, pid)] for i in range(len(cells)) if (i, pid) in quotes]
            total = len(own)
            bad = [q for q in own if q.status in ("FAILED", "TIMEOUT")]
            skipped = sum(1 for q in own if q.status == "SKIPPED")
            unsupported = [q for q in own if q.status == "UNSUPPORTED"]
            excluded = sorted({c for q in own for c in q.other_currencies})
            currency_note = (f"; הצעות במטבע {', '.join(excluded)} לא נכללו (ללא המרת מטבע)"
                             if excluded else "")
            if total and len(unsupported) == total:
                sources.append(CalendarSource(**src, status="UNSUPPORTED", message=unsupported[0].message,
                                              error_code=unsupported[0].error_code))
            elif total and len(bad) == total:
                failed_names.append(caps.display_name)
                sources.append(CalendarSource(**src, status="FAILED", message=bad[0].message, error_code=bad[0].error_code))
            elif bad or skipped:
                if bad:
                    failed_names.append(caps.display_name)
                parts = []
                if bad:
                    parts.append(f"הספק נכשל או לא הגיב בזמן ב-{len(bad)} מתוך {total} תאריכים")
                if skipped:
                    parts.append(f"{skipped} תאריכים לא נבדקו (מגבלת זמן)")
                sources.append(CalendarSource(**src, status="PARTIAL", message="; ".join(parts) + currency_note,
                                              error_code=bad[0].error_code if bad else None))
            else:
                sources.append(CalendarSource(**src, status="OK", message=(
                    f"נתוני הדגמה (סינתטיים) — נבדקו {total} תאריכים{currency_note}")))

    # ---- notes ----
    who = f"לכל {req.travelers} הנוסעים יחד" if req.travelers > 1 else "לנוסע אחד"
    trip = "הלוך-חזור" if req.trip_nights else "בכיוון אחד"
    legend = (
        f"כל תא מציג את המחיר הכולל הזול ביותר שנמצא {who} ({trip}) במטבע {currency}, ולצידו המחיר לנוסע. "
        "הצבעים יחסיים למחירים שבלוח זה בלבד: 'הזול ביותר' — המחיר הנמוך בלוח; 'נמוך', 'בינוני' ו'גבוה' — "
        "שליש התאריכים הזולים, האמצעיים והיקרים. '—' לא נבדק, '∅' אין טיסות, '!' תקלה אצל ספק. "
        "בחירת תא מריצה חיפוש רגיל לתאריכים אלה."
    )
    coverage: list[str] = []
    if demo:
        coverage.append(f"המחירים בלוח מבוססים על {len(demo)} ספקי הדגמה שנבדקו לכל תאריך — נתוני הדגמה (סינתטיים), "
                        "לא מחיר אמיתי ולא זמינות אמיתית.")
    n_cached = sum(1 for i in range(len(cells)) if cached.get(i))
    if n_cached:
        coverage.append(f"{MSG_LIVE_NOT_QUERIED}; ב-{n_cached} תאריכים נכללו מחירים אמיתיים שמורים מחיפושים "
                        f"קודמים זהים (עד {ttl} דקות).")
    else:
        coverage.append(f"{MSG_LIVE_NOT_QUERIED} — מחירים חיים מופיעים רק אם נשמרו מחיפוש קודם זהה.")
    if not demo and not n_cached:
        coverage.append("לא נבדקו מחירים לתאריכים בלוח.")
    if failed_names:
        coverage.append(f"ספקים שנכשלו בחלק מהתאריכים או בכולם: {', '.join(failed_names)}.")
    coverage.append("המחיר בלוח הוא נקודת התחלה — המחיר הסופי נקבע בחיפוש הרגיל ובבדיקת ההצעה.")

    log.info("fare calendar route=%s-%s cells=%d priced=%d providers=%d took_ms=%d", req.origin, req.destination,
             len(cells), counts["priced"], len(demo), int((time.monotonic() - started) * 1000))
    return FlightCalendarResponse(
        origin=req.origin,
        destination=req.destination,
        currency=currency,
        cabin=req.cabin,
        depart_dates=req.depart_dates,
        trip_nights=nights_axis,
        cells=out_cells,
        stats=stats,
        sources=sources,
        legend_note=legend,
        coverage_note=" ".join(coverage),
        has_demo=bool(demo) and any(q.status != "SKIPPED" for q in quotes.values()),
        generated_at=utcnow(),
    )
