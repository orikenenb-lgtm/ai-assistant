"""
נתיבי הזמנות (לקוח): יצירה וצפייה בהזמנות שלי.
כל הפעולות בזהות המשתמש (user client) — ה-RLS אוכף בעלות גם ברמת ה-DB.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_access_token, get_current_user
from app.schemas.auth import UserOut
from app.schemas.orders import OrderCreate, OrderItemOut, OrderOut
from app.services.orders_service import OrderValidationError, build_order_payload
from app.services.supabase_client import get_service_client, get_user_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orders", tags=["orders"])


def _resolve_customer_id(client, user: UserOut) -> str:
    """מאתר את רשומת ה-customer המקושרת למשתמש. לא מקושר → 403 עם הסבר."""
    if user.role == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="יצירת הזמנה בשם לקוח תתווסף בדשבורד האדמין (Phase 4)",
        )
    if not user.rivhit_customer_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="החשבון עדיין לא קושר ללקוח — פנה למנהל המערכת",
        )
    result = client.table("customers").select("id") \
        .eq("rivhit_id", user.rivhit_customer_id).limit(1).execute()
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="הלקוח המקושר לא נמצא — פנה למנהל המערכת",
        )
    return result.data[0]["id"]


def _order_out(order: dict, items: list[dict], product_names: dict[str, str]) -> OrderOut:
    return OrderOut(
        id=order["id"],
        order_number=order["order_number"],
        status=order["status"],
        total_estimate=order.get("total_estimate"),
        final_total=order.get("final_total"),
        notes=order.get("notes"),
        created_at=str(order["created_at"]),
        items=[OrderItemOut(
            id=item["id"],
            product_id=item["product_id"],
            product_name=product_names.get(item["product_id"]),
            quantity=item["quantity"],
            unit_price=float(item["unit_price"]),
            line_total=float(item.get("line_total") or 0),
            notes=item.get("notes"),
        ) for item in items],
    )


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderCreate,
    user: UserOut = Depends(get_current_user),
    token: str = Depends(get_access_token),
) -> OrderOut:
    """
    יצירת הזמנה (O1): המחירים נלקחים מה-DB ברגע זה (snapshot, O8).
    הכתיבה בזהות המשתמש — ה-RLS מוודא שההזמנה על שם הלקוח שלו בלבד.
    """
    client = get_user_client(token)
    customer_id = _resolve_customer_id(client, user)

    # שליפת המוצרים המבוקשים דרך RLS — לקוח רואה רק פעילים (O6, O7)
    product_ids = list({item.product_id for item in body.items})
    products_result = client.table("products").select("*").in_("id", product_ids).execute()
    products_by_id = {p["id"]: p for p in (products_result.data or [])}

    try:
        order_payload, items_payload = build_order_payload(
            body, products_by_id, customer_id, user.id)
    except OrderValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    inserted = client.table("orders").insert(order_payload).execute()
    if not inserted.data:
        raise HTTPException(status_code=500, detail="יצירת ההזמנה נכשלה — נסה שוב")
    order = inserted.data[0]

    try:
        for item in items_payload:
            item["order_id"] = order["id"]
        items_result = client.table("order_items").insert(items_payload).execute()
        items = items_result.data or []
    except Exception as exc:
        # שורות נכשלו — מוחקים את ההזמנה היתומה (תיקון מערכת, service role)
        logger.error("הכנסת שורות נכשלה להזמנה %s — מנקה: %s", order["id"], exc)
        try:
            get_service_client().table("orders").delete().eq("id", order["id"]).execute()
        except Exception:
            logger.exception("גם ניקוי ההזמנה היתומה נכשל (order_id=%s)", order["id"])
        raise HTTPException(status_code=500, detail="יצירת ההזמנה נכשלה — נסה שוב") from exc

    names = {p["id"]: p["name"] for p in products_by_id.values()}
    return _order_out(order, items, names)


@router.get("", response_model=list[OrderOut])
def list_my_orders(
    user: UserOut = Depends(get_current_user),
    token: str = Depends(get_access_token),
) -> list[OrderOut]:
    """ההזמנות שלי (A4: ה-RLS מחזיר ללקוח רק את שלו), מהחדשה לישנה."""
    client = get_user_client(token)
    result = client.table("orders").select("*").order("created_at", desc=True).execute()
    return [_order_out(order, [], {}) for order in (result.data or [])]


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: str,
    user: UserOut = Depends(get_current_user),
    token: str = Depends(get_access_token),
) -> OrderOut:
    """הזמנה בודדת עם שורותיה. של מישהו אחר → 404 (ה-RLS פשוט לא מחזיר אותה)."""
    client = get_user_client(token)
    result = client.table("orders").select("*").eq("id", order_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ההזמנה לא נמצאה")
    order = result.data[0]

    items = client.table("order_items").select("*").eq("order_id", order_id).execute().data or []
    product_ids = list({item["product_id"] for item in items})
    names: dict[str, str] = {}
    if product_ids:
        products = client.table("products").select("id,name").in_("id", product_ids).execute()
        names = {p["id"]: p["name"] for p in (products.data or [])}
    return _order_out(order, items, names)
