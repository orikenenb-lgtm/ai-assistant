"""Expedia Group Rapid API (hotels) — LIVE placeholder.

Docs: https://developers.expediagroup.com/docs/products/rapid — signature auth
(SHA-512 of api key + shared secret + timestamp): ``ORI_EXPEDIA_RAPID_API_KEY`` +
``ORI_EXPEDIA_RAPID_SHARED_SECRET``. Rapid is API-only (no hosted checkout links).
"""

from __future__ import annotations

from typing import ClassVar

from app.modules.providers.live.common import LiveAdapter
from app.schemas.common import Category


class ExpediaRapidAdapter(LiveAdapter):
    provider_id = "expedia_rapid"
    display_name = "Expedia Rapid (מלונות)"
    categories: ClassVar[tuple[Category, ...]] = ("hotel",)
    credential_fields = ("expedia_rapid_api_key", "expedia_rapid_shared_secret")
    official_docs_url = "https://developers.expediagroup.com/docs/products/rapid"
    deep_link_domains = ()
    rate_limit_note = "בהתאם להסכם השותפים של Expedia Group"
    description = "API רשמי לשותפים של Expedia Group ללינה. דורש הסכם שותפים; ללא דף תשלום מתארח."
