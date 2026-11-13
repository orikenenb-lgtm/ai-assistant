"""Booking.com Demand API (hotels) — NON-FUNCTIONAL placeholder (partner agreement required).

Access is limited to approved Managed Affiliate Partners (contract + Partner Centre, see
docs/integrations/provider-api-notes.md §3). Request/response formats were NOT read from the official
OpenAPI spec, so no request format is invented here: even when credentials + opt-in are present,
``search()`` raises ``ProviderUnsupportedError``.

To apply: https://developers.booking.com/demand/docs/getting-started/prerequisites . Env vars that would
be used: ``ORI_BOOKING_DEMAND_API_KEY`` and ``ORI_BOOKING_DEMAND_AFFILIATE_ID``.
"""

from __future__ import annotations

from typing import ClassVar

from app.core.db import utcnow
from app.modules.providers.base import ProviderHealth, ProviderNotConfiguredError, ProviderUnsupportedError, RawOffer, SearchContext
from app.modules.providers.live.common import NOT_CONNECTED_MESSAGE, LiveAdapter
from app.schemas.common import ApiModel, Category

PARTNER_APPROVAL_MESSAGE = "נדרש אישור שותף — המתאם יושלם לאחר קבלת גישה"


class BookingDemandAdapter(LiveAdapter):
    provider_id = "booking_demand"
    display_name = "Booking.com Demand API (מלונות)"
    categories: ClassVar[tuple[Category, ...]] = ("hotel",)
    credential_fields = ("booking_demand_api_key", "booking_demand_affiliate_id")
    official_docs_url = "https://developers.booking.com/demand/docs"
    deep_link_domains = ("booking.com",)
    rate_limit_note = "בהתאם להסכם השותפים של Booking.com"
    description = (
        "API רשמי לשותפים מנוהלים (Managed Affiliate Partners) של Booking.com. דורש חוזה שותפות ואישור — אין הרשמה עצמית. "
        "המתאם אינו פעיל: פורמט הבקשות לא אומת, ולכן גם עם מפתחות הוא לא יבצע קריאות. "
        "משתני הסביבה העתידיים: ORI_BOOKING_DEMAND_API_KEY ו-ORI_BOOKING_DEMAND_AFFILIATE_ID."
    )

    def health(self) -> ProviderHealth:
        if not self.is_configured():
            return ProviderHealth(
                provider_id=self.provider_id, status="NOT_CONFIGURED", checked_at=utcnow(), message=NOT_CONNECTED_MESSAGE
            )
        return ProviderHealth(
            provider_id=self.provider_id, status="DEGRADED", checked_at=utcnow(), message=PARTNER_APPROVAL_MESSAGE
        )

    def search(self, category: Category, params: ApiModel, ctx: SearchContext) -> list[RawOffer]:
        if not self.is_configured():
            raise ProviderNotConfiguredError(NOT_CONNECTED_MESSAGE)
        raise ProviderUnsupportedError(PARTNER_APPROVAL_MESSAGE, code="PARTNER_APPROVAL_REQUIRED")
