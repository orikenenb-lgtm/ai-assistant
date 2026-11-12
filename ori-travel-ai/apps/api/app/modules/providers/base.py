"""Provider adapter contract.

Every travel data source (DEMO fixtures or an official LIVE API) implements
``ProviderAdapter``. Adapters are synchronous and side-effect free with respect
to the database: the search orchestrator calls them in a bounded thread pool,
then persists results itself.

Capability flags are explicit — never assume a provider can do something it
has not declared.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal
from urllib.parse import urlsplit

from app.schemas.common import ApiModel, Category, DataMode
from app.schemas.offers import CanonicalOffer, Money

ProviderHealthStatus = Literal["OK", "DEGRADED", "FAILED", "NOT_CONFIGURED", "DISABLED"]


class ProviderCapabilities(ApiModel):
    provider_id: str
    display_name: str  # Hebrew-friendly display name
    mode: DataMode  # DEMO or LIVE (never CACHED here)
    categories: list[Category]
    supports_search: bool = True
    supports_revalidate: bool = False
    supports_booking_options: bool = False
    supports_hosted_checkout: bool = False
    # Real booking execution through the API. Always False in V1.
    supports_live_booking: bool = False
    requires_credentials: list[str] = []  # env var names (never values)
    official_docs_url: str | None = None
    # Allowlisted domains for deep links / hosted checkout
    deep_link_domains: list[str] = []
    rate_limit_note: str | None = None
    notes: str | None = None  # Hebrew description incl. coverage limits


class ProviderHealth(ApiModel):
    provider_id: str
    status: ProviderHealthStatus
    checked_at: datetime
    message: str  # Hebrew, user safe
    latency_ms: int | None = None


class RevalidationResult(ApiModel):
    """Result of re-checking an offer with the supplier right before booking."""

    status: Literal["unchanged", "price_changed", "expired", "unavailable", "error"]
    offer_id: str
    new_total: Money | None = None
    checked_at: datetime
    message: str  # Hebrew
    # Updated canonical offer when the supplier returned fresh data
    refreshed_offer: CanonicalOffer | None = None


class BookingOptions(ApiModel):
    """How a user can complete a booking for this offer (V1: never live API execution)."""

    hosted_checkout_url: str | None = None  # allowlisted provider page
    simulation_available: bool = False
    live_api_booking: bool = False  # always False in V1
    instructions: str  # Hebrew


@dataclass
class SearchContext:
    """Per-search context passed to adapters."""

    search_id: str
    started_at: datetime
    timeout_seconds: float
    # Non-secret provider settings from ProviderConfiguration.settings
    provider_settings: dict[str, Any] = field(default_factory=dict)


@dataclass
class RawOffer:
    """Provider-native offer payload before normalization."""

    supplier_offer_id: str
    payload: dict[str, Any]
    fetched_at: datetime
    expires_at: datetime | None = None


class ProviderError(Exception):
    """Base error raised by adapters. ``message`` must be user safe (Hebrew)."""

    code = "PROVIDER_ERROR"

    def __init__(self, message: str, *, code: str | None = None, retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        if code:
            self.code = code


class ProviderNotConfiguredError(ProviderError):
    code = "NOT_CONFIGURED"


class ProviderTimeoutError(ProviderError):
    code = "TIMEOUT"


class ProviderRateLimitedError(ProviderError):
    code = "RATE_LIMITED"


class ProviderUnsupportedError(ProviderError):
    code = "UNSUPPORTED"


class ProviderAdapter(ABC):
    """Base class for all provider adapters."""

    provider_id: str = ""

    @abstractmethod
    def capabilities(self) -> ProviderCapabilities: ...

    @abstractmethod
    def is_configured(self) -> bool:
        """True when credentials/config needed for searching are present."""

    @abstractmethod
    def health(self) -> ProviderHealth: ...

    @abstractmethod
    def search(self, category: Category, params: ApiModel, ctx: SearchContext) -> list[RawOffer]:
        """Return raw offers. Must respect ctx.timeout_seconds; raise ProviderError on failure."""

    @abstractmethod
    def normalize(self, category: Category, raw: RawOffer, ctx: SearchContext) -> CanonicalOffer:
        """Convert a raw offer to the canonical contract (id is assigned later; use "")."""

    def revalidate(self, offer: CanonicalOffer) -> RevalidationResult:
        raise ProviderUnsupportedError("הספק אינו תומך בבדיקת מחיר חוזרת", code="UNSUPPORTED")

    def booking_options(self, offer: CanonicalOffer) -> BookingOptions:
        raise ProviderUnsupportedError("הספק אינו מספק אפשרויות הזמנה", code="UNSUPPORTED")

    # ---- helpers ----
    def supports(self, category: Category) -> bool:
        return category in self.capabilities().categories

    def is_allowed_deep_link(self, url: str | None) -> bool:
        """Only https links to explicitly allowlisted provider domains are allowed."""
        if not url:
            return False
        try:
            parts = urlsplit(url)
        except ValueError:
            return False
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
            return False
        host = parts.hostname.lower()
        return any(host == d or host.endswith("." + d) for d in self.capabilities().deep_link_domains)
