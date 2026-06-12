"""
שירות הסנכרון: Rivhit → מסד הנתונים.

עקרונות:
- dry-run לא כותב שום דבר ל-DB — מחזיר תצוגה מקדימה בלבד.
- אין כפילויות: upsert לפי rivhit_id (UNIQUE).
- רשומה שנעלמה מ-Rivhit → is_active=false (לא נמחקת!).
- כל ריצה אמיתית נרשמת ב-sync_logs (גם כשנכשלה).
"""
import logging
from dataclasses import dataclass, field
from typing import Protocol

from app.services.rivhit_service import RivhitClient, RivhitError

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    """תוצאת סנכרון — משותפת ל-dry-run ולריצה אמיתית."""
    sync_type: str
    dry_run: bool
    status: str = "success"                 # 'success' | 'error'
    records_synced: int = 0                 # סה"כ רשומות שהגיעו מ-Rivhit
    records_created: int = 0
    records_updated: int = 0
    records_deactivated: int = 0
    error_message: str | None = None
    preview: list[dict] = field(default_factory=list)   # רק ב-dry-run


class SyncRepository(Protocol):
    """שכבת הגישה ל-DB של הסנכרון — מופרדת כדי לאפשר בדיקות בלי Supabase."""

    def list_rivhit_ids(self, table: str) -> set[int]:
        """כל ה-rivhit_id הקיימים בטבלה."""
        ...

    def upsert(self, table: str, rows: list[dict]) -> None:
        """הכנסה/עדכון לפי rivhit_id — לעולם לא יוצר כפילות."""
        ...

    def deactivate_missing(self, table: str, present_ids: set[int]) -> int:
        """מסמן is_active=false לרשומות שלא הופיעו בסנכרון. מחזיר כמה סומנו."""
        ...

    def insert_sync_log(self, result: SyncResult) -> None:
        """רושם את תוצאת הסנכרון ב-sync_logs."""
        ...


class SyncService:
    def __init__(self, rivhit: RivhitClient, repo: SyncRepository):
        self._rivhit = rivhit
        self._repo = repo

    def sync_products(self, dry_run: bool) -> SyncResult:
        return self._sync("products", dry_run)

    def sync_customers(self, dry_run: bool) -> SyncResult:
        return self._sync("customers", dry_run)

    def _fetch(self, sync_type: str) -> list[dict]:
        if sync_type == "products":
            return self._rivhit.get_products()
        return self._rivhit.get_customers()

    def _sync(self, sync_type: str, dry_run: bool) -> SyncResult:
        result = SyncResult(sync_type=sync_type, dry_run=dry_run)
        try:
            rows = self._fetch(sync_type)
        except RivhitError as exc:
            # Rivhit לא זמין/שגוי — לא נוגעים ב-DB, רק מתעדים (S4, S5)
            result.status = "error"
            result.error_message = str(exc)
            if not dry_run:
                self._repo.insert_sync_log(result)
            logger.error("סנכרון %s נכשל: %s", sync_type, exc)
            return result

        incoming_ids = {row["rivhit_id"] for row in rows}
        if len(incoming_ids) != len(rows):
            # כפילות בתשובת Rivhit עצמה — משאירים מופע אחרון לכל מזהה
            unique: dict[int, dict] = {row["rivhit_id"]: row for row in rows}
            rows = list(unique.values())
            logger.warning("סנכרון %s: זוהו כפילויות בתשובת Rivhit — אוחדו", sync_type)

        try:
            existing_ids = self._repo.list_rivhit_ids(sync_type)
        except Exception as exc:
            # גם כשל בקריאת המצב הקיים מה-DB חייב להירשם כריצה כושלת (S7)
            result.status = "error"
            result.error_message = f"שגיאת DB בקריאת מצב קיים: {exc}"
            if not dry_run:
                try:
                    self._repo.insert_sync_log(result)
                except Exception:
                    logger.exception("גם רישום ה-sync_log נכשל")
            logger.error("סנכרון %s נכשל בקריאת DB: %s", sync_type, exc)
            return result

        result.records_synced = len(rows)
        result.records_created = len(incoming_ids - existing_ids)
        result.records_updated = len(incoming_ids & existing_ids)
        missing_ids = existing_ids - incoming_ids

        if dry_run:
            result.records_deactivated = len(missing_ids)
            result.preview = rows[:20]      # טעימה לתצוגה מקדימה
            return result

        try:
            # רשומה שחזרה מ-Rivhit היא פעילה מעצם הגדרתה
            for row in rows:
                row["is_active"] = True
            self._repo.upsert(sync_type, rows)
            result.records_deactivated = self._repo.deactivate_missing(sync_type, incoming_ids)
            self._repo.insert_sync_log(result)
        except Exception as exc:
            result.status = "error"
            result.error_message = f"שגיאת DB בסנכרון: {exc}"
            try:
                self._repo.insert_sync_log(result)
            except Exception:
                logger.exception("גם רישום ה-sync_log נכשל")
            logger.error("סנכרון %s נכשל בכתיבה ל-DB: %s", sync_type, exc)
            return result

        logger.info(
            "סנכרון %s הושלם: %d נוצרו, %d עודכנו, %d הושבתו",
            sync_type, result.records_created, result.records_updated, result.records_deactivated,
        )
        return result


class SupabaseSyncRepository:
    """מימוש ה-repository מול Supabase (service role — סנכרון הוא פעולת מערכת)."""

    def __init__(self):
        # import עצל כדי שבדיקות בלי Supabase לא ידרשו קונפיג
        from app.services.supabase_client import get_service_client
        self._client = get_service_client()

    def list_rivhit_ids(self, table: str) -> set[int]:
        result = self._client.table(table).select("rivhit_id").execute()
        return {row["rivhit_id"] for row in (result.data or [])}

    def upsert(self, table: str, rows: list[dict]) -> None:
        if rows:
            self._client.table(table).upsert(rows, on_conflict="rivhit_id").execute()

    def deactivate_missing(self, table: str, present_ids: set[int]) -> int:
        existing = self.list_rivhit_ids(table)
        to_deactivate = list(existing - present_ids)
        if not to_deactivate:
            return 0
        self._client.table(table).update({"is_active": False}) \
            .in_("rivhit_id", to_deactivate).execute()
        return len(to_deactivate)

    def insert_sync_log(self, result: SyncResult) -> None:
        self._client.table("sync_logs").insert({
            "sync_type": result.sync_type,
            "status": result.status,
            "records_synced": result.records_synced,
            "records_updated": result.records_updated,
            "records_created": result.records_created,
            "error_message": result.error_message,
        }).execute()
