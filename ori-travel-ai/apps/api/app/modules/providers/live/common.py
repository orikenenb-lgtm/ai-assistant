"""Base class for LIVE (official API) adapters.

Wave 1 ships placeholders only: no HTTP calls are made anywhere in this
package. An adapter is usable only when BOTH the explicit opt-in
``ORI_LIVE_PROVIDERS_ENABLED=true`` AND all of its credentials are present;
otherwise it reports NOT_CONFIGURED ("לא מחובר") and the orchestrator never
calls ``search()``.

Implementing a real adapter (agent B6) — per file in this package:
1. Override ``search()`` with real HTTP calls (``httpx`` is already a runtime
   dependency) honoring ``ctx.timeout_seconds``; map HTTP 429 to
   ``ProviderRateLimitedError(retryable=True)``, 5xx/timeouts to retryable
   ``ProviderError``/``ProviderTimeoutError``; never put raw payloads, headers or
   secrets into error messages (Hebrew, user-safe only).
2. Override ``normalize()`` using ``app.modules.providers.normalization``
   (``component``/``build_breakdown``/``compute_dedupe_key``); set
   ``source.mode="LIVE"`` and ``deep_link`` only to allowlisted https URLs.
3. Override ``health()`` (cheap authenticated call) and flip
   ``implemented = True`` plus the relevant capability flags.
"""

from __future__ import annotations

from typing import ClassVar

from app.core.config import get_settings
from app.core.db import utcnow
from app.modules.providers.base import (
    ProviderAdapter,
    ProviderCapabilities,
    ProviderHealth,
    ProviderNotConfiguredError,
    ProviderUnsupportedError,
    RawOffer,
    SearchContext,
)
from app.schemas.common import ApiModel, Category
from app.schemas.offers import CanonicalOffer

NOT_CONNECTED_MESSAGE = "לא מחובר — חסרים פרטי גישה או שהפעלת ספקים חיים כבויה (ORI_LIVE_PROVIDERS_ENABLED)"
NOT_IMPLEMENTED_MESSAGE = "החיבור החי לספק זה טרם מומש בגרסה זו — לא בוצעה פנייה לספק"


class LiveAdapter(ProviderAdapter):
    provider_id: str = ""
    display_name: str = ""
    categories: ClassVar[tuple[Category, ...]] = ()
    # Settings field names (app.core.config.Settings) holding the credentials
    credential_fields: ClassVar[tuple[str, ...]] = ()
    official_docs_url: str | None = None
    deep_link_domains: ClassVar[tuple[str, ...]] = ()
    rate_limit_note: str | None = None
    description: str = ""
    rate_limit_per_minute: int = 20
    timeout_seconds: float | None = None
    # Flipped to True by the agent that implements real HTTP calls
    implemented: ClassVar[bool] = False
    allowed_settings: ClassVar[dict[str, tuple]] = {
        "max_results": ("int", 1, 50),
        "market": ("pattern", r"^[A-Z]{2}$"),
        "language": ("enum", ("he", "en")),
    }

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            provider_id=self.provider_id,
            display_name=self.display_name,
            mode="LIVE",
            categories=list(self.categories),
            supports_search=True,
            supports_revalidate=False,
            supports_booking_options=False,
            supports_hosted_checkout=False,
            supports_live_booking=False,
            requires_credentials=self.required_env_vars(),
            official_docs_url=self.official_docs_url,
            deep_link_domains=list(self.deep_link_domains),
            rate_limit_note=self.rate_limit_note,
            notes=self.description,
        )

    @classmethod
    def required_env_vars(cls) -> list[str]:
        return [f"ORI_{f.upper()}" for f in cls.credential_fields]

    def credentials_present(self) -> bool:
        settings = get_settings()
        return all(bool(getattr(settings, f, None)) for f in self.credential_fields)

    def is_configured(self) -> bool:
        return bool(get_settings().live_providers_enabled) and self.credentials_present()

    def health(self) -> ProviderHealth:
        if not self.is_configured():
            return ProviderHealth(
                provider_id=self.provider_id,
                status="NOT_CONFIGURED",
                checked_at=utcnow(),
                message=NOT_CONNECTED_MESSAGE,
            )
        return ProviderHealth(
            provider_id=self.provider_id,
            status="DEGRADED",
            checked_at=utcnow(),
            message=NOT_IMPLEMENTED_MESSAGE,
        )

    def search(self, category: Category, params: ApiModel, ctx: SearchContext) -> list[RawOffer]:
        if not self.is_configured():
            raise ProviderNotConfiguredError(NOT_CONNECTED_MESSAGE)
        raise ProviderUnsupportedError(NOT_IMPLEMENTED_MESSAGE, code="NOT_IMPLEMENTED")

    def normalize(self, category: Category, raw: RawOffer, ctx: SearchContext) -> CanonicalOffer:
        raise ProviderUnsupportedError(NOT_IMPLEMENTED_MESSAGE, code="NOT_IMPLEMENTED")
