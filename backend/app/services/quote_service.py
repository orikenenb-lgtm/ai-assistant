"""
לוגיקת הצעת מחיר: ולידציות, בניית preview, ו-token אישור.

זרימת הבטיחות (Q1-Q5):
1. dry-run: בונה preview + token אישור. אפס כתיבה — לא ל-Rivhit ולא ל-DB.
2. confirm: דורש את ה-token מה-dry-run. אם ההזמנה השתנתה בינתיים —
   ה-token לא יתאים והמערכת תדרוש dry-run מחדש (Q3).
3. הזמנה שכבר יש לה הצעה — נחסמת (Q4).
"""
import hashlib
import json

from app.schemas.orders import OrderItemOut

# סטטוסים שמהם מותר להפיק הצעת מחיר
QUOTABLE_STATUSES = {"pending", "reviewed"}


class QuoteValidationError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def validate_order_quotable(order: dict, items: list[dict],
                            customer_rivhit_id: int | None) -> None:
    """כל הסיבות לא להפיק הצעה — עם הודעה ברורה לכל אחת."""
    if order.get("rivhit_quote_id"):
        raise QuoteValidationError(
            f"להזמנה כבר קיימת הצעת מחיר ב-Rivhit (מסמך {order['rivhit_quote_id']}) — "
            "אי אפשר ליצור כפולה", status_code=409)
    if order.get("status") not in QUOTABLE_STATUSES:
        raise QuoteValidationError(
            f"אי אפשר להפיק הצעה מהזמנה בסטטוס '{order.get('status')}' — "
            "רק מהזמנה ממתינה או נסקרת", status_code=409)
    if not items:
        raise QuoteValidationError("להזמנה אין שורות — אין מה להציע")
    if not customer_rivhit_id:
        raise QuoteValidationError("ללקוח אין מזהה Rivhit — הרץ סנכרון לקוחות")


def build_quote_items(items: list[dict], products_rivhit_ids: dict[str, int]) -> list[dict]:
    """ממפה שורות הזמנה לשורות מסמך Rivhit (לפי rivhit_id של כל מוצר)."""
    quote_items = []
    for item in items:
        rivhit_item_id = products_rivhit_ids.get(item["product_id"])
        if rivhit_item_id is None:
            raise QuoteValidationError(
                f"למוצר {item['product_id']} אין מזהה Rivhit — הרץ סנכרון מוצרים")
        quote_items.append({
            "item_id": rivhit_item_id,
            "quantity": item["quantity"],
            "price_nis": float(item["unit_price"]),
        })
    return quote_items


def confirmation_token(order_id: str, quote_items: list[dict]) -> str:
    """
    טביעת אצבע של ההצעה: נגזרת מההזמנה ושורותיה.
    ה-confirm חייב להציג אותה — מבטיח שמה שאושר הוא בדיוק מה שיישלח (Q3).
    """
    # מיון דטרמיניסטי: סדר השורות מה-DB לא מובטח, ואסור שיפסול אישור תקין
    canonical_items = sorted(
        quote_items,
        key=lambda item: (item["item_id"], item["quantity"], item["price_nis"]))
    canonical = json.dumps(
        {"order_id": order_id, "items": canonical_items},
        sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def build_preview(order: dict, items: list[OrderItemOut],
                  customer_name: str, quote_items: list[dict]) -> dict:
    """ה-preview שמוצג לאבא לפני האישור — בדיוק מה שיישלח ל-Rivhit."""
    total = sum(qi["price_nis"] * qi["quantity"] for qi in quote_items)
    return {
        "order_id": order["id"],
        "order_number": order["order_number"],
        "customer_name": customer_name,
        "lines": [{
            "product_name": item.product_name,
            "quantity": item.quantity,
            "unit_price": item.unit_price,
            "line_total": item.line_total,
        } for item in items],
        "total": round(total, 2),
        "confirmation_token": confirmation_token(order["id"], quote_items),
    }
