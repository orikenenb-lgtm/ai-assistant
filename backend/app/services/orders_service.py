"""
לוגיקת יצירת הזמנה — טהורה וניתנת לבדיקה.

עקרון הזהב (O8): המחיר נלקח אך ורק מרשומת המוצר ב-DB ברגע ההזמנה (snapshot).
הלקוח שולח רק product_id + quantity — לעולם לא מחיר.
"""
from app.schemas.orders import OrderCreate


class OrderValidationError(Exception):
    """שגיאת ולידציה עסקית — מתורגמת ל-400/404 בשכבת ה-router."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def build_order_payload(
    order_in: OrderCreate,
    products_by_id: dict[str, dict],
    customer_id: str,
    user_id: str,
) -> tuple[dict, list[dict]]:
    """
    בונה את רשומת ההזמנה ושורותיה מתוך הקטלוג שב-DB.

    products_by_id — המוצרים כפי שנשלפו מה-DB (בזהות המשתמש, דרך RLS).
    מוצר שלא נמצא שם = לא קיים או לא פעיל → נחסם (O6, O7).
    """
    items: list[dict] = []
    total = 0.0

    # איחוד כפילויות: אותו מוצר פעמיים בסל → שורה אחת עם סכום הכמויות
    merged: dict[str, dict] = {}
    for item in order_in.items:
        if item.product_id in merged:
            merged[item.product_id]["quantity"] += item.quantity
        else:
            merged[item.product_id] = {"quantity": item.quantity, "notes": item.notes}

    for product_id, data in merged.items():
        product = products_by_id.get(product_id)
        if product is None:
            raise OrderValidationError(
                f"מוצר {product_id} לא קיים בקטלוג או אינו זמין", status_code=404)
        if not product.get("is_active", False):
            raise OrderValidationError(
                f"המוצר \"{product.get('name', product_id)}\" אינו זמין להזמנה")

        unit_price = float(product["base_price"])     # snapshot מה-DB — לא מהלקוח!
        line_total = round(unit_price * data["quantity"], 2)
        total += line_total
        items.append({
            "product_id": product_id,
            "quantity": data["quantity"],
            "unit_price": unit_price,
            "line_total": line_total,
            "notes": data["notes"],
        })

    order = {
        "customer_id": customer_id,
        "created_by": user_id,
        "status": "pending",
        "total_estimate": round(total, 2),
        "notes": order_in.notes,
    }
    return order, items
