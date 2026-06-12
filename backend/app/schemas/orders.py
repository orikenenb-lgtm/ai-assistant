"""סכמות מוצרים והזמנות — ולידציה קשיחה על כל קלט (O2-O5)."""
from pydantic import BaseModel, Field


class ProductOut(BaseModel):
    id: str
    rivhit_id: int
    sku: str | None = None
    name: str
    category: str | None = None
    description: str | None = None
    base_price: float
    stock_quantity: int = 0
    unit: str | None = None
    image_url: str | None = None
    is_active: bool = True


class OrderItemIn(BaseModel):
    product_id: str
    # gt=0 חוסם כמות אפס ושלילית (O3, O4); טיפוס int חוסם "abc" (O5)
    quantity: int = Field(gt=0, le=100_000)
    notes: str | None = Field(default=None, max_length=500)


class OrderCreate(BaseModel):
    # min_length=1 חוסם הזמנה ריקה (O2)
    items: list[OrderItemIn] = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)


class OrderItemOut(BaseModel):
    id: str
    product_id: str
    product_name: str | None = None
    quantity: int
    unit_price: float
    line_total: float
    notes: str | None = None


class OrderOut(BaseModel):
    id: str
    order_number: int
    status: str
    total_estimate: float | None = None
    final_total: float | None = None
    notes: str | None = None
    created_at: str
    items: list[OrderItemOut] = []
