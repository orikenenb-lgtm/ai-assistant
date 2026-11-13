"""Trips (shared family itineraries) and their items."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base, UTCDateTime
from app.models._common import JSONType, created_at_col, pk, updated_at_col

TRIP_STATUSES = ("planning", "booked", "completed", "cancelled")
TRIP_ITEM_KINDS = ("flight", "hotel", "car", "activity", "transfer", "note", "other")
# known = supplier quoted total; estimate = user/AI estimate; excluded = not counted
COST_STATUSES = ("known", "estimate", "excluded")


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[str] = pk()
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    destination: Mapped[str | None] = mapped_column(String(200), nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # IANA timezone of the destination, e.g. "Europe/Rome"
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="planning")
    budget_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    budget_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    items: Mapped[list[TripItem]] = relationship(
        back_populates="trip",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="TripItem.sort_order",
    )
    travelers: Mapped[list[TripTraveler]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", passive_deletes=True
    )


class TripTraveler(Base):
    __tablename__ = "trip_travelers"

    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), primary_key=True
    )
    family_member_id: Mapped[str] = mapped_column(
        ForeignKey("family_members.id", ondelete="CASCADE"), primary_key=True
    )

    trip: Mapped[Trip] = relationship(back_populates="travelers")


class TripItem(Base):
    __tablename__ = "trip_items"

    id: Mapped[str] = pk()
    trip_id: Mapped[str] = mapped_column(
        ForeignKey("trips.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    start_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    # IANA timezone for displaying local times of this item
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    location: Mapped[str | None] = mapped_column(String(300), nullable=True)
    latitude: Mapped[float | None] = mapped_column(nullable=True)
    longitude: Mapped[float | None] = mapped_column(nullable=True)
    offer_id: Mapped[str | None] = mapped_column(
        ForeignKey("offers.id", ondelete="SET NULL"), nullable=True
    )
    cost_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    cost_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    cost_status: Mapped[str] = mapped_column(String(16), nullable=False, default="estimate")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Snapshot of the canonical offer at the time it was added (source + freshness)
    offer_snapshot: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    created_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    trip: Mapped[Trip] = relationship(back_populates="items")

    __table_args__ = (Index("ix_trip_items_trip_start", "trip_id", "start_at"),)
