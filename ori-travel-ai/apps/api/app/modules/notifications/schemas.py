from __future__ import annotations

from datetime import datetime

from app.schemas.common import ApiModel


class NotificationOut(ApiModel):
    id: str
    kind: str
    title: str
    body: str | None = None
    link: str | None = None
    read_at: datetime | None = None
    created_at: datetime


class UnreadCount(ApiModel):
    count: int


class ReadAllOut(ApiModel):
    updated: int
