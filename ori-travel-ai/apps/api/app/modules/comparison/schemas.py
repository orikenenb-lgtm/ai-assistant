"""Comparison API schemas."""

from __future__ import annotations

from pydantic import Field

from app.schemas.common import ApiModel, Category
from app.schemas.offers import CanonicalOffer, ConvertedAmount


class ComparisonIn(ApiModel):
    offer_ids: list[str] = Field(..., min_length=2, max_length=10)
    weights: dict[str, int] | None = None


class ComparisonGroup(ApiModel):
    category: Category
    currency: str
    offers: list[CanonicalOffer]  # each with ``score`` (rank within the group)
    cheapest_offer_id: str | None = None
    # Labeled DEMO FX conversions of each total into the family display currency
    # (display only — never used for ranking). Keyed by offer id.
    display_conversions: dict[str, ConvertedAmount] = Field(default_factory=dict)


class ComparisonOut(ApiModel):
    groups: list[ComparisonGroup]
    weights: dict[str, int]
    notes: list[str] = Field(default_factory=list)
