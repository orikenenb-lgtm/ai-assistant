"""
נתיבי הדשבורד — אדמין בלבד (require_admin בכל endpoint).
קריאות בזהות האדמין (RLS מתיר לו הכל); פעולות מערכת (invite, audit) ב-service role.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_access_token, require_admin
from app.schemas.admin import (
    AdminOrderOut,
    CustomerOut,
    DashboardStats,
    InviteRequest,
    LinkUserRequest,
    OrderUpdateRequest,
    ProfileOut,
)
from app.schemas.auth import UserOut
from app.schemas.orders import OrderItemOut
from app.services.admin_service import StatusTransitionError, build_order_update
from app.services.supabase_client import get_service_client, get_user_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


def _audit(user_id: str, action: str, entity_type: str, entity_id: str,
           old_values: dict | None = None, new_values: dict | None = None) -> None:
    """רישום ב-audit_log (service role). כשל ברישום לא מפיל את הפעולה — רק לוג."""
    try:
        get_service_client().table("audit_log").insert({
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "old_values": old_values,
            "new_values": new_values,
        }).execute()
    except Exception:
        logger.exception("רישום audit נכשל: %s %s", action, entity_id)


def _admin_order_out(order: dict, items: list[dict] | None = None,
                     names: dict[str, str] | None = None,
                     customer_name: str | None = None) -> AdminOrderOut:
    return AdminOrderOut(
        id=order["id"],
        order_number=order["order_number"],
        status=order["status"],
        total_estimate=order.get("total_estimate"),
        final_total=order.get("final_total"),
        notes=order.get("notes"),
        admin_notes=order.get("admin_notes"),
        created_at=str(order["created_at"]),
        customer_id=order.get("customer_id"),
        customer_name=customer_name,
        rivhit_quote_id=order.get("rivhit_quote_id"),
        items=[OrderItemOut(
            id=i["id"], product_id=i["product_id"],
            product_name=(names or {}).get(i["product_id"]),
            quantity=i["quantity"], unit_price=float(i["unit_price"]),
            line_total=float(i.get("line_total") or 0), notes=i.get("notes"),
        ) for i in (items or [])],
    )


# ---------- סקירה כללית ----------

@router.get("/stats", response_model=DashboardStats)
def dashboard_stats(
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> DashboardStats:
    """מספרי הדשבורד: הזמנות לפי סטטוס, לקוחות, מוצרים, סנכרון אחרון."""
    client = get_user_client(token)

    orders = client.table("orders").select("status").execute().data or []
    by_status: dict[str, int] = {}
    for row in orders:
        by_status[row["status"]] = by_status.get(row["status"], 0) + 1

    customers = client.table("customers").select("id", count="exact").limit(1).execute()
    products = client.table("products").select("id", count="exact").limit(1).execute()
    last_sync = client.table("sync_logs").select("created_at").eq("status", "success") \
        .order("created_at", desc=True).limit(1).execute()

    return DashboardStats(
        orders_by_status=by_status,
        total_customers=customers.count or 0,
        total_products=products.count or 0,
        last_sync_at=str(last_sync.data[0]["created_at"]) if last_sync.data else None,
    )


# ---------- הזמנות ----------

@router.get("/orders", response_model=list[AdminOrderOut])
def list_all_orders(
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
) -> list[AdminOrderOut]:
    """כל ההזמנות, אופציונלית מסוננות לפי סטטוס, מהחדשה לישנה (L3)."""
    client = get_user_client(token)
    query = client.table("orders").select("*, customers(name)") \
        .order("created_at", desc=True)
    if status_filter:
        query = query.eq("status", status_filter)
    start = (page - 1) * page_size
    rows = query.range(start, start + page_size - 1).execute().data or []
    return [
        _admin_order_out(row, customer_name=(row.get("customers") or {}).get("name"))
        for row in rows
    ]


@router.get("/orders/{order_id}", response_model=AdminOrderOut)
def get_order_admin(
    order_id: str,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> AdminOrderOut:
    """הזמנה מלאה: שורות, שמות מוצרים, שם לקוח, הערות פנימיות."""
    client = get_user_client(token)
    result = client.table("orders").select("*, customers(name)") \
        .eq("id", order_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="ההזמנה לא נמצאה")
    order = result.data[0]

    items = client.table("order_items").select("*").eq("order_id", order_id).execute().data or []
    names: dict[str, str] = {}
    product_ids = list({i["product_id"] for i in items})
    if product_ids:
        products = client.table("products").select("id,name").in_("id", product_ids).execute()
        names = {p["id"]: p["name"] for p in (products.data or [])}

    return _admin_order_out(order, items, names,
                            customer_name=(order.get("customers") or {}).get("name"))


@router.patch("/orders/{order_id}", response_model=AdminOrderOut)
def update_order(
    order_id: str,
    body: OrderUpdateRequest,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> AdminOrderOut:
    """עדכון סטטוס/הערות/סכום סופי — עם ולידציית מעבר סטטוס ורישום audit."""
    client = get_user_client(token)
    current = client.table("orders").select("*").eq("id", order_id).limit(1).execute()
    if not current.data:
        raise HTTPException(status_code=404, detail="ההזמנה לא נמצאה")
    order = current.data[0]

    try:
        fields = build_order_update(order["status"], body)
    except StatusTransitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not fields:
        return get_order_admin(order_id, user, token)

    updated = client.table("orders").update(fields).eq("id", order_id).execute()
    if not updated.data:
        raise HTTPException(status_code=500, detail="העדכון נכשל — נסה שוב")

    _audit(user.id, "updated_order", "order", order_id,
           old_values={k: order.get(k) for k in fields},
           new_values=fields)
    return get_order_admin(order_id, user, token)


# ---------- לקוחות ----------

@router.get("/customers", response_model=list[CustomerOut])
def list_customers(
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
    search: str | None = Query(default=None, max_length=100),
) -> list[CustomerOut]:
    """כל הלקוחות (מסונכרנים מ-Rivhit), עם חיפוש לפי שם/עיר."""
    client = get_user_client(token)
    query = client.table("customers").select("*").order("name")
    if search:
        query = query.or_(f"name.ilike.%{search}%,city.ilike.%{search}%")
    rows = query.execute().data or []
    return [CustomerOut(**{**row, "synced_at": str(row.get("synced_at") or "") or None})
            for row in rows]


@router.post("/customers/invite", status_code=status.HTTP_201_CREATED)
def invite_customer(
    body: InviteRequest,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> dict:
    """
    הזמנת לקוח: Supabase שולח אימייל הזמנה; בהרשמה הפרופיל נוצר
    כבר מקושר ל-rivhit_customer_id (דרך ה-metadata וה-trigger).
    """
    client = get_user_client(token)
    exists = client.table("customers").select("id") \
        .eq("rivhit_id", body.rivhit_customer_id).limit(1).execute()
    if not exists.data:
        raise HTTPException(status_code=404,
                            detail="לקוח Rivhit לא נמצא — הרץ סנכרון קודם")

    service = get_service_client()
    try:
        service.auth.admin.invite_user_by_email(body.email, options={
            "data": {
                "full_name": body.full_name,
                "rivhit_customer_id": str(body.rivhit_customer_id),
            },
        })
    except Exception as exc:
        logger.warning("הזמנת %s נכשלה: %s", body.email, exc)
        raise HTTPException(status_code=400,
                            detail="שליחת ההזמנה נכשלה — ייתכן שהאימייל כבר רשום") from exc

    _audit(user.id, "invited_customer", "customer", exists.data[0]["id"],
           new_values={"email": body.email, "rivhit_customer_id": body.rivhit_customer_id})
    return {"message": f"נשלחה הזמנה ל-{body.email}"}


# ---------- משתמשים (פרופילים) ----------

@router.get("/users", response_model=list[ProfileOut])
def list_users(
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> list[ProfileOut]:
    """כל המשתמשים — לזיהוי מי ממתין לקישור ללקוח Rivhit."""
    client = get_user_client(token)
    rows = client.table("profiles").select("*").order("created_at", desc=True).execute().data or []
    return [ProfileOut(**row) for row in rows]


@router.patch("/users/{profile_id}", response_model=ProfileOut)
def update_user(
    profile_id: str,
    body: LinkUserRequest,
    user: UserOut = Depends(require_admin),
    token: str = Depends(get_access_token),
) -> ProfileOut:
    """קישור משתמש ללקוח Rivhit ו/או עדכון סטטוס חשבון."""
    fields: dict = {}
    if body.rivhit_customer_id is not None:
        fields["rivhit_customer_id"] = body.rivhit_customer_id
    if body.status is not None:
        fields["status"] = body.status
    if not fields:
        raise HTTPException(status_code=400, detail="לא נשלח שום שדה לעדכון")

    client = get_user_client(token)
    current = client.table("profiles").select("*").eq("id", profile_id).limit(1).execute()
    if not current.data:
        raise HTTPException(status_code=404, detail="המשתמש לא נמצא")

    updated = client.table("profiles").update(fields).eq("id", profile_id).execute()
    if not updated.data:
        raise HTTPException(status_code=500, detail="העדכון נכשל")

    _audit(user.id, "updated_user", "profile", profile_id,
           old_values={k: current.data[0].get(k) for k in fields}, new_values=fields)
    return ProfileOut(**updated.data[0])
