"""נתיבי סנכרון לאדמין: הרצת סנכרון (dry-run / אמיתי) וצפייה בלוגים."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.dependencies import get_access_token, require_admin
from app.schemas.auth import UserOut
from app.services.rivhit_service import RivhitClient
from app.services.supabase_client import get_user_client
from app.services.sync_service import SyncResult, SyncService, SupabaseSyncRepository

router = APIRouter(prefix="/admin/sync", tags=["admin-sync"])


class SyncRequest(BaseModel):
    sync_type: Literal["products", "customers", "all"] = "all"
    dry_run: bool = True    # ברירת מחדל בטוחה: תצוגה מקדימה בלבד


def get_sync_service() -> SyncService:
    """בניית שירות הסנכרון — מוחלף ב-mock בבדיקות."""
    return SyncService(rivhit=RivhitClient(), repo=SupabaseSyncRepository())


@router.post("", response_model=list[SyncResult])
def run_sync(
    body: SyncRequest,
    user: UserOut = Depends(require_admin),
    service: SyncService = Depends(get_sync_service),
) -> list[SyncResult]:
    """
    הרצת סנכרון מ-Rivhit. dry_run=true (ברירת מחדל) — תצוגה בלבד, אפס כתיבה.
    רק אדמין. כל ריצה אמיתית נרשמת ב-sync_logs.
    """
    results: list[SyncResult] = []
    if body.sync_type in ("products", "all"):
        results.append(service.sync_products(dry_run=body.dry_run))
    if body.sync_type in ("customers", "all"):
        results.append(service.sync_customers(dry_run=body.dry_run))
    return results


@router.get("/logs")
def sync_logs(
    limit: int = 20,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> list[dict]:
    """היסטוריית סנכרונים אחרונים (sync_logs) — בזהות האדמין, דרך RLS."""
    client = get_user_client(token)
    result = (
        client.table("sync_logs")
        .select("*")
        .order("created_at", desc=True)
        .limit(min(limit, 100))
        .execute()
    )
    return result.data or []
