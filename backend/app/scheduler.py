"""
מתזמן הסנכרון האוטומטי — כל SYNC_INTERVAL_HOURS שעות (ברירת מחדל: 4).
פעיל רק כאשר SYNC_ENABLED=true (בפרודקשן); ב-dev מושבת כברירת מחדל.
"""
import asyncio
import logging

from app.config import get_settings

logger = logging.getLogger(__name__)


async def _run_sync_once() -> None:
    """ריצת סנכרון אחת (מוצרים + לקוחות) בתוך thread כדי לא לחסום את ה-event loop."""
    from app.services.rivhit_service import RivhitClient
    from app.services.sync_service import SyncService, SupabaseSyncRepository

    def _sync() -> None:
        service = SyncService(rivhit=RivhitClient(), repo=SupabaseSyncRepository())
        service.sync_products(dry_run=False)
        service.sync_customers(dry_run=False)

    await asyncio.to_thread(_sync)


async def sync_loop() -> None:
    """לולאת הסנכרון: רצה לנצח, מתעדת שגיאות וממשיכה (לא מפילה את השרת)."""
    settings = get_settings()
    interval_seconds = settings.sync_interval_hours * 3600
    logger.info("מתזמן סנכרון פעיל — כל %d שעות", settings.sync_interval_hours)
    while True:
        try:
            await _run_sync_once()
        except Exception:
            logger.exception("סנכרון מתוזמן נכשל — ינוסה שוב במחזור הבא")
        await asyncio.sleep(interval_seconds)
