"""Expedia Group Rapid API (hotels) — NON-FUNCTIONAL placeholder (partner agreement required).

Rapid requires an approved commercial partnership (docs/integrations/provider-api-notes.md §4). Only the
documented signature helper is implemented (and unit-tested); it is NOT wired to any request. Even with
credentials + opt-in, ``search()`` raises ``ProviderUnsupportedError``; no request format is invented.

Env vars that would be used: ``ORI_EXPEDIA_RAPID_API_KEY`` and ``ORI_EXPEDIA_RAPID_SHARED_SECRET``.
"""

from __future__ import annotations

import hashlib
import time
from typing import ClassVar

from app.core.db import utcnow
from app.modules.providers.base import ProviderHealth, ProviderNotConfiguredError, ProviderUnsupportedError, RawOffer, SearchContext
from app.modules.providers.live.common import NOT_CONNECTED_MESSAGE, LiveAdapter
from app.schemas.common import ApiModel, Category

PARTNER_APPROVAL_MESSAGE = "נדרש אישור שותף — המתאם יושלם לאחר קבלת גישה"


def expedia_signature(api_key: str, shared_secret: str, timestamp: int | None = None) -> tuple[str, int]:
    """Rapid signature: unsalted SHA-512 hex of ``apiKey + sharedSecret + unixTimestampSeconds``.

    Returns ``(signature, timestamp)``. Documented at
    https://developers.expediagroup.com/rapid/lodging/reference/signature-authentication — the header form
    ``Authorization: EAN APIKey=<key>,Signature=<sig>,timestamp=<ts>`` is [prior], unverified.
    """
    ts = int(time.time()) if timestamp is None else int(timestamp)
    digest = hashlib.sha512(f"{api_key}{shared_secret}{ts}".encode()).hexdigest()
    return digest, ts


class ExpediaRapidAdapter(LiveAdapter):
    provider_id = "expedia_rapid"
    display_name = "Expedia Rapid (מלונות)"
    categories: ClassVar[tuple[Category, ...]] = ("hotel",)
    credential_fields = ("expedia_rapid_api_key", "expedia_rapid_shared_secret")
    official_docs_url = "https://developers.expediagroup.com/docs/products/rapid"
    deep_link_domains = ()
    rate_limit_note = "בהתאם להסכם השותפים של Expedia Group"
    description = (
        "API רשמי לשותפים של Expedia Group ללינה. דורש הסכם מסחרי ואישור אתר — אין הרשמה עצמית, וללא דף תשלום מתארח. "
        "המתאם אינו פעיל: גם עם מפתחות הוא לא יבצע קריאות. "
        "משתני הסביבה העתידיים: ORI_EXPEDIA_RAPID_API_KEY ו-ORI_EXPEDIA_RAPID_SHARED_SECRET."
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
