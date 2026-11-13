"""Post-filters applied to normalized offers according to the search params.

Hard criteria filter offers out; soft criteria (preferred departure window,
checked bags, kosher preference, language) only affect scoring/warnings.
"""

from __future__ import annotations

from datetime import datetime

from app.schemas.offers import ActivityDetails, CanonicalOffer, CarDetails, FlightDetails, HotelDetails
from app.schemas.search import ActivitySearchParams, CarSearchParams, FlightSearchParams, HotelSearchParams

# Minimum board level: asking for "breakfast" accepts breakfast or anything richer.
BOARD_LEVEL = {"room_only": 0, "breakfast": 1, "half_board": 2, "full_board": 3, "all_inclusive": 4}
BOARD_MIN = {"any": 0, "breakfast": 1, "half_board": 2, "all_inclusive": 4}


def _free_cancellation_open(offer: CanonicalOffer, now: datetime) -> bool:
    c = offer.cancellation
    return c.refundable is True and (c.free_cancellation_until is None or c.free_cancellation_until > now)


def passes(offer: CanonicalOffer, params, now: datetime) -> bool:
    if params.max_price is not None and offer.price.total.currency == params.currency:
        if offer.price.total.amount > params.max_price:
            return False
    d = offer.details
    if isinstance(params, FlightSearchParams) and isinstance(d, FlightDetails):
        if params.max_stops is not None and d.max_stops > params.max_stops:
            return False
        return True
    if isinstance(params, HotelSearchParams) and isinstance(d, HotelDetails):
        if params.min_stars is not None and (d.star_rating is None or d.star_rating < params.min_stars):
            return False
        if BOARD_LEVEL.get(d.board, 0) < BOARD_MIN[params.board]:
            return False
        if params.free_cancellation_only and not _free_cancellation_open(offer, now):
            return False
        if params.accessibility_required and not d.accessibility_features:
            return False
        return True
    if isinstance(params, CarSearchParams) and isinstance(d, CarDetails):
        if params.car_class != "any" and d.car_class != params.car_class:
            return False
        if params.transmission != "any" and d.transmission != params.transmission:
            return False
        if d.seats < params.min_seats:
            return False
        return True
    if isinstance(params, ActivitySearchParams) and isinstance(d, ActivityDetails):
        if params.interests:
            wanted = set(params.interests)
            if d.category not in wanted and not ("family" in wanted and d.family_friendly):
                return False
        if params.accessibility_required and not d.accessibility_features:
            return False
        # Suitability: an activity the youngest child cannot join is not a valid family option.
        if d.min_age and params.children_ages and min(params.children_ages) < d.min_age:
            return False
        return True
    return False  # category mismatch


def currency_warning(offer: CanonicalOffer, params) -> CanonicalOffer:
    """Max price cannot be applied across currencies (no silent FX)."""
    if params.max_price is not None and offer.price.total.currency != params.currency:
        msg = f"לא ניתן להחיל מחיר מקסימלי: ההצעה במטבע {offer.price.total.currency} ולא ב-{params.currency}"
        if msg not in offer.warnings:
            return offer.model_copy(update={"warnings": [*offer.warnings, msg]})
    return offer
