"""
סנכרון הקטלוג: רווחית (קריאה בלבד) → cache ב-catalog_products.
חד-כיווני בלבד — נתונים זורמים מרווחית אלינו, אף פעם לא חזרה.
"""
import logging
from datetime import datetime, timezone
from typing import Protocol

from app.catalog import rivhit_readonly as ro

logger = logging.getLogger(__name__)


class CatalogRepo(Protocol):
    def upsert(self, rows: list[dict]) -> None: ...


def sync_catalog(repo: CatalogRepo) -> dict:
    """מושך פריטים מרווחית, ממפה, ושומר ב-cache. מחזיר סיכום."""
    items = ro.get_items()
    now = datetime.now(timezone.utc).isoformat()
    rows: list[dict] = []
    for raw in items:
        mapped = ro.map_item(raw)
        item_id = mapped.get("rivhit_item_id")
        if item_id in (None, ""):
            continue
        mapped["rivhit_item_id"] = str(item_id)
        mapped["last_synced_at"] = now
        rows.append(mapped)
    repo.upsert(rows)
    logger.info("סנכרון קטלוג: %d מוצרים עודכנו מרווחית", len(rows))
    return {"synced": len(rows), "last_synced_at": now}
