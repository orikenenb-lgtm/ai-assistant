"""
לקוח רווחית לקריאה בלבד — עבור הקטלוג בלבד.

עקרון הברזל: READ-ONLY נאכף בקוד דרך whitelist קשיח.
שום פקודה שאינה ברשימה הלבנה לא תישלח לרווחית — לעולם. הבדיקה קורית
*לפני* כל פנייה לרשת, כך שאפילו טעות קוד לא יכולה להגיע לפקודת כתיבה.

מבודד לחלוטין מ-app.services.rivhit_service (ששירת את ההזמנות) — קובץ נפרד,
טוקן נפרד (CATALOG_RIVHIT_TOKEN), בלי שום יכולת כתיבה.
"""
import logging

import requests

from app.config import get_settings

logger = logging.getLogger(__name__)

# ---- רשימה לבנה קשיחה: אך ורק פקודות קריאה. כל היתר חסום. ----
READ_ONLY_METHODS = frozenset({
    "Item.List", "Item.Details", "Item.Quantity",   # סחורה ומלאי
    "Customer.List", "Customer.Get",                 # לקוחות (לעתיד)
    "Document.List", "Document.Details",             # מסמכים (לעתיד)
})


class RivhitReadOnlyError(Exception):
    """תקלת תקשורת/נתונים מול רווחית."""


class RivhitWriteAttemptError(Exception):
    """ניסיון לקרוא לפקודה שאינה ברשימת הקריאה-בלבד — נחסם לפני כל פנייה."""


def _assert_read_only(method: str) -> None:
    if method not in READ_ONLY_METHODS:
        raise RivhitWriteAttemptError(
            f"חסום: הפקודה '{method}' אינה ברשימת הקריאה-בלבד. שום דבר לא נשלח לרווחית.")


def call(method: str, params: dict | None = None, timeout: int = 20) -> dict | list:
    """קריאה בודדת לרווחית — עוברת תמיד דרך שער ה-whitelist."""
    _assert_read_only(method)  # שער ראשון, תמיד — לפני קונפיג, טוקן או רשת
    settings = get_settings()
    token = settings.catalog_rivhit_token
    if not token:
        raise RivhitReadOnlyError("CATALOG_RIVHIT_TOKEN אינו מוגדר (טוקן הדמו של רווחית).")
    url = f"{settings.catalog_rivhit_base_url.rstrip('/')}/{method}"
    body = {"api_token": token, **(params or {})}
    try:
        resp = requests.post(url, json=body, timeout=timeout)
        resp.raise_for_status()
        payload = resp.json()
    except requests.RequestException as exc:
        # לא מדפיסים את הטוקן לעולם
        raise RivhitReadOnlyError(f"שגיאת תקשורת מול רווחית: {exc}") from exc
    if payload.get("error_code", 0) != 0:
        msg = payload.get("client_message") or payload.get("debug_message") or payload.get("error_code")
        raise RivhitReadOnlyError(f"רווחית החזירה שגיאה: {msg}")
    return payload.get("data", {})


def get_items() -> list[dict]:
    """Item.List — רשימת המוצרים (קריאה בלבד)."""
    data = call("Item.List")
    if isinstance(data, dict):
        return data.get("item_list") or data.get("items") or []
    return data if isinstance(data, list) else []


def map_item(raw: dict) -> dict:
    """
    ממפה פריט גולמי מרווחית לשורת catalog_products.
    מיפוי ראשוני — יכויל מול נתוני הדמו האמיתיים (שמות השדות ברווחית
    משתנים מעט בין גרסאות). לכן נשמר גם הגלם ב-raw להתאמה.
    """
    def first(*keys):
        for k in keys:
            if raw.get(k) not in (None, ""):
                return raw.get(k)
        return None
    return {
        "rivhit_item_id": first("item_id", "item_part_num", "id"),
        "name": first("item_name", "item_extended_description", "description") or "",
        "price": first("sale_nis", "item_price", "price") or 0,
        "quantity": first("quantity", "item_quantity", "stock") or 0,
        "image_url": first("item_picture", "image_url", "picture"),
        "category": first("group_name", "item_group_id", "category"),
    }
