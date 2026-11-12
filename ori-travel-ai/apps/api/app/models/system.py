"""Audit events, provider configurations and app settings."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models._common import JSONType, created_at_col, pk, updated_at_col


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = pk()
    actor_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # dotted action name, e.g. "auth.login", "booking.approve"
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # success / failure / denied
    outcome: Mapped[str] = mapped_column(String(16), nullable=False, default="success")
    # Redacted details (never secrets, passwords, document numbers)
    details: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = created_at_col()

    __table_args__ = (Index("ix_audit_events_created", "created_at"),)


class ProviderConfiguration(Base):
    """Non-secret per-provider configuration. Secrets live only in env vars."""

    __tablename__ = "provider_configurations"

    id: Mapped[str] = pk()
    provider_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Non-secret settings (e.g. market, max results). Validated by the adapter.
    settings: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    updated_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()


class AppSetting(Base):
    """Family-wide settings as key -> JSON value (ranking weights, scheduler, map...)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONType, nullable=False)
    updated_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = updated_at_col()
