"""
rivhit_service — הלקוח הבלעדי של Rivhit Online API.

⚠️ כלל ברזל: כל קריאה ל-Rivhit במערכת עוברת אך ורק דרך הקובץ הזה.
   אסור לאף module אחר לדבר עם Rivhit ישירות.

פרוטוקול Rivhit Online API:
- כל קריאה היא POST עם JSON body שכולל api_token.
- תשובה: {"error_code": 0, "client_message": "...", "data": {...}}
  error_code == 0 → הצלחה; אחרת — שגיאה עסקית.
- הנתיבים (Item.List וכו') ניתנים להתאמה ב-config מול התיעוד הרשמי.
"""
import logging
import time

import requests

from app.config import get_settings

logger = logging.getLogger(__name__)

# נתיבי ה-API — מרוכזים כאן כדי שכיול מול התיעוד הרשמי יהיה במקום אחד
PATH_ITEM_LIST = "Item.List"
PATH_CUSTOMER_LIST = "Customer.List"
PATH_DOCUMENT_NEW = "Document.New"

# המתנות בין ניסיונות חוזרים (exponential backoff)
RETRY_DELAYS_SECONDS = [1, 2, 4, 8]
REQUEST_TIMEOUT_SECONDS = 30


class RivhitError(Exception):
    """שגיאה מ-Rivhit — רשת, טוקן, או שגיאה עסקית (error_code != 0)."""


class RivhitClient:
    """לקוח Rivhit עם retry אוטומטי על שגיאות רשת ו-rate limit."""

    def __init__(self, api_token: str | None = None, base_url: str | None = None):
        settings = get_settings()
        self._api_token = api_token or settings.rivhit_api_token
        self._base_url = (base_url or settings.rivhit_api_base_url).rstrip("/")
        if not self._api_token:
            raise RivhitError("RIVHIT_API_TOKEN לא מוגדר — הוסף אותו ל-env")

    # ----- שכבת התקשורת -----

    def _post(self, path: str, payload: dict | None = None) -> dict:
        """
        POST ל-Rivhit עם retry + exponential backoff (1s, 2s, 4s, 8s).
        חוזר על הניסיון רק על תקלות זמניות: רשת, timeout, 5xx, 429.
        """
        url = f"{self._base_url}/{path}"
        body = {"api_token": self._api_token, **(payload or {})}
        last_error: Exception | None = None

        for attempt, delay in enumerate([0] + RETRY_DELAYS_SECONDS):
            if delay:
                logger.info("Rivhit: ניסיון חוזר %d בעוד %d שניות (%s)", attempt, delay, path)
                time.sleep(delay)
            try:
                response = requests.post(url, json=body, timeout=REQUEST_TIMEOUT_SECONDS)
            except requests.RequestException as exc:
                last_error = exc
                continue  # תקלת רשת — ננסה שוב

            if response.status_code == 429 or response.status_code >= 500:
                last_error = RivhitError(f"Rivhit החזיר {response.status_code} עבור {path}")
                continue  # rate limit / תקלת שרת — ננסה שוב

            if response.status_code != 200:
                # 4xx אחר — בעיה קבועה (טוקן/בקשה), אין טעם לנסות שוב
                raise RivhitError(f"Rivhit החזיר {response.status_code} עבור {path}")

            try:
                data = response.json()
            except ValueError as exc:
                # תשובה קטומה/לא-JSON (בדיקה S5) — לא שומרים כלום
                raise RivhitError(f"תשובה לא תקינה מ-Rivhit עבור {path}: לא JSON") from exc

            if not isinstance(data, dict) or "error_code" not in data:
                raise RivhitError(f"תשובה לא תקינה מ-Rivhit עבור {path}: מבנה לא מוכר")

            if data["error_code"] != 0:
                raise RivhitError(
                    f"שגיאת Rivhit ({data['error_code']}) עבור {path}: "
                    f"{data.get('client_message', 'ללא פירוט')}"
                )

            return data.get("data") or {}

        raise RivhitError(f"Rivhit לא זמין אחרי {len(RETRY_DELAYS_SECONDS) + 1} ניסיונות: {last_error}")

    # ----- קריאה (Read) — סנכרון -----

    def get_products(self) -> list[dict]:
        """מושך את כל המוצרים מ-Rivhit וממפה לסכמה הפנימית של products."""
        data = self._post(PATH_ITEM_LIST)
        items = data.get("item_list") or []
        return [self._map_product(item) for item in items]

    def get_customers(self) -> list[dict]:
        """מושך את כל הלקוחות מ-Rivhit וממפה לסכמה הפנימית של customers."""
        data = self._post(PATH_CUSTOMER_LIST)
        customers = data.get("customer_list") or []
        return [self._map_customer(c) for c in customers]

    # ----- כתיבה (Write) — הצעת מחיר -----

    def create_quote(self, customer_rivhit_id: int, items: list[dict],
                     comments: str | None = None) -> int:
        """
        ⚠️ כותב ל-Rivhit! יצירת מסמך הצעת מחיר. מחזיר את מזהה המסמך.
        מוגן בכפול: ה-endpoint דורש token אישור + מפסק RIVHIT_WRITE_ENABLED.
        items: [{"item_id": int, "quantity": int, "price_nis": float}]
        """
        settings = get_settings()
        if not settings.rivhit_write_enabled:
            raise RivhitError(
                "כתיבה ל-Rivhit מושבתת בסביבה זו (RIVHIT_WRITE_ENABLED=false)")

        data = self._post(PATH_DOCUMENT_NEW, {
            "document_type": settings.rivhit_quote_document_type,
            "customer_id": customer_rivhit_id,
            "items": items,
            "comments": comments or "",
        })
        document_id = data.get("document_number") or data.get("document_id")
        if not document_id:
            raise RivhitError("Rivhit לא החזיר מזהה מסמך — יש לבדוק ידנית בחשבון!")
        return int(document_id)

    # ----- מיפוי שדות Rivhit → סכמה פנימית -----
    # אם שמות השדות בחשבון האמיתי שונים — מתקנים רק כאן.

    @staticmethod
    def _map_product(item: dict) -> dict:
        return {
            "rivhit_id": item["item_id"],
            "sku": item.get("barcode") or item.get("item_part_num") or None,
            "name": item.get("item_name") or f"מוצר {item['item_id']}",
            "category": item.get("item_group_name") or None,
            "description": item.get("item_extended_description") or None,
            "base_price": float(item.get("sale_nis") or 0),
            "cost_price": float(item["cost_nis"]) if item.get("cost_nis") is not None else None,
            "stock_quantity": int(item.get("quantity") or 0),
            "unit": item.get("item_unit_name") or None,
        }

    @staticmethod
    def _map_customer(c: dict) -> dict:
        return {
            "rivhit_id": c["customer_id"],
            "name": " ".join(filter(None, [c.get("first_name"), c.get("last_name")]))
                    or f"לקוח {c['customer_id']}",
            "city": c.get("city") or None,
            "phone": c.get("phone") or None,
            "email": (c.get("email") or "").strip().lower() or None,
            "price_list_id": c.get("price_list_id"),
        }
