"""Amadeus for Developers — Self-Service APIs: DISCONTINUED (listed only to explain why).

Per research (docs/integrations/provider-api-notes.md §2, third-party reports citing a Feb 2026 customer
letter) the Self-Service portal was closed on 2026-07-17 and API keys were disabled. This adapter is
therefore permanently inert: ``is_configured()`` is always False (whatever the environment holds),
``search()`` never touches the network and ``health()`` explains the situation.
The environment variables are still declared so the provider list stays stable for the owner.
"""

from __future__ import annotations

from typing import ClassVar

from app.core.db import utcnow
from app.modules.providers.base import ProviderCapabilities, ProviderHealth, ProviderNotConfiguredError, RawOffer, SearchContext
from app.modules.providers.live.common import LiveAdapter
from app.schemas.common import ApiModel, Category

AMADEUS_DISCONTINUED_MESSAGE = (
    "הופסק — לפי דיווחים, פורטל Self-Service של Amadeus נסגר ב-17.7.2026 ומפתחות ה-API הושבתו. "
    "המתאם אינו מבצע קריאות לרשת"
)


class AmadeusAdapter(LiveAdapter):
    provider_id = "amadeus"
    display_name = "Amadeus Self-Service (טיסות ומלונות) — הופסק"
    categories: ClassVar[tuple[Category, ...]] = ("flight", "hotel")
    credential_fields = ("amadeus_client_id", "amadeus_client_secret")
    official_docs_url = "https://developers.amadeus.com/self-service"
    deep_link_domains = ()
    rate_limit_note = "לא רלוונטי — השירות הופסק"
    description = (
        "הופסק: לפי דיווחים (מקורות צד שלישי, ראו docs/integrations/providers.md) פורטל ה-Self-Service של Amadeus נסגר "
        "ב-17.7.2026. גישה לפורטל הארגוני מחייבת חוזה מול Amadeus. המתאם נשאר ברשימה רק כדי להסביר מדוע הוא כבוי, "
        "ואינו מבצע קריאות לרשת גם אם הוגדרו משתני סביבה."
    )

    def capabilities(self) -> ProviderCapabilities:
        return super().capabilities().model_copy(update={"supports_revalidate": False, "supports_booking_options": False})

    def is_configured(self) -> bool:
        return False

    def health(self) -> ProviderHealth:
        return ProviderHealth(
            provider_id=self.provider_id, status="NOT_CONFIGURED", checked_at=utcnow(), message=AMADEUS_DISCONTINUED_MESSAGE
        )

    def search(self, category: Category, params: ApiModel, ctx: SearchContext) -> list[RawOffer]:
        raise ProviderNotConfiguredError(AMADEUS_DISCONTINUED_MESSAGE, code="DISCONTINUED")
