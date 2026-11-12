"""Audit trail helper. All security-relevant actions are recorded here."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.redaction import redact
from app.models.system import AuditEvent

log = logging.getLogger("ori.audit")


def client_ip(request: Request | None) -> str | None:
    if request is None or request.client is None:
        return None
    return request.client.host


def record_audit(
    db: Session,
    action: str,
    *,
    actor_user_id: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    outcome: str = "success",
    details: dict[str, Any] | None = None,
    request: Request | None = None,
    commit: bool = False,
) -> AuditEvent:
    """Add an audit event to the session (caller commits unless commit=True)."""
    event = AuditEvent(
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        outcome=outcome,
        details=redact(details or {}),
        ip=client_ip(request),
        request_id=getattr(request.state, "request_id", None) if request is not None else None,
    )
    db.add(event)
    if commit:
        db.commit()
    log.info("audit action=%s outcome=%s entity=%s:%s", action, outcome, entity_type, entity_id)
    return event
