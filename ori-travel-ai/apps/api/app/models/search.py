"""Searches, provider runs, canonical offers, price snapshots, saved offers."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UTCDateTime
from app.models._common import JSONType, created_at_col, pk

# Categories with a manual search flow
CATEGORIES = ("flight", "hotel", "car", "activity")


class SearchRequest(Base):
    __tablename__ = "search_requests"

    id: Mapped[str] = pk()
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    params: Mapped[dict] = mapped_column(JSONType, nullable=False)
    # sha256 of the canonical params JSON — used for the search cache
    params_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # running / completed / partial / failed
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    origin: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")  # manual/ai/alert
    result_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = created_at_col()
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)

    provider_searches: Mapped[list[ProviderSearch]] = relationship(
        back_populates="search_request", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (Index("ix_search_requests_cat_created", "category", "created_at"),)


class ProviderSearch(Base):
    """One provider adapter run inside a search request."""

    __tablename__ = "provider_searches"

    id: Mapped[str] = pk()
    search_request_id: Mapped[str] = mapped_column(
        ForeignKey("search_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # DEMO / LIVE / CACHED
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    # OK / FAILED / TIMEOUT / NOT_CONFIGURED / DISABLED / CACHED
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Redacted, user-safe message (never raw provider payloads or secrets)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)

    search_request: Mapped[SearchRequest] = relationship(back_populates="provider_searches")


class Offer(Base):
    """A canonical offer as returned to users (see app.schemas.offers.CanonicalOffer)."""

    __tablename__ = "offers"

    id: Mapped[str] = pk()
    search_request_id: Mapped[str | None] = mapped_column(
        ForeignKey("search_requests.id", ondelete="SET NULL"), nullable=True, index=True
    )
    provider_search_id: Mapped[str | None] = mapped_column(
        ForeignKey("provider_searches.id", ondelete="SET NULL"), nullable=True
    )
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)  # DEMO / LIVE / CACHED
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    supplier_offer_id: Mapped[str] = mapped_column(String(255), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    total_amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    # known / estimated
    price_status: Mapped[str] = mapped_column(String(16), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    deep_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Full canonical offer JSON (CanonicalOffer.model_dump(mode="json"))
    data: Mapped[dict] = mapped_column(JSONType, nullable=False)
    created_at: Mapped[datetime] = created_at_col()

    __table_args__ = (Index("ix_offers_provider_supplier", "provider_id", "supplier_offer_id"),)


class PriceSnapshot(Base):
    __tablename__ = "price_snapshots"

    id: Mapped[str] = pk()
    alert_id: Mapped[str | None] = mapped_column(
        ForeignKey("alerts.id", ondelete="CASCADE"), nullable=True, index=True
    )
    offer_id: Mapped[str | None] = mapped_column(
        ForeignKey("offers.id", ondelete="SET NULL"), nullable=True
    )
    provider_id: Mapped[str] = mapped_column(String(64), nullable=False)
    mode: Mapped[str] = mapped_column(String(16), nullable=False)
    dedupe_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    # OK / FAILED / NO_RESULTS
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="OK")
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    captured_at: Mapped[datetime] = created_at_col()


class SavedOffer(Base):
    __tablename__ = "saved_offers"

    id: Mapped[str] = pk()
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    offer_id: Mapped[str] = mapped_column(
        ForeignKey("offers.id", ondelete="CASCADE"), nullable=False
    )
    trip_id: Mapped[str | None] = mapped_column(
        ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = created_at_col()

    __table_args__ = (UniqueConstraint("user_id", "offer_id", name="uq_saved_offers_user_offer"),)
