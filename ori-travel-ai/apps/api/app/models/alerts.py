"""Price alerts (saved searches with thresholds) and in-app notifications."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, UTCDateTime
from app.models._common import JSONType, created_at_col, pk, updated_at_col


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = pk()
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    search_params: Mapped[dict] = mapped_column(JSONType, nullable=False)
    target_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    check_interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=720)
    last_checked_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    last_best_amount_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_best_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # OK / FAILED / NO_RESULTS / NEVER
    last_status: Mapped[str] = mapped_column(String(16), nullable=False, default="NEVER")
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    __table_args__ = (Index("ix_alerts_active_checked", "is_active", "last_checked_at"),)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = pk()
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # price_drop / alert_failed / booking_update / invitation / system
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # In-app relative link only (validated to start with "/")
    link: Mapped[str | None] = mapped_column(String(300), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    created_at: Mapped[datetime] = created_at_col()
