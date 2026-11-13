"""Side-by-side comparison of persisted offers.

Offers are grouped by (category, currency) and scored separately per group:
cost is never compared across currencies or categories. Optional labeled DEMO
FX conversions are attached for display only.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.app_settings import get_setting
from app.core.db import utcnow
from app.modules.comparison.fx import FX_NOTE, FxUnavailableError, convert
from app.modules.comparison.schemas import ComparisonGroup, ComparisonOut
from app.modules.comparison.scoring import WeightsError, normalize_weights, score_offers
from app.modules.providers.errors import UnprocessableError
from app.modules.search.service import family_weights, get_offer
from app.schemas.offers import CanonicalOffer


def compare_offers(db: Session, offer_ids: list[str], weights: dict[str, int] | None = None) -> ComparisonOut:
    if len(set(offer_ids)) != len(offer_ids):
        raise UnprocessableError("כל הצעה יכולה להופיע פעם אחת בלבד בהשוואה")
    if not 2 <= len(offer_ids) <= 10:
        raise UnprocessableError("יש לבחור בין 2 ל-10 הצעות להשוואה")
    try:
        w = normalize_weights(weights) if weights is not None else family_weights(db)
    except WeightsError as exc:
        raise UnprocessableError(str(exc), details=[{"field": "weights", "message": str(exc)}]) from None

    offers = [get_offer(db, oid).model_copy(update={"score": None}) for oid in offer_ids]
    groups: dict[tuple[str, str], list[CanonicalOffer]] = {}
    for o in offers:
        groups.setdefault((o.category, o.price.total.currency), []).append(o)

    display_currency = str(get_setting(db, "display").get("currency") or "ILS")
    notes: list[str] = []
    out_groups: list[ComparisonGroup] = []
    used_fx = False
    for (category, currency), items in groups.items():
        scored = score_offers(items, w)
        cheapest = min(scored, key=lambda o: (o.price.total.amount, o.id))
        conversions = {}
        if currency != display_currency:
            for o in scored:
                try:
                    conversions[o.id] = convert(o.price.total, display_currency)
                    used_fx = True
                except FxUnavailableError:
                    pass
        out_groups.append(
            ComparisonGroup(category=category, currency=currency, offers=scored, cheapest_offer_id=cheapest.id,
                            display_conversions=conversions)
        )

    categories = {c for c, _ in groups}
    if len(categories) > 1:
        notes.append("הצעות מקטגוריות שונות מוצגות בקבוצות נפרדות ואינן מדורגות זו מול זו")
    for category in categories:
        if len({cur for c, cur in groups if c == category}) > 1:
            notes.append("הצעות במטבעות שונים מוצגות בקבוצות נפרדות — לא בוצעה המרת מטבע לצורך הדירוג")
            break
    if any(len(g.offers) == 1 for g in out_groups):
        notes.append("בחלק מהקבוצות יש הצעה אחת בלבד — אין מול מה לדרג אותה")
    if any(o.source.mode == "DEMO" for o in offers):
        notes.append("חלק מההצעות הן נתוני הדגמה — לא מחיר אמיתי ולא זמינות אמיתית")
    now = utcnow()
    expired = sum(1 for o in offers if o.source.expires_at is not None and o.source.expires_at <= now)
    if expired:
        notes.append(f"{expired} הצעות פגו תוקף — מומלץ לחפש מחדש לפני הזמנה")
    if used_fx:
        notes.append(f"המרות מטבע ל-{display_currency} מוצגות לנוחות בלבד. {FX_NOTE}")
    return ComparisonOut(groups=out_groups, weights=w, notes=notes)
