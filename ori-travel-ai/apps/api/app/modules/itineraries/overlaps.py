"""Overlap detection between timed trip items.

Rules
-----
* Only items with a ``start_at`` take part; unscheduled items are ignored.
* An item occupies the half-open interval ``[start_at, end_at)``. Without ``end_at`` (or with
  ``end_at == start_at``) it is a *point* in time: a point overlaps an interval when
  ``start <= point < end`` and overlaps another point only when both are at the same instant.
* Forbidden pairs (reported as overlaps, rejected with 409 ``ITEM_OVERLAP`` unless the client
  sends ``allow_overlap: true``): flight/flight, activity/flight, activity/activity, hotel/hotel.
* Everything else may overlap freely: a car rental overlaps anything, a hotel stay overlaps
  flights, activities and cars, and transfer/note/other items are never checked.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Protocol

from app.modules.itineraries.schemas import OverlapOut

FORBIDDEN_PAIRS: frozenset[frozenset[str]] = frozenset(
    {
        frozenset({"flight"}),
        frozenset({"activity", "flight"}),
        frozenset({"activity"}),
        frozenset({"hotel"}),
    }
)

_KIND_HE = {"flight": "טיסה", "activity": "פעילות", "hotel": "מלון"}


class _Timed(Protocol):
    id: str
    kind: str
    title: str
    start_at: datetime | None
    end_at: datetime | None


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def _interval(it: _Timed) -> tuple[datetime, datetime] | None:
    if it.start_at is None:
        return None
    s = _aware(it.start_at)
    e = _aware(it.end_at) if it.end_at is not None else s
    return s, max(s, e)


def intervals_overlap(a: tuple[datetime, datetime], b: tuple[datetime, datetime]) -> bool:
    (s1, e1), (s2, e2) = a, b
    p1, p2 = s1 == e1, s2 == e2
    if p1 and p2:
        return s1 == s2
    if p1:
        return s2 <= s1 < e2
    if p2:
        return s1 <= s2 < e1
    return s1 < e2 and s2 < e1


def pair_forbidden(kind_a: str, kind_b: str) -> bool:
    return frozenset({kind_a, kind_b}) in FORBIDDEN_PAIRS


def kind_pair(kind_a: str, kind_b: str) -> str:
    return "-".join(sorted((kind_a, kind_b)))


def _message(a: _Timed, b: _Timed) -> str:
    ka, kb = _KIND_HE.get(a.kind, a.kind), _KIND_HE.get(b.kind, b.kind)
    return f"{ka} \"{a.title}\" חופפת בזמן ל{kb} \"{b.title}\""


def find_overlaps(items: Iterable[_Timed]) -> list[OverlapOut]:
    """All forbidden overlapping pairs (one entry per pair; ``item_id`` is the earlier-starting item)."""
    timed = []
    for it in items:
        iv = _interval(it)
        if iv is not None and any(it.kind in p for p in FORBIDDEN_PAIRS):
            timed.append((iv, it))
    timed.sort(key=lambda t: (t[0][0], t[1].id))
    out: list[OverlapOut] = []
    for i, (iv_a, a) in enumerate(timed):
        for iv_b, b in timed[i + 1 :]:
            if iv_b[0] > iv_a[1]:
                # sorted by start: nothing later can touch a (points at a's end are handled by <=)
                break
            if pair_forbidden(a.kind, b.kind) and intervals_overlap(iv_a, iv_b):
                out.append(
                    OverlapOut(
                        item_id=a.id,
                        other_item_id=b.id,
                        kind_pair=kind_pair(a.kind, b.kind),
                        message=_message(a, b),
                    )
                )
    return out


def overlaps_for(overlaps: list[OverlapOut], item_id: str) -> list[OverlapOut]:
    return [o for o in overlaps if item_id in (o.item_id, o.other_item_id)]
