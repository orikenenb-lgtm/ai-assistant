"""Comparison + FX API (one router serves /api/comparisons and /api/fx/rates)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import AuthContext, current_user
from app.modules.comparison.fx import FxRatesOut, fx_rates
from app.modules.comparison.schemas import ComparisonIn, ComparisonOut
from app.modules.comparison.service import compare_offers

router = APIRouter(tags=["comparison"])


@router.post("/api/comparisons", response_model=ComparisonOut)
def create_comparison(
    body: ComparisonIn, ctx: AuthContext = Depends(current_user), db: Session = Depends(get_db)
) -> ComparisonOut:
    return compare_offers(db, body.offer_ids, body.weights)


@router.get("/api/fx/rates", response_model=FxRatesOut)
def get_fx_rates(ctx: AuthContext = Depends(current_user)) -> FxRatesOut:
    return fx_rates()
