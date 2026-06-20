"""
Router הקטלוג (אדיטיבי, מבודד) תחת /catalog.
- GET  /catalog/products  — מציג את ה-cache לכל משתמש מחובר (RLS authenticated).
- POST /catalog/sync      — אדמין בלבד: מושך מרווחית (קריאה בלבד) ומעדכן cache.
אם רווחית לא זמינה — מחזירים שגיאה ברורה; ה-GET ממשיך להגיש את ה-cache האחרון.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.catalog import rivhit_readonly as ro
from app.catalog.sync import sync_catalog
from app.dependencies import get_access_token, get_current_user, require_admin
from app.schemas.auth import UserOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/catalog", tags=["catalog"])


class _SupabaseCatalogRepo:
    def __init__(self):
        from app.services.supabase_client import get_service_client
        self._client = get_service_client()

    def upsert(self, rows: list[dict]) -> None:
        if rows:
            self._client.table("catalog_products").upsert(rows, on_conflict="rivhit_item_id").execute()


@router.get("/products")
def list_products(
    token: str = Depends(get_access_token),
    _: UserOut = Depends(get_current_user),
) -> list[dict]:
    """הקטלוג מה-cache (Supabase) — מהיר, לא פונה לרווחית."""
    from app.services.supabase_client import get_user_client
    res = get_user_client(token).table("catalog_products").select("*").order("name").execute()
    return res.data or []


@router.post("/sync")
def sync(_: UserOut = Depends(require_admin)) -> dict:
    """רענון הקטלוג מרווחית (קריאה בלבד) — לאבא/אדמין בלבד."""
    try:
        return sync_catalog(_SupabaseCatalogRepo())
    except ro.RivhitReadOnlyError as exc:
        # רווחית לא זמינה/שגיאה — לא קורסים; ה-cache הקיים ממשיך להיות מוגש ב-GET
        logger.error("סנכרון קטלוג נכשל: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
