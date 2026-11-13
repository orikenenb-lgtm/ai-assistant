from __future__ import annotations

from datetime import datetime
from typing import Any

from app.schemas.common import ApiModel


class AuditEventOut(ApiModel):
    id: str
    actor_user_id: str | None = None
    actor_display_name: str | None = None
    action: str
    entity_type: str | None = None
    entity_id: str | None = None
    outcome: str
    details: dict[str, Any]
    ip: str | None = None
    request_id: str | None = None
    created_at: datetime
