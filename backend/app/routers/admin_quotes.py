"""
נתיבי הצעת מחיר — הכתיבה היחידה ל-Rivhit במערכת.
POST /admin/orders/{id}/quote          → dry-run: preview בלבד, אפס כתיבה (Q1)
POST /admin/orders/{id}/quote/confirm  → push אמיתי, רק עם token מה-dry-run (Q2, Q3)
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.dependencies import get_access_token, require_admin
from app.schemas.auth import UserOut
from app.services.quote_service import (
    QuoteValidationError,
    build_preview,
    build_quote_items,
    confirmation_token,
    validate_order_quotable,
)
from app.services.rivhit_service import RivhitClient, RivhitError
from app.services.supabase_client import get_service_client, get_user_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/orders", tags=["admin-quotes"])

# ערך שריון זמני ל-rivhit_quote_id בזמן יצירת מסמך (0 = "בתהליך", לא מזהה אמיתי)
QUOTE_RESERVATION_SENTINEL = 0


class ConfirmQuoteRequest(BaseModel):
    confirmation_token: str


def get_rivhit_client() -> RivhitClient:
    """מוחלף ב-mock בבדיקות."""
    return RivhitClient()


def _load_quote_context(order_id: str, token: str) -> tuple[dict, list[dict], dict, str, int]:
    """שולף הזמנה + שורות + לקוח, ומריץ את כל הולידציות (Q4)."""
    client = get_user_client(token)

    result = client.table("orders").select("*").eq("id", order_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="ההזמנה לא נמצאה")
    order = result.data[0]

    items = client.table("order_items").select("*").eq("order_id", order_id).execute().data or []

    customer_rivhit_id: int | None = None
    customer_name = "לקוח"
    if order.get("customer_id"):
        customer = client.table("customers").select("rivhit_id,name") \
            .eq("id", order["customer_id"]).limit(1).execute()
        if customer.data:
            customer_rivhit_id = customer.data[0]["rivhit_id"]
            customer_name = customer.data[0]["name"]

    try:
        validate_order_quotable(order, items, customer_rivhit_id)
    except QuoteValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    product_ids = list({i["product_id"] for i in items})
    products = client.table("products").select("id,rivhit_id,name").in_("id", product_ids).execute()
    rivhit_ids = {p["id"]: p["rivhit_id"] for p in (products.data or [])}
    names = {p["id"]: p["name"] for p in (products.data or [])}

    try:
        quote_items = build_quote_items(items, rivhit_ids)
    except QuoteValidationError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    # מעשירים את השורות בשמות לתצוגה
    for item in items:
        item["product_name"] = names.get(item["product_id"])

    return order, items, quote_items, customer_name, customer_rivhit_id


@router.post("/{order_id}/quote")
def quote_dry_run(
    order_id: str,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> dict:
    """
    Dry-run (Q1): מחזיר בדיוק מה שיישלח ל-Rivhit + token אישור.
    לא כותב כלום — לא ל-Rivhit, לא ל-DB, אפילו לא לוג סנכרון.
    """
    order, items, quote_items, customer_name, _ = _load_quote_context(order_id, token)

    from app.schemas.orders import OrderItemOut
    item_models = [OrderItemOut(
        id=i["id"], product_id=i["product_id"], product_name=i.get("product_name"),
        quantity=i["quantity"], unit_price=float(i["unit_price"]),
        line_total=float(i.get("line_total") or 0), notes=i.get("notes"),
    ) for i in items]

    preview = build_preview(order, item_models, customer_name, quote_items)
    preview["dry_run"] = True
    return preview


@router.post("/{order_id}/quote/confirm")
def quote_confirm(
    order_id: str,
    body: ConfirmQuoteRequest,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
    rivhit: RivhitClient = Depends(get_rivhit_client),
) -> dict:
    """
    ⚠️ Push אמיתי ל-Rivhit (Q2) — רק אחרי dry-run, עם ה-token שהוא החזיר (Q3).
    מוגן גם במפסק RIVHIT_WRITE_ENABLED (כבוי בסביבות שאינן production).
    """
    order, _, quote_items, _, customer_rivhit_id = _load_quote_context(order_id, token)

    expected = confirmation_token(order_id, quote_items)
    if body.confirmation_token != expected:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ההזמנה השתנתה מאז התצוגה המקדימה — הרץ תצוגה מקדימה מחדש ואשר שוב",
        )

    client = get_user_client(token)

    # שריון אטומי (compare-and-swap): רק בקשה אחת תופסת את ההזמנה.
    # מונע הצעה כפולה ב-Rivhit כששני אדמינים מאשרים במקביל.
    reservation = client.table("orders") \
        .update({"rivhit_quote_id": QUOTE_RESERVATION_SENTINEL}) \
        .eq("id", order_id).is_("rivhit_quote_id", "null").execute()
    if not reservation.data:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="ההזמנה כבר בטיפול על ידי בקשה אחרת — רענן את הדף",
        )

    try:
        quote_id = rivhit.create_quote(
            customer_rivhit_id, quote_items,
            comments=f"Kerem Orders — הזמנה #{order['order_number']}")
    except RivhitError as exc:
        # Q5: הכתיבה ל-Rivhit נכשלה — משחררים את השריון כדי לאפשר ניסיון חוזר
        try:
            client.table("orders").update({"rivhit_quote_id": None}) \
                .eq("id", order_id).execute()
        except Exception:
            logger.exception("שחרור שריון ההצעה נכשל (הזמנה %s)", order_id)
        logger.error("יצירת הצעה ל-Rivhit נכשלה (הזמנה %s): %s", order_id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    # המסמך נוצר ב-Rivhit — עכשיו מעדכנים את ההזמנה אצלנו
    from app.services.admin_service import build_order_update
    from app.schemas.admin import OrderUpdateRequest
    fields = build_order_update(order["status"], OrderUpdateRequest(status="quoted"))
    fields["rivhit_quote_id"] = quote_id

    updated = client.table("orders").update(fields).eq("id", order_id).execute()
    if not updated.data:
        # Q5 קריטי: המסמך קיים ב-Rivhit אבל לא נשמר אצלנו — חייב טיפול ידני
        logger.critical(
            "מסמך %s נוצר ב-Rivhit אך עדכון ההזמנה %s נכשל! לעדכן ידנית.",
            quote_id, order_id)
        raise HTTPException(
            status_code=500,
            detail=f"ההצעה נוצרה ב-Rivhit (מסמך {quote_id}) אך עדכון ההזמנה נכשל — "
                   "אל תיצור שוב! פנה לתמיכה")

    try:
        get_service_client().table("audit_log").insert({
            "user_id": user.id,
            "action": "quoted_order",
            "entity_type": "order",
            "entity_id": order_id,
            "new_values": {"rivhit_quote_id": quote_id, "status": "quoted"},
        }).execute()
    except Exception:
        logger.exception("רישום audit של הצעה נכשל")

    return {
        "message": f"הצעת מחיר נוצרה ב-Rivhit (מסמך {quote_id})",
        "rivhit_quote_id": quote_id,
        "order_status": "quoted",
    }
