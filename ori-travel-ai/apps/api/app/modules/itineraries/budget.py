"""Trip budget: totals per currency (never mixed or silently converted), per kind, remaining, warnings.

Overlap policy: items flagged as overlapping (``OVERLAPS`` warning) are STILL counted in every total -
an overlap is a scheduling conflict, not a cost exclusion; only ``cost_status == "excluded"`` removes a cost.

``per_traveler`` = counted (known + estimated) / number of trip travelers, only when every counted
cost is in one currency and there is at least one traveler; otherwise null with ``per_traveler_reason``.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from app.core.db import utcnow
from app.core.money import from_minor, quantize
from app.models.trips import Trip, TripItem
from app.modules.itineraries.overlaps import find_overlaps
from app.modules.itineraries.schemas import BudgetCurrencyRow, BudgetKindRow, BudgetOut, BudgetWarning
from app.modules.itineraries.service import snapshot_expired
from app.schemas.common import Money

_BUCKET = {"known": "known", "estimate": "estimated", "excluded": "excluded"}


def _rows(items: list[TripItem]) -> list[BudgetCurrencyRow]:
    acc: dict[str, dict[str, Decimal]] = defaultdict(lambda: {"known": Decimal(0), "estimated": Decimal(0), "excluded": Decimal(0)})
    for it in items:
        if it.cost_amount_minor is None or not it.cost_currency:
            continue
        bucket = _BUCKET.get(it.cost_status)
        if bucket is None:
            continue
        acc[it.cost_currency][bucket] += from_minor(it.cost_amount_minor, it.cost_currency)
    return [
        BudgetCurrencyRow(
            currency=cur,
            known=v["known"],
            estimated=v["estimated"],
            excluded=v["excluded"],
            counted=v["known"] + v["estimated"],
        )
        for cur, v in sorted(acc.items())
    ]


def compute_budget(trip: Trip) -> BudgetOut:
    items = list(trip.items)
    now = utcnow()
    budget = (
        Money(amount=from_minor(trip.budget_amount_minor, trip.budget_currency), currency=trip.budget_currency)
        if trip.budget_amount_minor is not None and trip.budget_currency
        else None
    )
    totals = _rows(items)

    by_kind: dict[str, list[TripItem]] = defaultdict(list)
    for it in items:
        by_kind[it.kind].append(it)
    kinds = [BudgetKindRow(kind=k, item_count=len(v), totals=_rows(v)) for k, v in sorted(by_kind.items())]

    warnings: list[BudgetWarning] = []
    counted_currencies = {
        it.cost_currency
        for it in items
        if it.cost_amount_minor is not None and it.cost_currency and it.cost_status in ("known", "estimate")
    }

    remaining: Money | None = None
    reason = "ok"
    over = False
    if budget is None:
        reason = "no_budget"
    elif counted_currencies - {budget.currency}:
        reason = "mixed_currencies"
        warnings.append(
            BudgetWarning(
                code="MIXED_CURRENCIES",
                message=(
                    "לא ניתן לחשב יתרה: בטיול יש עלויות במטבעות שונים ממטבע התקציב "
                    f"({', '.join(sorted(counted_currencies | {budget.currency}))}). "
                    "המערכת אינה ממירה מטבעות באופן אוטומטי — הסכומים מוצגים לפי מטבע."
                ),
            )
        )
    else:
        counted = next((r.counted for r in totals if r.currency == budget.currency), Decimal(0))
        rem = quantize(budget.amount - counted, budget.currency)
        remaining = Money(amount=rem, currency=budget.currency)
        if rem < 0:
            over = True
            warnings.append(BudgetWarning(code="OVER_BUDGET", message="העלויות חורגות מהתקציב שהוגדר לטיול"))

    expired = [i.id for i in items if snapshot_expired(i.offer_snapshot, now)]
    if expired:
        warnings.append(
            BudgetWarning(
                code="OFFER_EXPIRED",
                message="חלק מהמחירים נשמרו מהצעות שפג תוקפן — יש לאמת מחיר וזמינות מחדש לפני הזמנה",
                item_ids=expired,
            )
        )
    estimated = [i.id for i in items if i.cost_status == "estimate" and i.cost_amount_minor is not None]
    if estimated:
        warnings.append(
            BudgetWarning(
                code="ESTIMATED_COSTS",
                message="חלק מהעלויות הן הערכה בלבד ואינן מחיר מאושר של ספק",
                item_ids=estimated,
            )
        )
    no_cost = [i.id for i in items if i.cost_amount_minor is None and i.cost_status != "excluded"]
    if no_cost:
        warnings.append(
            BudgetWarning(
                code="ITEMS_WITHOUT_COST",
                message="לחלק מהפריטים אין עלות מוגדרת — הסכומים אינם כוללים אותם",
                item_ids=no_cost,
            )
        )
    demo = [i.id for i in items if (i.offer_snapshot or {}).get("source", {}).get("mode") == "DEMO"]
    if demo:
        warnings.append(
            BudgetWarning(
                code="DEMO_DATA",
                message="חלק מהמחירים הם נתוני הדגמה (DEMO) ואינם מחירים אמיתיים",
                item_ids=demo,
            )
        )
    overlaps = find_overlaps(items)
    if overlaps:
        involved = list(dict.fromkeys(i for o in overlaps for i in (o.item_id, o.other_item_id)))
        warnings.append(
            BudgetWarning(
                code="OVERLAPS",
                message=(
                    f"נמצאו {len(overlaps)} חפיפות בזמנים בין פריטים בטיול. "
                    "העלויות של הפריטים החופפים עדיין נספרות בתקציב."
                ),
                item_ids=involved,
            )
        )

    traveler_count = len(trip.travelers)
    per_traveler: Money | None = None
    if not counted_currencies:
        per_reason = "no_costs"
    elif len(counted_currencies) > 1:
        per_reason = "mixed_currencies"
    elif traveler_count <= 0:
        per_reason = "no_travelers"
    else:
        cur = next(iter(counted_currencies))
        total = next((r.counted for r in totals if r.currency == cur), Decimal(0))
        per_traveler = Money(amount=quantize(total / traveler_count, cur), currency=cur)
        per_reason = "ok"
    return BudgetOut(
        trip_id=trip.id,
        budget=budget,
        totals=totals,
        by_kind=kinds,
        remaining=remaining,
        remaining_reason=reason,  # type: ignore[arg-type]
        over_budget=over,
        per_traveler=per_traveler,
        per_traveler_reason=per_reason,  # type: ignore[arg-type]
        traveler_count=traveler_count,
        warnings=warnings,
    )
