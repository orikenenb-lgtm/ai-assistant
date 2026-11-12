"""Amadeus for Developers — Self-Service APIs (flights + hotels) — LIVE placeholder.

Docs: https://developers.amadeus.com/self-service — OAuth2 client-credentials
(``ORI_AMADEUS_CLIENT_ID`` / ``ORI_AMADEUS_CLIENT_SECRET``). ``settings.amadeus_env``
selects ``test.api.amadeus.com`` (default, sandbox data) or ``api.amadeus.com``.
Flight Offers Search v2, Hotel List + Hotel Search v3. No hosted checkout/deep links.
"""

from __future__ import annotations

from typing import ClassVar

from app.modules.providers.live.common import LiveAdapter
from app.schemas.common import Category


class AmadeusAdapter(LiveAdapter):
    provider_id = "amadeus"
    display_name = "Amadeus Self-Service (טיסות ומלונות)"
    categories: ClassVar[tuple[Category, ...]] = ("flight", "hotel")
    credential_fields = ("amadeus_client_id", "amadeus_client_secret")
    official_docs_url = "https://developers.amadeus.com/self-service"
    deep_link_domains = ()
    rate_limit_note = "מכסה חודשית חינמית מוגבלת בסביבת הבדיקה ומגבלת בקשות לשנייה"
    description = (
        "API רשמי של Amadeus לחיפוש טיסות ומלונות. סביבת הבדיקה מחזירה נתונים חלקיים/מדומים; "
        "אין קישורי הזמנה ישירים."
    )
