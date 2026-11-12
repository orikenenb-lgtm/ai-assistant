"""Search highlights (V6 contract §2): cheapest / fastest / best-score offer of ONE search.

Rules:
* Input = the offers a search response returns (already post-filter, deduped, scored).
* Only offers in the *dominant currency* are compared (the currency with the most
  offers; ties -> the requested currency, then alphabetical). Prices are never
  converted, so an offer in another currency can never be called "the cheapest".
* ``cheapest``: lowest ``price.total``; ties -> better rank, provider, supplier id.
* ``fastest``: flights only — shortest ``total_duration_minutes``; ties -> cheaper.
* ``best_score``: highest ``score.total``; ties -> better rank, cheaper.
* The Hebrew note says "cheapest among the offers found in this search" — never
  "the cheapest flight" (no full market coverage).
"""

from __future__ import annotations

from collections import Counter
from decimal import Decimal

from app.schemas.offers import CanonicalOffer, FlightDetails
from app.schemas.search import SearchHighlights

HIGHLIGHTS_NOTE = "הזול ביותר מבין ההצעות שנמצאו בחיפוש זה (מטבע זהה) — לא בהכרח בכל השוק"
_BIG_RANK = 10**9


def dominant_currency(offers: list[CanonicalOffer], preferred: str | None = None) -> str | None:
    counts = Counter(o.price.total.currency for o in offers)
    if not counts:
        return None
    return min(counts, key=lambda cur: (-counts[cur], cur != preferred, cur))


def _rank(o: CanonicalOffer) -> int:
    return o.score.rank if o.score is not None and o.score.rank is not None else _BIG_RANK


def _tiebreak(o: CanonicalOffer) -> tuple:
    return (_rank(o), o.source.provider_id, o.source.supplier_offer_id, o.id)


def compute_highlights(offers: list[CanonicalOffer], preferred_currency: str | None = None) -> SearchHighlights | None:
    currency = dominant_currency(offers, preferred_currency)
    if currency is None:
        return None
    pool = [o for o in offers if o.price.total.currency == currency]
    cheapest = min(pool, key=lambda o: (o.price.total.amount, *_tiebreak(o)))
    flights = [o for o in pool if isinstance(o.details, FlightDetails)]
    fastest = (
        min(flights, key=lambda o: (o.details.total_duration_minutes, o.price.total.amount, *_tiebreak(o)))  # type: ignore[union-attr]
        if flights else None
    )
    scored = [o for o in pool if o.score is not None]
    best = (
        min(scored, key=lambda o: (-Decimal(o.score.total), _rank(o), o.price.total.amount, *_tiebreak(o)))  # type: ignore[union-attr]
        if scored else cheapest
    )
    note = HIGHLIGHTS_NOTE
    excluded = len(offers) - len(pool)
    if excluded:
        note += f". {excluded} הצעות במטבע אחר לא נכללו בהשוואה (ללא המרת מטבע)"
    return SearchHighlights(
        currency=currency,
        cheapest_offer_id=cheapest.id,
        fastest_offer_id=fastest.id if fastest is not None else None,
        best_score_offer_id=best.id,
        comparable_count=len(pool),
        note=note,
    )
