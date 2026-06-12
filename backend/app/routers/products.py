"""נתיבי קטלוג — קריאה בלבד. ה-RLS מסתיר מוצרים לא פעילים מלקוחות (O7)."""
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import get_access_token, get_current_user
from app.schemas.auth import UserOut
from app.schemas.orders import ProductOut
from app.services.supabase_client import get_user_client

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[ProductOut])
def list_products(
    user: UserOut = Depends(get_current_user),
    token: str = Depends(get_access_token),
    search: str | None = Query(default=None, max_length=100),
    category: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=48, ge=1, le=100),
) -> list[ProductOut]:
    """
    הקטלוג: חיפוש לפי שם/מק"ט, סינון קטגוריה, pagination (L1).
    הקריאה בזהות המשתמש — RLS מחזיר ללקוח רק מוצרים פעילים.
    """
    client = get_user_client(token)
    query = client.table("products").select("*").order("name")

    if search:
        # חיפוש גם בשם וגם במק"ט
        query = query.or_(f"name.ilike.%{search}%,sku.ilike.%{search}%")
    if category:
        query = query.eq("category", category)

    start = (page - 1) * page_size
    result = query.range(start, start + page_size - 1).execute()
    return [ProductOut(**row) for row in (result.data or [])]


@router.get("/categories", response_model=list[str])
def list_categories(
    user: UserOut = Depends(get_current_user),
    token: str = Depends(get_access_token),
) -> list[str]:
    """רשימת הקטגוריות הקיימות — לסינון בקטלוג."""
    client = get_user_client(token)
    result = client.table("products").select("category").execute()
    categories = {row["category"] for row in (result.data or []) if row.get("category")}
    return sorted(categories)


@router.get("/{product_id}", response_model=ProductOut)
def get_product(
    product_id: str,
    user: UserOut = Depends(get_current_user),
    token: str = Depends(get_access_token),
) -> ProductOut:
    """מוצר בודד. לא קיים / לא פעיל ללקוח → 404 (O6)."""
    client = get_user_client(token)
    result = client.table("products").select("*").eq("id", product_id).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="המוצר לא נמצא")
    return ProductOut(**result.data[0])
