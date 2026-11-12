"""Viator Partner API (activities) — LIVE placeholder.

Docs: https://docs.viator.com/partner-api/technical/ — header ``exp-api-key:
<ORI_VIATOR_API_KEY>``. Product search + availability; product URLs on
viator.com (allowlisted) for hosted checkout by affiliate partners.
"""

from __future__ import annotations

from typing import ClassVar

from app.modules.providers.live.common import LiveAdapter
from app.schemas.common import Category


class ViatorAdapter(LiveAdapter):
    provider_id = "viator"
    display_name = "Viator (אטרקציות)"
    categories: ClassVar[tuple[Category, ...]] = ("activity",)
    credential_fields = ("viator_api_key",)
    official_docs_url = "https://docs.viator.com/partner-api/technical/"
    deep_link_domains = ("viator.com",)
    rate_limit_note = "מגבלות קצב לפי רמת השותף ב-Viator"
    description = "API רשמי לשותפים של Viator לסיורים ואטרקציות. ההזמנה מתבצעת באתר הספק."
