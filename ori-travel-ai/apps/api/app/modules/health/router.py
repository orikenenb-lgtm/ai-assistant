"""Liveness / readiness endpoints (no authentication, no sensitive data)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.crypto import encryption_available
from app.core.db import get_db, utcnow

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "time": utcnow().isoformat()}


@router.get("/ready")
def ready(db: Session = Depends(get_db)):
    checks: dict[str, dict] = {}
    ok = True
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = {"ok": True}
    except Exception:  # pragma: no cover - only when DB is broken
        ok = False
        checks["database"] = {"ok": False, "message": "מסד הנתונים אינו זמין"}
    try:
        db.execute(text("SELECT 1 FROM users LIMIT 1"))
        checks["schema"] = {"ok": True}
    except Exception:
        ok = False
        checks["schema"] = {"ok": False, "message": "הטבלאות לא נוצרו — הריצו migrations"}
    checks["encryption"] = {
        "ok": encryption_available(),
        "message": None if encryption_available() else "ORI_DATA_KEY חסר — לא ניתן לשמור פרטי דרכון",
    }
    settings = get_settings()
    body = {
        "status": "ready" if ok else "not_ready",
        "env": settings.env,
        "checks": checks,
        "booking_live_execution": False,
    }
    return JSONResponse(status_code=200 if ok else 503, content=body)
