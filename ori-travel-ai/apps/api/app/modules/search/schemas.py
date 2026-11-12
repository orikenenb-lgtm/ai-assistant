"""Search module API schemas (SearchResponse itself lives in app.schemas.search)."""

from __future__ import annotations

from datetime import datetime

from app.schemas.common import ApiModel, Category


class SearchHistoryItem(ApiModel):
    search_id: str
    category: Category
    params: dict
    status: str
    result_count: int
    created_at: datetime
    origin: str
