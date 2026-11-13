from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.common import ApiModel, Category
from app.schemas.offers import CanonicalOffer


class SavedOfferCreate(ApiModel):
    offer_id: str = Field(..., min_length=1, max_length=64)
    note: str | None = Field(None, max_length=500)
    trip_id: str | None = Field(None, max_length=64)


class SavedOfferUpdate(ApiModel):
    note: str | None = Field(None, max_length=500)
    trip_id: str | None = Field(None, max_length=64)


class SavedOfferOut(ApiModel):
    id: str
    offer_id: str
    category: Category
    note: str | None = None
    trip_id: str | None = None
    is_expired: bool
    created_at: datetime
    offer: CanonicalOffer
