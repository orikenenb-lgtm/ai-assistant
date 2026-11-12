"""Search orchestrator.

``run_search(db, user_id, params, origin)``:

1. validates params (shared Pydantic contracts) and persists a ``SearchRequest``
   (canonical params JSON + ``params_hash``);
2. serves an identical search completed within ``search_cache_ttl_minutes``
   from cache (provider runs reported as ``CACHED`` with the original fetch
   time; LIVE offers become ``source.mode="CACHED"``, DEMO stays DEMO);
3. otherwise runs every enabled + usable adapter of the category in a bounded
   ``ThreadPoolExecutor`` with a per-provider timeout and an overall deadline
   (timeouts -> TIMEOUT, errors -> FAILED with a Hebrew user-safe message; one
   safe retry for retryable errors; per-provider rate limiting). Disabled and
   not-configured providers are recorded but never called;
4. normalizes + validates offers (``finalize_offer``), applies post-filters,
   dedupes (cheapest per dedupe_key & currency, ``also_offered_by`` filled),
   scores with the family ranking weights and persists ``ProviderSearch`` and
   ``Offer`` rows (integer minor units + full canonical JSON);
5. returns a ``SearchResponse`` with an honest Hebrew ``coverage_note``.

Adapters never touch the database; all persistence happens on the caller's
thread/session.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.app_settings import DEFAULT_RANKING_WEIGHTS, get_setting
from app.core.config import get_settings
from app.core.db import utcnow
from app.core.errors import NotFoundError
from app.core.money import to_minor
from app.core.ratelimit import limiter
from app.core.redaction import redact_text
from app.models._common import new_id
from app.models.search import Offer, ProviderSearch, SearchRequest
from app.modules.comparison.scoring import WeightsError, normalize_weights, preferences_from_params, score_offers
from app.modules.providers import registry
from app.modules.providers.base import (
    ProviderAdapter,
    ProviderError,
    ProviderNotConfiguredError,
    ProviderRateLimitedError,
    ProviderTimeoutError,
    ProviderUnsupportedError,
    RawOffer,
    SearchContext,
)
from app.modules.providers.errors import UnprocessableError
from app.modules.providers.normalization import clean_text, finalize_offer
from app.modules.search.filters import currency_warning, passes
from app.modules.search.highlights import compute_highlights
from app.modules.search.schemas import SearchHistoryItem
from app.schemas.common import Category, Page
from app.schemas.offers import CanonicalOffer
from app.schemas.search import PARAMS_BY_CATEGORY, ProviderRun, SearchResponse

log = logging.getLogger("ori.search")

SEARCH_RATE_LIMIT = 30
SEARCH_RATE_WINDOW_SECONDS = 600
PROVIDER_RATE_WINDOW_SECONDS = 60
MAX_RAW_OFFERS_PER_PROVIDER = 100
POLL_SECONDS = 0.05
OVERALL_DEADLINE_FACTOR = 2.0

CATEGORY_HE = {"flight": "טיסות", "hotel": "מלונות", "car": "השכרת רכב", "activity": "אטרקציות ופעילויות"}
DEMO_DISCLAIMER = "תוצאות מספקי הדגמה הן נתוני הדגמה — לא מחיר אמיתי ולא זמינות אמיתית."
NO_FULL_COVERAGE = "אין התחייבות לכיסוי מלא של השוק — ייתכנו מחירים ואפשרויות נוספים אצל ספקים אחרים."
MSG_NOT_CONFIGURED = "לא מחובר — חסרים פרטי גישה או שהפעלת ספקים חיים כבויה"
MSG_DISABLED = "הספק הושבת בהגדרות"
MSG_RATE_LIMITED = "הספק הגביל את קצב הבקשות — נסו שוב בעוד מספר דקות"
MSG_PROVIDER_ERROR = "אירעה שגיאה אצל הספק — התוצאות שלו אינן מוצגות"
MSG_NORMALIZATION = "הנתונים שהתקבלו מהספק לא עברו בדיקת תקינות ולכן לא הוצגו"
MSG_DEMO_OK = "נתוני הדגמה (סינתטיים)"

# ------------------------------------------------------------------ params ----

_ERROR_HE = {
    "missing": "שדה חובה",
    "greater_than_equal": "הערך קטן מהמינימום המותר",
    "greater_than": "הערך קטן מדי",
    "less_than_equal": "הערך גדול מהמקסימום המותר",
    "less_than": "הערך גדול מדי",
    "string_too_short": "הטקסט קצר מדי",
    "string_too_long": "הטקסט ארוך מדי",
    "string_pattern_mismatch": "הפורמט אינו תקין",
    "string_type": "נדרש טקסט",
    "date_parsing": "תאריך לא תקין (YYYY-MM-DD)",
    "date_from_datetime_parsing": "תאריך לא תקין (YYYY-MM-DD)",
    "date_from_datetime_inexact": "תאריך לא תקין (YYYY-MM-DD)",
    "date_type": "תאריך לא תקין (YYYY-MM-DD)",
    "datetime_parsing": "תאריך ושעה לא תקינים",
    "datetime_from_date_parsing": "תאריך ושעה לא תקינים",
    "datetime_type": "תאריך ושעה לא תקינים",
    "int_parsing": "נדרש מספר שלם",
    "int_type": "נדרש מספר שלם",
    "int_from_float": "נדרש מספר שלם",
    "decimal_parsing": "נדרש מספר",
    "decimal_type": "נדרש מספר",
    "bool_parsing": "נדרש true/false",
    "bool_type": "נדרש true/false",
    "literal_error": "ערך לא נתמך",
    "too_long": "יותר מדי פריטים",
    "too_short": "מעט מדי פריטים",
    "list_type": "נדרשת רשימה",
    "dict_type": "מבנה לא תקין",
    "model_type": "מבנה לא תקין",
    "model_attributes_type": "מבנה לא תקין",
}


def _translate_errors(errors: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
    details: list[dict[str, Any]] = []
    headline: str | None = None
    for e in errors:
        etype = e.get("type", "")
        field_name = ".".join(str(p) for p in e.get("loc", ()))
        if etype == "value_error":
            msg = str(e.get("msg", "")).removeprefix("Value error, ").strip()
            headline = headline or msg
        else:
            msg = _ERROR_HE.get(etype, "ערך לא תקין")
        details.append({"field": field_name, "message": msg, "type": etype})
    return headline or "חלק מהשדות אינם תקינים", details


def parse_search_params(payload: Any, category: str | None = None):
    """Validate a dict or a params model into the category's params model (422 on error)."""
    if isinstance(payload, BaseModel):
        data: dict[str, Any] = payload.model_dump(mode="python")
    elif isinstance(payload, dict):
        data = dict(payload)
    else:
        raise UnprocessableError("גוף הבקשה חייב להיות אובייקט JSON")
    cat = category or data.get("category")
    if cat not in PARAMS_BY_CATEGORY:
        raise UnprocessableError("קטגוריית חיפוש לא נתמכת", details=[{"field": "category", "message": "ערך לא נתמך"}])
    if data.get("category", cat) != cat:
        raise UnprocessableError("הקטגוריה בגוף הבקשה אינה תואמת לנתיב")
    data["category"] = cat
    try:
        return PARAMS_BY_CATEGORY[cat].model_validate(data)
    except ValidationError as exc:
        message, details = _translate_errors(exc.errors(include_url=False))
        raise UnprocessableError(message, details=details) from None


