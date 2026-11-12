"""Booking.com Demand API (hotels) — LIVE placeholder.

Docs: https://developers.booking.com/demand/docs — requires an approved affiliate
partnership: ``ORI_BOOKING_DEMAND_API_KEY`` + ``ORI_BOOKING_DEMAND_AFFILIATE_ID``.
Deep links must point to booking.com (allowlisted) and carry the affiliate id.
"""

from __future__ import annotations

from typing import ClassVar

from app.modules.providers.live.common import LiveAdapter
from app.schemas.common import Category


class BookingDemandAdapter(LiveAdapter):
    provider_id = "booking_demand"
    display_name = "Booking.com Demand API (מלונות)"
    categories: ClassVar[tuple[Category, ...]] = ("hotel",)
    credential_fields = ("booking_demand_api_key", "booking_demand_affiliate_id")
    official_docs_url = "https://developers.booking.com/demand/docs"
    deep_link_domains = ("booking.com",)
    rate_limit_note = "בהתאם להסכם השותפים של Booking.com"
    description = "API רשמי לשותפים מאושרים של Booking.com. דורש אישור שותף; ההזמנה מתבצעת באתר הספק."
