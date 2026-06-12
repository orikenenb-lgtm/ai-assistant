"""סכמות הדשבורד — עדכון הזמנות, לקוחות, הזמנת משתמשים."""
from pydantic import BaseModel, EmailStr, Field

from app.schemas.orders import OrderOut

ORDER_STATUSES = ("pending", "reviewed", "quoted", "confirmed", "shipped", "closed", "cancelled")


class OrderUpdateRequest(BaseModel):
    """עדכון הזמנה על ידי אדמין — סטטוס ו/או הערות פנימיות."""
    status: str | None = Field(default=None, pattern="^(" + "|".join(ORDER_STATUSES) + ")$")
    admin_notes: str | None = Field(default=None, max_length=2000)
    final_total: float | None = Field(default=None, ge=0)


class AdminOrderOut(OrderOut):
    """הזמנה בעיני אדמין — כולל שם הלקוח והערות פנימיות."""
    customer_id: str | None = None
    customer_name: str | None = None
    admin_notes: str | None = None
    rivhit_quote_id: int | None = None


class CustomerOut(BaseModel):
    id: str
    rivhit_id: int
    name: str
    city: str | None = None
    region: str | None = None
    phone: str | None = None
    email: str | None = None
    price_list_id: int | None = None
    is_active: bool = True
    synced_at: str | None = None


class ProfileOut(BaseModel):
    id: str
    role: str
    full_name: str | None = None
    phone: str | None = None
    rivhit_customer_id: int | None = None
    status: str


class InviteRequest(BaseModel):
    """הזמנת לקוח: אימייל + הלקוח ב-Rivhit שאליו יקושר."""
    email: EmailStr
    rivhit_customer_id: int
    full_name: str | None = None


class LinkUserRequest(BaseModel):
    """קישור ידני של משתמש קיים ללקוח Rivhit."""
    rivhit_customer_id: int | None = None
    status: str | None = Field(default=None, pattern="^(active|pending_approval|inactive)$")


class DashboardStats(BaseModel):
    orders_by_status: dict[str, int]
    total_customers: int
    total_products: int
    last_sync_at: str | None = None
