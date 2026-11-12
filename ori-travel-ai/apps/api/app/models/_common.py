"""Shared column helpers for ORM models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import UTCDateTime, utcnow


def new_id() -> str:
    return uuid.uuid4().hex


def pk() -> Mapped[str]:
    return mapped_column(String(32), primary_key=True, default=new_id)


def created_at_col() -> Mapped[datetime]:
    return mapped_column(UTCDateTime(), default=utcnow, nullable=False)


def updated_at_col() -> Mapped[datetime]:
    return mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow, nullable=False)


# Portable JSON column (JSON on SQLite, JSON on PostgreSQL; JSONB could be
# introduced later via a migration without touching application code).
JSONType = JSON
