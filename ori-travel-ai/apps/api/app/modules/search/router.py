"""Search API: run searches, read/re-rank stored searches, history, offers.

Route order matters: ``/api/search/history`` is declared before
``/api/search/{search_id}``; ``/api/search/flight/calendar`` before
``/api/search/{category}``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user
from app.core.errors import NotFoundError
from app.modules.comparison.scoring import WeightsError, parse_weights_param
from app.modules.providers.errors import UnprocessableError
from app.modules.search import calendar, service
from app.modules.search.schemas import FlightCalendarResponse, SearchHistoryItem
from app.schemas.common import Page
from app.schemas.offers import CanonicalOffer
from app.schemas.search import PARAMS_BY_CATEGORY, SearchResponse

router = APIRouter(tags=["search"])


@router.get("/api/search/history", response_model=Page[SearchHistoryItem])
def search_history(
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(20, ge=1, le=100),
    category: str | None = Query(None, pattern="^(flight|hotel|car|activity)$"),
    ctx: AuthContext = Depends(current_user),
    db: Session = Depends(get_db),
) -> Page[SearchHistoryItem]:
    return service.list_history(db, ctx.user_id, page=page, page_size=page_size, category=category)


@router.post("/api/search/flight/calendar", response_model=FlightCalendarResponse)
def flight_calendar(
    payload: dict[str, Any] = Body(...),
    ctx: AuthContext = Depends(current_user),
    db: Session = Depends(get_db),
) -> FlightCalendarResponse:
    """Fare calendar (V6 §1): DEMO adapters per cell + cached real offers; LIVE adapters never called.

    Rate limited (10 per 10 minutes per user). Nothing is persisted.
    """
    return calendar.flight_calendar(db, ctx.user_id, payload)


@router.post("/api/search/{category}", response_model=SearchResponse)
def run_search(
    category: str,
    payload: dict[str, Any] = Body(...),
    ctx: AuthContext = Depends(current_user),
    db: Session = Depends(get_db),
) -> SearchResponse:
    if category not in PARAMS_BY_CATEGORY:
        raise NotFoundError("קטגוריית חיפוש לא נתמכת", code="UNKNOWN_CATEGORY")
    params = service.parse_search_params(payload, category)
    # run_search applies the per-user search rate limit (30 per 10 minutes).
    return service.run_search(db, ctx.user_id, params, origin="manual")


@router.get("/api/search/{search_id}", response_model=SearchResponse)
def get_search(
    search_id: str,
    weights: str | None = Query(None, max_length=120),
    ctx: AuthContext = Depends(current_user),
    db: Session = Depends(get_db),
) -> SearchResponse:
    parsed = None
    if weights:
        try:
            parsed = parse_weights_param(weights)
        except WeightsError as exc:
            raise UnprocessableError(str(exc), details=[{"field": "weights", "message": str(exc)}]) from None
    return service.get_search(db, search_id, viewer_id=ctx.user_id, viewer_is_owner=ctx.is_owner, weights=parsed)


@router.get("/api/offers/{offer_id}", response_model=CanonicalOffer)
def get_offer(offer_id: str, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)) -> CanonicalOffer:
    return service.get_offer(db, offer_id)