def canonical_params(params: BaseModel) -> dict[str, Any]:
    return params.model_dump(mode="json")


def params_hash(canonical: dict[str, Any]) -> str:
    payload = json.dumps(canonical, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def family_weights(db: Session) -> dict[str, int]:
    try:
        return normalize_weights(get_setting(db, "ranking_weights"))
    except WeightsError:
        return dict(DEFAULT_RANKING_WEIGHTS)


def check_search_rate_limit(user_id: str) -> None:
    limiter.check(
        f"search:{user_id}",
        SEARCH_RATE_LIMIT,
        SEARCH_RATE_WINDOW_SECONDS,
        "הגעתם למגבלת החיפושים — נסו שוב בעוד מספר דקות",
    )


# ------------------------------------------------------------- execution ----


@dataclass
class _Run:
    adapter: ProviderAdapter
    name: str
    mode: str
    status: str = ""
    started_at: datetime = field(default_factory=utcnow)
    finished_at: datetime | None = None
    duration_ms: int | None = None
    error_code: str | None = None
    message: str | None = None
    ctx: SearchContext | None = None
    raws: list[RawOffer] = field(default_factory=list)
    offers: list[CanonicalOffer] = field(default_factory=list)
    result_count: int = 0

    @property
    def provider_id(self) -> str:
        return self.adapter.provider_id


def _safe_message(message: str | None, fallback: str) -> str:
    text = redact_text(clean_text(message, 300)) if message else None
    return text or fallback


def _timeout_for(adapter: ProviderAdapter, base: float) -> float:
    specific = getattr(adapter, "timeout_seconds", None)
    if isinstance(specific, int | float) and specific > 0:
        return min(float(specific), base)
    return base


def _call_adapter(adapter: ProviderAdapter, category: Category, params: BaseModel, ctx: SearchContext,
                  started: dict[str, float], finished: dict[str, float]) -> list[RawOffer]:
    pid = adapter.provider_id
    t0 = time.monotonic()
    started[pid] = t0
    try:
        try:
            return adapter.search(category, params, ctx)
        except (ProviderTimeoutError, ProviderRateLimitedError, ProviderNotConfiguredError, ProviderUnsupportedError):
            raise
        except ProviderError as exc:
            remaining = ctx.timeout_seconds - (time.monotonic() - t0)
            if not exc.retryable or remaining < ctx.timeout_seconds / 2:
                raise
            time.sleep(min(0.25, remaining / 4))
            log.info("retrying provider=%s once after retryable error code=%s", pid, exc.code)
            return adapter.search(category, params, ctx)
    finally:
        finished[pid] = time.monotonic()


def _collect(run: _Run, future: Future, started: dict[str, float], finished: dict[str, float]) -> None:
    pid = run.provider_id
    run.finished_at = utcnow()
    if pid in started and pid in finished:
        run.duration_ms = int((finished[pid] - started[pid]) * 1000)
    try:
        raws = future.result()
    except ProviderNotConfiguredError:
        run.status, run.error_code, run.message = "NOT_CONFIGURED", "NOT_CONFIGURED", MSG_NOT_CONFIGURED
    except ProviderUnsupportedError as exc:
        run.status, run.error_code = "UNSUPPORTED", exc.code
        run.message = _safe_message(exc.message, "הספק אינו תומך בבקשה זו")
    except ProviderTimeoutError as exc:
        run.status, run.error_code = "TIMEOUT", "TIMEOUT"
        run.message = _safe_message(exc.message, "הספק לא הגיב בזמן")
    except ProviderRateLimitedError:
        run.status, run.error_code, run.message = "FAILED", "RATE_LIMITED", MSG_RATE_LIMITED
    except ProviderError as exc:
        run.status, run.error_code = "FAILED", (exc.code or "PROVIDER_ERROR")[:64]
        run.message = _safe_message(exc.message, MSG_PROVIDER_ERROR)
    except Exception as exc:  # noqa: BLE001 - adapters are untrusted; never leak raw details
        log.warning("provider=%s raised %s", pid, type(exc).__name__)
        run.status, run.error_code, run.message = "FAILED", "PROVIDER_ERROR", MSG_PROVIDER_ERROR
    else:
        run.status = "OK"
        run.raws = list(raws or [])[:MAX_RAW_OFFERS_PER_PROVIDER]


def _execute(runs: list[_Run], category: Category, params: BaseModel, search_id: str,
             provider_settings: dict[str, dict[str, Any]]) -> None:
    if not runs:
        return
    settings = get_settings()
    base_timeout = max(0.05, float(settings.provider_timeout_seconds))
    deadline = time.monotonic() + base_timeout * OVERALL_DEADLINE_FACTOR
    started: dict[str, float] = {}
    finished: dict[str, float] = {}
    workers = max(1, min(int(settings.provider_max_concurrency), len(runs)))
    executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ori-provider")
    futures: dict[Future, _Run] = {}
    try:
        for run in runs:
            run.ctx = SearchContext(
                search_id=search_id,
                started_at=utcnow(),
                timeout_seconds=_timeout_for(run.adapter, base_timeout),
                provider_settings=dict(provider_settings.get(run.provider_id, {})),
            )
            run.started_at = utcnow()
            futures[executor.submit(_call_adapter, run.adapter, category, params, run.ctx, started, finished)] = run
        pending = set(futures)
        while pending:
            done, pending = wait(pending, timeout=POLL_SECONDS, return_when=FIRST_COMPLETED)
            for f in done:
                _collect(futures[f], f, started, finished)
            now = time.monotonic()
            for f in list(pending):
                run = futures[f]
                assert run.ctx is not None
                t0 = started.get(run.provider_id)
                if now >= deadline or (t0 is not None and now - t0 >= run.ctx.timeout_seconds):
                    pending.discard(f)
                    f.cancel()
                    run.status, run.error_code = "TIMEOUT", "TIMEOUT"
                    run.message = f"הספק לא הגיב בזמן (עד {run.ctx.timeout_seconds:g} שניות)"
                    run.finished_at = utcnow()
                    run.duration_ms = int((now - t0) * 1000) if t0 is not None else 0
    finally:
        # Never block the request on a stuck adapter thread.
        executor.shutdown(wait=False, cancel_futures=True)


def _normalize_run(run: _Run, category: Category) -> None:
    assert run.ctx is not None
    offers: list[CanonicalOffer] = []
    dropped = 0
    for raw in run.raws:
        try:
            offers.append(finalize_offer(run.adapter, run.adapter.normalize(category, raw, run.ctx)))
        except Exception as exc:  # noqa: BLE001 - one bad offer must not fail the search
            dropped += 1
            log.warning("provider=%s offer rejected during normalization: %s", run.provider_id, type(exc).__name__)
    run.offers = offers
    if run.raws and not offers:
        run.status, run.error_code, run.message = "FAILED", "NORMALIZATION_ERROR", MSG_NORMALIZATION
    elif dropped:
        run.message = f"{dropped} הצעות נפסלו בבדיקת תקינות ולא הוצגו"
    elif run.mode == "DEMO":
        run.message = MSG_DEMO_OK


def dedupe_offers(offers: list[CanonicalOffer]) -> tuple[list[CanonicalOffer], int]:
    """Keep the cheapest offer per (dedupe_key, currency, demo-or-real); others listed in also_offered_by.

    DEMO offers are never merged with real (LIVE/CACHED) ones, so fixture data can
    never hide a real supplier offer (or vice versa).
    """
    groups: dict[tuple[str, str, bool], list[CanonicalOffer]] = {}
    for o in offers:
        groups.setdefault((o.dedupe_key, o.price.total.currency, o.source.mode == "DEMO"), []).append(o)
    out: list[CanonicalOffer] = []
    for group in groups.values():
        group.sort(key=lambda o: (o.price.total.amount, o.source.provider_id, o.source.supplier_offer_id))
        best = group[0]
        others = sorted({o.source.provider_name for o in group[1:] if o.source.provider_id != best.source.provider_id})
        also = list(dict.fromkeys([*best.also_offered_by, *others]))
        out.append(best.model_copy(update={"also_offered_by": also}))
    return out, len(offers) - len(out)


def overall_status(statuses: list[str]) -> str:
    ok = any(s in ("OK", "CACHED") for s in statuses)
    failed = any(s in ("FAILED", "TIMEOUT") for s in statuses)
    if not ok:
        return "failed"
    return "partial" if failed else "completed"


def build_coverage_note(category: str, runs: list[ProviderRun], offers: list[CanonicalOffer], *,
                        filtered_out: int = 0, merged: int = 0, cached_at: datetime | None = None) -> str:
    def names(*statuses: str) -> str:
        return ", ".join(r.provider_name for r in runs if r.status in statuses)

    answered = sum(1 for r in runs if r.status in ("OK", "CACHED"))
    parts = [f"נבדקו {answered} מתוך {len(runs)} ספקים של {CATEGORY_HE.get(category, category)}."]
    if failed := names("FAILED", "TIMEOUT"):
        parts.append(f"ספקים שנכשלו או לא הגיבו בזמן: {failed}.")
    if unsupported := names("UNSUPPORTED"):
        parts.append(f"ספקים שאינם תומכים ביעד או בבקשה: {unsupported}.")
    if not_connected := names("NOT_CONFIGURED"):
        parts.append(f"ספקים לא מחוברים: {not_connected}.")
    if disabled := names("DISABLED"):
        parts.append(f"ספקים מושבתים בהגדרות: {disabled}.")
    if cached_at is not None:
        parts.append(f"התוצאות מוצגות ממטמון של חיפוש זהה שבוצע ב-{cached_at:%d/%m/%Y %H:%M} UTC.")
    if filtered_out:
        parts.append(f"{filtered_out} הצעות סוננו לפי הקריטריונים שבחרתם.")
    if merged:
        parts.append(f"{merged} הצעות זהות מספקים שונים אוחדו — מוצגת הזולה מביניהן.")
    if not offers:
        parts.append("לא נמצאו הצעות מתאימות.")
    if any(o.source.mode == "DEMO" for o in offers) or any(r.mode == "DEMO" and r.status in ("OK", "CACHED") for r in runs):
        parts.append(DEMO_DISCLAIMER)
    parts.append(NO_FULL_COVERAGE)
    return " ".join(parts)


# ----------------------------------------------------------- persistence ----


def _offer_row(offer: CanonicalOffer, search_id: str, provider_search_id: str | None) -> tuple[Offer, CanonicalOffer]:
    row_id = new_id()
    offer = offer.model_copy(update={"id": row_id})
    total = offer.price.total
    row = Offer(
        id=row_id,
        search_request_id=search_id,
        provider_search_id=provider_search_id,
        provider_id=offer.source.provider_id,
        mode=offer.source.mode,
        category=offer.category,
        supplier_offer_id=offer.source.supplier_offer_id[:255],
        dedupe_key=offer.dedupe_key[:128],
        title=offer.title[:300],
        total_amount_minor=to_minor(total.amount, total.currency),
        currency=total.currency,
        price_status=offer.price.total_status,
        fetched_at=offer.source.fetched_at,
        expires_at=offer.source.expires_at,
        deep_link=offer.source.deep_link,
        data=offer.model_dump(mode="json"),
    )
    return row, offer


def _registry_order() -> dict[str, int]:
    return {a.provider_id: i for i, a in enumerate(registry.all_adapters())}


def _run_out(ps: ProviderSearch) -> ProviderRun:
    message = ps.error_message
    if ps.status == "CACHED":
        when = ps.finished_at or ps.started_at
        message = f"מוצג מהמטמון — נשלף לראשונה ב-{when:%H:%M} UTC"
    elif ps.status == "OK" and not message and ps.mode == "DEMO":
        message = MSG_DEMO_OK
    return ProviderRun(
        provider_id=ps.provider_id,
        provider_name=registry.provider_display_name(ps.provider_id),
        mode=ps.mode,  # type: ignore[arg-type]
        status=ps.status,  # type: ignore[arg-type]
        result_count=ps.result_count,
        duration_ms=ps.duration_ms,
        error_code=ps.error_code,
        message=message,
        fetched_at=(ps.finished_at or ps.started_at) if ps.status in ("OK", "CACHED") else None,
    )


def _sorted_runs(rows: list[ProviderSearch]) -> list[ProviderSearch]:
    order = _registry_order()
    return sorted(rows, key=lambda r: (order.get(r.provider_id, 10_000), r.provider_id))


def _response(sr: SearchRequest, runs: list[ProviderRun], offers: list[CanonicalOffer], weights: dict[str, int],
              coverage: str) -> SearchResponse:
    return SearchResponse(
        search_id=sr.id,
        category=sr.category,  # type: ignore[arg-type]
        status=sr.status if sr.status in ("completed", "partial", "failed") else "failed",  # type: ignore[arg-type]
        params=dict(sr.params),
        created_at=sr.created_at,
        completed_at=sr.completed_at,
        providers=runs,
        offers=offers,
        total_offers_before_dedupe=sum(r.result_count for r in runs if r.status in ("OK", "CACHED")),
        weights=weights,
        coverage_note=coverage,
        has_demo_results=any(o.source.mode == "DEMO" for o in offers),
        has_live_results=any(o.source.mode in ("LIVE", "CACHED") for o in offers),
        highlights=compute_highlights(offers, (sr.params or {}).get("currency")),
    )


# -------------------------------------------------------------------- cache ----


def _find_cached(db: Session, phash: str, eligible_ids: set[str],
                 configs: dict[str, Any] | None = None) -> SearchRequest | None:
    """Most recent identical, fully completed search within the TTL.

    A search completed BEFORE an eligible provider's configuration last changed
    (enable/disable, ``simulate_error``, ``max_results`` ...) is not reused, so an
    owner's provider change takes effect on the very next search.
    """
    ttl = get_settings().search_cache_ttl_minutes
    if ttl <= 0 or not eligible_ids:
        return None
    since = utcnow() - timedelta(minutes=ttl)
    changed = [getattr(configs.get(pid), "updated_at", None) for pid in eligible_ids] if configs else []
    changed_at = max((c for c in changed if c is not None), default=None)
    if changed_at is not None and changed_at > since:
        since = changed_at
    candidates = db.scalars(
        select(SearchRequest)
        .where(
            SearchRequest.params_hash == phash,
            SearchRequest.status == "completed",
            SearchRequest.completed_at.is_not(None),
            SearchRequest.completed_at >= since,
        )
        .order_by(SearchRequest.completed_at.desc())
        .limit(5)
    ).all()
    for sr in candidates:
        ok_ids = {r.provider_id for r in sr.provider_searches if r.status == "OK"}
        if ok_ids == eligible_ids:
            return sr
    return None


def _serve_from_cache(db: Session, user_id: str | None, canonical: dict[str, Any], phash: str, origin: str,
                      src: SearchRequest, weights: dict[str, int]) -> SearchResponse:
    sr = SearchRequest(user_id=user_id, category=src.category, params=canonical, params_hash=phash,
                       status=src.status, origin=origin, result_count=0)
    db.add(sr)
    db.flush()
    ps_ids: dict[str, str] = {}
    new_rows: list[ProviderSearch] = []
    for r in _sorted_runs(list(src.provider_searches)):
        was_ok = r.status == "OK"
        row = ProviderSearch(
            id=new_id(),
            search_request_id=sr.id,
            provider_id=r.provider_id,
            mode=("CACHED" if r.mode == "LIVE" else r.mode) if was_ok else r.mode,
            status="CACHED" if was_ok else r.status,
            started_at=r.started_at,
            finished_at=r.finished_at,
            duration_ms=None if was_ok else r.duration_ms,
            result_count=r.result_count,
            error_code=r.error_code,
            error_message=r.error_message,
        )
        new_rows.append(row)
        ps_ids[r.provider_id] = row.id
    db.add_all(new_rows)
    db.flush()
    offers: list[CanonicalOffer] = []
    for row in db.scalars(select(Offer).where(Offer.search_request_id == src.id)).all():
        offer = CanonicalOffer.model_validate(row.data)
        if offer.source.mode == "LIVE":
            offer = offer.model_copy(update={"source": offer.source.model_copy(update={"mode": "CACHED"})})
        offers.append(offer.model_copy(update={"score": None}))
    scored = score_offers(offers, weights, preferences=preferences_from_params(canonical))
    final: list[CanonicalOffer] = []
    for offer in scored:
        row, offer = _offer_row(offer, sr.id, ps_ids.get(offer.source.provider_id))
        db.add(row)
        final.append(offer)
    sr.result_count = len(final)
    sr.completed_at = utcnow()
    db.commit()
    runs = [_run_out(r) for r in new_rows]
    cached_at = max((r.finished_at or r.started_at for r in src.provider_searches if r.status == "OK"), default=None)
    merged = max(0, sum(r.result_count for r in runs if r.status == "CACHED") - len(final))
    coverage = build_coverage_note(sr.category, runs, final, merged=merged, cached_at=cached_at)
    return _response(sr, runs, final, weights, coverage)


# ------------------------------------------------------------------ public ----


def run_search(db: Session, user_id: str | None, params: Any, origin: str = "manual", *,
               use_cache: bool = True) -> SearchResponse:
    """Run (or serve from cache) a search. ``params`` may be a params model or a dict.

    Raises ``UnprocessableError`` (422, Hebrew) for invalid params and
    ``RateLimitedError`` (429) when a user exceeds the search quota
    (origin ``"alert"`` is exempt; the price-tracking scheduler has its own quotas).
    """
    origin = (origin or "manual")[:16]
    if user_id is not None and origin != "alert":
        check_search_rate_limit(user_id)
    params = parse_search_params(params)
    category: Category = params.category
    canonical = canonical_params(params)
    phash = params_hash(canonical)
    weights = family_weights(db)
    prefs = preferences_from_params(canonical)

    configs = registry.ensure_configs(db)
    adapters = registry.adapters_for_category(category)
    eligible = {a.provider_id for a in adapters if configs[a.provider_id].enabled and registry.is_usable(a)}
    if use_cache:
        cached = _find_cached(db, phash, eligible, configs)
        if cached is not None:
            return _serve_from_cache(db, user_id, canonical, phash, origin, cached, weights)

    sr = SearchRequest(user_id=user_id, category=category, params=canonical, params_hash=phash, status="running",
                       origin=origin)
    db.add(sr)
    db.flush()

    runs: list[_Run] = []
    to_call: list[_Run] = []
    for adapter in adapters:
        caps = adapter.capabilities()
        run = _Run(adapter=adapter, name=caps.display_name, mode=caps.mode)
        cfg = configs.get(adapter.provider_id)
        if cfg is not None and not cfg.enabled:
            run.status, run.message = "DISABLED", MSG_DISABLED
        elif not registry.is_usable(adapter):
            run.status, run.error_code, run.message = "NOT_CONFIGURED", "NOT_CONFIGURED", MSG_NOT_CONFIGURED
        elif not limiter.hit(f"provider:{adapter.provider_id}", int(getattr(adapter, "rate_limit_per_minute", 60) or 60),
                             PROVIDER_RATE_WINDOW_SECONDS):
            run.status, run.error_code, run.message = "FAILED", "RATE_LIMITED", MSG_RATE_LIMITED
        else:
            to_call.append(run)
        runs.append(run)

    _execute(to_call, category, params, sr.id, {pid: dict(c.settings or {}) for pid, c in configs.items()})

    now = utcnow()
    filtered_out = 0
    for run in to_call:
        if run.status != "OK":
            continue
        _normalize_run(run, category)
        kept = [currency_warning(o, params) for o in run.offers if passes(o, params, now)]
        filtered_out += len(run.offers) - len(kept)
        run.offers = kept
        run.result_count = len(kept)

    ps_rows: dict[str, ProviderSearch] = {}
    for run in runs:
        row = ProviderSearch(
            id=new_id(),
            search_request_id=sr.id,
            provider_id=run.provider_id,
            mode=run.mode,
            status=run.status,
            started_at=run.started_at,
            finished_at=run.finished_at or (now if run.status in ("DISABLED", "NOT_CONFIGURED", "FAILED") else None),
            duration_ms=run.duration_ms,
            result_count=run.result_count,
            error_code=(run.error_code or None) and run.error_code[:64],
            error_message=(run.message[:500] if run.message and run.status != "OK" else None),
        )
        ps_rows[run.provider_id] = row
        db.add(row)
    db.flush()

    all_offers = [o for run in runs for o in run.offers]
    deduped, merged = dedupe_offers(all_offers)
    scored = score_offers(deduped, weights, preferences=prefs)
    final: list[CanonicalOffer] = []
    for offer in scored:
        ps = ps_rows.get(offer.source.provider_id)
        row, offer = _offer_row(offer, sr.id, ps.id if ps else None)
        db.add(row)
        final.append(offer)

    sr.status = overall_status([r.status for r in runs])
    sr.result_count = len(final)
    sr.completed_at = utcnow()
    db.commit()

    run_out: list[ProviderRun] = []
    for run in runs:
        out = _run_out(ps_rows[run.provider_id])
        if run.status == "OK" and run.message:
            out = out.model_copy(update={"message": run.message})
        run_out.append(out)
    coverage = build_coverage_note(category, run_out, final, filtered_out=filtered_out, merged=merged)
    return _response(sr, run_out, final, weights, coverage)


def _load_search(db: Session, search_id: str, viewer_id: str | None, viewer_is_owner: bool) -> SearchRequest:
    sr = db.get(SearchRequest, search_id)
    if sr is None or (viewer_id is not None and not viewer_is_owner and sr.user_id != viewer_id):
        # Do not reveal whether another member's search exists.
        raise NotFoundError("החיפוש לא נמצא", code="SEARCH_NOT_FOUND")
    return sr


def search_offers(db: Session, search_id: str) -> list[CanonicalOffer]:
    rows = db.scalars(select(Offer).where(Offer.search_request_id == search_id).order_by(Offer.created_at, Offer.id)).all()
    return [CanonicalOffer.model_validate({**r.data, "id": r.id}) for r in rows]


def get_search(db: Session, search_id: str, *, viewer_id: str | None = None, viewer_is_owner: bool = False,
               weights: dict[str, int] | None = None) -> SearchResponse:
    """Load a stored search and re-rank it (family weights unless ``weights`` given).

    When ``viewer_id`` is set, only the search's own user (or an owner) may read it.
    """
    sr = _load_search(db, search_id, viewer_id, viewer_is_owner)
    w = normalize_weights(weights) if weights is not None else family_weights(db)
    offers = [o.model_copy(update={"score": None}) for o in search_offers(db, sr.id)]
    scored = score_offers(offers, w, preferences=preferences_from_params(sr.params))
    runs = [_run_out(ps) for ps in _sorted_runs(list(sr.provider_searches))]
    merged = max(0, sum(r.result_count for r in runs if r.status in ("OK", "CACHED")) - len(scored))
    cached_at = None
    if runs and all(r.status != "OK" for r in runs) and any(r.status == "CACHED" for r in runs):
        cached_at = max((r.fetched_at for r in runs if r.status == "CACHED" and r.fetched_at), default=None)
    coverage = build_coverage_note(sr.category, runs, scored, merged=merged, cached_at=cached_at)
    return _response(sr, runs, scored, w, coverage)


def list_history(db: Session, user_id: str, *, page: int = 1, page_size: int = 20,
                 category: str | None = None) -> Page[SearchHistoryItem]:
    query = select(SearchRequest).where(SearchRequest.user_id == user_id)
    count_q = select(func.count()).select_from(SearchRequest).where(SearchRequest.user_id == user_id)
    if category:
        query = query.where(SearchRequest.category == category)
        count_q = count_q.where(SearchRequest.category == category)
    total = db.scalar(count_q) or 0
    rows = db.scalars(
        query.order_by(SearchRequest.created_at.desc(), SearchRequest.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    items = [
        SearchHistoryItem(
            search_id=r.id,
            category=r.category,  # type: ignore[arg-type]
            params=dict(r.params),
            status=r.status,
            result_count=r.result_count,
            created_at=r.created_at,
            origin=r.origin,
        )
        for r in rows
    ]
    return Page[SearchHistoryItem](items=items, total=total, page=page, page_size=page_size)


def get_offer_row(db: Session, offer_id: str) -> Offer:
    row = db.get(Offer, offer_id) if offer_id and len(offer_id) <= 64 else None
    if row is None:
        raise NotFoundError("ההצעה לא נמצאה", code="OFFER_NOT_FOUND")
    return row


def get_offer(db: Session, offer_id: str) -> CanonicalOffer:
    row = get_offer_row(db, offer_id)
    return CanonicalOffer.model_validate({**row.data, "id": row.id})
